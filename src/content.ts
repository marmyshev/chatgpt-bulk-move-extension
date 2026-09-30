import type { RequestMessage, RunnerStatus, StartMessage } from "./shared";

const UI_TEXT = {
  rootSectionLabels: ["Chats", "Recent", "Your chats"],
  moveToProject: ["Move to project"],
  loadMore: ["Show more", "Load more"],
  projectSearchPlaceholders: ["Search projects", "Search"]
};

const status: RunnerStatus = {
  running: false,
  moved: 0,
  skipped: 0,
  phase: "Ready"
};

let runToken = 0;
const processedConversationIds = new Set<string>();

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function isVisible(element: Element): boolean {
  if (!(element instanceof HTMLElement)) return false;

  const style = getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
    return false;
  }

  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function findSidebar(): HTMLElement | null {
  const candidates = Array.from(document.querySelectorAll<HTMLElement>("nav, aside"));
  const withChats = candidates.find(el => el.querySelector('a[href^="/c/"]'));
  return withChats ?? candidates[0] ?? null;
}

function findRootSectionLabel(sidebar: HTMLElement): HTMLElement | null {
  const all = Array.from(sidebar.querySelectorAll<HTMLElement>("*"));

  for (const wanted of UI_TEXT.rootSectionLabels) {
    const match = all.find(element => {
      if (!isVisible(element)) return false;
      if (element.matches("a, button, input, textarea")) return false;
      return normalizeText(element.textContent) === wanted;
    });

    if (match) return match;
  }

  return null;
}

function conversationIdFromHref(href: string): string {
  const url = new URL(href, location.origin);
  const match = url.pathname.match(/^\/c\/([^/?#]+)/);
  return match?.[1] ?? url.pathname;
}

function getRootChatLinks(): HTMLAnchorElement[] {
  const sidebar = findSidebar();
  if (!sidebar) {
    throw new Error("Could not locate the ChatGPT sidebar.");
  }

  const label = findRootSectionLabel(sidebar);
  if (!label) {
    throw new Error(
      `Could not confidently locate the root chat section. Expected one of: ${UI_TEXT.rootSectionLabels.join(", ")}.`
    );
  }

  const links = Array.from(sidebar.querySelectorAll<HTMLAnchorElement>('a[href^="/c/"]'))
    .filter(link => {
      const relation = label.compareDocumentPosition(link);
      const comesAfterLabel = Boolean(relation & Node.DOCUMENT_POSITION_FOLLOWING);
      return comesAfterLabel && isVisible(link);
    })
    .filter(link => !processedConversationIds.has(conversationIdFromHref(link.href)));

  return links;
}

function getChatTitle(link: HTMLAnchorElement): string {
  return (
    normalizeText(link.getAttribute("aria-label")) ||
    normalizeText(link.textContent) ||
    conversationIdFromHref(link.href)
  );
}

function findScrollableAncestor(start: Element): HTMLElement | null {
  let current: HTMLElement | null = start instanceof HTMLElement ? start : start.parentElement;

  while (current && current !== document.body) {
    const style = getComputedStyle(current);
    const overflowY = style.overflowY;
    const canScroll = /(auto|scroll)/.test(overflowY) && current.scrollHeight > current.clientHeight + 8;

    if (canScroll) return current;
    current = current.parentElement;
  }

  return null;
}

async function waitFor<T>(
  producer: () => T | null | undefined,
  timeoutMs: number,
  intervalMs = 75
): Promise<T> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const value = producer();
    if (value != null) return value;
    await sleep(intervalMs);
  }

  throw new Error("Timed out waiting for the ChatGPT UI.");
}

function getVisibleOverlays(): HTMLElement[] {
  const selectors = [
    '[role="menu"]',
    '[role="dialog"]',
    '[role="listbox"]',
    '[data-radix-popper-content-wrapper]'
  ].join(",");

  return Array.from(document.querySelectorAll<HTMLElement>(selectors)).filter(isVisible);
}

function findOverlayCandidates(text: string): HTMLElement[] {
  const exact = normalizeText(text);

  const candidateSelectors = [
    '[role="menuitem"]',
    '[role="option"]',
    "button",
    "a"
  ].join(",");

  const matches: HTMLElement[] = [];

  for (const overlay of getVisibleOverlays()) {
    for (const candidate of Array.from(overlay.querySelectorAll<HTMLElement>(candidateSelectors))) {
      if (!isVisible(candidate)) continue;
      if (normalizeText(candidate.textContent) === exact) {
        matches.push(candidate);
      }
    }
  }

  return Array.from(new Set(matches));
}

function findUniqueOverlayItem(text: string): HTMLElement | null {
  const matches = findOverlayCandidates(text);

  if (matches.length > 1) {
    throw new Error(`More than one visible menu item is named "${text}". Refusing an ambiguous click.`);
  }

  return matches[0] ?? null;
}

function findAnyOverlayItem(labels: string[]): HTMLElement | null {
  for (const label of labels) {
    const item = findUniqueOverlayItem(label);
    if (item) return item;
  }
  return null;
}

function dispatchContextMenu(target: HTMLElement): void {
  const rect = target.getBoundingClientRect();

  target.dispatchEvent(new MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: window,
    button: 2,
    buttons: 2,
    clientX: Math.round(rect.left + Math.min(30, rect.width / 2)),
    clientY: Math.round(rect.top + Math.min(20, rect.height / 2))
  }));
}

