import { writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

export function layoutFixture(displayText) {
  return {
    choreography: "editorial",
    background: "暖白纸张，右侧一小块绿色插画，文字区域安静留白",
    texts: displayText.map((text, i) => ({
      copyIndex: i,
      text,
      label: i ? "正文" : "标题",
      x: 100,
      y: 80 + i * 130,
      w: 1300,
      h: 120,
      font: "sans",
      fontWeight: i ? 400 : 700,
      fontSize: i ? 36 : 60,
      color: "#20272b",
      align: "left",
      lineHeight: 1.3,
      letterSpacing: 0,
      step: i,
      effect: "rise",
      duration: 700,
      delay: 0,
    })),
  };
}

// Container structure fixture, never used as proof of actual font rendering.
export async function fontPackFixture(dir) {
  const bytes = Buffer.alloc(200);
  bytes.writeUInt32LE(bytes.length);
  bytes.writeUInt16LE(0x504c, 34);
  await writeFile(path.join(dir, "font-1.fntdata"), bytes);
  const fonts = [
    ["Jianghao Sans", "regular"],
    ["Jianghao Sans", "bold"],
    ["Jianghao Sans Light", "regular"],
    ["Jianghao Serif", "regular"],
    ["Jianghao Serif", "bold"],
  ].map(([family, slot]) => ({
    family,
    slot,
    file: "font-1.fntdata",
    license: "SIL OPEN FONT LICENSE",
    sha256: createHash("sha256").update(bytes).digest("hex"),
    characters: Array.from({ length: 65536 }, (_, i) => i),
  }));
  await writeFile(
    path.join(dir, "manifest.json"),
    JSON.stringify({ version: 1, fonts }),
  );
}
