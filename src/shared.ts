export type StartMessage = {
  type: "START";
  projectName: string;
  delayMs: number;
  maxChats?: number;
};

export type StopMessage = {
  type: "STOP";
};

export type StatusMessage = {
  type: "STATUS";
};

export type RequestMessage = StartMessage | StopMessage | StatusMessage;

export type RunnerStatus = {
  running: boolean;
  moved: number;
  skipped: number;
  phase: string;
  lastChatTitle?: string;
  lastSkipReason?: string;
  error?: string;
};
