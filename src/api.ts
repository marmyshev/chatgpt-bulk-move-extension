import type { ConversationSummary, Project } from "./shared";

const ORIGIN = "https://chatgpt.com";
const CONVERSATION_PAGE_SIZE = 100;
const PROJECT_PAGE_SIZE = 20;
const MAX_RETRIES = 4;

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    function onAbort() {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    }

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function readCookie(name: string): string | null {
  const parts = document.cookie.split(";");

  for (const part of parts) {
    const index = part.indexOf("=");
    if (index < 0) continue;

    if (part.slice(0, index).trim() === name) {
      return decodeURIComponent(part.slice(index + 1).trim());
    }
  }

  return null;
}

type SessionResponse = {
  accessToken?: string;
  error?: string;
};

type AccountsCheckResponse = {
  accounts?: Record<string, { account?: { account_id?: string } }>;
};

let cachedToken: string | null = null;
let cachedAccountId: string | null = null;
let tokenPromise: Promise<string> | null = null;

async function fetchAccessToken(): Promise<string> {
  const response = await fetch(`${ORIGIN}/api/auth/session`, {
    credentials: "include",
    headers: { accept: "application/json" }
  });

  if (!response.ok) {
    throw new ApiError(
      response.status,
      `Could not read the ChatGPT session (HTTP ${response.status}). Make sure you are signed in.`
    );
  }

  const data = (await response.json()) as SessionResponse;

  if (!data.accessToken) {
    throw new ApiError(401, "ChatGPT session has no access token. Sign in again and reload the page.");
  }

  return data.accessToken;
}

async function getAccessToken(forceRefresh = false): Promise<string> {
  if (!forceRefresh && cachedToken) return cachedToken;

  if (forceRefresh) {
    cachedToken = null;
    tokenPromise = null;
  }

  tokenPromise ??= fetchAccessToken()
    .then(token => {
      cachedToken = token;
      return token;
    })
    .finally(() => {
      tokenPromise = null;
    });

  return tokenPromise;
}

async function getAccountId(): Promise<string | null> {
  if (cachedAccountId) return cachedAccountId;

  try {
    const token = await getAccessToken();

    const response = await fetch(`${ORIGIN}/backend-api/accounts/check/v4-2023-04-27`, {
      credentials: "include",
      headers: {
        accept: "*/*",
        authorization: `Bearer ${token}`
      }
    });

    if (!response.ok) return null;

    const data = (await response.json()) as AccountsCheckResponse;
    const accounts = data.accounts ?? {};
    const personal = accounts["default"] ?? accounts["personal"];
    const first = personal ?? Object.values(accounts)[0];

    cachedAccountId = first?.account?.account_id ?? null;
    return cachedAccountId;
  } catch {
    return null;
  }
}

type RequestOptions = {
  method?: "GET" | "PATCH" | "POST";
  body?: unknown;
  signal?: AbortSignal;
};

async function buildHeaders(token: string, hasBody: boolean): Promise<HeadersInit> {
  const headers: Record<string, string> = {
    accept: "*/*",
    authorization: `Bearer ${token}`
  };

  if (hasBody) {
    headers["content-type"] = "application/json";
  }

  const accountId = await getAccountId();
  if (accountId) {
    headers["chatgpt-account-id"] = accountId;
  }

  const deviceId = readCookie("oai-did");
  if (deviceId) {
    headers["oai-device-id"] = deviceId;
    headers["oai-did"] = deviceId;
  }

  headers["oai-language"] = "en-US";

  return headers;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, signal } = options;
  let refreshed = false;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    signal?.throwIfAborted();

    const token = await getAccessToken();

    const response = await fetch(`${ORIGIN}${path}`, {
      method,
      credentials: "include",
      signal,
      headers: await buildHeaders(token, body !== undefined),
      body: body === undefined ? undefined : JSON.stringify(body)
    });

    if (response.ok) {
      return (await response.json()) as T;
    }

    if ((response.status === 401 || response.status === 403) && !refreshed) {
      refreshed = true;
      await getAccessToken(true);
      continue;
    }

    const retryable = response.status === 429 || response.status >= 500;

    if (retryable && attempt < MAX_RETRIES) {
      const retryAfter = Number(response.headers.get("retry-after"));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : Math.min(8000, 500 * 2 ** attempt);

      await sleep(waitMs, signal);
      continue;
    }

    const detail = await response.text().catch(() => "");
    throw new ApiError(
      response.status,
      `HTTP ${response.status} on ${path}${detail ? `: ${detail.slice(0, 200)}` : ""}`
    );
  }

  throw new ApiError(0, `Request to ${path} failed after ${MAX_RETRIES + 1} attempts.`);
}

