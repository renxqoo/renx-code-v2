export type SubagentRunStatus =
  | 'created'
  | 'queued'
  | 'starting'
  | 'running'
  | 'waiting'
  | 'blocked'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timed_out';

export type SubagentRunHighlight = {
  id: string;
  kind: 'status' | 'insight' | 'warning' | 'error';
  text: string;
  timestamp: number;
};

export type SubagentRunTimelineEntry = {
  id: string;
  kind: 'lifecycle' | 'status' | 'insight' | 'warning' | 'error' | 'artifact';
  text: string;
  timestamp: number;
};

export type SubagentRunArtifact = {
  id: string;
  label: string;
  content?: string;
};

export type SubagentRunViewModel = {
  runId: string;
  title: string;
  role?: string;
  status: SubagentRunStatus;
  statusText: string;
  progress?: number;
  linkedTaskId?: string | null;
  latestStatusLine?: string;
  highlights: SubagentRunHighlight[];
  artifacts: SubagentRunArtifact[];
  timeline: SubagentRunTimelineEntry[];
  outputPreview?: string;
  finalSummary?: string;
  firstSeenIndex: number;
  updatedAt: number;
};
