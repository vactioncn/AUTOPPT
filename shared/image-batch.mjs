export function planImageBatch(slideIds, available) {
  const ids = [...new Set(slideIds)];
  const known = Number.isSafeInteger(available) && available >= 0;
  const affordable = known ? Math.min(ids.length, available) : 0;
  return {
    ids,
    total: ids.length,
    known,
    affordable,
    remaining: ids.length - affordable,
    limited: known && affordable < ids.length,
  };
}
