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
