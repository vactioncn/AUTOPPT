const player = document.getElementById("player");
const play = document.getElementById("play");
const status = document.getElementById("status");
const scrub = document.getElementById("scrub");
const checkpoints = [2.6, 7.5, 11.5, 14.95, 17.9, 21.5, 25.6, 27.1, 30.3, 37];
const labels = [
  "提出问题",
  "先看完整页面",
  "聚焦关键结论",
  "建立坐标",
  "展开四季数据",
  "突出比较结论",
  "提出问题",
  "展示证据",
  "形成下一步行动",
  "收束观点",
];
let mode = "movie",
  target = null,
  ready = false;
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const buttons = [...document.querySelectorAll("button")];
buttons.forEach((b) => (b.disabled = true));
scrub.disabled = true;
function pause() {
  target = null;
  player.pause();
}
function jump(time) {
  pause();
  player.seek(time);
  update();
}
function update() {
  if (!ready) return;
  const t = player.currentTime;
  scrub.max = player.duration;
  scrub.value = t;
  const fmt = (x) => `00:${String(Math.floor(x)).padStart(2, "0")}`;
  document.getElementById("clock").textContent =
    `${fmt(t)} / ${fmt(player.duration)}`;
  play.textContent =
    mode === "steps"
      ? player.paused
        ? "下一步 →"
        : "暂停"
      : player.paused
        ? t >= player.duration - 0.1
          ? "重新播放"
          : "播放样片"
        : "暂停";
  const chapters = [0, 6, 14, 24, 32];
  document
    .querySelectorAll("[data-at]")
    .forEach((b, i) =>
      b.setAttribute(
        "aria-current",
        String(t >= chapters[i] && t < (chapters[i + 1] ?? Infinity)),
      ),
    );
  if (mode === "steps") {
    const i = checkpoints.findLastIndex((x) => t >= x - 0.04);
    status.textContent = `${Math.max(1, i + 1)} / ${checkpoints.length} · ${labels[Math.max(0, i)]} · 点击下一步继续，画面会停下来等你讲。`;
  } else
    status.textContent =
      "点击「开启声音」听配乐。切换「逐步讲」，体验现场演讲的停顿与推进。";
}
function next() {
  const t = player.currentTime;
  const nextTime = checkpoints.find((x) => x > t + 0.06);
  if (nextTime == null) {
    jump(checkpoints[0]);
    return;
  }
  if (mode !== "steps" || reduced) {
    jump(nextTime);
    return;
  }
  target = nextTime;
  player.muted = true;
  syncSound();
  player.play();
  update();
}
function previous() {
  jump(
    checkpoints.findLast((x) => x < player.currentTime - 0.06) ??
      checkpoints[0],
  );
}
function toggle() {
  if (!player.paused) {
    pause();
    update();
    return;
  }
  if (mode === "steps") next();
  else {
    target = null;
    if (Math.abs(player.currentTime - checkpoints[0]) < 0.05) player.seek(0);
    player.play();
    update();
  }
}
function setMode(value) {
  pause();
  mode = value;
  document
    .getElementById("movie")
    .setAttribute("aria-pressed", String(mode === "movie"));
  document
    .getElementById("steps")
    .setAttribute("aria-pressed", String(mode === "steps"));
  if (mode === "steps") {
    player.muted = true;
    syncSound();
  }
  update();
}
function syncSound() {
  const sound = document.getElementById("sound");
  sound.textContent = player.muted ? "开启声音" : "关闭声音";
  sound.setAttribute("aria-pressed", String(!player.muted));
}
player.addEventListener("ready", () => {
  ready = true;
  buttons.forEach((b) => (b.disabled = false));
  scrub.disabled = false;
  player.iframeElement.title = "一页 PPT，怎样让人看懂？动画画面";
  player.seek(checkpoints[0]);
  update();
});
player.addEventListener("error", (event) => {
  status.textContent = `播放失败：${event.detail?.message || "请刷新后重试"}。也可下载视频观看。`;
});
player.addEventListener("timeupdate", () => {
  if (target != null && player.currentTime >= target) {
    const stop = target;
    target = null;
    player.pause();
    player.seek(stop);
  }
  update();
});
player.addEventListener("ended", update);
play.onclick = toggle;
document.getElementById("next").onclick = next;
document.getElementById("previous").onclick = previous;
document.getElementById("movie").onclick = () => setMode("movie");
document.getElementById("steps").onclick = () => setMode("steps");
document.getElementById("sound").onclick = () => {
  player.muted = !player.muted;
  syncSound();
};
function presentation(expanded) {
  document.getElementById("theater").classList.toggle("expanded", expanded);
  document.body.classList.toggle("presenting", expanded);
  document.getElementById("fullscreen").textContent = expanded
    ? "退出全屏"
    : "全屏";
}
function fullscreen() {
  // Viewport presentation works in embedded browsers as well as normal tabs.
  presentation(
    !document.getElementById("theater").classList.contains("expanded"),
  );
}
document.getElementById("fullscreen").onclick = fullscreen;
scrub.oninput = () => jump(Number(scrub.value));
document
  .querySelectorAll("[data-at]")
  .forEach((b) => (b.onclick = () => jump(Number(b.dataset.at))));
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && document.body.classList.contains("presenting")) {
    presentation(false);
    return;
  }
  if (
    !ready ||
    e.altKey ||
    e.metaKey ||
    e.ctrlKey ||
    /^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(e.target.tagName) ||
    e.target.isContentEditable
  )
    return;
  if (["ArrowRight", "ArrowLeft", " "].includes(e.key)) e.preventDefault();
  if (e.key === "ArrowRight") next();
  if (e.key === "ArrowLeft") previous();
  if (e.key === " ") toggle();
  if (e.key.toLowerCase() === "f") fullscreen();
});
// Only a localhost page exposes the optional local editor link, supplied by the launcher.
const studioPort = new URLSearchParams(location.search).get("studio");
if (
  ["localhost", "127.0.0.1"].includes(location.hostname) &&
  /^\d{4,5}$/.test(studioPort || "") &&
  Number(studioPort) < 65536
) {
  const a = document.getElementById("studio");
  a.href = `http://127.0.0.1:${studioPort}/`;
  a.hidden = false;
}
