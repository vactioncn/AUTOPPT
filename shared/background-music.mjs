// Stream just the selected track. GainNode fades also work on mobile browsers
// where changing HTMLMediaElement.volume is not supported.
export function createBackgroundMusicPlayer({
  createAudio = () => new Audio(),
  createContext = () =>
    new (globalThis.AudioContext || globalThis.webkitAudioContext)(),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  onError = () => {},
} = {}) {
  let context,
    current,
    disposed = false;
  let desired = { enabled: false, playing: false, url: "", volume: 0.12 };
  const entries = new Set();
  const wanted = () =>
    desired.enabled && desired.playing && !!desired.url && !disposed;
  function gain(entry, target, seconds) {
    const now = context.currentTime;
    const previous = entry.ramp;
    const held = previous
      ? previous.start +
        (previous.target - previous.start) *
          Math.min(1, Math.max(0, (now - previous.at) / previous.seconds))
      : 0;
    entry.gain.gain.cancelScheduledValues(now);
    entry.gain.gain.setValueAtTime(held, now);
    entry.gain.gain.linearRampToValueAtTime(target, now + seconds);
    entry.ramp = { start: held, target, at: now, seconds };
  }
  function remove(entry) {
    clearTimer(entry.timer);
    entry.audio.pause();
    entry.audio.removeAttribute("src");
    entry.audio.load();
    entry.audio.remove?.();
    entry.source.disconnect();
    entry.gain.disconnect();
    entries.delete(entry);
    if (disposed && !entries.size) void context?.close().catch(() => {});
  }
  function fadeOut(entry, discard = false) {
    clearTimer(entry.timer);
    gain(entry, 0, 0.9);
    entry.timer = setTimer(() => {
      if (discard || disposed || entry !== current) remove(entry);
      else if (!wanted()) entry.audio.pause();
    }, 950);
  }
  function envelope(entry) {
    const { currentTime: t, duration: d } = entry.audio;
    // Soften the end and beginning on every loop; keep narration untouched.
    return Number.isFinite(d) && d > 3
      ? Math.min(1, t / 1.2, Math.max(0, d - t) / 1.2)
      : 1;
  }
  async function unlock() {
    if (disposed) return;
    try {
      context ||= createContext();
      if (context.state === "suspended") await context.resume();
    } catch {
      onError("浏览器暂时不能播放背景音乐，口播仍可正常播放。");
    }
  }
  async function update(settings) {
    desired = {
      ...desired,
      ...settings,
      volume: Math.max(0, Math.min(0.4, settings.volume ?? desired.volume)),
    };
    if (disposed) return;
    if (!wanted()) {
      if (current) fadeOut(current);
      return;
    }
    await unlock();
    if (!context || !wanted()) return;
    if (!current || current.url !== desired.url) {
      if (current) fadeOut(current, true);
      const audio = createAudio();
      audio.loop = true;
      audio.preload = "none";
      audio.src = desired.url;
      const source = context.createMediaElementSource(audio),
        node = context.createGain();
      node.gain.value = 0;
      source.connect(node);
      node.connect(context.destination);
      current = {
        url: desired.url,
        audio,
        source,
        gain: node,
        timer: null,
        ramp: null,
      };
      entries.add(current);
      const entry = current;
      audio.addEventListener("timeupdate", () => {
        if (wanted() && current === entry)
          gain(entry, desired.volume * envelope(entry), 0.25);
      });
      audio.addEventListener("error", () => {
        if (current === entry && wanted()) {
          desired.enabled = false;
          fadeOut(entry);
          onError(
            "背景音乐暂时无法加载，请关闭后重开，或换一首。口播不受影响。",
          );
        }
      });
    }
    const entry = current;
    clearTimer(entry.timer);
    try {
      if (entry.audio.error) entry.audio.load();
      await entry.audio.play();
      if (disposed) {
        entry.audio.pause();
        return;
      }
      if (current !== entry || !wanted()) {
        fadeOut(entry, current !== entry);
        return;
      }
      gain(entry, desired.volume * envelope(entry), 1.4);
    } catch (e) {
      if (current !== entry || !wanted() || e.name === "AbortError") return;
      desired.enabled = false;
      fadeOut(entry);
      onError("背景音乐未能播放，请关闭后重新开启。口播不受影响。");
    }
  }
  function dispose() {
    disposed = true;
    for (const entry of entries) fadeOut(entry, true);
    if (!entries.size) void context?.close().catch(() => {});
  }
  return { update, unlock, dispose };
}
