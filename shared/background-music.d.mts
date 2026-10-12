export type MusicSettings = {
  enabled: boolean;
  playing: boolean;
  url: string;
  volume: number;
};
export const BACKGROUND_MUSIC_DEFAULT_VOLUME: 0.4;
export function createBackgroundMusicPlayer(options?: {
  createAudio?: () => HTMLAudioElement;
  onError?: (message: string) => void;
}): {
  update(settings: Partial<MusicSettings>): Promise<void>;
  unlock(): Promise<void>;
  dispose(): void;
};
