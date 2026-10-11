const pages = new Set([
  "website",
  "login",
  "register",
  "support",
  "privacy",
  "terms",
]);
export function publicPage(pathname = "/", hash = "") {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/index.html") return "website";
  if (path !== "/")
    return pages.has(path.slice(1)) ? path.slice(1) : "notfound";
  const route = hash.replace(/^#/, "");
  if (!route || route === "intro" || route === "web-content") return "website";
  return pages.has(route) ? route : null;
}
export function workspaceTarget(value) {
  if (typeof value !== "string") return "projects";
  const route = value.replace(/^#/, "");
  return /^(projects|styles|account|admin|help|settings(?:\/(?:models|speech|labs))?|project\/[a-f0-9-]{36}(?:\/(?:overview|studio|rehearsal|delivery))?)$/.test(
    route,
  )
    ? route
    : "projects";
}
export function navigateWeb(path, replace = false) {
  if (!/^\/(?:[a-z]+)?(?:[?#].*)?$/.test(path))
    throw new Error("Invalid navigation");
  history[replace ? "replaceState" : "pushState"](null, "", path);
  window.dispatchEvent(new Event("popstate"));
}
