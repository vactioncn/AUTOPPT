// Small fixtures only: reconstruct the exported records for assertions. The
// production player loads individual media lazily and never combines them.
export function htmlPayload(html) {
  const data = JSON.parse(html.match(/id="deck-data">([^]*?)<\/script>/)[1]);
  for (const match of html.matchAll(/class="deck-page">([^]*?)<\/script>/g))
    data.pages.push(JSON.parse(match[1]));
  const audio = html.match(/id="deck-audio">([^]*?)<\/script>/);
  if (audio) Object.assign(data.audio, JSON.parse(audio[1]));
  const media = new Map(
    [
      ...html.matchAll(
        /type="application\/octet-stream" id="([^"]+)">([^]*?)<\/script>/g,
      ),
    ].map((match) => [`asset:${match[1]}`, match[2]]),
  );
  const resolve = (value) => {
    if (Array.isArray(value)) return value.map(resolve);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, resolve(v)]),
      );
    return media.get(value) || value;
  };
  return resolve(data);
}
