import test from "node:test";
import { htmlPayload } from "./helpers/html-payload.mjs";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import http from "node:http";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import sharp from "sharp";
import { textRemoval } from "../server/motion/pixels.mjs";
import { validateLayers, validateAnalysis } from "../shared/motion/schema.mjs";
const textLayer = {
  id: "title",
  type: "text",
  text: "讲述节奏",
  x: 60,
  y: 60,
  w: 240,
  h: 58,
  fontSize: 60,
  font: "sans",
  fontWeight: 900,
  color: "#101010",
  fill: "#ffffff",
  step: 0,
  effect: "rise",
};
const analysis = () => ({
  texts: [
    { ...textLayer },
    {
      ...textLayer,
      id: "body",
      text: "让每个观点依次出现",
      x: 65,
      y: 200,
      w: 265,
      h: 28,
      fontSize: 28,
      fontWeight: 400,
      step: 1,
    },
  ],
  objects: [
    {
      label: "蓝色圆形",
      x: 490,
      y: 155,
      w: 130,
      h: 130,
      fill: "#ffffff",
      matte: "#ffffff",
      step: 1,
      effect: "zoom",
    },
  ],
  summary: "标题后呈现观点和图形",
  warnings: [],
});
const sourceSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450"><rect width="800" height="450" fill="white"/><text x="60" y="112" font-family="Arial" font-size="60" font-weight="900">讲述节奏</text><text x="65" y="225" font-size="28">让每个观点依次出现</text><circle cx="555" cy="220" r="60" fill="#315df5"/></svg>';

test("motion schema rejects untrusted layout/styles and preserves literal text", () => {
  const l = validateLayers(
    [{ ...textLayer, text: "</script><img src=x onerror=alert(1)>" }],
    800,
    450,
  )[0];
  assert.equal(l.text, "</script><img src=x onerror=alert(1)>");
  assert.throws(() =>
    validateLayers([{ ...textLayer, color: "red;display:none" }], 800, 450),
  );
  assert.throws(() => validateLayers([{ ...textLayer, x: 790 }], 800, 450));
  assert.throws(() =>
    validateLayers([{ ...textLayer, fontSize: NaN }], 800, 450),
  );
  assert.throws(() =>
    validateLayers(
      [
        {
          id: "x",
          type: "image",
          asset: "../../secret",
          x: 1,
          y: 1,
          w: 10,
          h: 10,
        },
      ],
      800,
      450,
    ),
  );
  const a = analysis();
  a.objects.push({ label: "覆盖文字", x: 0, y: 0, w: 500, h: 120 });
  const result = validateAnalysis(a, 800, 450);
  assert.equal(result.layers.filter((l) => l.type === "image").length, 1);
});

test("glyph removal preserves the highlighted backdrop and leaves unrelated pixels alone", () => {
  const width = 100,
    height = 100,
    raw = Buffer.alloc(width * height * 4, 255);
  for (let y = 20; y < 80; y++)
    for (let x = 10; x < 90; x++) {
      const i = (y * width + x) * 4;
      raw[i] = 210;
      raw[i + 1] = 250;
      raw[i + 2] = 30;
    }
  for (let y = 35; y < 65; y++)
    for (let x = 25; x < 40; x++) {
      const i = (y * width + x) * 4;
      raw[i] = 10;
      raw[i + 1] = 10;
      raw[i + 2] = 10;
    }
  const result = textRemoval(raw, width, height, {
    x: 25,
    y: 35,
    w: 15,
    h: 30,
    fontSize: 32,
    color: "#0a0a0a",
  });
  assert(result.simple);
  const local =
    ((50 - result.box.top) * result.box.width + 30 - result.box.left) * 4;
  assert.deepEqual(
    [...result.pixels.subarray(local, local + 3)],
    [210, 250, 30],
  );
  assert.equal(
    result.mask[
      (21 - result.box.top) * result.box.width + 12 - result.box.left
    ],
    undefined,
  );

  // A clean shaded backdrop provides ground truth for antialiased text removal.
  const clean = Buffer.alloc(120 * 80 * 4, 255);
  for (let y = 0; y < 80; y++)
    for (let x = 0; x < 120; x++) {
      const value = Math.round(
        246 + 4 * Math.sin(x / 18) + 2 * Math.cos(y / 20),
      );
      clean.fill(value, (y * 120 + x) * 4, (y * 120 + x) * 4 + 3);
    }
  const printed = Buffer.from(clean);
  for (let x = 25; x <= 85; x += 20)
    for (let y = 24; y < 56; y++)
      for (let dx = -1; dx < 7; dx++) {
        const i = (y * 120 + x + dx) * 4;
        const shade = dx === -1 || dx === 6 ? Math.round(clean[i] * 0.96) : 30;
        printed.fill(shade, i, i + 3);
      }
  const cleaned = textRemoval(printed, 120, 80, {
    x: 24,
    y: 24,
    w: 68,
    h: 32,
    fontSize: 36,
    color: "#1e1e1e",
  });
  assert(cleaned.simple);
  let worst = 0;
  for (let y = 24; y < 56; y++)
    for (let x = 24; x < 92; x++) {
      const i =
        ((y - cleaned.box.top) * cleaned.box.width + x - cleaned.box.left) * 4;
      worst = Math.max(
        worst,
        Math.abs(cleaned.pixels[i] - clean[(y * 120 + x) * 4]),
      );
    }
  assert(worst <= 3, `shaded backdrop residual: ${worst}`);
});

