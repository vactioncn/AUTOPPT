import type {
  PresenterGeneration,
  PresenterStudioState,
} from "./presenter-types";
import type { Scene } from "./types";
import type { Voice } from "./speech-types";
export type RehearsalPlan = {
  actor: "self" | "voice" | "digital";
  visual: "original" | "motion";
  avatarId: string;
  voiceId: string;
  emotion: string;
  speed: number;
  placement: string;
  size: string;
  narrationId: string;
  pageId: string;
  slideIds: string[];
};
export type RehearsalContext = {
  plan: RehearsalPlan;
  script: {
    revision: number;
    pages: { id: string; notes: string; text: string }[];
  };
  voices: Voice[];
  speech: { hasKey: boolean; model: string };
};
export type RehearsalRun = {
  id: string;
  createdAt: string;
  scope: "trial" | "all" | "selected";
  trialLength: "short" | "page";
  plan: RehearsalPlan;
  status: string;
  message: string;
  compatible: boolean;
  voiceName: string;
  speechModel?: string;
  presenter: PresenterGeneration | null;
  pages: {
    id: string;
    number: number;
    title: string;
    text: string;
    fullText?: string;
    image?: string | null;
    scene?: Scene | null;
    clips: {
      text?: string;
      audioFile?: string;
      file?: string;
      duration?: number;
      status?: string;
    }[];
  }[];
  motion: {
    id: string;
    status: string;
    progress: string;
    pages: {
      id: string;
      number: number;
      title: string;
      status: string;
      reused?: boolean;
      error?: string;
    }[];
  } | null;
};
export type RehearsalResources = {
  context: RehearsalContext;
  studio: PresenterStudioState;
  narrations: { id: string; voiceName: string; available: boolean }[];
};
