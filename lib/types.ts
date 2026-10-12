export type StageStatus = "pending" | "active" | "done" | "skipped" | "error";

export type JobStatus = "queued" | "running" | "paused" | "done" | "error";

export type JobMode = "burn" | "doc";

export type SubtitleMode = "zh" | "en" | "bilingual";

export type SubtitleOrder = "zh-top" | "en-top";

export type Quality = "precise" | "fast";

export type JobStage = {
  id: string;
  label: string;
  status: StageStatus;
  detail?: string;
};

export type JobRecord = {
  id: string;
  title: string;
  sourceUrl: string;
  sourceName: string;
  mode: JobMode;
  subtitle: SubtitleMode;
  subtitleOrder: SubtitleOrder;
  quality: Quality;
  language: string;
  cnSize: number;
  enSize: number;
  cnColor: string;
  enColor: string;
  status: JobStatus;
  error?: string;
  stages: JobStage[];
  detectedLanguage?: string;
  outputs: string[];
  canResume: boolean;
  folderId?: string;
  createdAt: string;
  updatedAt: string;
};

export type Settings = {
  apiBase: string;
  apiKey: string;
  model: string;
  proxy: string;
  cnSize: number;
  enSize: number;
  cnColor: string;
  enColor: string;
  subtitleOrder: SubtitleOrder;
};

export type PublicSettings = {
  apiBase: string;
  model: string;
  proxy: string;
  hasKey: boolean;
  cnSize: number;
  enSize: number;
  cnColor: string;
  enColor: string;
  subtitleOrder: SubtitleOrder;
};

export type Health = {
  ffmpeg: boolean;
  ffprobe: boolean;
  ytdlp: boolean;
  whisper: boolean;
  hasKey: boolean;
};
