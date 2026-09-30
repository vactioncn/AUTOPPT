import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import sharp from "sharp";
import { mkdtemp, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import {
  extractPage,
  collectImages,
  registerStyleImports,
} from "../server/style-import.mjs";
import {
  publicUrl,
  isPublicAddress,
  resolvePublic,
  publicFetch,
} from "../server/public-fetch.mjs";

test("URL import refuses non-web URLs, credentials, private addresses and mixed DNS answers", async () => {
  for (const url of [
    "file:///etc/passwd",
    "ftp://example.com/a",
    "https://a:b@example.com",
    "http://example.com:4317",
  ])
    assert.throws(() => publicUrl(url));
  for (const ip of [
    "127.0.0.1",
    "0.0.0.0",
    "10.0.0.1",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "198.18.0.1",
    "::1",
    "fe80::1",
    "fc00::1",
    "::ffff:127.0.0.1",
    "2001:db8::1",
  ])
    assert.equal(isPublicAddress(ip), false, ip);
  assert.equal(isPublicAddress("1.1.1.1"), true);
  await assert.rejects(() =>
    resolvePublic(new URL("https://example.org"), async () => [
      { address: "1.1.1.1", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ]),
  );
  await assert.rejects(() => publicFetch("http://2130706433"));
});

test("work extraction uses Zcool gallery only and keeps signed public preview URLs", () => {
  const page = extractPage(
    `<h1>红黑档案袋</h1><img src="/avatar.png"><div class="work-content"><img class="photoImage" data-src="//img.zcool.cn/a.jpg?k=abc&amp;t=123" src="/loading.gif"><img class="photoImage" src="//img.zcool.cn/a.jpg?k=abc&amp;t=123"></div><aside><img src="/recommend.jpg"></aside>`,
    "https://www.zcool.com.cn/work/test.html",
  );
  assert.equal(page.title, "红黑档案袋");
  const responsive = extractPage(
    '<main><picture><source srcset="small.jpg 320w, large.jpg?crop=1,2 1200w"><img src="small.jpg"></picture></main>',
    "https://example.org/work/",
  );
  assert.equal(
    responsive.candidates[0].url,
    "https://example.org/work/large.jpg?crop=1,2",
  );
  assert.deepEqual(page.candidates, [
    { url: "https://img.zcool.cn/a.jpg?k=abc&t=123", alt: "" },
  ]);
  const generic = extractPage(
    '<main><img data-original="/slide.png"><img alt="logo" src="/logo.png"><img src="data:image/png,abc"></main><footer><img src="/ad.jpg"></footer>',
    "https://example.org/work",
  );
  assert.deepEqual(
    generic.candidates.map((c) => c.url),
    ["https://example.org/slide.png"],
  );
  assert.equal(
    extractPage(
      '<title>作品</title><meta property="og:image" content="/cover.png">',
      "https://example.org",
    ).candidates.length,
    1,
  );
});

test("image collection normalizes real bytes, rejects small/invalid content and deduplicates", async () => {
  const large = await sharp({
    create: { width: 1024, height: 576, channels: 3, background: "#b21e1e" },
  })
    .png()
    .toBuffer();
  const small = await sharp({
    create: { width: 40, height: 40, channels: 3, background: "#fff" },
  })
    .png()
    .toBuffer();
  const saved = [];
  const result = await collectImages("https://example.org/page", {
    signal: AbortSignal.timeout(10000),
    saveImage: async (id, bytes) => saved.push({ id, bytes }),
    fetchPage: async (url) => ({
      url,
      status: 200,
      headers: {},
      body: url.endsWith("/page")
        ? Buffer.from(
            '<main><img src="/a.png"><img src="/duplicate.png"><img src="/small.png"><img src="/invalid.png"></main>',
          )
        : url.endsWith("/small.png")
          ? small
          : url.endsWith("/invalid.png")
            ? Buffer.from("not an image")
            : large,
    }),
  });
  assert.equal(result.images.length, 1);
  assert.equal(result.skipped, 3);
  assert.equal(saved.length, 1);
  assert.equal(result.images[0].width, 1024);
  assert.equal((await sharp(saved[0].bytes).metadata()).format, "png");
  await assert.rejects(
    () =>
      collectImages("https://example.org/page", {
        fetchPage: async (url) => ({
          url,
          status: 403,
          body: Buffer.from("访问验证"),
        }),
      }),
    /登录或访问验证/,
  );
});

test("Zcool normal rendering fallback produces the gallery or a clear access error", async () => {
  const image = await sharp({
    create: { width: 800, height: 450, channels: 3, background: "#ddd" },
  })
    .png()
    .toBuffer();
  let renders = 0;
  const result = await collectImages(
    "https://www.zcool.com.cn/work/test.html",
    {
      signal: AbortSignal.timeout(10000),
      saveImage: async () => {},
      fetchPage: async (url) => ({
        url,
        status: 200,
        body: url.includes("/work/")
          ? Buffer.from('<meta name="aliyun_waf_aa">')
          : image,
      }),
      render: async (url) => {
        renders++;
        return {
          url,
          html: '<h1>作品</h1><img class="photoImage" src="https://img.zcool.cn/a.png">',
        };
      },
    },
  );
  assert.equal(renders, 1);
  assert.equal(result.images.length, 1);
});

test("URL style workflow previews before saving, enqueues only selected references and preserves source", async (t) => {
  const dir = path.join(
    await mkdtemp(path.join(tmpdir(), "autoppt-url-test-")),
    ".local",
  );
  await mkdir(dir);
  await mkdir(path.join(dir, "assets"));
  const records = [],
    jobs = [];
  const image = await sharp({
    create: { width: 800, height: 450, channels: 3, background: "#b21e1e" },
  })
    .png()
    .toBuffer();
  const app = express();
  app.use(express.json());
  registerStyleImports(app, {
    dataDir: dir,
    assetPath: (name) => path.join(dir, "assets", name),
    put: (kind, value) => {
      records.push({ kind, value });
      return value;
    },
    id: randomUUID,
    now: () => new Date().toISOString(),
    enqueue: (...args) => {
      jobs.push(args);
      return { id: randomUUID() };
    },
    collect: async (url, { saveImage }) => {
      const images = await Promise.all(
        [0, 1, 2].map(async () => {
          const id = randomUUID();
          await saveImage(id, image);
          return {
            id,
            width: 800,
            height: 450,
            sourceUrl: "https://example.org/slide.png",
          };
        }),
      );
      return { url, title: "红黑风格", images, skipped: 0, truncated: false };
    },
  });
  app.use((err, req, res, next) =>
    res.status(400).json({ error: err.message }),
  );
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const base = "http://127.0.0.1:" + server.address().port;
  const post = async (route, body) => {
    const r = await fetch(base + route, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: r.status, data: await r.json() };
  };
  const preview = await post("/api/style-imports", {
    url: "https://example.org/work",
  });
  assert.equal(preview.status, 200);
  assert.equal(records.length, 0);
  assert.equal(jobs.length, 0);
  const draft = preview.data;
  assert.equal((await fetch(base + draft.images[0].preview)).status, 200);
  assert.equal(
    (await fetch(base + `/api/style-imports/${draft.id}/images/unknown`))
      .status,
    404,
  );
  assert.equal(
    (
      await post("/api/styles/from-url", {
        name: "测试",
        importId: draft.id,
        imageIds: ["../escape"],
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await post("/api/styles/from-url", {
        name: "测试",
        importId: draft.id,
        imageIds: [],
      })
    ).status,
    400,
  );
  const result = await post("/api/styles/from-url", {
    name: "红黑风格",
    importId: draft.id,
    imageIds: [draft.images[1].id, draft.images[2].id],
  });
  assert.equal(result.status, 201);
  assert.equal(result.data.style.refs.length, 2);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0][0], "style");
  assert.equal(result.data.style.source.url, "https://example.org/work");
  assert.deepEqual(
    await readFile(path.join(dir, "assets", result.data.style.refs[0])),
    image,
  );
  assert.equal(
    (
      await post("/api/styles/from-url", {
        name: "重复",
        importId: draft.id,
        imageIds: [draft.images[0].id],
      })
    ).status,
    400,
  );
  assert.equal(records.length, 1);
});

test("a public image link is downloaded once and can be saved as a reference", async () => {
  const image = await sharp({
    create: { width: 1024, height: 768, channels: 3, background: "#c93e32" },
  })
    .webp()
    .toBuffer();
  let calls = 0,
    writes = 0;
  const result = await collectImages("https://example.org/ref.webp", {
    fetchPage: async (url) => {
      calls++;
      return {
        url,
        status: 200,
        headers: { "content-type": "image/webp" },
        body: image,
      };
    },
    saveImage: async () => {
      writes++;
    },
  });
  assert.equal(calls, 1);
  assert.equal(writes, 1);
  assert.equal(result.images.length, 1);
});

test("cancelled imports stop image fetches and never publish a partial selection", async () => {
  const controller = new AbortController();
  let writes = 0;
  await assert.rejects(
    () =>
      collectImages("https://example.org/page", {
        signal: controller.signal,
        saveImage: async () => {
          writes++;
        },
        fetchPage: async (url, { signal }) => {
          if (url.endsWith("/page"))
            return {
              url,
              status: 200,
              body: Buffer.from('<main><img src="/slide.png"></main>'),
            };
          queueMicrotask(() =>
            controller.abort(new Error("Cancelled test import")),
          );
          return new Promise((resolve, reject) =>
            signal.addEventListener("abort", () => reject(signal.reason), {
              once: true,
            }),
          );
        },
      }),
    /Cancelled test import/,
  );
  assert.equal(writes, 0);
});
