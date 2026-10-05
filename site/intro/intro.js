const viewer = document.getElementById("image-viewer");
const status = document.getElementById("page-status");
for (const button of document.querySelectorAll("[data-zoom]")) {
  button.addEventListener("click", () => {
    const img = document.getElementById("viewer-image");
    img.src = button.dataset.zoom;
    img.alt = button.dataset.caption;
    document.getElementById("viewer-caption").textContent =
      button.dataset.caption;
    viewer.showModal();
  });
}
document
  .querySelector(".viewer-close")
  .addEventListener("click", () => viewer.close());
viewer.addEventListener("click", (event) => {
  const box = viewer.getBoundingClientRect();
  if (
    event.target === viewer &&
    (event.clientX < box.left ||
      event.clientX > box.right ||
      event.clientY < box.top ||
      event.clientY > box.bottom)
  )
    viewer.close();
});

const choices = [...document.querySelectorAll(".style-choice")];
let selection = 0;
for (const [index, button] of choices.entries()) {
  button.addEventListener("click", async () => {
    const request = ++selection;
    const preview = new Image();
    preview.src = button.dataset.styleSrc;
    try {
      await preview.decode();
    } catch {
      if (request === selection)
        status.textContent = "图片未能加载，请稍后重试。";
      return;
    }
    if (request !== selection) return;
    for (const choice of choices)
      choice.setAttribute("aria-pressed", String(choice === button));
    const img = document.getElementById("gallery-image");
    img.src = preview.src;
    img.alt = `${button.dataset.styleLabel}封面`;
    document.getElementById("gallery-title").textContent =
      button.dataset.styleLabel;
    document.getElementById("gallery-description").textContent =
      button.dataset.styleDetail;
    const zoom = document.getElementById("gallery-zoom");
    zoom.dataset.zoom = button.dataset.styleSrc;
    zoom.dataset.caption = `${button.dataset.styleLabel} · 内置风格封面`;
    status.textContent = "";
  });
  button.addEventListener("keydown", (event) => {
    let next;
    if (event.key === "ArrowRight") next = (index + 1) % choices.length;
    if (event.key === "ArrowLeft")
      next = (index + choices.length - 1) % choices.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = choices.length - 1;
    if (next === undefined) return;
    event.preventDefault();
    choices[next].focus();
    choices[next].click();
  });
}

const menuButton = document.querySelector(".menu-toggle");
const navigation = document.getElementById("site-navigation");
function closeMenu() {
  navigation.classList.remove("is-open");
  menuButton.setAttribute("aria-expanded", "false");
  menuButton.setAttribute("aria-label", "打开导航");
}
menuButton.addEventListener("click", () => {
  const open = menuButton.getAttribute("aria-expanded") !== "true";
  navigation.classList.toggle("is-open", open);
  menuButton.setAttribute("aria-expanded", String(open));
  menuButton.setAttribute("aria-label", open ? "关闭导航" : "打开导航");
});
navigation.addEventListener("click", (event) => {
  if (event.target.closest("a")) closeMenu();
});
document.addEventListener("keydown", (event) => {
  if (
    event.key === "Escape" &&
    menuButton.getAttribute("aria-expanded") === "true"
  ) {
    closeMenu();
    menuButton.focus();
  }
});
document.addEventListener("click", (event) => {
  if (!event.target.closest(".site-header")) closeMenu();
});

for (const button of document.querySelectorAll(".copy-code")) {
  button.addEventListener("click", async () => {
    const code = button.nextElementSibling.textContent;
    try {
      await navigator.clipboard.writeText(code);
      button.textContent = "已复制";
      status.textContent = "安装命令已复制。";
    } catch {
      const range = document.createRange();
      range.selectNodeContents(button.nextElementSibling);
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      button.textContent = "请复制已选命令";
      status.textContent = "命令已选中，请手动复制。";
    }
    setTimeout(() => (button.textContent = "复制命令"), 2500);
  });
}

const embedded =
  window.parent !== window &&
  new URLSearchParams(location.search).has("embedded");
const local = ["127.0.0.1", "localhost", "[::1]"].includes(location.hostname);
const workspace = document.getElementById("open-workspace");
// Only a local /intro/ route belongs to the application's workspace. An
// isolated deployment preview on localhost is still just a static website.
const localWorkspace =
  local &&
  /^\/intro(?:\/|\/index\.html|$)/.test(location.pathname) &&
  workspace.getAttribute("href") === "../#projects";
if (embedded) {
  workspace.addEventListener("click", (event) => {
    event.preventDefault();
    window.parent.postMessage({ type: "autoppt:intro-back" }, location.origin);
  });
  for (const link of document.querySelectorAll("a[href]")) {
    if (new URL(link.href).origin !== location.origin) {
      link.target = "_blank";
      link.rel = "noopener noreferrer";
    }
  }
} else if (localWorkspace) {
  const back = document.createElement("a");
  back.href = "../#projects";
  back.textContent = "返回工作台";
  navigation.prepend(back);
} else {
  workspace.href = "https://github.com/vactioncn/AUTOPPT";
  workspace.textContent = "查看源码与安装入口 ↗";
}

const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
if (!reducedMotion.matches && "IntersectionObserver" in window) {
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.remove("reveal-pending");
          observer.unobserve(entry.target);
        }
      }
    },
    { threshold: 0.08 },
  );
  for (const element of document.querySelectorAll("[data-reveal]")) {
    if (element.getBoundingClientRect().top > innerHeight) {
      element.classList.add("reveal-pending");
      observer.observe(element);
    }
  }
  reducedMotion.addEventListener("change", () => {
    if (reducedMotion.matches) {
      observer.disconnect();
      document
        .querySelectorAll(".reveal-pending")
        .forEach((el) => el.classList.remove("reveal-pending"));
    }
  });
}