function findMenuButtonNear(link: HTMLAnchorElement): HTMLButtonElement | null {
  let container: HTMLElement | null = link.parentElement;

  for (let i = 0; i < 5 && container; i += 1, container = container.parentElement) {
    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).filter(isVisible);

    const semantic = buttons.find(button => {
      const label = normalizeText(button.getAttribute("aria-label")).toLowerCase();
      const title = normalizeText(button.getAttribute("title")).toLowerCase();
      return /more|option|menu/.test(`${label} ${title}`);
    });

    if (semantic) return semantic;

    if (buttons.length === 1) return buttons[0];
  }

  return null;
}

async function openMoveMenu(link: HTMLAnchorElement): Promise<HTMLElement> {
  link.scrollIntoView({ block: "center", inline: "nearest" });
  await sleep(150);

  dispatchContextMenu(link);

  try {
    return await waitFor(() => findAnyOverlayItem(UI_TEXT.moveToProject), 1800);
  } catch {
    const fallbackButton = findMenuButtonNear(link);

    if (!fallbackButton) {
      throw new Error(`Could not open the menu for "${getChatTitle(link)}".`);
    }

    fallbackButton.click();
    return await waitFor(() => findAnyOverlayItem(UI_TEXT.moveToProject), 1800);
  }
}

function setReactCompatibleInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;

  if (setter) {
    setter.call(input, value);
  } else {
    input.value = value;
  }

  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function findProjectSearchInput(): HTMLInputElement | null {
  for (const overlay of getVisibleOverlays()) {
    const inputs = Array.from(overlay.querySelectorAll<HTMLInputElement>("input")).filter(isVisible);

    const preferred = inputs.find(input => {
      const placeholder = normalizeText(input.placeholder);
      return UI_TEXT.projectSearchPlaceholders.some(text => placeholder.includes(text));
    });

    if (preferred) return preferred;
    if (inputs.length === 1) return inputs[0];
  }

  return null;
}

function scrollProjectOverlay(): boolean {
  const overlays = getVisibleOverlays();

  for (const overlay of overlays.reverse()) {
    const elements = [overlay, ...Array.from(overlay.querySelectorAll<HTMLElement>("*"))];

    for (const element of elements) {
      if (!isVisible(element)) continue;
      if (element.scrollHeight <= element.clientHeight + 8) continue;

      const before = element.scrollTop;
      element.scrollTop = Math.min(
        element.scrollHeight,
        element.scrollTop + Math.max(120, Math.floor(element.clientHeight * 0.8))
      );

      if (element.scrollTop !== before) return true;
    }
  }

  return false;
}

async function chooseProject(projectName: string): Promise<void> {
  const moveItem = await waitFor(() => findAnyOverlayItem(UI_TEXT.moveToProject), 1200);
  moveItem.click();

  await sleep(200);

  let projectItem = findUniqueOverlayItem(projectName);
  if (projectItem) {
    projectItem.click();
    return;
  }

  const search = findProjectSearchInput();
  if (search) {
    search.focus();
    setReactCompatibleInputValue(search, projectName);
    await sleep(350);

    projectItem = findUniqueOverlayItem(projectName);
    if (!projectItem) {
      throw new Error(`Project "${projectName}" was not found after searching the move menu.`);
    }

    projectItem.click();
    return;
  }

  for (let i = 0; i < 10; i += 1) {
    const didScroll = scrollProjectOverlay();
    if (!didScroll) break;

    await sleep(200);
    projectItem = findUniqueOverlayItem(projectName);
    if (projectItem) {
      projectItem.click();
      return;
    }
  }

  throw new Error(`Project "${projectName}" is not visible in the move menu.`);
}

async function waitForMoveToApply(conversationId: string): Promise<boolean> {
  const deadline = Date.now() + 7000;

  while (Date.now() < deadline) {
    const stillInRoot = getRootChatLinks().some(
      link => conversationIdFromHref(link.href) === conversationId
    );

    if (!stillInRoot) return true;
    await sleep(150);
  }

  return false;
}

function dismissOpenMenus(): void {
  document.dispatchEvent(new KeyboardEvent("keydown", {
    key: "Escape",
    code: "Escape",
    bubbles: true,
    cancelable: true
  }));

  document.dispatchEvent(new KeyboardEvent("keyup", {
    key: "Escape",
    code: "Escape",
    bubbles: true,
    cancelable: true
  }));
}

