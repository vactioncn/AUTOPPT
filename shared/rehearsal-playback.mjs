// Read-only checks: a saved recording is current only for the exact inputs and scope.
export function matchesRehearsalRun(
  run,
  plan,
  { texts, model, pageIds, trialLength },
) {
  if (!run.compatible || !plan) return false;
  const keys = [
    "actor",
    "visual",
    "avatarId",
    "voiceId",
    "emotion",
    "speed",
    "narrationId",
  ];
  if (!keys.every((key) => run.plan[key] === plan[key])) return false;
  if ((run.plan.expression || "natural") !== (plan.expression || "natural"))
    return false;
  if (!plan.narrationId && run.speechModel && run.speechModel !== model)
    return false;
  const ids = run.scope === "trial" ? [plan.pageId] : pageIds;
  if (
    run.pages.length !== ids.length ||
    run.pages.some((page, i) => page.id !== ids[i])
  )
    return false;
  if (run.scope === "trial" && run.trialLength !== trialLength) return false;
  return (
    !!plan.narrationId ||
    run.pages.every((page) => (page.fullText ?? page.text) === texts[page.id])
  );
}

// Pending clips cannot be played. Including them stops continuous playback at the
// first unfinished segment even when later pages already have playable audio.
export function rehearsalPlaybackPieces(run) {
  return run.pages.flatMap((page) => {
    const playable = page.clips.filter((clip) => clip.file || clip.audioFile);
    if (playable.length) return playable.map((clip) => ({ page, clip }));
    return run.plan.actor === "self" ? [{ page, clip: {} }] : [];
  });
}
