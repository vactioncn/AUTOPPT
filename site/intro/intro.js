const tabs = [...document.querySelectorAll('[role="tab"]')];
function selectFeature(id, focus = false) {
  const selected = tabs.find((t) => t.dataset.feature === id);
  if (!selected) return;
  for (const tab of tabs) {
    const active = tab === selected;
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
    document.getElementById(tab.getAttribute("aria-controls")).hidden = !active;
  }
  if (focus) selected.focus();
}
for (const [i, tab] of tabs.entries()) {
  tab.addEventListener("click", () => selectFeature(tab.dataset.feature));
  tab.addEventListener("keydown", (e) => {
    let next;
    if (e.key === "ArrowRight") next = (i + 1) % tabs.length;
    if (e.key === "ArrowLeft") next = (i - 1 + tabs.length) % tabs.length;
    if (e.key === "Home") next = 0;
    if (e.key === "End") next = tabs.length - 1;
    if (next !== undefined) {
      e.preventDefault();
      selectFeature(tabs[next].dataset.feature, true);
    }
  });
}
document
  .querySelectorAll("[data-select-feature]")
  .forEach((link) =>
    link.addEventListener("click", () =>
      selectFeature(link.dataset.selectFeature),
    ),
  );
const viewer = document.getElementById("image-viewer");
for (const button of document.querySelectorAll("[data-zoom]"))
  button.addEventListener("click", () => {
    const img = document.getElementById("viewer-image");
    img.src = button.dataset.zoom;
    img.alt = button.dataset.caption;
    document.getElementById("viewer-caption").textContent =
      button.dataset.caption;
    viewer.showModal();
  });
document
  .querySelector(".viewer-close")
  .addEventListener("click", () => viewer.close());
for (const button of document.querySelectorAll(".copy-code"))
  button.addEventListener("click", async () => {
    const code = button.nextElementSibling.textContent;
    try {
      await navigator.clipboard.writeText(code);
      button.textContent = "已复制";
    } catch {
      const range = document.createRange();
      range.selectNodeContents(button.nextElementSibling);
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      button.textContent = "请复制已选命令";
    }
    setTimeout(() => (button.textContent = "复制命令"), 2500);
  });
// The downloadable introduction can also be hosted on any static host.
// Only local installations have a same-origin workspace to open.
if (!["127.0.0.1", "localhost", "[::1]"].includes(location.hostname)) {
  const link = document.getElementById("open-workspace");
  link.href = "https://github.com/vactioncn/AUTOPPT";
  link.textContent = "查看源码与安装入口 ↗";
}
