import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  DEFAULT_STYLE_ID,
  defaultStyleId,
  BUILTIN_STYLE_COVERS,
} from "../shared/styles.mjs";

const dir = mkdtempSync(path.join(tmpdir(), "autoppt-builtins-"));
process.env.AUTOPPT_DATA_DIR = dir;
const { db, get, put, all, seedBuiltinStyles } =
  await import("../server/store.mjs");
after(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

test("fresh installs ship the approved restrained prompt without local assets or planning", () => {
  const style = get("style", "restrained-minimal");
  assert.equal(style.name, "克制极简风格");
  assert.equal(style.builtin, true);
  assert.equal(style.status, "ready");
  assert.equal(style.compositionMode, "direct");
  assert.deepEqual(style.refs, []);
  assert.equal(
    createHash("sha256").update(style.rules).digest("hex"),
    "24cbf6879474dd56a3d352ce94a4859d06886eae94026561e6cd1272ab0a38a6",
    "The published prompt must remain identical to the approved saved original",
  );
  assert.equal(defaultStyleId(all("style")), DEFAULT_STYLE_ID);
});

test("childhood editorial default ships the exact approved prompt and a display-only cover", () => {
  const style = get("style", DEFAULT_STYLE_ID);
  assert.equal(style.name, "克制儿童摄影杂志风");
  assert.equal(style.compositionMode, "direct");
  assert.deepEqual(style.refs, []);
  assert.equal(
    createHash("sha256").update(style.rules).digest("hex"),
    "6d75b8f55ef10f0285fb39d37b053a929fc01e7651c797da8401401992cacf74",
  );
  const cover = readFileSync(
    new URL("../public" + BUILTIN_STYLE_COVERS[style.id], import.meta.url),
  );
  assert.equal(cover.subarray(1, 4).toString(), "PNG");
  assert.equal(defaultStyleId(all("style")), style.id);
  // Upgrading an existing personal copy must preserve its rules, timestamps and history.
  const personal = {
    ...style,
    builtin: false,
    rules: "用户当前原文",
    updatedAt: "keep",
    versions: [{ rules: "旧版" }],
  };
  put("style", personal);
  seedBuiltinStyles();
  assert.deepEqual(get("style", style.id), personal);
});

test("upgrade only adds the missing builtin and preserves edits, deletion and old project selections", () => {
  db.prepare("DELETE FROM records WHERE kind='style' AND id=?").run(
    DEFAULT_STYLE_ID,
  );
  put("style", { ...get("style", "editorial"), rules: "本人的旧风格修改" });
  put("style", { id: "my-style", name: "克制极简风格", rules: "个人原文" });
  put("project", {
    id: "existing",
    styleId: "editorial",
    slides: [{ image: "keep.png", notes: "原稿", versions: [{ id: "v1" }] }],
  });
  const beforeStyles = all("style");
  const beforeProjects = all("project");
  seedBuiltinStyles();
  assert.equal(all("style").length, beforeStyles.length + 1);
  for (const s of beforeStyles) assert.deepEqual(get("style", s.id), s);
  assert.deepEqual(all("project"), beforeProjects);
  const modified = {
    ...get("style", DEFAULT_STYLE_ID),
    rules: "用户修改后的内置风格",
    compositionMode: "content-led",
  };
  put("style", modified);
  seedBuiltinStyles();
  assert.deepEqual(get("style", DEFAULT_STYLE_ID), modified);
  const deleted = { ...modified, deletedAt: "2026-10-01T00:00:00Z" };
  put("style", deleted);
  seedBuiltinStyles();
  assert.deepEqual(get("style", DEFAULT_STYLE_ID), deleted);
  assert.notEqual(defaultStyleId(all("style")), DEFAULT_STYLE_ID);
});

test("default selection skips unavailable styles and handles an empty library", () => {
  assert.equal(
    defaultStyleId([
      { id: DEFAULT_STYLE_ID, rules: " " },
      { id: "deleted", rules: "valid", deletedAt: "2026-10-01" },
      { id: "other", rules: "有效规则" },
    ]),
    "other",
  );
  assert.equal(defaultStyleId([]), "");
});
