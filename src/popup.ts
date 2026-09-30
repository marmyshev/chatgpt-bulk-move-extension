import type { RequestMessage, RunnerStatus } from "./shared";

const projectInput = document.querySelector<HTMLInputElement>("#projectName")!;
const delayInput = document.querySelector<HTMLInputElement>("#delayMs")!;
const testOneButton = document.querySelector<HTMLButtonElement>("#testOne")!;
const startButton = document.querySelector<HTMLButtonElement>("#start")!;
const stopButton = document.querySelector<HTMLButtonElement>("#stop")!;
const statusElement = document.querySelector<HTMLPreElement>("#status")!;

async function getActiveChatGptTab(): Promise<chrome.tabs.Tab> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab?.id || !tab.url) {
    throw new Error("No active browser tab.");
  }

  const url = new URL(tab.url);
  if (url.hostname !== "chatgpt.com") {
    throw new Error("Open chatgpt.com in the active tab first.");
  }

  return tab;
}

async function send<T>(message: RequestMessage): Promise<T> {
  const tab = await getActiveChatGptTab();

  try {
    return await chrome.tabs.sendMessage(tab.id!, message) as T;
  } catch {
    throw new Error("ChatGPT content script is not available. Reload the chatgpt.com tab and try again.");
  }
}

function getConfig() {
  const projectName = projectInput.value.trim();
  const delayMs = Number(delayInput.value);

  if (!projectName) {
    throw new Error("Enter the exact destination project name.");
  }

  if (!Number.isFinite(delayMs) || delayMs < 500 || delayMs > 10000) {
    throw new Error("Delay must be between 500 and 10000 ms.");
  }

  return { projectName, delayMs };
}

function renderStatus(status: RunnerStatus) {
  const lines = [
    status.running ? "Running" : "Stopped",
    `Moved: ${status.moved}`,
    `Skipped: ${status.skipped}`,
    `Phase: ${status.phase}`
  ];

  if (status.lastChatTitle) {
    lines.push(`Last: ${status.lastChatTitle}`);
  }
  if (status.lastSkipReason) {
    lines.push(`Last skip: ${status.lastSkipReason}`);
  }
  if (status.error) {
    lines.push(`Fatal error: ${status.error}`);
  }

  statusElement.textContent = lines.join("\n");
}

async function start(maxChats?: number) {
  try {
    const config = getConfig();
    await chrome.storage.sync.set(config);

    const status = await send<RunnerStatus>({
      type: "START",
      ...config,
      maxChats
    });

    renderStatus(status);
  } catch (error) {
    statusElement.textContent = error instanceof Error ? error.message : String(error);
  }
}

testOneButton.addEventListener("click", () => void start(1));
startButton.addEventListener("click", () => void start());

stopButton.addEventListener("click", async () => {
  try {
    renderStatus(await send<RunnerStatus>({ type: "STOP" }));
  } catch (error) {
    statusElement.textContent = error instanceof Error ? error.message : String(error);
  }
});

async function refreshStatus() {
  try {
    renderStatus(await send<RunnerStatus>({ type: "STATUS" }));
  } catch {
    // Popup may be opened before the page/content script is ready.
  }
}

async function init() {
  const saved = await chrome.storage.sync.get({
    projectName: "",
    delayMs: 1500
  });

  projectInput.value = String(saved.projectName ?? "");
  delayInput.value = String(saved.delayMs ?? 1500);

  await refreshStatus();
  window.setInterval(() => void refreshStatus(), 750);
}

void init();
