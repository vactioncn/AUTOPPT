// Line diff with a bounded LCS table. Large inputs fall back to a changed
// middle block; text is never truncated and ordering is always preserved.
export function textDiff(before, after) {
  const a = before.split("\n"),
    b = after.split("\n");
  let first = 0,
    endA = a.length,
    endB = b.length;
  while (first < endA && first < endB && a[first] === b[first]) first++;
  while (endA > first && endB > first && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const result = a.slice(0, first).map((text) => ({ kind: "same", text }));
  const n = endA - first,
    m = endB - first;
  if ((n + 1) * (m + 1) > 1000000) {
    for (let i = first; i < endA; i++)
      result.push({ kind: "removed", text: a[i] });
    for (let i = first; i < endB; i++)
      result.push({ kind: "added", text: b[i] });
  } else {
    const table = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        table[i][j] =
          a[first + i] === b[first + j]
            ? table[i + 1][j + 1] + 1
            : Math.max(table[i + 1][j], table[i][j + 1]);
    let i = 0,
      j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && a[first + i] === b[first + j]) {
        result.push({ kind: "same", text: a[first + i++] });
        j++;
      } else if (i < n && (j === m || table[i + 1][j] >= table[i][j + 1]))
        result.push({ kind: "removed", text: a[first + i++] });
      else result.push({ kind: "added", text: b[first + j++] });
    }
  }
  return [...result, ...a.slice(endA).map((text) => ({ kind: "same", text }))];
}
