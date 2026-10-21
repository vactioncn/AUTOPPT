import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HOSTED_BUILTIN_STYLE_IDS, offeredStyles } from "../shared/styles.mjs";

test("published custom styles appear once in creation; existing source selections remain usable", () => {
  const source = { id: "private", rules: "private current rules" };
  const published = {
    id: "catalog-private",
    catalogSourceId: source.id,
    rules: "approved rules",
  };
  const before = structuredClone([source, published]);
  assert.deepEqual(offeredStyles([source, published], true), [published]);
  assert.deepEqual(offeredStyles([source, published], true, source.id), [
    source,
    published,
  ]);
  assert.deepEqual(
    offeredStyles([source, { ...published, catalogHidden: true }], true),
    [source],
  );
  assert.deepEqual([source, published], before);
});

test("web choices keep four curated identities, private styles and only the current legacy choice", () => {
  const styles = [
    { id: "bold", name: "数字聚焦", builtin: true, rules: "用户原文" },
    { id: "mine", name: "数字聚焦", builtin: false, rules: "个人风格" },
    ...[...HOSTED_BUILTIN_STYLE_IDS]
      .reverse()
      .map((id) => ({ id, builtin: true, rules: "原提示词" })),
    { id: "gone", deletedAt: "keep", rules: "已删除" },
  ];
  const before = structuredClone(styles);
  assert.deepEqual(
    offeredStyles(styles, true).map((s) => s.id),
    [...HOSTED_BUILTIN_STYLE_IDS, "mine"],
  );
  assert.deepEqual(
    offeredStyles(styles, true, "bold").map((s) => s.id),
    [...HOSTED_BUILTIN_STYLE_IDS, "bold", "mine"],
  );
  assert.deepEqual(
    offeredStyles(styles).map((s) => s.id),
    styles.filter((s) => !s.deletedAt).map((s) => s.id),
  );
  assert.deepEqual(
    styles,
    before,
    "Browsing must never rewrite saved styles or their order",
  );
});

test("new hosted workspaces seed four styles; upgrades preserve legacy rules, history and projects", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "autoppt-hosted-styles-"));
  try {
    execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
      import assert from 'node:assert/strict';
      import { all, get, put, seedBuiltinStyles, db } from './server/store.mjs';
      import { HOSTED_BUILTIN_STYLE_IDS } from './shared/styles.mjs';
      assert.deepEqual(all('style').map(s=>s.id).sort(), [...HOSTED_BUILTIN_STYLE_IDS].sort());
      put('style', {id:'bold',name:'保留旧风格',builtin:true,rules:'不可改写的规则',versions:[{id:'old'}],updatedAt:'keep'});
      put('project', {id:'existing',styleId:'bold',slides:[{image:'keep.png',notes:'原稿'}]});
      put('style', {...get('style',HOSTED_BUILTIN_STYLE_IDS[1]), deletedAt:'keep-deleted'});
      const styles=all('style'), projects=all('project');
      seedBuiltinStyles();
      assert.deepEqual(all('style'),styles);
      assert.deepEqual(all('project'),projects);
      assert.equal(get('style','bold').rules,'不可改写的规则');
      db.close();
    `,
      ],
      {
        cwd: fileURLToPath(new URL("..", import.meta.url)),
        env: {
          ...process.env,
          AUTOPPT_DATA_DIR: dir,
          AUTOPPT_WORKER_TOKEN: "isolated-test-worker",
        },
        stdio: "pipe",
      },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
