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
// Local root opens the workspace; explicit public links use the same site as hosted.
export function visiblePublicPage(pathname = "/", hash = "", hosted = false) {
  if (!hosted && (pathname === "/" || pathname === "/index.html") && !hash)
    return null;
  return publicPage(pathname, hash);
}
export function workspaceTarget(value) {
  if (typeof value !== "string") return "projects";
  const route = value.replace(/^#/, "");
  return /^(projects|styles|new(?:\/(?:example|[a-f0-9-]{36}))?|account|admin(?:\/models)?|help|settings(?:\/(?:models|speech|labs))?|project\/[a-f0-9-]{36}(?:\/(?:overview|studio|rehearsal|delivery))?)$/.test(
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
