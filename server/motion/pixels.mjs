export const rgb = (color) =>
  [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
export const distance = (a, b) =>
  Math.max(...a.map((v, i) => Math.abs(v - b[i])));
export function regionBox(layer, width, height, padding = 0) {
  const x = Math.max(0, Math.floor(layer.x - padding)),
    y = Math.max(0, Math.floor(layer.y - padding));
  return {
    left: x,
    top: y,
    width: Math.min(width - x, Math.ceil(layer.x + layer.w + padding) - x),
    height: Math.min(height - y, Math.ceil(layer.y + layer.h + padding) - y),
  };
}
// Locate actual glyph pixels instead of erasing their whole rectangle. This keeps
// highlighted blocks, rules, and texture between letters intact.
export function textRemoval(data, width, height, layer) {
  const box = regionBox(
    layer,
    width,
    height,
    Math.max(3, layer.fontSize * 0.055),
  );
  const w = box.width,
    h = box.height,
    ink = rgb(layer.color),
    mask = new Uint8Array(w * h);
  const histogram = new Map();
  let sampled = 0;
  for (let y = 0; y < h; y += 3)
    for (let x = 0; x < w; x += 3) {
      const i = ((box.top + y) * width + box.left + x) * 4,
        px = [...data.subarray(i, i + 3)];
      if (distance(px, ink) < 70) continue;
      sampled++;
      const key = px.map((v) => v >> 4).join(",");
      const item = histogram.get(key) || { sum: [0, 0, 0], count: 0 };
      px.forEach((v, c) => (item.sum[c] += v));
      item.count++;
      histogram.set(key, item);
    }
  const palette = [...histogram.values()]
    .sort((a, b) => b.count - a.count)
    .filter((c) => c.count / Math.max(sampled, 1) > 0.03)
    .slice(0, 4)
    .map((c) => c.sum.map((v) => v / c.count));
  const resemblesInk = (px) =>
    distance(px, ink) <= 50 ||
    palette.some((bg) => {
      const direction = ink.map((v, c) => v - bg[c]),
        norm = direction.reduce((n, v) => n + v * v, 0);
      if (norm < 3600) return false;
      const t =
        px.reduce((n, v, c) => n + (v - bg[c]) * direction[c], 0) / norm;
      return (
        t > 0.07 &&
        t < 1.15 &&
        distance(
          px,
          bg.map((v, c) => v + t * direction[c]),
        ) < 13
      );
    });
  const dilation = Math.min(4, Math.max(2, Math.ceil(layer.fontSize * 0.02)));
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = ((box.top + y) * width + box.left + x) * 4;
      if (!resemblesInk([...data.subarray(i, i + 3)])) continue;
      for (let dy = -dilation; dy <= dilation; dy++)
        for (let dx = -dilation; dx <= dilation; dx++) {
          const nx = x + dx,
            ny = y + dy;
          if (nx >= 0 && nx < w && ny >= 0 && ny < h) mask[ny * w + nx] = 1;
        }
    }
  // On nearly uniform backdrops (including two-color highlights), extend the
  // surrounding original pixels inward. No generative redraw is needed.
  const samples = [];
  for (let y = 0; y < h; y += 3)
    for (let x = 0; x < w; x += 3)
      if (!mask[y * w + x]) {
        const i = ((box.top + y) * width + box.left + x) * 4;
        samples.push([...data.subarray(i, i + 3)]);
      }
  const clusters = [];
  for (const pixel of samples) {
    const c = clusters.find((c) => distance(c.rgb, pixel) <= 9);
    if (c) c.count++;
    else clusters.push({ rgb: pixel, count: 1 });
    if (clusters.length > 64) break;
  }
  clusters.sort((a, b) => b.count - a.count);
  const simple =
    samples.length > 0 &&
    clusters.slice(0, 5).reduce((n, c) => n + c.count, 0) / samples.length >
      0.95;
  const pixels = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      data.copy(
        pixels,
        (y * w + x) * 4,
        ((box.top + y) * width + box.left + x) * 4,
        ((box.top + y) * width + box.left + x) * 4 + 4,
      );
  if (simple) {
    const modes = [];
    for (const c of clusters)
      if (
        c.count / samples.length > 0.02 &&
        !modes.some((m) => distance(m, c.rgb) < 22)
      )
        modes.push(c.rgb);
    const label = (i) => {
      if (i < 0) return -1;
      const px = [...pixels.subarray(i * 4, i * 4 + 3)];
      let best = 0,
        delta = Infinity;
      modes.forEach((c, j) => {
        const d = distance(px, c);
        if (d < delta) {
          best = j;
          delta = d;
        }
      });
      return best;
    };
    const stats = modes.map(() => ({
      matrix: [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
      ],
      values: [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
      ],
    }));
    for (let i = 0; i < mask.length; i += 2)
      if (!mask[i]) {
        const m = label(i);
        if (
          m < 0 ||
          distance([...pixels.subarray(i * 4, i * 4 + 3)], modes[m]) > 22
        )
          continue;
        const v = [1, (i % w) / w, Math.floor(i / w) / h],
          t = stats[m];
        for (let a = 0; a < 3; a++)
          for (let b = 0; b < 3; b++) t.matrix[a][b] += v[a] * v[b];
        for (let c = 0; c < 3; c++)
          for (let a = 0; a < 3; a++)
            t.values[c][a] += pixels[i * 4 + c] * v[a];
      }
    function solve(matrix, values, fallback) {
      const rows = matrix.map((row, i) => [...row, values[i]]);
      for (let k = 0; k < 3; k++) {
        let best = k;
        for (let j = k + 1; j < 3; j++)
          if (Math.abs(rows[j][k]) > Math.abs(rows[best][k])) best = j;
        [rows[k], rows[best]] = [rows[best], rows[k]];
        const pivot = rows[k][k];
        if (Math.abs(pivot) < 1e-7) return [fallback, 0, 0];
        for (let j = k; j < 4; j++) rows[k][j] /= pivot;
        for (let i = 0; i < 3; i++)
          if (i !== k) {
            const factor = rows[i][k];
            for (let j = k; j < 4; j++) rows[i][j] -= factor * rows[k][j];
          }
      }
      return rows.map((r) => r[3]);
    }
    const planes = stats.map((t, m) =>
      t.values.map((v, c) => solve(t.matrix, v, modes[m][c])),
    );
    // Sample the nearby unmasked texture instead of filling each glyph with a
    // single global plane. Local means avoid visible letter-shaped patches on
    // subtly shaded paper while keeping distinct highlight colors separated.
    const stride = w + 1;
    const integrals = modes.map((mode, m) => {
      const sums = Array.from(
        { length: 4 },
        () => new Float64Array(stride * (h + 1)),
      );
      for (let y = 0; y < h; y++) {
        const row = [0, 0, 0, 0];
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          if (
            !mask[i] &&
            label(i) === m &&
            distance([...pixels.subarray(i * 4, i * 4 + 3)], mode) <= 22
          ) {
            row[0]++;
            for (let c = 0; c < 3; c++) row[c + 1] += pixels[i * 4 + c];
          }
          for (let c = 0; c < 4; c++)
            sums[c][(y + 1) * stride + x + 1] =
              sums[c][y * stride + x + 1] + row[c];
        }
      }
      return sums;
    });
    function nearby(mode, x, y) {
      for (let radius = 6; radius <= Math.max(w, h) * 2; radius *= 2) {
        const x0 = Math.max(0, x - radius),
          x1 = Math.min(w, x + radius + 1),
          y0 = Math.max(0, y - radius),
          y1 = Math.min(h, y + radius + 1);
        const values = integrals[mode].map(
          (s) =>
            s[y1 * stride + x1] -
            s[y0 * stride + x1] -
            s[y1 * stride + x0] +
            s[y0 * stride + x0],
        );
        if (values[0] >= 24) return values.slice(1).map((v) => v / values[0]);
      }
      return null;
    }
    const left = new Int32Array(w * h).fill(-1),
      right = new Int32Array(w * h).fill(-1),
      up = new Int32Array(w * h).fill(-1),
      down = new Int32Array(w * h).fill(-1);
    for (let y = 0; y < h; y++) {
      let a = -1,
        b = -1;
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!mask[i]) a = i;
        left[i] = a;
        const j = y * w + w - 1 - x;
        if (!mask[j]) b = j;
        right[j] = b;
      }
    }
    for (let x = 0; x < w; x++) {
      let a = -1,
        b = -1;
      for (let y = 0; y < h; y++) {
        const i = y * w + x;
        if (!mask[i]) a = i;
        up[i] = a;
        const j = (h - 1 - y) * w + x;
        if (!mask[j]) b = j;
        down[j] = b;
      }
    }
    for (let i = 0; i < mask.length; i++)
      if (mask[i] || modes.length === 1) {
        const vertical = [up[i], down[i]],
          horizontal = [left[i], right[i]];
        let mode = -1;
        if (
          vertical.every((n) => n >= 0) &&
          label(vertical[0]) === label(vertical[1])
        )
          mode = label(vertical[0]);
        else if (
          horizontal.every((n) => n >= 0) &&
          label(horizontal[0]) === label(horizontal[1])
        )
          mode = label(horizontal[0]);
        else {
          const nearest = [...vertical, ...horizontal]
            .filter((n) => n >= 0)
            .sort(
              (a, b) =>
                Math.abs((a % w) - (i % w)) +
                Math.abs(Math.floor(a / w) - Math.floor(i / w)) -
                (Math.abs((b % w) - (i % w)) +
                  Math.abs(Math.floor(b / w) - Math.floor(i / w))),
            )[0];
          mode = label(nearest ?? -1);
        }
        if (mode < 0 || !modes[mode])
          return { box, mask, simple: false, pixels };
        const local = nearby(mode, i % w, Math.floor(i / w));
        for (let c = 0; c < 3; c++)
          pixels[i * 4 + c] = Math.max(
            0,
            Math.min(
              255,
              Math.round(
                local?.[c] ??
                  planes[mode][c][0] +
                    (planes[mode][c][1] * (i % w)) / w +
                    (planes[mode][c][2] * Math.floor(i / w)) / h,
              ),
            ),
          );
      }
    // A single smooth backdrop can be restored across the complete text box.
    // This also removes pale outlines/shadows which are unlike the ink color.
    // Multi-color highlights keep the glyph-only mask to preserve their edges.
    if (modes.length === 1) mask.fill(1);
  }
  return { box, mask, simple, pixels };
}
