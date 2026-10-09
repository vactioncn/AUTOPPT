export type PresenterAvatar = {
  id: string;
  name: string;
  previewAsset: string;
  style: string;
  voiceId: string;
  voiceName: string;
  voiceSource?: "minimax";
  ready: boolean;
};
export type PresenterStudioState = {
  hasKey: boolean;
  generationAvailable: boolean;
  avatars: PresenterAvatar[];
  defaultAvatarId: string;
  styles: { id: string; name: string }[];
  imageAvailable: boolean;
  hasSpeechKey: boolean;
  defaultSpeechVoiceId: string;
};
export type PresenterVoice = {
  id: string;
  name: string;
  description?: string;
  custom?: boolean;
};
export type PresenterGeneration = {
  id: string;
  narrationId: string;
  avatarId: string;
  avatarName?: string;
  voiceName?: string;
  mode?: "text" | "audio" | "minimax";
  preview?: boolean;
  placement: string;
  size: string;
  scope: "page" | "all";
  status: string;
  message: string;
  createdAt: string;
  compatible: boolean;
  pages: {
    id: string;
    title: string;
    number?: number;
    clips: {
      index: number;
      duration: number;
      status: string;
      file?: string;
      text?: string;
    }[];
  }[];
};
export const presenterVideo = (file: string) =>
  "/api/presenter/video/" + encodeURIComponent(file);
export const presenterActive = (job: PresenterGeneration) =>
  ["queued", "running"].includes(job.status);
