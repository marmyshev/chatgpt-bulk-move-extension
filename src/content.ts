import { BulkMovePanel } from "./panel";
import { clampDelay, DEFAULT_DELAY_MS, type RequestMessage, type RunnerStatus } from "./shared";

const INSTALL_FLAG = "__chatgptBulkMoveInstalled";

type FlaggedWindow = Window & { [INSTALL_FLAG]?: boolean };

let panel: BulkMovePanel | null = null;

function getPanel(): BulkMovePanel {
  panel ??= new BulkMovePanel();
  return panel;
}

async function openPanel(): Promise<RunnerStatus> {
  const instance = getPanel();

  const saved = await chrome.storage.sync.get({ delayMs: DEFAULT_DELAY_MS });
  instance.setDelay(clampDelay(Number(saved.delayMs)));

  instance.mount();
  return instance.getStatus();
}

function idleStatus(): RunnerStatus {
  return {
    running: false,
    total: 0,
    moved: 0,
    failed: 0,
    phase: "Panel closed."
  };
}

function handleMessage(
  message: RequestMessage,
  _sender: chrome.runtime.MessageSender,
  sendResponse: (response: RunnerStatus) => void
): boolean | undefined {
  if (message.type === "OPEN_PANEL") {
    void openPanel().then(sendResponse);
    return true;
  }

  if (message.type === "CLOSE_PANEL") {
    panel?.unmount();
    sendResponse(idleStatus());
    return;
  }

  if (message.type === "STOP") {
    panel?.requestStop();
    sendResponse(panel?.getStatus() ?? idleStatus());
    return;
  }

  if (message.type === "STATUS") {
    sendResponse(panel?.isMounted() ? panel.getStatus() : idleStatus());
    return;
  }

  return;
}

// The popup may inject this bundle into a tab that already loaded it via the
// manifest content script. Register the listener only once per page.
if (!(window as FlaggedWindow)[INSTALL_FLAG]) {
  (window as FlaggedWindow)[INSTALL_FLAG] = true;
  chrome.runtime.onMessage.addListener(handleMessage);
}
