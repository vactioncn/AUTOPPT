import path from "node:path";
import { readFile, realpath, stat } from "node:fs/promises";

// This is an explicitly imported site playlist, independent of private projects.
export function registerBackgroundMusic(app, directory) {
  const root = path.resolve(directory);
  async function catalogue() {
    let entries;
    try {
      entries = JSON.parse(
        await readFile(path.join(root, "index.json"), "utf8"),
      );
    } catch {
      return [];
    }
    if (!Array.isArray(entries)) return [];
    const tracks = await Promise.all(
      entries.slice(0, 30).map(async (item) => {
        if (
          !/^[a-f0-9]{24}$/.test(item?.id || "") ||
          typeof item.name !== "string"
        )
          return null;
        const file = path.join(root, item.id + ".mp3");
        try {
          // A playlist cannot expose symlinks into another user's workspace.
          if (path.dirname(await realpath(file)) !== (await realpath(root)))
            return null;
          const info = await stat(file);
          if (!info.isFile() || !info.size || info.size > 30 * 1024 * 1024)
            return null;
          return {
            id: item.id,
            name: item.name.slice(0, 100),
            url: "/api/background-music/" + item.id + ".mp3",
          };
        } catch {
          return null;
        }
      }),
    );
    return tracks.filter(Boolean);
  }
  app.get("/api/background-music", async (_req, res) => {
    res.set("Cache-Control", "no-store").json({ tracks: await catalogue() });
  });
  app.get("/api/background-music/:file", async (req, res) => {
    const track = (await catalogue()).find(
      (t) => t.id + ".mp3" === req.params.file,
    );
    if (!track)
      return res
        .status(404)
        .json({ error: "这首背景音乐暂时不可用，请换一首。" });
    res.set("X-Content-Type-Options", "nosniff");
    res.type("audio/mpeg").sendFile(req.params.file, {
      root,
      maxAge: "1d",
      dotfiles: "deny",
    });
  });
}
