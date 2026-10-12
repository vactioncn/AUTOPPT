export type MusicSettings = {
  enabled: boolean;
  playing: boolean;
  url: string;
  volume: number;
};
export function createBackgroundMusicPlayer(options?: {
  createAudio?: () => HTMLAudioElement;
  onError?: (message: string) => void;
}): {
  update(settings: Partial<MusicSettings>): Promise<void>;
  unlock(): Promise<void>;
  dispose(): void;
};
