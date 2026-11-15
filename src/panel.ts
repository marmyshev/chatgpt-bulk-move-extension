import { ApiError, listConversations, listProjects, moveConversation } from "./api";
import { PANEL_STYLES } from "./panel-styles";
import {
  clampDelay,
  DEFAULT_DELAY_MS,
  MAX_DELAY_MS,
  MIN_DELAY_MS,
  NO_PROJECT,
  type ConversationSummary,
  type MoveState,
  type Project,
  type RunnerStatus
} from "./shared";

const HOST_ID = "chatgpt-bulk-move-panel-host";

type Row = ConversationSummary & {
  state: MoveState;
  reason?: string;
};

type ScopeFilter = "all" | "none" | string;
type SortKey = "updated" | "created" | "title";

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export class BulkMovePanel {
  private readonly host: HTMLDivElement;
  private readonly root: ShadowRoot;

  private rows: Row[] = [];
  private projects: Project[] = [];
  private projectNames = new Map<string, string>();
  private selected = new Set<string>();
  private visibleIds: string[] = [];
  private lastClickedId: string | null = null;
  private pinnedIds = new Set<string>();

  private scope: ScopeFilter = "none";
  private search = "";
  private sortKey: SortKey = "updated";
  private sortDesc = true;
  private includeArchived = false;
  private delayMs = DEFAULT_DELAY_MS;
  private destination: string = NO_PROJECT;

  private loading = false;
  private loadError: string | null = null;
  private loadProgress = "";

  private running = false;
  private stopRequested = false;
  private movedCount = 0;
  private failedCount = 0;
  private runPhase = "Ready.";
  private loadAbort: AbortController | null = null;

  private els!: {
    scope: HTMLSelectElement;
    search: HTMLInputElement;
    destination: HTMLSelectElement;
    delay: HTMLInputElement;
    archived: HTMLInputElement;
    refresh: HTMLButtonElement;
    selectAll: HTMLInputElement;
    selectVisible: HTMLButtonElement;
    clear: HTMLButtonElement;
    selectionCount: HTMLSpanElement;
    tbody: HTMLTableSectionElement;
    listMessage: HTMLDivElement;
    status: HTMLDivElement;
    move: HTMLButtonElement;
    stop: HTMLButtonElement;
    headers: HTMLTableCellElement[];
  };

  constructor() {
    this.host = document.createElement("div");
    this.host.id = HOST_ID;
    this.root = this.host.attachShadow({ mode: "open" });
    this.build();
  }

  mount(): void {
    if (!this.host.isConnected) {
      document.body.appendChild(this.host);
      document.addEventListener("keydown", this.onKeyDown, true);
      void this.reload();
    }
  }

  unmount(): void {
    this.stopRequested = true;
    this.loadAbort?.abort();
    document.removeEventListener("keydown", this.onKeyDown, true);
    this.host.remove();
  }

  isMounted(): boolean {
    return this.host.isConnected;
  }

  getStatus(): RunnerStatus {
    return {
      running: this.running,
      total: this.rows.length,
      moved: this.movedCount,
      failed: this.failedCount,
      phase: this.runPhase,
      error: this.loadError ?? undefined
    };
  }

  requestStop(): void {
    if (this.running) {
      this.stopRequested = true;
      this.runPhase = "Stopping after the current move...";
      this.renderStatus();
    }
  }

  setDelay(delayMs: number): void {
    this.delayMs = clampDelay(delayMs);
    if (this.els) this.els.delay.value = String(this.delayMs);
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && this.host.isConnected && !this.running) {
      event.stopPropagation();
      this.unmount();
    }
  };

  private build(): void {
    const style = document.createElement("style");
    style.textContent = PANEL_STYLES;

    const backdrop = document.createElement("div");
    backdrop.className = "backdrop";
    backdrop.innerHTML = `
      <div class="panel" role="dialog" aria-label="Bulk move ChatGPT chats">
        <header>
          <h2>Bulk move chats</h2>
          <span class="spacer"></span>
          <span class="hint" data-el="loadHint"></span>
          <button class="secondary" data-el="refresh">Refresh</button>
          <button class="ghost" data-el="close" aria-label="Close">✕</button>
        </header>

        <div class="toolbar">
          <label class="field">
            Show
            <select data-el="scope"></select>
          </label>

          <label class="field grow">
            Search title
            <input type="text" data-el="search" placeholder="Filter by title" autocomplete="off" />
          </label>

          <label class="field grow">
            Move to project
            <select data-el="destination"></select>
          </label>

          <label class="field">
            Delay (ms)
            <input type="number" data-el="delay" min="${MIN_DELAY_MS}" max="${MAX_DELAY_MS}" step="50" />
          </label>

          <label class="field">
            Archived
            <span><input type="checkbox" data-el="archived" /> include</span>
          </label>
        </div>

        <div class="selection-bar">
          <span class="count" data-el="selectionCount">0 selected</span>
          <button class="secondary" data-el="selectVisible">Select all shown</button>
          <button class="secondary" data-el="clear">Clear selection</button>
          <span class="hint">Shift-click a checkbox to select a range.</span>
        </div>

        <div class="list">
          <table>
            <thead>
              <tr>
                <th class="check plain"><input type="checkbox" data-el="selectAll" aria-label="Select all shown" /></th>
                <th data-sort="title">Title</th>
                <th class="plain">Current project</th>
                <th data-sort="updated">Updated</th>
                <th class="plain">Status</th>
              </tr>
            </thead>
            <tbody data-el="tbody"></tbody>
          </table>
          <div class="message" data-el="listMessage"></div>
        </div>

        <footer>
          <div class="status" data-el="status">Ready.</div>
          <button data-el="move">Move selected</button>
          <button class="danger" data-el="stop" disabled>Stop</button>
        </footer>
      </div>
    `;

    this.root.append(style, backdrop);

    const pick = <T extends HTMLElement>(name: string): T =>
      this.root.querySelector<T>(`[data-el="${name}"]`)!;

    this.els = {
      scope: pick<HTMLSelectElement>("scope"),
      search: pick<HTMLInputElement>("search"),
      destination: pick<HTMLSelectElement>("destination"),
      delay: pick<HTMLInputElement>("delay"),
      archived: pick<HTMLInputElement>("archived"),
      refresh: pick<HTMLButtonElement>("refresh"),
      selectAll: pick<HTMLInputElement>("selectAll"),
      selectVisible: pick<HTMLButtonElement>("selectVisible"),
      clear: pick<HTMLButtonElement>("clear"),
      selectionCount: pick<HTMLSpanElement>("selectionCount"),
      tbody: pick<HTMLTableSectionElement>("tbody"),
      listMessage: pick<HTMLDivElement>("listMessage"),
      status: pick<HTMLDivElement>("status"),
      move: pick<HTMLButtonElement>("move"),
      stop: pick<HTMLButtonElement>("stop"),
      headers: Array.from(this.root.querySelectorAll<HTMLTableCellElement>("thead th[data-sort]"))
    };

    this.els.delay.value = String(this.delayMs);

    pick<HTMLButtonElement>("close").addEventListener("click", () => this.unmount());

    backdrop.addEventListener("mousedown", event => {
      if (event.target === backdrop && !this.running) this.unmount();
    });

    this.els.refresh.addEventListener("click", () => void this.reload());

    this.els.scope.addEventListener("change", () => {
      this.scope = this.els.scope.value;
      this.lastClickedId = null;
      this.pinnedIds.clear();
      this.renderList({ pruneSelection: true });
    });

    this.els.search.addEventListener("input", () => {
      this.search = this.els.search.value.trim().toLowerCase();
      this.lastClickedId = null;
      this.pinnedIds.clear();
      this.renderList({ pruneSelection: true });
    });

    this.els.destination.addEventListener("change", () => {
      this.destination = this.els.destination.value;
      this.renderStatus();
    });

    this.els.delay.addEventListener("change", () => {
      this.delayMs = clampDelay(Number(this.els.delay.value));
      this.els.delay.value = String(this.delayMs);
      void chrome.storage.sync.set({ delayMs: this.delayMs });
    });

    this.els.archived.addEventListener("change", () => {
      this.includeArchived = this.els.archived.checked;
      void this.reload();
    });

    this.els.selectAll.addEventListener("change", () => {
      if (this.els.selectAll.checked) {
        for (const id of this.visibleIds) this.selected.add(id);
      } else {
        for (const id of this.visibleIds) this.selected.delete(id);
      }
      this.renderList();
    });

    this.els.selectVisible.addEventListener("click", () => {
      for (const id of this.visibleIds) this.selected.add(id);
      this.renderList();
    });

    this.els.clear.addEventListener("click", () => {
      this.selected.clear();
      this.pinnedIds.clear();
      this.renderList();
    });

    this.els.move.addEventListener("click", () => void this.runMoves());
    this.els.stop.addEventListener("click", () => this.requestStop());

    for (const header of this.els.headers) {
      header.addEventListener("click", () => {
        const key = header.dataset.sort as SortKey;
        if (this.sortKey === key) {
          this.sortDesc = !this.sortDesc;
        } else {
          this.sortKey = key;
          this.sortDesc = key !== "title";
        }
        this.renderList();
      });
    }

    this.els.tbody.addEventListener("click", event => {
      const target = event.target as HTMLElement;
      const checkbox = target.closest<HTMLInputElement>('input[type="checkbox"][data-id]');
      if (!checkbox) return;

      const id = checkbox.dataset.id!;
      const shift = (event as MouseEvent).shiftKey;

      if (shift && this.lastClickedId && this.lastClickedId !== id) {
        const from = this.visibleIds.indexOf(this.lastClickedId);
        const to = this.visibleIds.indexOf(id);

        if (from >= 0 && to >= 0) {
          const [start, end] = from < to ? [from, to] : [to, from];
          const shouldSelect = checkbox.checked;

          for (let i = start; i <= end; i += 1) {
            const rangeId = this.visibleIds[i];
            if (shouldSelect) this.selected.add(rangeId);
            else this.selected.delete(rangeId);
          }
        }
      } else if (checkbox.checked) {
        this.selected.add(id);
      } else {
        this.selected.delete(id);
      }

      this.lastClickedId = id;
      this.renderList();
    });
  }

  private async reload(): Promise<void> {
    if (this.running) return;

    this.loadAbort?.abort();
    const controller = new AbortController();
    this.loadAbort = controller;

    this.loading = true;
    this.loadError = null;
    this.loadProgress = "Loading…";
    this.renderList();
    this.renderStatus();

    try {
      const projects = await listProjects(controller.signal);
      this.projects = projects;
      this.projectNames = new Map(projects.map(project => [project.id, project.name]));
      this.renderProjectControls();

      const conversations = await listConversations({
        signal: controller.signal,
        includeArchived: this.includeArchived,
        onProgress: (loaded, total) => {
          this.loadProgress = `Loaded ${loaded} of ${total}…`;
          this.renderLoadHint();
        }
      });

      this.rows = conversations.map(conversation => ({ ...conversation, state: "idle" }));
      this.pinnedIds.clear();
      this.selected.clear();
      this.lastClickedId = null;
      this.loadProgress = `${this.rows.length} chats · ${this.projects.length} projects`;
    } catch (error) {
      if (controller.signal.aborted) return;
      this.loadError = errorMessage(error);
      this.loadProgress = "";
    } finally {
      if (!controller.signal.aborted) {
        this.loading = false;
        this.renderList();
        this.renderStatus();
      }
    }
  }

  private renderProjectControls(): void {
    const scopeValue = this.scope;
    this.els.scope.innerHTML = "";

    const scopeOptions: Array<[string, string]> = [
      ["none", "Chats without a project"],
      ["all", "All chats"],
      ...this.projects.map(project => [project.id, `In: ${project.name}`] as [string, string])
    ];

    for (const [value, label] of scopeOptions) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      this.els.scope.appendChild(option);
    }

    this.els.scope.value = scopeOptions.some(([value]) => value === scopeValue) ? scopeValue : "none";
    this.scope = this.els.scope.value;

    const destinationValue = this.destination;
    this.els.destination.innerHTML = "";

    const noProject = document.createElement("option");
    noProject.value = NO_PROJECT;
    noProject.textContent = "— Remove from project —";
    this.els.destination.appendChild(noProject);

    for (const project of this.projects) {
      const option = document.createElement("option");
      option.value = project.id;
      option.textContent = project.name;
      this.els.destination.appendChild(option);
    }

    this.els.destination.value = this.projects.some(project => project.id === destinationValue)
      ? destinationValue
      : this.projects[0]?.id ?? NO_PROJECT;

    this.destination = this.els.destination.value;
  }

  private matchesFilter(row: Row): boolean {
    // Rows taking part in the current run stay visible even after their
    // project changes, so the user can watch them finish.
    if (this.pinnedIds.has(row.id)) return true;
    if (this.scope === "none" && row.gizmoId) return false;
    if (this.scope !== "none" && this.scope !== "all" && row.gizmoId !== this.scope) return false;
    if (this.search && !row.title.toLowerCase().includes(this.search)) return false;
    return true;
  }

  private filteredRows(): Row[] {
    const rows = this.rows.filter(row => this.matchesFilter(row));

    const direction = this.sortDesc ? -1 : 1;

    rows.sort((a, b) => {
      if (this.sortKey === "title") {
        return a.title.localeCompare(b.title) * direction;
      }

      const key = this.sortKey === "created" ? "createTime" : "updateTime";
      const left = a[key] ? Date.parse(a[key]!) : 0;
      const right = b[key] ? Date.parse(b[key]!) : 0;
      return (left - right) * direction;
    });

    return rows;
  }

  private renderLoadHint(): void {
    const hint = this.root.querySelector<HTMLElement>('[data-el="loadHint"]');
    if (hint) hint.textContent = this.loadProgress;
  }

  private renderList(options: { pruneSelection?: boolean } = {}): void {
    this.renderLoadHint();

    const rows = this.filteredRows();
    this.visibleIds = rows.map(row => row.id);

    // Selection is always scoped to what the current filter shows. Changing the
    // filter drops anything that is no longer visible so "Move selected" can
    // never touch a hidden chat.
    if (options.pruneSelection && !this.running) {
      const visible = new Set(this.visibleIds);
      for (const id of this.selected) {
        if (!visible.has(id)) this.selected.delete(id);
      }
    }

    const message = this.els.listMessage;

    if (this.loadError) {
      message.textContent = this.loadError;
      message.className = "message error";
    } else if (this.loading) {
      message.textContent = "Loading conversations…";
      message.className = "message";
    } else if (rows.length === 0) {
      message.textContent = "No chats match the current filter.";
      message.className = "message";
    } else {
      message.textContent = "";
      message.className = "message";
      message.style.display = "none";
    }

    if (this.loadError || this.loading || rows.length === 0) {
      message.style.display = "";
    }

    const fragment = document.createDocumentFragment();

    for (const row of rows) {
      const tr = document.createElement("tr");
      if (this.selected.has(row.id)) tr.classList.add("selected");

      const checkCell = document.createElement("td");
      checkCell.className = "check";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.dataset.id = row.id;
      checkbox.checked = this.selected.has(row.id);
      checkbox.disabled = this.running;
      checkCell.appendChild(checkbox);

      const titleCell = document.createElement("td");
      titleCell.className = "title";
      titleCell.title = row.title;
      const link = document.createElement("a");
      link.href = `/c/${row.id}`;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = row.title;
      link.style.color = "inherit";
      titleCell.appendChild(link);

      const projectCell = document.createElement("td");
      projectCell.className = "project";
      const badge = document.createElement("span");
      if (row.gizmoId) {
        badge.className = "badge project";
        badge.textContent = this.projectNames.get(row.gizmoId) ?? row.gizmoId;
      } else {
        badge.className = "badge none";
        badge.textContent = "No project";
      }
      projectCell.appendChild(badge);

      const updatedCell = document.createElement("td");
      updatedCell.className = "updated";
      updatedCell.textContent = formatDate(row.updateTime);

      const stateCell = document.createElement("td");
      stateCell.className = "state";
      if (row.state !== "idle") {
        const stateBadge = document.createElement("span");
        stateBadge.className = `badge ${row.state}`;
        stateBadge.textContent = row.state;
        if (row.reason) stateBadge.title = row.reason;
        stateCell.appendChild(stateBadge);
      }

      tr.append(checkCell, titleCell, projectCell, updatedCell, stateCell);
      fragment.appendChild(tr);
    }

    this.els.tbody.replaceChildren(fragment);

    const selectedVisible = this.visibleIds.filter(id => this.selected.has(id)).length;
    this.els.selectAll.checked = rows.length > 0 && selectedVisible === rows.length;
    this.els.selectAll.indeterminate = selectedVisible > 0 && selectedVisible < rows.length;
    this.els.selectionCount.textContent = `${selectedVisible} of ${rows.length} shown selected`;

    this.renderStatus();
  }

  private selectedVisibleIds(): string[] {
    return this.visibleIds.filter(id => this.selected.has(id));
  }

  private renderStatus(): void {
    const destinationName =
      this.destination === NO_PROJECT
        ? "no project"
        : this.projectNames.get(this.destination) ?? this.destination;

    const selectedCount = this.selectedVisibleIds().length;
    const parts = [this.runPhase];

    if (this.movedCount || this.failedCount) {
      parts.push(`Moved ${this.movedCount}`, `Failed ${this.failedCount}`);
    }

    if (!this.running && selectedCount > 0) {
      parts.push(`Target: ${destinationName}`);
    }

    this.els.status.textContent = parts.join(" · ");
    this.els.move.disabled = this.running || selectedCount === 0 || this.loading;
    this.els.stop.disabled = !this.running;
    this.els.refresh.disabled = this.running;
    this.els.archived.disabled = this.running || this.loading;
  }

  private async runMoves(): Promise<void> {
    if (this.running) return;

    // Only ever move what the user can currently see selected.
    const targets = this.selectedVisibleIds();
    if (targets.length === 0) return;

    const gizmoId = this.destination === NO_PROJECT ? null : this.destination;

    this.running = true;
    this.stopRequested = false;
    this.movedCount = 0;
    this.failedCount = 0;
    this.pinnedIds = new Set(targets);

    const byId = new Map(this.rows.map(row => [row.id, row]));

    for (const id of targets) {
      const row = byId.get(id);
      if (row) {
        row.state = "pending";
        row.reason = undefined;
      }
    }

    this.runPhase = `Moving 0 of ${targets.length}…`;
    this.renderList();

    for (let index = 0; index < targets.length; index += 1) {
      if (this.stopRequested) {
        this.runPhase = `Stopped after ${index} of ${targets.length}.`;
        break;
      }

      const id = targets[index];
      const row = byId.get(id);

      if (row) row.state = "moving";
      this.runPhase = `Moving ${index + 1} of ${targets.length}…`;
      this.renderList();

      try {
        await moveConversation(id, gizmoId);

        if (row) {
          row.state = "moved";
          row.gizmoId = gizmoId;
        }
        this.movedCount += 1;
        this.selected.delete(id);
      } catch (error) {
        if (row) {
          row.state = "failed";
          row.reason = errorMessage(error);
        }
        this.failedCount += 1;
      }

      this.renderList();

      if (index < targets.length - 1 && this.delayMs > 0) {
        await sleep(this.delayMs);
      }
    }

    if (!this.stopRequested) {
      this.runPhase = `Done. Reload ChatGPT to refresh its sidebar.`;
    }

    this.running = false;
    this.renderList();
  }
}