test(
  "motion workflow is isolated, resumable, validated and exports a self-contained player",
  { timeout: 120000 },
  async (t) => {
    const dir = mkdtempSync(path.join(tmpdir(), "autoppt-motion-test-"));
    mkdirSync(path.join(dir, "assets"));
    const source = await sharp(Buffer.from(sourceSvg)).png().toBuffer();
    writeFileSync(path.join(dir, "assets", "sample.png"), source);
    let calls = 0,
      edits = 0,
      fail = false,
      hold = false;
    const gates = [];
    const provider = http.createServer(async (req, res) => {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      res.setHeader("Content-Type", "application/json");
      if (req.url.endsWith("/chat/completions")) {
        calls++;
        if (hold) await new Promise((resolve) => gates.push(resolve));
        if (fail) {
          fail = false;
          res.statusCode = 503;
          res.end('{"error":{"message":"fixture failure"}}');
          return;
        }
        const result = analysis();
        if (calls % 2 === 0) result.objects[0].fill = null;
        res.end(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify(result) } }],
          }),
        );
      } else if (req.url.endsWith("/images/edits")) {
        edits++;
        res.end(
          JSON.stringify({
            data: [
              {
                b64_json: (
                  await sharp({
                    create: {
                      width: 800,
                      height: 450,
                      channels: 3,
                      background: "#ffffff",
                    },
                  })
                    .png()
                    .toBuffer()
                ).toString("base64"),
              },
            ],
          }),
        );
      } else {
        res.statusCode = 404;
        res.end("{}");
      }
    });
    provider.listen(0, "127.0.0.1");
    await once(provider, "listening");
    t.after(() => {
      gates.forEach((r) => r());
      provider.closeAllConnections();
      provider.close();
    });
    const config = {
      baseUrl: `http://127.0.0.1:${provider.address().port}`,
      apiKey: "fixture",
      model: "fixture",
    };
    writeFileSync(
      path.join(dir, "settings.json"),
      JSON.stringify({ text: config, image: config }),
    );
    const db = new DatabaseSync(path.join(dir, "autoppt.sqlite"));
    db.exec(
      "CREATE TABLE records (kind TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(kind,id))",
    );
    const project = {
      id: "motion-fixture",
      title: "演讲测试 </script>",
      revision: 4,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      draft: "",
      batches: [],
      styleId: "restrained-minimal",
      slides: [1, 2, 3].map((i) => ({
        id: "page-" + i,
        notes: "私密备注 " + i,
        plan: { title: "演讲第 " + i + " 页", displayText: ["讲述节奏"] },
        image: "sample.png",
        stale: false,
        status: "ready",
        versions: [],
        batchIds: [],
        styleId: "restrained-minimal",
        manuscriptVersion: 1,
      })),
    };
    db.prepare("INSERT INTO records VALUES (?,?,?)").run(
      "project",
      project.id,
      JSON.stringify(project),
    );
    let proc, base;
    async function start() {
      proc = spawn(process.execPath, ["server/index.mjs"], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          AUTOPPT_DATA_DIR: dir,
          PORT: "0",
          NODE_ENV: "production",
          AUTOPPT_WORKER_TOKEN: "",
          AUTOPPT_DESKTOP_TOKEN: "",
        },
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      });
      proc.stderr.on("data", () => {});
      proc.stdout.on("data", () => {});
      const message = await Promise.race([
        once(proc, "message").then((x) => x[0]),
        once(proc, "exit").then(() => {
          throw new Error("server exited");
        }),
      ]);
      base = `http://127.0.0.1:${message.port}`;
    }
    await start();
    t.after(() => {
      proc.kill();
      db.close();
    });
    const get = async (url) => {
      const res = await fetch(base + url);
      assert.equal(res.status, 200);
      return res.json();
    };
    const request = async (url, body, method = "POST", status = 200) => {
      const res = await fetch(base + url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const value = await res.json();
      assert.equal(res.status, status, JSON.stringify(value));
      return value;
    };
    async function until(fn) {
      const deadline = Date.now() + 20000;
      while (Date.now() < deadline) {
        const value = await fn();
        if (value) return value;
        await new Promise((r) => setTimeout(r, 40));
      }
      throw new Error("wait timeout");
    }
    const original = await get("/api/projects/" + project.id);
    const create = () =>
      request(
        "/api/projects/" + project.id + "/motion",
        { revision: original.revision, slideIds: ["page-2", "page-1"] },
        "POST",
        202,
      );
    await request(
      "/api/projects/" + project.id + "/motion",
      { revision: 0, slideIds: ["page-1"] },
      "POST",
      409,
    );
    await request(
      "/api/projects/" + project.id + "/motion",
      { revision: original.revision, slideIds: ["unknown"] },
      "POST",
      400,
    );
    fail = true;
    let d = await create();
    d = await until(async () => {
      const x = await get("/api/motion/" + d.id);
      return x.status === "partial" ? x : null;
    });
    assert.deepEqual(
      d.pages.map((p) => p.id),
      ["page-1", "page-2"],
    );
    assert.equal(d.pages[0].status, "failed");
    assert.equal(d.pages[1].status, "ready");
    assert.equal(d.pages[1].layers.filter((l) => l.type === "text").length, 2);
    const callsBefore = calls;
    await request(
      "/api/motion/" + d.id + "/retry",
      { pageIds: ["page-1"] },
      "POST",
      202,
    );
    d = await until(async () => {
      const x = await get("/api/motion/" + d.id);
      return x.status === "ready" ? x : null;
    });
    assert.equal(calls, callsBefore + 1);
    assert(edits > 0, "complex background edit path exercised");
    const bg = await sharp(
      readFileSync(path.join(dir, "assets", d.pages[0].background)),
    )
      .ensureAlpha()
      .raw()
      .toBuffer();
    const originalPixels = await sharp(source).ensureAlpha().raw().toBuffer();
    assert.match(d.pages[0].background, /\.jpg$/);
    const error =
      bg
        .subarray(0, 800 * 4)
        .reduce((sum, v, i) => sum + Math.abs(v - originalPixels[i]), 0) /
      (800 * 4);
    assert(
      error < 2,
      "outside repair regions only small JPEG encoding differences remain",
    );
    const circle = d.pages[0].layers.find((l) => l.type === "image");
    const crop = await sharp(
      readFileSync(path.join(dir, "assets", circle.asset)),
    )
      .ensureAlpha()
      .raw()
      .toBuffer();
    assert.equal(crop[3], 0, "matte removed");
    assert.equal(crop[(65 * 130 + 65) * 4 + 3], 255, "object preserved");
    const patched = d.pages[0].layers.map((l) =>
      l.type === "text"
        ? { ...l, text: "文字 </script><script>window.pwned=true</script>" }
        : l,
    );
    await request(
      `/api/motion/${d.id}/pages/page-1`,
      { revision: d.revision - 1, layers: patched },
      "PATCH",
      409,
    );
    d = await request(
      `/api/motion/${d.id}/pages/page-1`,
      { revision: d.revision, layers: patched, reviewed: true },
      "PATCH",
    );
    const rejectedLayers = d.pages[0].layers.map((l) =>
      l.type === "image" ? { ...l, asset: "different-project.png" } : l,
    );
    await request(
      `/api/motion/${d.id}/pages/page-1`,
      { revision: d.revision, layers: rejectedLayers },
      "PATCH",
      400,
    );
    const previewResponse = await fetch(
      base + `/api/motion/${d.id}/pages/page-1/preview`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          layers: d.pages[0].layers.map((l) =>
            l.type === "text"
              ? { ...l, font: "serif", text: "新的字体校准" }
              : l,
          ),
        }),
      },
    );
    assert.equal(previewResponse.status, 200);
    assert((await previewResponse.text()).includes("Noto Serif SC Variable"));
    assert.equal(
      (await get(`/api/motion/${d.id}`)).revision,
      d.revision,
      "preview does not persist or charge",
    );
    const htmlResponse = await fetch(
      base + `/api/motion/${d.id}/html?download=1`,
    );
    assert.equal(htmlResponse.status, 200);
    const html = await htmlResponse.text();
    assert(html.includes("data:font/woff2;base64,"));
    assert(html.includes("data:image/png;base64,"));
    assert(!html.includes("私密备注"));
    assert(!html.includes("<script>window.pwned"));
    assert(htmlResponse.headers.get("content-disposition").includes(".html"));
    const payload = htmlPayload(html);
    assert.equal(payload.pages[0].layers[0].text, patched[0].text);
    assert.equal(calls, callsBefore + 1, "editing/export do not call model");
    assert.deepEqual(
      await get("/api/projects/" + project.id),
      original,
      "original project unchanged",
    );
    assert.deepEqual(
      readFileSync(path.join(dir, "assets", "sample.png")),
      source,
    );
    if (process.env.MOTION_BROWSER_TEST === "1") {
      const { chromium } = await import("playwright-core");
      const browser = await chromium.launch({
        executablePath:
          process.env.CHROMIUM_EXECUTABLE ||
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        headless: true,
      });
      try {
        const context = await browser.newContext({
            viewport: { width: 1280, height: 800 },
          }),
          p = await context.newPage();
        const errors = [];
        p.on("pageerror", (e) => errors.push(e.message));
        const filename = path.join(dir, "presentation.html");
        writeFileSync(filename, html);
        await context.setOffline(true);
        await p.goto("file://" + filename);
        await p.waitForFunction(() => window.__motionReady);
        assert.equal(await p.evaluate(() => !!window.pwned), false);
        assert.equal(await p.locator(".text").count(), 2);
        const stageBounds = await p.locator("#stage").boundingBox();
        assert(
          stageBounds.x >= -1 && stageBounds.y >= -1,
          "fixed canvas stays inside viewport",
        );
        assert(stageBounds.x + stageBounds.width <= 1281);
        await p.keyboard.press("ArrowRight");
        assert.match(await p.title(), /^2 \/ 2/);
        await p.keyboard.press("ArrowUp");
        assert.match(await p.title(), /^1 \/ 2/);
        await p.locator("#steps").click({ force: true });
        assert.equal(await p.locator(".layer:not([hidden])").count(), 1);
        await p.keyboard.press("Space");
        assert.equal(await p.locator(".layer:not([hidden])").count(), 3);
        await p.keyboard.press("End");
        assert.match(await p.title(), /^2 \/ 2/);
        await p.keyboard.press("Home");
        await p.emulateMedia({ reducedMotion: "reduce" });
        await p.keyboard.press("r");
        assert.equal(
          await p.evaluate(() => document.getAnimations().length),
          0,
        );
        await p.setViewportSize({ width: 390, height: 844 });
        assert.equal(
          await p.evaluate(() => document.documentElement.scrollWidth),
          390,
        );
        assert.deepEqual(errors, []);
        await context.setOffline(false);
        await p.setViewportSize({ width: 1440, height: 1000 });
        await p.goto(base);
        await p.getByText("演讲测试 </script>", { exact: true }).last().click();
        await p
          .getByRole("navigation", { name: "项目区域" })
          .getByRole("button", { name: "演练中心", exact: true })
          .click();
        await p
          .getByRole("button", { name: "打开动态演示", exact: true })
          .click();
        await p.getByText("HTML 还原 · 点击文字可选中校准").waitFor();
        await p.getByLabel("文字", { exact: true }).fill("已校准标题");
        await p.getByRole("button", { name: "保存并标记已校对" }).click();
        await p
          .getByRole("button", { name: "下载 HTML", exact: true })
          .waitFor({ state: "visible" });
        await p.setViewportSize({ width: 1440, height: 1000 });
        await p.screenshot({
          path: path.join(dir, "studio.png"),
          fullPage: true,
        });
        console.log("Motion browser evidence:", path.join(dir, "studio.png"));
      } finally {
        await browser.close();
      }
    }
    hold = true;
    const d2 = await create();
    await until(() => gates.length);
    assert((await get("/api/activity")).activeJobs > 0);
    await request(`/api/projects/${project.id}`, {}, "DELETE", 400);
    await request(`/api/motion/${d2.id}/cancel`, {});
    await until(async () => {
      const x = await get(`/api/motion/${d2.id}`);
      return x.status === "cancelled";
    });
    hold = false;
    gates.splice(0).forEach((r) => r());
    await request(`/api/motion/${d2.id}/retry`, {}, "POST", 202);
    await until(async () => {
      const x = await get(`/api/motion/${d2.id}`);
      return x.status === "ready";
    });
    // Recovery never automatically replays charged requests.
    const interrupted = {
      ...d,
      id: "interrupted",
      status: "running",
      pages: d.pages.map((p, i) => (i ? { ...p, status: "running" } : p)),
    };
    db.prepare("INSERT INTO records VALUES (?,?,?)").run(
      "motion",
      interrupted.id,
      JSON.stringify(interrupted),
    );
    const countBeforeRestart = calls;
    proc.kill();
    await once(proc, "exit");
    await start();
    const restored = await get("/api/motion/interrupted");
    assert.equal(restored.status, "interrupted");
    assert.equal(restored.pages[0].status, "ready");
    assert.equal(restored.pages[1].status, "pending");
    assert.equal(calls, countBeforeRestart);
    console.log(
      `Motion requests: ${calls} vision, ${edits} repair; temporary data: ${dir}`,
    );
  },
);
