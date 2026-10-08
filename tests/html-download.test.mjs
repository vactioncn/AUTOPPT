import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, stat, link } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { constants } from "node:buffer";
import { once } from "node:events";
import express from "express";
import sharp from "sharp";
import { sendHtmlDownload } from "../server/html-download.mjs";
import { htmlPayload } from "./helpers/html-payload.mjs";

const directory = await mkdtemp(path.join(tmpdir(), "autoppt-html-test-"));
process.env.AUTOPPT_DATA_DIR = directory;
const { db, assetPath } = await import("../server/store.mjs");
const { writeStaticHtml } = await import("../server/html-export.mjs");
const png = await sharp({
  create: { width: 80, height: 45, channels: 3, background: "#cc6633" },
})
  .png()
  .toBuffer();
await writeFile(assetPath("sample.png"), png);
after(async () => {
  db.close();
  await rm(directory, { recursive: true, force: true });
});

const project = {
  title: "分块导出 </script>",
  batches: [],
  slides: [1, 2].map((i) => ({
    id: `page-${i}`,
    image: "sample.png",
    notes: `备注 ${i}`,
  })),
};

async function server(t, write) {
  const app = express();
  app.get("/export", (req, res) =>
    sendHtmlDownload(res, "演讲.html", true, write),
  );
  app.use((error, req, res, next) =>
    res.status(400).json({ error: error.message }),
  );
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  return `http://127.0.0.1:${server.address().port}/export`;
}
const absent = async (file) => {
  for (let i = 0; i < 100; i++) {
    if (!(await stat(file).catch(() => null))) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`temporary file was not removed: ${file}`);
};

test("HTML download preserves pages and original pixels, then removes the temporary file", async (t) => {
  let temporary;
  const url = await server(t, async (file, signal) => {
    temporary = file;
    await writeStaticHtml(project, {}, file, { signal });
  });
  const response = await fetch(url);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-disposition"), /^attachment;/);
  const html = await response.text(),
    data = htmlPayload(html);
  assert.equal(
    Number(response.headers.get("content-length")),
    Buffer.byteLength(html),
  );
  assert.deepEqual(
    data.pages.map((p) => p.id),
    ["page-1", "page-2"],
  );
  assert.deepEqual(
    Buffer.from(data.pages[0].background.split(",")[1], "base64"),
    png,
  );
  assert.equal(data.pages[0].background, data.pages[1].background);
  assert.equal(
    html.match(/data:image\/png;base64,/g).length,
    1,
    "shared images are embedded once",
  );
  assert(!html.includes("备注 1"));
  assert(!html.includes("分块导出 </script>"));
  await absent(path.dirname(temporary));
});

test("a missing late-page image returns an error before download headers and removes partial output", async (t) => {
  let temporary;
  const url = await server(t, async (file, signal) => {
    temporary = file;
    await writeStaticHtml(
      {
        ...project,
        slides: [
          ...project.slides,
          { id: "missing", image: "missing.png", notes: "" },
        ],
      },
      {},
      file,
      { signal },
    );
  });
  const response = await fetch(url);
  assert.equal(response.status, 400);
  assert.equal(response.headers.get("content-disposition"), null);
  assert.match((await response.json()).error, /missing\.png/);
  await absent(path.dirname(temporary));
});

test("disconnecting during preparation cancels work and removes partial output", async (t) => {
  let announce;
  const started = new Promise((resolve) => {
    announce = resolve;
  });
  let cancelled = false,
    temporary;
  const url = await server(t, async (file, signal) => {
    temporary = file;
    await writeFile(file, "partial");
    announce();
    await new Promise((resolve) =>
      signal.addEventListener(
        "abort",
        () => {
          cancelled = true;
          resolve();
        },
        { once: true },
      ),
    );
    signal.throwIfAborted();
  });
  const controller = new AbortController();
  const request = fetch(url, { signal: controller.signal }).catch(
    (error) => error,
  );
  await started;
  controller.abort();
  assert.equal((await request).name, "AbortError");
  await absent(path.dirname(temporary));
  assert(cancelled);
});

test(
  "offline HTML exports beyond the V8 single-string limit",
  { skip: process.env.LARGE_HTML_EXPORT_TEST !== "1", timeout: 120000 },
  async () => {
    // Valid PNG plus harmless trailing padding simulates many original large
    // images without model calls or retaining hundreds of MB of test fixtures.
    const padded = Buffer.alloc(4 * 1024 * 1024);
    png.copy(padded);
    await writeFile(assetPath("large.png"), padded);
    const count =
      Math.ceil(constants.MAX_STRING_LENGTH / ((padded.length * 4) / 3)) + 1;
    const slides = [];
    for (let i = 0; i < count; i++) {
      const image = `large-${i}.png`;
      await link(assetPath("large.png"), assetPath(image));
      slides.push({ id: `page-${i}`, image, notes: "" });
    }
    const filename = path.join(directory, "large.html");
    await writeStaticHtml({ ...project, slides }, {}, filename);
    assert((await stat(filename)).size > constants.MAX_STRING_LENGTH);
    // Inspect bounded ends only: reading the complete file as UTF-8 would itself
    // hit the limit this test protects against.
    const { open } = await import("node:fs/promises");
    const file = await open(filename, "r");
    try {
      const tail = Buffer.alloc(64);
      await file.read(
        tail,
        0,
        tail.length,
        (await file.stat()).size - tail.length,
      );
      assert(tail.toString().endsWith("</body></html>"));
    } finally {
      await file.close();
    }
  },
);
