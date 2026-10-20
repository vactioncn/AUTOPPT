export function planImageBatch(slideIds, available, creditsPerPage = 1) {
  if (!Number.isSafeInteger(creditsPerPage) || creditsPerPage < 1)
    throw new Error("每页额度估算无效");
  const ids = [...new Set(slideIds)];
  const known = Number.isSafeInteger(available) && available >= 0;
  const affordable = known
    ? Math.min(ids.length, Math.floor(available / creditsPerPage))
    : 0;
  return {
    ids,
    total: ids.length,
    known,
    affordable,
    remaining: ids.length - affordable,
    limited: known && affordable < ids.length,
  };
}
