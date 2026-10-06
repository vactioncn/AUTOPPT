function ownedFrame(origin, web, details) {
  try {
    return (
      !!web &&
      !web.isDestroyed() &&
      details?.isMainFrame === true &&
      new URL(web.getURL()).origin === origin &&
      new URL(details.requestingUrl).origin === origin &&
      (!details.securityOrigin ||
        new URL(details.securityOrigin).origin === origin)
    );
  } catch {
    return false;
  }
}
function allowRequest(origin, web, permission, details) {
  if (!ownedFrame(origin, web, details)) return false;
  return (
    permission === "fullscreen" ||
    (permission === "media" &&
      details.mediaTypes?.length === 1 &&
      details.mediaTypes[0] === "audio")
  );
}
module.exports = { ownedFrame, allowRequest };
