export type PresenterGeneration = {
  id: string;
  narrationId: string;
  avatarId: string;
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
    clips: { index: number; duration: number; status: string; file?: string }[];
  }[];
};
export const presenterVideo = (file: string) =>
  "/api/presenter/video/" + encodeURIComponent(file);
