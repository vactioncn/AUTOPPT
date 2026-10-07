import type { Scene } from "./types";
import type { SpeechOptions } from "../shared/speech.mjs";
export type Voice = {
  id: string;
  name: string;
  description: string;
  custom?: boolean;
};
export type SpeechConnection = {
  baseUrl: string;
  model: string;
  hasKey: boolean;
};
export type NarrationPage = {
  id: string;
  number: number;
  title: string;
  notes: string;
  image: string | null;
  scene: Scene | null;
  stale: boolean;
  emotion: string;
  status: string;
  error?: string;
  clips: { text: string; file?: string; duration?: number }[];
};
export type Narration = {
  id: string;
  title: string;
  sourceRevision: number;
  options: SpeechOptions;
  voiceName: string;
  status: string;
  progress: string;
  model: string;
  pages: NarrationPage[];
  createdAt: string;
};
export const speechAudio = (file: string) =>
  // v2 could also cache 404s while the old backend was finishing active jobs.
  "/api/speech/audio/" + encodeURIComponent(file) + "?v=3";
