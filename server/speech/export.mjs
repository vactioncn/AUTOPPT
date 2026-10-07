import path from "node:path";
import { readFile } from "node:fs/promises";
import { get, dataDir } from "../store.mjs";
import { speakerNotes } from "../manuscript.mjs";

export function narrationForExport(id, projectId) {
  if (!id) return null;
  const narration = typeof id === "string" && get("narration", id);
  if (!narration || narration.projectId !== projectId)
    throw new Error("口播版本不属于这个项目");
  if (narration.status !== "ready")
    throw new Error("请先完成所选版本的口播，再导出 HTML");
  return narration;
}
export function matchNarrationPage(narration, page, motion = false) {
  const n = narration.pages.find((p) => p.id === page.id);
  const matches =
    n &&
    (motion
      ? n.sourceFingerprint
        ? n.sourceFingerprint === page.source.fingerprint
        : n.image === page.source.image &&
          n.notes === page.source.notes &&
          !n.scene
      : n.image === page.image &&
        JSON.stringify(n.scene || null) ===
          JSON.stringify(page.scene || null) &&
        n.notes === speakerNotes(page));
  if (!matches)
    throw new Error(
      `第 ${page.number || ""} 页的画面或讲稿与所选口播不一致，请选择对应版本或为当前页面生成口播`,
    );
  if (n.status !== "ready" || n.clips.some((c) => !c.file))
    throw new Error("所选页面的口播尚未完成");
  return n;
}
export async function embedAudio(pages) {
  const audio = {};
  for (const p of pages)
    for (const clip of p.clips || []) {
      if (!/^[a-f0-9-]{36}\.mp3$/.test(clip.file))
        throw new Error("已保存口播的音频路径无效");
      if (audio[clip.file]) continue;
      let data;
      try {
        data = await readFile(path.join(dataDir, "speech-audio", clip.file));
      } catch {
        throw new Error(`第 ${p.number} 页的音频文件缺失，无法导出完整口播`);
      }
      if (!data.length)
        throw new Error(`第 ${p.number} 页的音频为空，无法导出`);
      audio[clip.file] = "data:audio/mpeg;base64," + data.toString("base64");
    }
  return audio;
}
