import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import http from "node:http";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import sharp from "sharp";
import JSZip from "jszip";
import { copyFixture, reviewFixture } from "./fixtures/screen-copy.mjs";
import { preservedFixture, fontPackFixture } from "./fixtures/layered.mjs";

test(
  "legacy copy failure resumes normal planning; layered checkpoints, editing, export and history preserve existing pages",
  { timeout: 60000 },
  async (t) => {
    const dir = await mkdtemp(path.join(tmpdir(), "jianghao-native-"));
    await mkdir(path.join(dir, "assets"));
    const picture = await sharp({
      create: { width: 1600, height: 900, channels: 3, background: "#f5f1e8" },
    })
      .jpeg()
      .toBuffer();
    await writeFile(path.join(dir, "assets/old.jpg"), picture);
    await fontPackFixture(dir);
    const events = [],
      prompts = [];
    let failCheck = true,
      copyCalls = 0;
    const provider = http.createServer(async (req, res) => {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = JSON.parse(Buffer.concat(chunks));
      res.setHeader("Content-Type", "application/json");
      if (req.url.includes("/images/")) {
        events.push("image");
        prompts.push(body.prompt);
        return res.end(
          JSON.stringify({ data: [{ b64_json: picture.toString("base64") }] }),
        );
      }
      const system = body.messages[0].content;
      const raw = body.messages[1].content[0].text;
      let result;
      if (system.includes("检查局部去字结果")) {
        events.push("check");
        // A valid transport response but invalid inspection; retry must reuse pixels.
        result = {
          mainTextRemoved: true,
          nonTextPreserved: true,
          detail: "fixture",
        };
      } else {
        const data = JSON.parse(raw);
        if (system.includes("原画面文字还原师")) {
          events.push("analysis");
          result = failCheck
            ? { texts: [], objects: [] }
            : preservedFixture(data);
          failCheck = false;
        } else if (system.includes("演讲内容关系分析师"))
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
        else if (system.includes("演讲上屏文案复核编辑"))
          result = reviewFixture(data);
        else if (system.includes("演讲上屏文案编辑")) {
          copyCalls++;
          result = copyFixture(data, ["先讲故事", "让表达更从容"]);
        } else throw Error(system.slice(0, 100));
      }
      res.end(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(result) } }],
        }),
      );
    });
    provider.listen(0, "127.0.0.1");
    await once(provider, "listening");
    const connection = {
      baseUrl: `http://127.0.0.1:${provider.address().port}/v1`,
      model: "fixture",
      apiKey: "fixture-only",
    };
    await writeFile(
      path.join(dir, "settings.json"),
      JSON.stringify({ text: connection, image: connection }),
    );
    const db = new DatabaseSync(path.join(dir, "autoppt.sqlite"));
    db.exec(
      "CREATE TABLE records(kind TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(kind,id))",
    );
    const old = {
      id: "old",
      notes: "旧稿",
      image: "old.jpg",
      scene: null,
      plan: null,
      status: "ready",
      versions: [],
      batchIds: [],
      styleId: "style",
    };
    const project = {
      id: "project",
      title: "首次分层验收",
      revision: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      styleId: "style",
      batches: [],
      draft: "",
      slides: [
        old,
        {
          ...old,
          id: "new",
          notes: "先讲故事，让表达更从容。",
          image: null,
          status: "pending",
          error: "文案提炼未通过，未开始出图。旧版引用检查失败。",
        },
      ],
    };
    const put = (kind, value) =>
      db
        .prepare("INSERT INTO records VALUES(?,?,?)")
        .run(kind, value.id, JSON.stringify(value));
    put("project", project);
    put("style", {
      id: "style",
      name: "留白",
      status: "ready",
      rules: "暖白纸张与绿色点缀",
      refs: [],
      colors: ["#f5f1e8", "#20272b", "#557755"],
    });
    const proc = spawn(process.execPath, ["server/index.mjs"], {
      env: {
        ...process.env,
        PORT: "0",
        NODE_ENV: "production",
        AUTOPPT_WORKER_TOKEN: "",
        AUTOPPT_DESKTOP_TOKEN: "",
        AUTOPPT_DATA_DIR: dir,
        AUTOPPT_PPTX_FONT_DIR: dir,
      },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    proc.stdout.resume();
    proc.stderr.resume();
    t.after(() => {
      proc.kill();
      provider.closeAllConnections();
      provider.close();
      db.close();
    });
    const [info] = await once(proc, "message");
    const base = `http://127.0.0.1:${info.port}/api`;
    async function request(
      url,
      body,
      method = body ? "POST" : "GET",
      status = 200,
    ) {
      const r = await fetch(base + url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const value = await r.json();
      assert.equal(r.status, status, JSON.stringify(value));
      return value;
    }
    async function finished(id) {
      for (let i = 0; i < 300; i++) {
        const j = (await request("/jobs")).find((j) => j.id === id);
        if (j && !["queued", "running"].includes(j.status)) return j;
        await new Promise((r) => setTimeout(r, 30));
      }
      throw Error("job timeout");
    }
    const job = await request(
      "/projects/project/render",
      { slideIds: ["new"], redesign: false },
      "POST",
      202,
    );
    assert.equal((await finished(job.id)).status, "failed");
    const interim = await request("/projects/project");
    assert.equal(interim.slides[1].image, null);
    assert(interim.slides[1].pendingLayered.originalImage);
    await request(`/jobs/${job.id}/retry`, {}, "POST", 200);
    assert.equal((await finished(job.id)).status, "completed");
    let saved = await request("/projects/project");
    assert.deepEqual(saved.slides[0], old);
    assert.equal(
      copyCalls,
      1,
      "legacy copy failure re-enters planning; image retry reuses the valid copy",
    );
    assert.deepEqual(saved.slides[1].plan.displayText, [
      "先讲故事",
      "让表达更从容",
    ]);
    assert.deepEqual(events, ["image", "analysis", "analysis", "check"]);
    const packageResponse = await fetch(
      `${base}/projects/project/package?revision=${saved.revision}`,
    );
    assert.equal(packageResponse.status, 200);
    const form = new FormData();
    form.append(
      "project",
      new Blob([await packageResponse.arrayBuffer()]),
      "native.autoppt.zip",
    );
    const importedResponse = await fetch(`${base}/projects/import`, {
      method: "POST",
      body: form,
    });
    const imported = await importedResponse.json();
    assert.equal(importedResponse.status, 201, JSON.stringify(imported));
    const importedProject = await request(`/projects/${imported.project.id}`);
    assert.equal(
      importedProject.slides[1].layered.layers[0].text,
      saved.slides[1].layered.layers[0].text,
    );
    assert.notEqual(
      importedProject.slides[1].layered.background,
      saved.slides[1].layered.background,
    );
    assert.equal(
      (await request(`/projects/${importedProject.id}/motion`))[0].id,
      `native-${importedProject.id}`,
    );
    assert(prompts[0].includes("先讲故事"));
    assert(!prompts[0].includes("不要在图片中绘制任何文字"));
    assert.equal(
      saved.slides[1].layered.preservation.outsideMaskDifferences,
      0,
    );
    assert(saved.slides[1].layered.originalImage);
    assert.equal(saved.slides[1].layered.layers[0].text, "先讲故事");
    let deck = (await request("/projects/project/motion"))[0];
    assert.equal(deck.id, "native-project");
    assert.equal(deck.pages.length, 2);
    const changed = deck.pages[1].layers.map((l, i) =>
      i ? l : { ...l, text: "从故事开始" },
    );
    deck = await request(
      "/motion/native-project/pages/new",
      { revision: deck.revision, layers: changed, choreography: "story" },
      "PATCH",
    );
    saved = await request("/projects/project");
    assert.equal(saved.slides[1].layered.layers[0].text, "从故事开始");
    assert.equal(
      saved.slides[1].versions[0].layered.layers[0].text,
      "先讲故事",
    );
    assert.equal(saved.slides[1].notes, project.slides[1].notes);
    assert.deepEqual(saved.slides[0], old);
    await request(
      "/motion/native-project/pages/new",
      { revision: 1, layers: changed },
      "PATCH",
      409,
    );
    const html = await fetch(
      `${base}/projects/project/html?revision=${saved.revision}`,
    ).then((r) => r.text());
    assert(html.includes("从故事开始"));
    assert(html.includes('"layers":[{'));
    const ppt = await fetch(`${base}/projects/project/export`).then(
      async (r) => {
        assert(r.ok, await r.clone().text());
        return r.arrayBuffer();
      },
    );
    const zip = await JSZip.loadAsync(ppt);
    assert(
      (await zip.file("ppt/slides/slide2.xml").async("string")).includes(
        "从故事开始",
      ),
    );
    assert(
      !(await zip.file("ppt/slides/slide1.xml").async("string")).includes(
        "<p:sp>",
      ),
    );
    assert(zip.file(/^ppt\/fonts\//).length);
    deck = await request("/motion/native-project/pages/new/undo", {
      revision: deck.revision,
    });
    assert.equal(deck.pages[1].layers[0].text, "先讲故事");
    saved = await request("/projects/project");
    const history = saved.slides[1].versions.find(
      (v) => v.layered.layers[0].text === "从故事开始",
    );
    await request("/projects/project/slides/new/restore", {
      versionId: history.id,
    });
    saved = await request("/projects/project");
    assert.equal(saved.slides[1].layered.layers[0].text, "从故事开始");
    assert.deepEqual(saved.slides[0], old);
    assert.deepEqual(events, ["image", "analysis", "analysis", "check"]);
    const beforeRepair = structuredClone(saved.slides[1]);
    await request(
      "/projects/project/slides/new/repair-background",
      { revision: 1 },
      "POST",
      409,
    );
    const repair = await request(
      "/projects/project/slides/new/repair-background",
      { revision: saved.revision },
      "POST",
      202,
    );
    assert.equal((await finished(repair.id)).status, "completed");
    saved = await request("/projects/project");
    assert.deepEqual(saved.slides[0], old);
    assert.deepEqual(
      saved.slides[1].layered.layers,
      beforeRepair.layered.layers,
    );
    assert.equal(
      saved.slides[1].layered.originalImage,
      beforeRepair.layered.originalImage,
    );
    assert.equal(saved.slides[1].notes, beforeRepair.notes);
    assert.equal(saved.slides[1].versions.at(-1).image, beforeRepair.image);
    assert.equal(saved.slides[1].layered.qualityReview.status, "advisory");
    assert.deepEqual(
      events,
      ["image", "analysis", "analysis", "check"],
      "repair never regenerates the page or re-runs editorial models",
    );
  },
);
