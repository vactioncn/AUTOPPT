import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import http from "node:http";
import { once } from "node:events";
import { fork } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import sharp from "sharp";
import JSZip from "jszip";
import { copyFixture, reviewFixture } from "./fixtures/screen-copy.mjs";
import { preservedFixture, fontPackFixture } from "./fixtures/layered.mjs";

test(
  "hosted layered generation, repair quota, account isolation, editable export and restart",
  { timeout: 90000 },
  async (t) => {
    const dir = await mkdtemp(path.join(tmpdir(), "jianghao-hosted-layered-"));
    const fontDir = path.join(dir, "fonts");
    await mkdir(fontDir);
    await fontPackFixture(fontDir);
    // Deliberately nonuniform regions force the real multipart repair path.
    const raw = Buffer.alloc(1600 * 900 * 3);
    for (let i = 0; i < raw.length; i++)
      raw[i] = (i * 73 + (i >> 3) * 19) % 256;
    for (const top of [80, 170])
      for (let y = top; y < top + 32; y++)
        for (let x = 100; x < 270; x++)
          if (x % 12 < 6) {
            const i = (y * 1600 + x) * 3;
            raw[i] = 32;
            raw[i + 1] = 39;
            raw[i + 2] = 43;
          }
    const picture = await sharp(raw, {
      raw: { width: 1600, height: 900, channels: 3 },
    })
      .png()
      .toBuffer();
    let images = 0,
      repairs = 0,
      texts = 0;
    const provider = http.createServer(async (req, res) => {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      assert.equal(
        req.headers.authorization,
        "Bearer isolated-provider-secret",
      );
      res.setHeader("Content-Type", "application/json");
      if (req.url.includes("/images/")) {
        images++;
        if (req.url.endsWith("/edits")) {
          repairs++;
          assert.match(req.headers["content-type"], /multipart/);
          assert.match(Buffer.concat(chunks).toString(), /name="mask"/);
        }
        return res.end(
          JSON.stringify({ data: [{ b64_json: picture.toString("base64") }] }),
        );
      }
      texts++;
      const body = JSON.parse(Buffer.concat(chunks));
      const system = body.messages[0].content;
      const data = JSON.parse(body.messages[1].content[0].text);
      let result;
      if (system.includes("原画面文字还原师")) result = preservedFixture(data);
      else if (system.includes("演讲上屏文案复核编辑"))
        result = reviewFixture(data);
      else if (system.includes("演讲上屏文案编辑"))
        result = copyFixture(data, ["先讲故事", "让表达更从容"]);
      else if (system.includes("演讲内容关系分析师"))
        result = {
          pages: data.pages.map((p) => ({
            id: p.id,
            claim: "先讲故事",
            relationship: "statement",
            literalSpatial: false,
            evidence: p.notes,
            entities: ["故事"],
            visualTask: "表达原文",
            mustNotImply: [],
          })),
        };
      else if (system.includes("检查局部去字结果"))
        result = {
          mainTextRemoved: false,
          nonTextPreserved: true,
          detail: "仅作建议，不能打回整页",
        };
      else throw Error(system.slice(0, 80));
      res.end(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(result) } }],
        }),
      );
    });
    provider.listen(0, "127.0.0.1");
    await once(provider, "listening");
    const socket = http.createServer().listen(0, "127.0.0.1");
    await once(socket, "listening");
    const port = socket.address().port;
    await new Promise((r) => socket.close(r));
    const origin = `http://127.0.0.1:${port}`;
    let child;
    const start = async () => {
      child = fork("server/hosted/index.mjs", [], {
        env: {
          ...process.env,
          NODE_ENV: "production",
          HOST: "127.0.0.1",
          PORT: String(port),
          AUTOPPT_HOSTED_DATA_DIR: dir,
          AUTOPPT_PUBLIC_URL: origin,
          AUTOPPT_ADMIN_PASSWORD: "isolated-password",
          AUTOPPT_SIGNUP_IMAGE_CREDITS: "2",
          AUTOPPT_LAYERED_ENABLED: "1",
          AUTOPPT_PPTX_FONT_DIR: fontDir,
          AUTOPPT_TEXT_BASE_URL: `http://127.0.0.1:${provider.address().port}/v1`,
          AUTOPPT_IMAGE_BASE_URL: `http://127.0.0.1:${provider.address().port}/v1`,
          AUTOPPT_TEXT_API_KEY: "isolated-provider-secret",
          AUTOPPT_IMAGE_API_KEY: "isolated-provider-secret",
        },
        stdio: ["ignore", "ignore", "pipe", "ipc"],
      });
      let logs = "";
      child.stderr.on("data", (c) => (logs += c));
      await Promise.race([
        once(child, "message"),
        once(child, "exit").then(() => {
          throw Error(logs);
        }),
      ]);
    };
    const stop = async () => {
      if (child?.exitCode === null) {
        const ended = once(child, "exit");
        child.kill("SIGTERM");
        await ended;
      }
    };
    t.after(async () => {
      await stop();
      provider.closeAllConnections();
      provider.close();
    });
    await start();
    async function request(
      url,
      { cookie, body, method = body ? "POST" : "GET", status = 200 } = {},
    ) {
      const r = await fetch(origin + url, {
        method,
        headers: {
          Origin: origin,
          ...(cookie ? { Cookie: cookie } : {}),
          "Content-Type": "application/json",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      assert.equal(r.status, status, await r.clone().text());
      return r;
    }
    const login = await request("/api/account/login", {
      body: { name: "admin", password: "isolated-password" },
    });
    const cookie = login.headers.get("set-cookie").split(";")[0];
    const owner = (await login.json()).user;
    const invite = await (
      await request("/api/admin/invites", { cookie, body: {} })
    ).json();
    const registration = await request("/api/account/register", {
      body: {
        name: "other",
        password: "isolated-password",
        invite: invite.code,
      },
      status: 200,
    });
    const other = registration.headers.get("set-cookie").split(";")[0];
    const folder = path.join(dir, "users", owner.id);
    await mkdir(path.join(folder, "assets"), { recursive: true });
    const db = new DatabaseSync(path.join(folder, "autoppt.sqlite"));
    db.exec(
      "CREATE TABLE records(kind TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(kind,id))",
    );
    const project = {
      id: "project",
      title: "隔离测试",
      revision: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      styleId: "style",
      batches: [],
      draft: "",
      slides: [
        {
          id: "page",
          notes: "先讲故事，让表达更从容。",
          image: null,
          scene: null,
          plan: null,
          status: "pending",
          versions: [],
          batchIds: [],
          styleId: "style",
        },
      ],
    };
    for (const [kind, value] of [
      ["project", project],
      [
        "style",
        {
          id: "style",
          name: "留白",
          status: "ready",
          rules: "保留照片与暖白背景",
          refs: [],
          colors: ["#f5f1e8"],
        },
      ],
    ])
      db.prepare("INSERT INTO records VALUES(?,?,?)").run(
        kind,
        value.id,
        JSON.stringify(value),
      );
    db.close();
    const boot = await (await request("/api/bootstrap", { cookie })).json();
    assert.equal(boot.capabilities.motionPresentation.enabled, true);
    const job = await (
      await request("/api/projects/project/render", {
        cookie,
        body: { slideIds: ["page"], redesign: false },
        status: 202,
      })
    ).json();
    for (let i = 0; i < 600; i++) {
      const jobs = await (await request("/api/jobs", { cookie })).json();
      const saved = jobs.find((j) => j.id === job.id);
      if (!["queued", "running"].includes(saved.status)) {
        assert.equal(saved.status, "completed", JSON.stringify(saved));
        break;
      }
      assert(i < 599, "job timeout");
      await new Promise((r) => setTimeout(r, 50));
    }
    let deck = (
      await (await request("/api/projects/project/motion", { cookie })).json()
    )[0];
    assert.equal(deck.pages[0].layers[0].text, "先讲故事");
    assert.equal(deck.pages[0].preservation.outsideMaskDifferences, 0);
    assert.equal(images, 2);
    assert.equal(repairs, 1);
    assert.equal(
      (await (await request("/api/account", { cookie })).json()).user.available,
      0,
    );
    const changed = deck.pages[0].layers.map((l, i) =>
      i ? l : { ...l, text: "从故事开始" },
    );
    const beforeCalls = [images, texts];
    deck = await (
      await request("/api/motion/native-project/pages/page", {
        cookie,
        method: "PATCH",
        body: {
          revision: deck.revision,
          layers: changed,
          choreography: "story",
        },
      })
    ).json();
    for (const url of [
      "/api/projects/project",
      "/api/motion/native-project",
      "/API/MOTION/native-project/html",
      "/assets/" + deck.pages[0].background,
    ])
      await request(url, { cookie: other, status: 404 });
    await request("/api/motion/native-project/pages/page", {
      cookie: other,
      method: "PATCH",
      body: { revision: deck.revision, layers: changed },
      status: 404,
    });
    await request("/api/motion/native-project/html", { status: 401 });
    const html = await request("/api/motion/native-project/html?edit=1", {
      cookie,
    });
    assert.equal(html.headers.get("x-frame-options"), "SAMEORIGIN");
    assert.equal(html.headers.get("cache-control"), "private, no-store");
    const rendered = await html.text();
    assert.match(rendered, /从故事开始/);
    assert.match(rendered, /story/);
    const pptx = await request("/api/projects/project/export", { cookie });
    const zip = await JSZip.loadAsync(await pptx.arrayBuffer());
    assert.match(
      await zip.file("ppt/slides/slide1.xml").async("string"),
      /从故事开始/,
    );
    assert(zip.file(/^ppt\/fonts\/.*fntdata$/).length > 0);
    assert.deepEqual([images, texts], beforeCalls);
    await stop();
    await start();
    const persisted = await (
      await request("/api/projects/project", { cookie })
    ).json();
    assert.equal(persisted.slides[0].layered.layers[0].text, "从故事开始");
    assert.equal(persisted.slides[0].notes, project.slides[0].notes);
    assert.equal(
      persisted.slides[0].versions[0].layered.layers[0].text,
      "先讲故事",
    );
    assert.deepEqual([images, texts], beforeCalls);
  },
);
