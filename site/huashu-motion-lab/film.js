const V = OM.vars();
const values = [V.q1, V.q2, V.q3, V.q4].map(Number);
if (
  values.some((n) => !Number.isFinite(n) || n < 0 || n > 80) ||
  values[0] <= 0
)
  throw new Error("演示数据须在 0–80 之间，Q1 必须大于 0。");
const growth = Math.round(((values[3] - values[0]) / values[0]) * 100);
const phrase =
  growth === 100
    ? "订单翻了一倍"
    : growth === 0
      ? "订单数量持平"
      : `订单${growth > 0 ? "增长" : "减少"} ${Math.abs(growth)}%`;
document.querySelectorAll(".growth-phrase").forEach((el) => {
  el.textContent = phrase;
});
document.getElementById("growth-value").textContent =
  `${growth > 0 ? "+" : ""}${growth}%`;
document.getElementById("calculation").textContent =
  `(${values[3]} − ${values[0]}) ÷ ${values[0]} × 100%`;
document.querySelectorAll(".mini-bars i").forEach((el, i) => {
  el.style.height = `${values[i] * 1.5}px`;
});
const bars = document.getElementById("bars");
values.forEach((value, i) => {
  const group = document.createElement("div");
  group.className = "bar-group";
  group.style.left = `${48 + i * 220}px`;
  group.dataset.omId = `quarter-${i + 1}`;
  group.innerHTML = `<div class="bar-fill" style="height:${value * 5}px"></div><span class="bar-number" style="bottom:${value * 5 + 12}px">${value}</span><span class="bar-label">Q${i + 1}</span>`;
  bars.append(group);
});
const tl = gsap.timeline({ paused: true, defaults: { ease: "power3.out" } });
const enter = (target, at, options = {}) =>
  tl.fromTo(
    target,
    { opacity: 0, y: 28 },
    { opacity: 1, y: 0, duration: 0.75, ...options, immediateRender: false },
    at,
  );
const scene = (id, at, end) => {
  tl.addLabel(`scene:${id}`, at).set(`#${id}`, { autoAlpha: 1 }, at);
  if (end < 40) tl.set(`#${id}`, { autoAlpha: 0 }, end);
};
scene("hook", 0, 6);
enter("#hook .eyebrow", 0.1);
enter("#hook h1 span", 0.2, { stagger: 0.25 });
enter(".opening-note", 1.4);
tl.fromTo(
  ".paper-stack",
  { x: 170, rotation: 10, opacity: 0 },
  { x: 0, rotation: -4, opacity: 1, duration: 1.1, immediateRender: false },
  0.2,
);
tl.fromTo(
  ".back-one",
  { x: 70, rotation: 8 },
  { x: -24, rotation: -8, duration: 1.2, immediateRender: false },
  0.4,
);
tl.fromTo(
  ".back-two",
  { x: 90, rotation: -10 },
  { x: 34, rotation: 10, duration: 1.2, immediateRender: false },
  0.55,
);
tl.fromTo(
  ".mini-bars i",
  { scaleY: 0 },
  { scaleY: 1, duration: 0.7, stagger: 0.15, immediateRender: false },
  1,
);
tl.to(
  ".paper-stack",
  { x: -100, scale: 1.16, rotation: 0, duration: 0.5, ease: "power2.inOut" },
  5.5,
);
scene("focus", 6, 14);
enter("#focus .eyebrow", 6.05);
enter("#focus h2", 6.15);
enter(".focus-note", 7);
tl.fromTo(
  ".focus-paper",
  { x: 75, rotation: -1, scale: 0.9 },
  { x: 0, rotation: 2, scale: 1, duration: 0.8, immediateRender: false },
  6,
);
tl.fromTo(
  ".focus-rule",
  { scaleX: 0 },
  { scaleX: 1, duration: 0.7, immediateRender: false },
  8,
);
tl.fromTo(
  ".focus-paper .minor",
  { opacity: 1 },
  { opacity: 0.25, duration: 0.65, immediateRender: false },
  8,
);
tl.fromTo(
  ".focus-paper .major",
  { y: 15, scale: 1 },
  { y: -5, scale: 1.03, duration: 0.8, immediateRender: false },
  8.1,
);
scene("data", 14, 24);
enter("#data h2", 14.05);
enter(".chart-caption", 14.15);
enter(".chart .gridline", 14.3, { duration: 0.5 });
tl.fromTo(
  ".bar-fill",
  { scaleY: 0 },
  { scaleY: 1, duration: 1, stagger: 0.5, immediateRender: false },
  15,
);
enter(".bar-label", 14.6, { duration: 0.45, stagger: 0.15 });
enter(".bar-number", 15.7, { duration: 0.4, stagger: 0.5 });
enter(".data-insight", 18, { duration: 0.8 });
tl.fromTo(
  ".insight-rule",
  { scaleX: 0 },
  { scaleX: 1, duration: 0.6, immediateRender: false },
  18.6,
);
scene("logic", 24, 32);
enter("#logic h2", 24.05);
enter(".logic-sub", 24.3);
enter(".n1", 24.8);
enter(".n2", 26.3);
enter(".n3", 27.8);
tl.fromTo(
  ".c1",
  { scaleX: 0 },
  { scaleX: 1, duration: 0.6, immediateRender: false },
  25.7,
);
tl.fromTo(
  ".c2",
  { scaleX: 0 },
  { scaleX: 1, duration: 0.6, immediateRender: false },
  27.2,
);
enter(".logic-note", 29);
scene("ending", 32, 40);
tl.fromTo(
  ".end-line",
  { scaleX: 0 },
  { scaleX: 1, duration: 0.5, immediateRender: false },
  32,
);
enter("#ending h2", 32.1, { duration: 0.9 });
enter(".end-note", 33.1);
enter(".delivery span", 34, { stagger: 0.2 });
enter(".signature", 34.7);
tl.fromTo(
  ".film-progress",
  { scaleX: 0 },
  { scaleX: 1, duration: 40, ease: "none" },
  0,
);
tl.to({}, { duration: 3 }, 37);
OM.music({ bpm: 120, product: "explainer", brand: "讲好", ending: "ring" });
[
  ["paper", 0.65, 0.45],
  ["tick", 1.35, 0.3],
  ["draw", 8.3, 0.4],
  ["pop", 15.3, 0.25],
  ["pop", 15.8, 0.3],
  ["pop", 16.3, 0.35],
  ["pop", 16.8, 0.4],
  ["chime", 18.3, 0.4],
  ["thud", 25.05, 0.3],
  ["thud", 26.55, 0.35],
  ["thud", 28.05, 0.4],
  ["draw", 29.3, 0.25],
  ["impact", 32.3, 0.32],
  ["ding", 35, 0.3],
].forEach(([name, at, gain], i) =>
  OM.sfx(name, at, { gain, note: 1 + (i % 3) }),
);
window.__timelines.film = tl;
