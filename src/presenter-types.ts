export type AvatarProfile = {
  id: string;
  name: string;
  sourceAsset: string;
  previewAsset: string;
  kind: "photo" | "preset" | "generated";
  provider: string;
  providerAvatarId?: string;
  createdAt: string;
  updatedAt: string;
};
export const presenterPositions: Record<string, string> = {
  "top-left": "左上角",
  "top-right": "右上角",
  "bottom-left": "左下角",
  "bottom-right": "右下角",
};
export const presenterSizes: Record<string, string> = {
  small: "小",
  medium: "中",
  large: "大",
};
export type PresenterVersion = {
  id: string;
  narrationId: string;
  avatarId: string;
  status: string;
  progress: string;
  placement: string;
  size: string;
  provider: string;
  current: boolean;
  createdAt: string;
  pages: {
    pageId: string;
    status: string;
    stale: boolean;
    videoFile?: string;
    duration?: number;
    error?: string;
  }[];
};
export type PresenterState = {
  hasKey?: boolean;
  configured: boolean;
  testOnly: boolean;
  versions: PresenterVersion[];
};
export const presenterVideo = (id: string, pageId: string) =>
  "/api/presenter/" +
  encodeURIComponent(id) +
  "/video/" +
  encodeURIComponent(pageId);
export const repairPresenter = () =>
  window.dispatchEvent(new Event("autoppt-open-presenter"));