function findLoadMoreButton(): HTMLButtonElement | null {
  const sidebar = findSidebar();
  if (!sidebar) return null;

  const label = findRootSectionLabel(sidebar);
  if (!label) return null;

  return Array.from(sidebar.querySelectorAll<HTMLButtonElement>("button"))
    .filter(isVisible)
    .filter(button => {
      const relation = label.compareDocumentPosition(button);
      return Boolean(relation & Node.DOCUMENT_POSITION_FOLLOWING);
    })
    .find(button => UI_TEXT.loadMore.includes(normalizeText(button.textContent))) ?? null;
}

async function tryLoadMore(): Promise<boolean> {
  const loadMore = findLoadMoreButton();
  if (loadMore) {
    loadMore.click();
    await sleep(900);
    return true;
  }

  const sidebar = findSidebar();
  if (!sidebar) return false;

  const rootLinks = getRootChatLinks();
  const anchor = rootLinks.at(-1) ?? findRootSectionLabel(sidebar);
  if (!anchor) return false;

  const scroller = findScrollableAncestor(anchor) ?? findScrollableAncestor(sidebar);
  if (!scroller) return false;

  const beforeTop = scroller.scrollTop;
  const beforeHeight = scroller.scrollHeight;

  scroller.scrollTop = scroller.scrollHeight;
  scroller.dispatchEvent(new Event("scroll", { bubbles: true }));

  await sleep(1000);

  return scroller.scrollTop !== beforeTop || scroller.scrollHeight !== beforeHeight;
}

type MoveResult =
  | { moved: true; title: string }
  | { moved: false; title: string; reason: string };

async function moveOne(link: HTMLAnchorElement, projectName: string): Promise<MoveResult> {
  const conversationId = conversationIdFromHref(link.href);
  const title = getChatTitle(link);

  status.phase = `Opening menu: ${title}`;
  status.lastChatTitle = title;
  status.lastSkipReason = undefined;

  try {
    await openMoveMenu(link);

    status.phase = `Moving: ${title}`;
    await chooseProject(projectName);

    const moved = await waitForMoveToApply(conversationId);
    if (!moved) {
      return {
        moved: false,
        title,
        reason: "Chat remained in the root list after the move attempt."
      };
    }

    return { moved: true, title };
  } catch (error) {
    return {
      moved: false,
      title,
      reason: error instanceof Error ? error.message : String(error)
    };
  } finally {
    // Whether moved or skipped, never try this chat again in the same run.
    processedConversationIds.add(conversationId);
    dismissOpenMenus();
  }
}

async function run(config: StartMessage, token: number): Promise<void> {
  const projectName = config.projectName.trim();
  const delayMs = Math.max(500, Math.min(10000, config.delayMs));
  const maxChats = config.maxChats ?? Number.POSITIVE_INFINITY;

  let stableEmptyRounds = 0;

  try {
    // Fail before moving anything if the root section cannot be identified.
    getRootChatLinks();

    while (
      token === runToken &&
      status.running &&
      status.moved + status.skipped < maxChats
    ) {
      const candidates = getRootChatLinks();

      if (candidates.length > 0) {
        stableEmptyRounds = 0;
        const result = await moveOne(candidates[0], projectName);

        if (result.moved) {
          status.moved += 1;
          status.phase = `Moved: ${result.title}`;
        } else {
          status.skipped += 1;
          status.lastSkipReason = result.reason;
          status.phase = `Skipped: ${result.title}`;
        }

        if (status.moved + status.skipped >= maxChats) break;
        await sleep(delayMs);
        continue;
      }

      status.phase = "Looking for more root chats...";
      const attemptedLoad = await tryLoadMore();
      await sleep(700);

      const afterLoad = getRootChatLinks();

      if (afterLoad.length > 0) {
        stableEmptyRounds = 0;
        continue;
      }

      stableEmptyRounds += 1;

      if (!attemptedLoad || stableEmptyRounds >= 4) {
        status.phase = "Complete: no more root chats found.";
        break;
      }
    }
  } catch (error) {
    status.error = error instanceof Error ? error.message : String(error);
    status.phase = "Stopped on error.";
  } finally {
    if (token === runToken) {
      status.running = false;
    }
  }
}

chrome.runtime.onMessage.addListener(
  (message: RequestMessage, _sender, sendResponse: (response: RunnerStatus) => void) => {
    if (message.type === "STATUS") {
      sendResponse({ ...status });
      return;
    }

    if (message.type === "STOP") {
      runToken += 1;
      status.running = false;
      status.phase = "Stopped by user.";
      sendResponse({ ...status });
      return;
    }

    if (message.type === "START") {
      runToken += 1;
      const token = runToken;

      status.running = true;
      status.moved = 0;
      status.skipped = 0;
      status.error = undefined;
      status.lastChatTitle = undefined;
      status.lastSkipReason = undefined;
      status.phase = "Starting...";
      processedConversationIds.clear();

      sendResponse({ ...status });
      void run(message, token);
    }
  }
);
