import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spokenManuscript, speakerNotes } from "../server/manuscript.mjs";

const dir = mkdtempSync(path.join(tmpdir(), "autoppt-manuscript-"));
process.env.AUTOPPT_DATA_DIR = dir;
const { all, get, put, db } = await import("../server/store.mjs");
const { migrateManuscripts } =
  await import("../server/manuscript-migration.mjs");
const { segment } = await import("../server/models.mjs");
const { newSlide } = await import("../server/jobs.mjs");
after(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

test("heading blocks disappear, preserving spoken paragraphs, wording and line endings", () => {
  const input =
    "# 演讲总标题\r\n\r\n## 章节标题\r\n\r\n  各位老板，大家好。  \r\n\r\n### 第一个思考题 ###\r\n\r\n我们怎么做？\r\n继续讲。\r\n";
  assert.equal(
    spokenManuscript(input),
    "  各位老板，大家好。  \r\n\r\n我们怎么做？\r\n继续讲。\r\n",
  );
  for (let level = 1; level <= 6; level++)
    assert.equal(
      spokenManuscript(`${"#".repeat(level)} 标题\n正文。`),
      "正文。",
    );
  assert.equal(
    spokenManuscript("大标题\n======\n\n正文。\n\n小标题\n------\n\n另一段。"),
    "正文。\n\n另一段。",
  );
  assert.equal(spokenManuscript("# 标题\n\n## 章节\n"), "");
  assert.equal(
    spokenManuscript(spokenManuscript(input)),
    spokenManuscript(input),
  );
});

test("prose, bold emphasis, escaped hashes, literal code and separators stay intact", () => {
  for (const text of [
    "  正文🙂。\n\n  第二段。  \n",
    "我们要讲 C#，标签 #1，还有 **重点正文**。\n",
    "第一章是开场白，这句正文要保留。\n",
    "\\# 这不是标题\n#标签不是标题\n####### 也不是标题",
    "```markdown\n# 代码示例\n标题\n===\n```\n\n正文。",
    "~~~\n## 示例\n~~~\n正文。",
    "    # 缩进代码\n\t## 代码\n",
    "正文。\n\n---\n下一段。",
  ])
    assert.equal(spokenManuscript(text), text);
  assert.equal(
    spokenManuscript("# 删去标题\n\n```md\n# 保留示例\n```\n正文。"),
    "```md\n# 保留示例\n```\n正文。",
  );
});

test("segmentation only sees the spoken body and a manual split never loses a literal hash", async () => {
  assert.deepEqual(
    await segment("# 章节\n\n这是正文。", "", new AbortController().signal),
    ["这是正文。"],
  );
  await assert.rejects(
    segment("## 只有标题", "", new AbortController().signal),
    /没有正文/,
  );
  const page = newSlide(
    "# 一个字面符号，原本位于正文句中。",
    ["batch"],
    "editorial",
  );
  assert.equal(speakerNotes(page), page.notes);
});

test("existing notes clean once with full backup; images, source, history, undo and stale state survive", () => {
  const original = {
    id: "legacy",
    revision: 2,
    title: "旧项目",
    draft: "# 未提交草稿",
    batches: [{ id: "b", text: "## 原始章节\n正文。", slideIds: ["s"] }],
    slides: [
      {
        id: "s",
        notes: "## 原始章节\n正文。",
        image: "original.png",
        plan: { title: "画面大标题不受影响" },
        stale: false,
        status: "ready",
        versions: [{ id: "old", notes: "# 旧稿\n旧正文。" }],
      },
    ],
    undo: {
      label: "拆分页面",
      slides: [
        { id: "before-split", notes: "# 旧标题\n合并前正文。", versions: [] },
      ],
    },
    proposal: {
      id: "proposal",
      notes: ["## 待确认\n方案正文。"],
      plans: [{ title: "保留方案" }],
    },
  };
  put("project", original);
  assert.deepEqual(migrateManuscripts(), ["legacy"]);
  const saved = get("project", "legacy");
  assert.equal(saved.slides[0].notes, "正文。");
  assert.equal(saved.slides[0].image, "original.png");
  assert.equal(saved.slides[0].stale, false);
  assert.deepEqual(saved.slides[0].plan, original.slides[0].plan);
  assert.equal(saved.slides[0].versions.at(-1).notes, original.slides[0].notes);
  assert.deepEqual(saved.slides[0].versions[0], original.slides[0].versions[0]);
  assert.equal(saved.undo.slides[0].notes, "合并前正文。");
  assert.deepEqual(saved.proposal.notes, ["方案正文。"]);
  assert.deepEqual(saved.batches, original.batches);
  assert.equal(saved.draft, original.draft);
  assert.deepEqual(all("manuscriptBackup")[0].project, original);
  assert.deepEqual(migrateManuscripts(), []);
  assert.equal(get("project", "legacy").revision, saved.revision);
  assert.equal(all("manuscriptBackup").length, 1);
});