type RawConversation = {
  id: string;
  title: string | null;
  create_time: string | null;
  update_time: string | null;
  gizmo_id: string | null;
  is_archived: boolean | null;
};

type ConversationsResponse = {
  items: RawConversation[];
  total: number;
  limit: number;
  offset: number;
};

function toSummary(raw: RawConversation): ConversationSummary {
  return {
    id: raw.id,
    title: (raw.title ?? "").trim() || "(untitled)",
    updateTime: raw.update_time,
    createTime: raw.create_time,
    gizmoId: raw.gizmo_id ?? null,
    isArchived: Boolean(raw.is_archived)
  };
}

export type ListProgress = (loaded: number, total: number) => void;

export async function listConversations(
  options: { signal?: AbortSignal; onProgress?: ListProgress; includeArchived?: boolean } = {}
): Promise<ConversationSummary[]> {
  const { signal, onProgress, includeArchived = false } = options;

  const seen = new Set<string>();
  const result: ConversationSummary[] = [];

  let offset = 0;
  let total = Number.POSITIVE_INFINITY;

  while (offset < total) {
    const params = new URLSearchParams({
      offset: String(offset),
      limit: String(CONVERSATION_PAGE_SIZE),
      order: "updated",
      is_archived: String(includeArchived)
    });

    const page = await request<ConversationsResponse>(
      `/backend-api/conversations?${params.toString()}`,
      { signal }
    );

    total = Number.isFinite(page.total) ? page.total : result.length;

    for (const raw of page.items ?? []) {
      if (seen.has(raw.id)) continue;
      seen.add(raw.id);
      result.push(toSummary(raw));
    }

    onProgress?.(result.length, total);

    if (!page.items || page.items.length === 0) break;
    offset += page.items.length;
  }

  return result;
}

type RawGizmo = {
  id: string;
  display?: { name?: string | null } | null;
  is_archived?: boolean | null;
};

type SidebarItem = {
  gizmo?: { gizmo?: RawGizmo | null } | null;
};

type SidebarResponse = {
  items: SidebarItem[];
  cursor?: string | null;
};

export async function listProjects(signal?: AbortSignal): Promise<Project[]> {
  const projects: Project[] = [];
  const seen = new Set<string>();

  let cursor: string | null | undefined;

  for (let page = 0; page < 50; page += 1) {
    const params = new URLSearchParams({
      conversations_per_gizmo: "0",
      limit: String(PROJECT_PAGE_SIZE),
      owned_only: "false"
    });

    if (cursor) params.set("cursor", cursor);

    const data = await request<SidebarResponse>(
      `/backend-api/gizmos/snorlax/sidebar?${params.toString()}`,
      { signal }
    );

    for (const item of data.items ?? []) {
      const gizmo = item.gizmo?.gizmo;
      if (!gizmo?.id || seen.has(gizmo.id)) continue;
      if (gizmo.is_archived) continue;

      seen.add(gizmo.id);
      projects.push({
        id: gizmo.id,
        name: (gizmo.display?.name ?? "").trim() || gizmo.id
      });
    }

    cursor = data.cursor;
    if (!cursor || (data.items ?? []).length === 0) break;
  }

  projects.sort((a, b) => a.name.localeCompare(b.name));
  return projects;
}

type MoveResponse = {
  success?: boolean;
};

export async function moveConversation(
  conversationId: string,
  gizmoId: string | null,
  signal?: AbortSignal
): Promise<void> {
  const data = await request<MoveResponse>(
    `/backend-api/conversation/${encodeURIComponent(conversationId)}`,
    {
      method: "PATCH",
      body: { gizmo_id: gizmoId },
      signal
    }
  );

  if (data.success !== true) {
    throw new ApiError(0, "ChatGPT did not confirm the move.");
  }
}
