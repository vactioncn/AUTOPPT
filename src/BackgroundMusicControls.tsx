import { useEffect, useId, useRef, useState } from "react";
import { MusicNote } from "@phosphor-icons/react";
import { createBackgroundMusicPlayer } from "../shared/background-music.mjs";
import "./background-music.css";

type Track = { id: string; name: string; url: string };
const preferenceKey = "autoppt-background-music-v1";
function preferences() {
  try {
    const value = JSON.parse(localStorage.getItem(preferenceKey) || "{}");
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}
export function BackgroundMusicControls({ playing }: { playing: boolean }) {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [trackId, setTrackId] = useState<string>(
    () => preferences().trackId || "",
  );
  const [volume, setVolume] = useState<number>(() => {
    const value = preferences().volume;
    return typeof value === "number" && Number.isFinite(value)
      ? Math.max(0, Math.min(0.4, value))
      : 0.12;
  });
  const [error, setError] = useState("");
  const player = useRef<ReturnType<typeof createBackgroundMusicPlayer> | null>(
    null,
  );
  const media = useRef<HTMLDivElement>(null);
  const id = useId();
  const selected = tracks.find((t) => t.id === trackId) || tracks[0];
  useEffect(() => {
    let closed = false;
    player.current = createBackgroundMusicPlayer({
      createAudio: () => {
        const audio = document.createElement("audio");
        audio.setAttribute("aria-label", "背景钢琴音乐");
        media.current?.append(audio);
        return audio;
      },
      onError: (message) => {
        if (!closed) {
          setError(message);
          setEnabled(false);
        }
      },
    });
    void fetch("/api/background-music")
      .then((r) => (r.ok ? r.json() : { tracks: [] }))
      .then((data) => {
        if (!closed && Array.isArray(data.tracks)) setTracks(data.tracks);
      })
      .catch(() => {});
    return () => {
      closed = true;
      player.current?.dispose();
      player.current = null;
    };
  }, []);
  useEffect(() => {
    void player.current?.update({
      enabled,
      playing,
      url: selected?.url || "",
      volume,
    });
  }, [enabled, playing, selected?.url, volume]);
  useEffect(() => {
    if (!selected) return;
    try {
      localStorage.setItem(
        preferenceKey,
        JSON.stringify({ trackId: selected.id, volume }),
      );
    } catch {
      /* playback still works without storage */
    }
  }, [selected?.id, volume]);
  if (!tracks.length) return null;
  return (
    <div className="background-music" onKeyDown={(e) => e.stopPropagation()}>
      <div ref={media} hidden />
      <div className="background-music-row">
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="背景音乐"
          className="background-music-switch"
          onClick={() => {
            setError("");
            if (!enabled) void player.current?.unlock();
            setEnabled(!enabled);
          }}
        >
          <MusicNote size={18} aria-hidden="true" /> 背景音乐
          <span className="background-music-toggle" aria-hidden="true">
            <span />
          </span>
        </button>
        {enabled && (
          <>
            <label className="background-music-track" htmlFor={id + "-track"}>
              <span className="background-music-label">曲目</span>
              <select
                id={id + "-track"}
                value={selected?.id}
                onChange={(e) => {
                  setError("");
                  setTrackId(e.target.value);
                }}
              >
                {tracks.map((track) => (
                  <option key={track.id} value={track.id}>
                    {track.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="background-music-volume" htmlFor={id + "-volume"}>
              <span>音量 {Math.round(volume * 100)}%</span>
              <input
                id={id + "-volume"}
                aria-label="背景音乐音量"
                type="range"
                min="0"
                max="40"
                step="1"
                value={Math.round(volume * 100)}
                onChange={(e) => setVolume(Number(e.target.value) / 100)}
              />
            </label>
          </>
        )}
      </div>
      {enabled && (
        <p className="background-music-hint">
          {playing ? "循环播放 · 自动淡入淡出" : "开始播放时，音乐随之淡入。"}
        </p>
      )}
      {error && (
        <p className="background-music-error" role="status">
          {error}
        </p>
      )}
    </div>
  );
}
