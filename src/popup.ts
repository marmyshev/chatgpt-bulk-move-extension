import {
  clampDelay,
  DEFAULT_DELAY_MS,
  type RequestMessage,
  type RunnerStatus
} from "./shared";

const openButton = document.querySelector<HTMLButtonElement>("#open")!;
const stopButton = document.querySelector<HTMLButtonElement>("#stop")!;
const delayInput = document.querySelector<HTMLInputElement>("#delayMs")!;
const statusElement = document.querySelector<HTMLPreElement>("#status")!;

function isChatGptUrl(url: string | undefined): boolean {
  if (!url) return false;

  try {
    return new URL(url).hostname === "chatgpt.com";
  } catch {
    return false;
  }
}

async function getActiveChatGptTab(): Promise<chrome.tabs.Tab> {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });

  // `tab.url` is only populated when the extension holds a matching host
  // permission, so an unknown URL is not by itself a failure.
  if (active?.id && (isChatGptUrl(active.url) || !active.url)) {
    return active;
  }

  const [match] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
    url: "https://chatgpt.com/*"
  });

  if (match?.id) return match;

  const [anyChatGpt] = await chrome.tabs.query({ url: "https://chatgpt.com/*" });
  if (anyChatGpt?.id) return anyChatGpt;

  throw new Error("Open chatgpt.com in a tab first.");
}

async function sendTo(tabId: number, message: RequestMessage): Promise<RunnerStatus> {
  return (await chrome.tabs.sendMessage(tabId, message)) as RunnerStatus;
}

async function send(message: RequestMessage, inject = false): Promise<RunnerStatus> {
  const tab = await getActiveChatGptTab();
  const tabId = tab.id!;

  try {
    return await sendTo(tabId, message);
  } catch {
    if (!inject) {
      throw new Error("Content script unavailable. Reload the chatgpt.com tab and try again.");
    }
  }

  // The tab predates this build of the extension; inject the script once.
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"]
    });
  } catch (error) {
    throw new Error(
      `Could not inject into the ChatGPT tab: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  try {
    return await sendTo(tabId, message);
  } catch {
    throw new Error("Content script did not respond. Reload the chatgpt.com tab and try again.");
  }
}

function renderStatus(status: RunnerStatus): void {
  const lines = [
    status.running ? "Running" : "Idle",
    `Phase: ${status.phase}`
  ];

  if (status.total) lines.push(`Loaded: ${status.total}`);
  if (status.moved || status.failed) {
    lines.push(`Moved: ${status.moved}`, `Failed: ${status.failed}`);
  }
  if (status.error) lines.push(`Error: ${status.error}`);

  statusElement.textContent = lines.join("\n");
  stopButton.disabled = !status.running;
}

function renderError(error: unknown): void {
  statusElement.textContent = error instanceof Error ? error.message : String(error);
  stopButton.disabled = true;
}

openButton.addEventListener("click", async () => {
  try {
    const delayMs = clampDelay(Number(delayInput.value));
    delayInput.value = String(delayMs);
    await chrome.storage.sync.set({ delayMs });

    renderStatus(await send({ type: "OPEN_PANEL" }, true));
    window.close();
  } catch (error) {
    renderError(error);
  }
});

stopButton.addEventListener("click", async () => {
  try {
    renderStatus(await send({ type: "STOP" }));
  } catch (error) {
    renderError(error);
  }
});

delayInput.addEventListener("change", () => {
  const delayMs = clampDelay(Number(delayInput.value));
  delayInput.value = String(delayMs);
  void chrome.storage.sync.set({ delayMs });
});

async function refreshStatus(): Promise<void> {
  try {
    renderStatus(await send({ type: "STATUS" }));
  } catch {
    // The page may not be ready yet; keep the last message.
  }
}

async function init(): Promise<void> {
  const saved = await chrome.storage.sync.get({ delayMs: DEFAULT_DELAY_MS });
  delayInput.value = String(clampDelay(Number(saved.delayMs)));

  await refreshStatus();
  window.setInterval(() => void refreshStatus(), 1000);
}

void init();
