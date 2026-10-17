import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  writeFile,
  rm,
  mkdir,
  symlink,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  validateDeck,
  buildTimeline,
  indexFromHash,
  moveIndex,
} from "../site/web-deck-lab/model.mjs";
import { buildWebDeck } from "../scripts/build-web-deck-demo.mjs";

const fixture = () => ({
  id: "test-only",
  title: "讨论一个问题",
  source: { title: "测试原稿", pages: { 1: "保留原文。" } },
  slides: [
    {
      type: "cover",
      title: "讨论一个问题",
      subtitle: "测试",
      aside: "说明",
      pattern: "M01",
      patternName: "封面",
      chapter: "开始",
      sources: [1],
      cues: ["开场"],
    },
    {
      type: "question",
      title: "条件是否满足？",
      question: "结果一定成立吗？",
      conclusion: "查看原始条件。",
      pattern: "M03",
      patternName: "提问",
      chapter: "讨论",
      sources: [1],
      cues: ["问题", "追问"],
    },
  ],
});

test("forward and backward preserve semantic phases across page boundaries", () => {
  const deck = validateDeck(fixture());
  const steps = buildTimeline(deck);
  assert.equal(steps.length, 3);
  assert.deepEqual(steps[moveIndex(1, -1, steps)], {
    page: 0,
    phase: 0,
    cue: "开场",
  });
  assert.deepEqual(steps[moveIndex(2, -1, steps)], {
    page: 1,
    phase: 0,
    cue: "问题",
  });
  assert.equal(moveIndex(0, -1, steps), 0);
  assert.equal(moveIndex(2, 1, steps), 2);
  for (let i = 0; i < steps.length; i++)
    assert.equal(
      indexFromHash(`#${steps[i].page + 1}.${steps[i].phase}`, steps),
      i,
    );
  for (const hash of ["#0.0", "#2.3", "#bad", "#1.-1"])
    assert.equal(indexFromHash(hash, steps), -1);
});

test("untraceable content and unsupported patterns fail before building a file", () => {
  const deck = fixture();
  deck.slides[1].sources = [2];
  assert.throws(() => validateDeck(deck), /source.pages.2/);
  deck.slides[1].sources = [1];
  deck.slides[1].type = "guessed-chart";
  assert.throws(() => validateDeck(deck), /未实现/);
  deck.slides[1].type = "question";
  deck.slides[1].cues.pop();
  assert.throws(() => validateDeck(deck), /步骤数/);
});

test("single-file output preserves source text, contains both themes and cannot break out of JSON script", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "web-deck-test-"));
  try {
    const deck = fixture();
    const unsafeText = '</script><img src=x onerror="alert(1)">__CSS__';
    deck.title = unsafeText;
    deck.source.pages[1] = unsafeText;
    await writeFile(path.join(dir, "in.json"), JSON.stringify(deck));
    const result = await buildWebDeck(
      path.join(dir, "in.json"),
      path.join(dir, "out.html"),
    );
    const html = await readFile(result.output, "utf8");
    assert.equal(result.pages, 2);
    assert.equal(result.steps, 3);
    assert.equal((html.match(/<script\b/g) || []).length, 2);
    const json = html.match(
      /<script id="deck-data" type="application\/json">([\s\S]*?)<\/script>/,
    )[1];
    assert.deepEqual(JSON.parse(json), deck);
    assert.ok(!html.includes("<img src=x"));
    assert.match(html, /\[data-theme=["']?architecture/);
    assert.ok(html.includes("data:font/woff2;base64,"));
    assert.ok(!/(?:src|href)=["']https?:|url\(https?:/.test(html));
    assert.ok(!html.includes("url(./fonts/"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("local image assets are embedded with attribution and preserve the source and cues", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "web-deck-media-"));
  try {
    const deck = fixture();
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aHfoAAAAASUVORK5CYII=",
      "base64",
    );
    await writeFile(path.join(dir, "concept.png"), png);
    deck.assets = {
      concept: { file: "concept.png", alt: "概念图", caption: "AI 视觉示意" },
    };
    deck.slides[0].hero = "concept";
    await writeFile(path.join(dir, "in.json"), JSON.stringify(deck));
    await buildWebDeck(path.join(dir, "in.json"), path.join(dir, "out.html"));
    const html = await readFile(path.join(dir, "out.html"), "utf8");
    const packed = JSON.parse(
      html.match(
        /<script id="deck-data" type="application\/json">([\s\S]*?)<\/script>/,
      )[1],
    );
    assert.deepEqual(packed.source, deck.source);
    assert.deepEqual(packed.slides, deck.slides);
    assert.deepEqual(packed.assets.concept, {
      alt: "概念图",
      caption: "AI 视觉示意",
      src: `data:image/png;base64,${png.toString("base64")}`,
    });
    assert.ok(!html.includes('"file":"concept.png"'));
    assert.ok(!/(?:src|href)=["']https?:|url\(https?:/.test(html));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("asset paths cannot read outside the storyboard directory, including symlinks", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "web-deck-path-"));
  try {
    const inner = path.join(dir, "story");
    await mkdir(inner);
    const external = path.join(dir, "external.png");
    await writeFile(external, "outside");
    await symlink(external, path.join(inner, "linked.png"));
    for (const file of [external, "../external.png", "linked.png"]) {
      const deck = fixture();
      deck.assets = { concept: { file } };
      await writeFile(path.join(inner, "in.json"), JSON.stringify(deck));
      await assert.rejects(
        buildWebDeck(path.join(inner, "in.json"), path.join(inner, "out.html")),
        /相对路径|超出分镜目录/,
      );
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
