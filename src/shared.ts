export const NO_PROJECT = "__none__";

export type MoveState = "idle" | "pending" | "moving" | "moved" | "failed";

export type ConversationSummary = {
  id: string;
  title: string;
  updateTime: string | null;
  createTime: string | null;
  gizmoId: string | null;
  isArchived: boolean;
};

export type Project = {
  id: string;
  name: string;
};

export type RunnerStatus = {
  running: boolean;
  total: number;
  moved: number;
  failed: number;
  phase: string;
  error?: string;
};

export type OpenPanelMessage = {
  type: "OPEN_PANEL";
};

export type ClosePanelMessage = {
  type: "CLOSE_PANEL";
};

export type StopMessage = {
  type: "STOP";
};

export type StatusMessage = {
  type: "STATUS";
};

export type RequestMessage =
  | OpenPanelMessage
  | ClosePanelMessage
  | StopMessage
  | StatusMessage;

export type PopupSettings = {
  delayMs: number;
};

export const DEFAULT_DELAY_MS = 400;
export const MIN_DELAY_MS = 0;
export const MAX_DELAY_MS = 10000;

export function clampDelay(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_DELAY_MS;
  return Math.max(MIN_DELAY_MS, Math.min(MAX_DELAY_MS, Math.round(value)));
}
