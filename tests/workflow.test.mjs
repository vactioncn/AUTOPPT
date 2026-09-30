import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";
import sharp from "sharp";
import { defaultSystem, composeScene, samplePlan } from "../shared/slides.mjs";
import { inspectPresentation } from "./helpers/presentation.mjs";

test(
  "image workflow: full style grammar, text-only generation, append, retry, split/merge, history, image PPT with notes",
  { timeout: 120000 },
  async (t) => {
    const dir = mkdtempSync(path.join(tmpdir(), "autoppt-image-test-"));
    const sys = defaultSystem({
      rules: "清晰的细字体和蓝色线条",
      colors: ["#f7f7f3", "#20272b", "#284fa3"],
    });
    const calls = [];
    const imageRequests = [];
    let failImage = false;
    let transparentImage = false;
    let imageCalls = 0,
      failDesign = false,
      failSegment = false,
      holdDesign = false,
      held,
      splitCount = 1;
    const provider = http.createServer(async (req, res) => {
      let body = "";
      for await (const p of req) body += p;
      res.setHeader("Content-Type", "application/json");
      if (req.url.includes("/images/")) {
        imageCalls++;
        imageRequests.push(JSON.parse(body));
        if (failImage) {
          failImage = false;
          res.statusCode = 503;
          res.end('{"error":{"message":"Test image failure"}}');
        } else if (transparentImage) {
          transparentImage = false;
          const transparent = await sharp({
            create: {
              width: 1600,
              height: 900,
              channels: 4,
              background: "#00000000",
            },
          })
            .png()
            .toBuffer();
          res.end(
            JSON.stringify({
              data: [{ b64_json: transparent.toString("base64") }],
            }),
          );
        } else
          res.end(
            JSON.stringify({ data: [{ b64_json: image.toString("base64") }] }),
          );
        return;
      }
      if (req.url.endsWith("/models")) {
        res.end(JSON.stringify({ data: [{ id: "test-text" }] }));
        return;
      }
      const input = JSON.parse(body),
        system = input.messages[0].content,
        user = input.messages[1].content[0].text;
      const refs = input.messages[1].content.filter(
        (c) => c.type === "image_url",
      ).length;
      let output;
      if (system.includes("风格规范整理师")) {
        calls.push({ type: "language", refs, data: JSON.parse(user) });
        output = Object.fromEntries(
          [
            "identity",
            "typography",
            "colorSystem",
            "compositionPrinciples",
            "graphicLanguage",
            "detailLanguage",
            "adaptationRules",
            "avoid",
          ].map((k) => [
            k,
            (k === "identity" ? "UNRESOLVED LIBRARY VARIANTS: " : "") +
              "浅色底、蓝色细线、Regular 字体、克制标注和开放留白。随内容创作关系，不固定画面。",
          ]),
        );
      } else if (system.includes("演讲内容关系分析师")) {
        const data = JSON.parse(user);
        calls.push({ type: "meaning", refs, data });
        output = {
          pages: data.pages.map((p) => ({
            id: p.id,
            claim: "保留这一页的核心观点",
            relationship: p.notes.includes("环节")
              ? "causality"
              : p.notes.includes("层级")
                ? "positioning"
                : "statement",
            evidence: p.notes.slice(0, 18),
            entities: ["原文主体"],
            visualTask: "直接表达原文关系",
            mustNotImply: ["不虚构未给出的结果"],
          })),
        };
      } else if (system.includes("演讲内容编辑")) {
        if (failSegment) {
          failSegment = false;
          res.statusCode = 503;
          res.end('{"error":{"message":"Test segmentation failure"}}');
          return;
        }
        const n = Number(user.match(/本批 (\d+) 句/)[1]);
        output = {
          ends:
            splitCount > 1
              ? [
                  ...Array.from(
                    { length: Math.min(n, splitCount) - 1 },
                    (_, i) => i + 1,
                  ),
                  n,
                ]
              : [n],
        };
      } else if (system.includes("建议语义转折")) {
        const n = (user.match(/^\[\d+\]/gm) || []).length;
        output = { ends: [1, n].filter((x, i, a) => !i || x !== a[i - 1]) };
      } else if (
        system.includes("视觉设计总监") ||
        system.includes("演讲设计系统设计师")
      ) {
        calls.push({ type: "system", refs, user });
        output = {
          description: "用于验收的设计规范",
          rules:
            "浅色底、深灰细字体、蓝色强调与细线。各页共享字重、间距与图形语言。按内容选择版式，不在页面复制原始参考文字。",
          colors: ["#f7f7f3", "#20272b", "#284fa3"],
          referenceProfiles: Array.from(
            {
              length:
                refs || JSON.parse(user).style?.referenceProfiles?.length || 0,
            },
            () => ({
              name: "蓝色测绘细线",
              role: "概念地图",
              layout: "左侧大字，右侧开放海域",
              typography: "Regular 标题与微型标注",
              graphics: "浅蓝群岛等高线、虚线网格和十字定位点",
              avoid: "不要卡片或粗标题",
            }),
          ),
          imageRecipes: [],
        };
      } else if (system.includes("演讲页面设计师")) {
        const data = JSON.parse(user);
        calls.push({ type: "design", refs, data });
        if (holdDesign) {
          holdDesign = false;
          await new Promise((r) => {
            held = r;
          });
        }
        if (failDesign) {
          failDesign = false;
          res.statusCode = 503;
          res.end('{"error":{"message":"Test design failure"}}');
          return;
        }
        output = {
          editScope: data.previous && data.feedback ? "details" : "composition",
          detailText: [],
          title: "LOCAL TEST FIXTURE",
          displayText: ["LOCAL TEST FIXTURE", "DETAIL LABEL"],
          visualForm: data.contentBrief.allowedForms[0],
          compositionKey: data.contentBrief.allowedForms[0] + "原创构图",
          selectionReason: "基于本页关系决定表现，不从参考图匹配模板",
          alternatives: [
            { idea: "直接表达原文关系", reason: "能够看见本页的核心关系" },
            { idea: "用装饰图形", reason: "不如直接表达清楚" },
          ],
          typography: "Regular 细字重，清楚区分主次层级",
          styleExecution: {
            typeHierarchy:
              "大字采用 Regular 笔画，正文更小，微型标注保持明确的尺度反差。",
            spatialRhythm:
              "标题与说明共享左对齐轴，空场集中在图形周围，不平均摊开各元素。",
            graphicHierarchy:
              "主体关系用细线，辅助引导线更浅，以精确端点形成清楚的图形层级。",
            microDetail:
              "本地测试不编造辅助事实，短标签保留在上屏文案中并使用疏排小字。",
          },
          layout: "标题与图形按内容关系组织，留白充分",
          visual: "轻细线条与标注，直接表达关系，不套原插画",
          styleFeatures: [
            "细线轮廓落在右侧",
            "Regular 标题放左侧",
            "微型标注对应内容",
          ],
          adaptations: "按讲稿重新构思表达",
          rationale: "按讲稿设计概念图形",
        };
      } else {
        res.statusCode = 400;
        res.end('{"error":{"message":"Unexpected model call"}}');
        return;
      }
      res.end(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(output) } }],
        }),
      );
    });
    provider.listen(0, "127.0.0.1");
    await once(provider, "listening");
    const settings = {
      text: {
        baseUrl: `http://127.0.0.1:${provider.address().port}/v1`,
        apiKey: "test-key",
        model: "test-text",
      },
      image: {
        apiKey: "test-image-key",
        model: "test-image",
        baseUrl: `http://127.0.0.1:${provider.address().port}/v1`,
      },
    };
    writeFileSync(path.join(dir, "settings.json"), JSON.stringify(settings));
    const portServer = http.createServer();
    portServer.listen(0, "127.0.0.1");
    await once(portServer, "listening");
    const port = portServer.address().port;
    await new Promise((r) => portServer.close(r));
    const base = `http://127.0.0.1:${port}/api`;
    let child,
      logs = "";
    const until = async (f) => {
      for (let i = 0; i < 300; i++) {
        const r = await f();
        if (r) return r;
        await new Promise((r) => setTimeout(r, 30));
      }
      throw new Error("Timed out\n" + logs);
    };
    const boot = async () => {
      child = spawn(process.execPath, ["server/index.mjs"], {
        env: {
          ...process.env,
          PORT: String(port),
          NODE_ENV: "production",
          AUTOPPT_DATA_DIR: dir,
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      child.stdout.on("data", (x) => (logs += x));
      child.stderr.on("data", (x) => (logs += x));
      await until(async () => {
        try {
          return (await fetch(base + "/health")).ok;
        } catch {
          return false;
        }
      });
    };
    const shutdown = async () => {
      if (child && child.exitCode === null) {
        child.kill();
        await once(child, "exit");
      }
    };
    t.after(async () => {
      held?.();
      await shutdown();
      provider.closeAllConnections();
      await new Promise((r) => provider.close(r));
    });
    await boot();
    const req = async (
      url,
      body,
      method = body === undefined ? "GET" : "POST",
      status = 200,
    ) => {
      const r = await fetch(base + url, {
        method,
        headers:
          body === undefined ? {} : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const d = await r.json();
      assert.equal(r.status, status, `${method} ${url}: ${JSON.stringify(d)}`);
      return d;
    };
    const poll = (job) =>
      until(async () => {
        const js = await req("/jobs"),
          j = js.find((x) => x.id === (job.id || job.jobId));
        return j && !["queued", "running"].includes(j.status) ? j : false;
      });
    const image = await sharp(
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><rect width="1600" height="900" fill="#f7f7f3"/><text x="90" y="200" font-size="70">LOCAL TEST FIXTURE</text></svg>',
      ),
    )
      .png()
      .toBuffer();
    const form = new FormData();
    form.append("name", "图片风格验收");
    form.append("images", new Blob([image], { type: "image/png" }), "ref.png");
    const upload = await (
      await fetch(base + "/styles", { method: "POST", body: form })
    ).json();
    assert.equal((await poll(upload.job)).status, "completed");
    let style = (await req("/bootstrap")).styles.find(
      (s) => s.id === upload.style.id,
    );
    assert.equal(style.referenceProfiles.length, 1);
    assert.equal(calls.find((c) => c.type === "system").refs, 1);
    await req(`/styles/${style.id}/layouts`, undefined, "GET", 410);
    let project = await req(
        "/projects",
        { title: "图片演讲验收", styleId: style.id },
        "POST",
        201,
      ),
      id = project.id;
    const read = () => req("/projects/" + id);
    const text = "第一句话。第二句话。第三句话。第四句话。第五句话。";
    await req(
      `/projects/${id}/batches`,
      { text: "# 只有大标题\n\n## 没有正文" },
      "POST",
      400,
    );
    assert.equal((await read()).batches.length, 0);
    const submittedText = "# 撰写时的大标题\n\n## 本节内容\n\n" + text;
    let job = await req(
      `/projects/${id}/batches`,
      { text: submittedText },
      "POST",
      202,
    );
    assert.equal((await poll(job)).status, "completed");
    project = await read();
    assert.equal(project.slides[0].notes, text);
    assert.equal(project.batches[0].text, submittedText);
    const initialRevision = project.revision;
    await req(
      `/projects/${id}/slides/${project.slides[0].id}`,
      { notes: "### 阅读时跳过的标题\n\n" + text },
      "PATCH",
    );
    assert.equal((await read()).revision, initialRevision);
    assert.equal((await read()).slides[0].stale, false);
    await req(
      `/projects/${id}/slides/${project.slides[0].id}`,
      { notes: "## 只剩标题" },
      "PATCH",
      400,
    );
    assert(project.slides[0].image);
    assert.equal(project.slides[0].scene, null);
    assert.equal(project.slides[0].review, null);
    const frozenCalls = calls.filter((c) => c.type === "system").length;
    const sid = project.slides[0].id;
    const originalImage = project.slides[0].image;
    // A failed image keeps the previous picture and the paid-for plan; retry reuses that plan.
    failImage = true;
    job = await req(
      `/projects/${id}/render`,
      { slideIds: [sid], redesign: true },
      "POST",
      202,
    );
    assert.equal((await poll(job)).status, "failed");
    assert.equal((await read()).slides[0].image, originalImage);
    const designCount = calls.filter((c) => c.type === "design").length;
    assert((await read()).slides[0].pendingPlan);
    await poll(await req(`/jobs/${job.id}/retry`, {}));
    assert.equal(calls.filter((c) => c.type === "design").length, designCount);
    project = await read();
    assert.equal(project.slides[0].versions.at(-1).image, originalImage);
    await req(`/projects/${id}/slides/${sid}/restore`, {
      versionId: project.slides[0].versions.at(-1).id,
    });
    assert.equal((await read()).slides[0].image, originalImage);
    // An unexpected cutout must not replace a usable slide; retry retains the designed page.
    transparentImage = true;
    const transparentJob = await req(
      `/projects/${id}/render`,
      { slideIds: [sid], redesign: true },
      "POST",
      202,
    );
    const rejected = await poll(transparentJob);
    assert.equal(rejected.status, "failed");
    assert.match((await read()).slides[0].error, /透明底/);
    assert.equal((await read()).slides[0].image, originalImage);
    const beforeOpaqueRetry = calls.filter((c) => c.type === "design").length;
    assert.equal(
      (await poll(await req(`/jobs/${transparentJob.id}/retry`, {}))).status,
      "completed",
    );
    assert.equal(
      calls.filter((c) => c.type === "design").length,
      beforeOpaqueRetry,
    );
    const cuts = [5, 10, 15, 20]; // Explicit UTF-16 source offsets, preserving the original text.
    job = await req(
      `/projects/${id}/proposal`,
      { type: "split", slideId: sid, cuts },
      "POST",
      202,
    );
    assert.equal((await poll(job)).status, "completed");
    project = await read();
    assert.equal(project.proposal.plans.length, 5);
    assert(project.proposal.plans.every((p) => p.engine === "image"));
    job = await req(
      `/projects/${id}/proposal/commit`,
      { proposalId: project.proposal.id },
      "POST",
      202,
    );
    assert.equal((await poll(job)).status, "completed");
    project = await read();
    assert.equal(project.slides.map((s) => s.notes).join(""), text);
    assert.equal(project.slides.length, 5);
    assert(project.slides.every((s) => s.image));
    await req(`/projects/${id}/undo`, {});
    assert.equal((await read()).slides.length, 1);
    // Repeat with three source units, then merge adjacent units and restore the structure.
    job = await req(
      `/projects/${id}/proposal`,
      { type: "split", slideId: sid, cuts: [10, 20] },
      "POST",
      202,
    );
    await poll(job);
    project = await read();
    await poll(
      await req(
        `/projects/${id}/proposal/commit`,
        { proposalId: project.proposal.id },
        "POST",
        202,
      ),
    );
    project = await read();
    await req(
      `/projects/${id}/proposal`,
      { type: "merge", slideIds: [project.slides[0].id, project.slides[2].id] },
      "POST",
      400,
    );
    job = await req(
      `/projects/${id}/proposal`,
      { type: "merge", slideIds: project.slides.slice(0, 2).map((s) => s.id) },
      "POST",
      202,
    );
    await poll(job);
    project = await read();
    await poll(
      await req(
        `/projects/${id}/proposal/commit`,
        { proposalId: project.proposal.id },
        "POST",
        202,
      ),
    );
    project = await read();
    assert.equal(project.slides.map((s) => s.notes).join(""), text);
    assert.equal(project.slides.length, 2);
    await req(`/projects/${id}/undo`, {});
    project = await read();
    assert.equal(project.slides.length, 3);
    // A failed page can resume; style changes invalidate old plans and only retry missing work.
    failDesign = true;
    job = await req(
      `/projects/${id}/batches`,
      { text: "新的段落。保留完整原文。" },
      "POST",
      202,
    );
    assert.equal((await poll(job)).status, "failed");
    assert((await read()).slides.at(-1).notes);
    assert.match(
      (await req(`/projects/${id}/export`, undefined, "GET", 400)).error,
      /未完成/,
    );
    await req(`/projects/${id}`, { styleId: "night" }, "PATCH");
    assert.equal(
      (await poll(await req(`/jobs/${job.id}/retry`, {}))).status,
      "completed",
    );
    assert.equal((await read()).slides.at(-1).imageStyle.id, "night");
    // Pause while waiting for a model, keep completed pages, then resume under the new style.
    held = null;
    holdDesign = true;
    job = await req(
      `/projects/${id}/batches`,
      { text: "暂停中的原文。完成之后继续。" },
      "POST",
      202,
    );
    await until(() => held);
    await req(`/projects/${id}/export`, undefined, "GET", 409);
    await req(`/jobs/${job.id}/cancel`, {});
    held();
    await until(
      async () => !(await read()).slides.some((s) => s.status === "generating"),
    );
    await req(`/projects/${id}`, { styleId: style.id }, "PATCH");
    await until(async () => {
      try {
        return await req(`/jobs/${job.id}/retry`, {});
      } catch {
        return false;
      }
    });
    assert.equal((await poll(job)).status, "completed");
    // Trials use the same full saved visual grammar, with no vision or automatic inspection.
    const route = `/styles/${style.id}/trials`;
    let trial = await req(
      route,
      { notes: text, rules: style.rules, layoutId: "reference-1" },
      "POST",
      202,
    );
    assert.equal((await poll({ id: trial.jobId })).status, "completed");
    const trials = () => req(route);
    trial = (await trials()).trials.find((t) => t.id === trial.id);
    assert(trial.image);
    assert.equal(trial.scene, null);
    assert.equal(trial.plan.layoutId, "");
    assert.equal(trial.plan.selectionMode, "content-first");
    assert.equal(trial.review, null);
    assert.equal(trial.plan.visualDirection.graphics, trial.plan.visual);
    await req(`${route}/${trial.id}/apply`, {});
    style = (await req("/bootstrap")).styles.find((s) => s.id === style.id);
    assert.equal(style.appliedTrialId, trial.id);
    assert.equal(calls.filter((c) => c.type === "system").length, frozenCalls);
    let refined = await req(
      route,
      {
        notes: text,
        rules: style.rules,
        mode: "refine",
        parentId: trial.id,
        feedback: "微型标注更轻",
      },
      "POST",
      202,
    );
    assert.equal((await poll({ id: refined.jobId })).status, "completed");
    assert.equal(calls.filter((c) => c.type === "system").at(-1).refs, 0);
    assert.equal(
      (await req("/bootstrap")).styles.find((s) => s.id === style.id)
        .appliedTrialId,
      trial.id,
    );
    await req(`${route}/${trial.id}/inspect`, {}, "POST", 410);
    const exported = await fetch(base + `/projects/${id}/export`);
    assert.equal(exported.status, 200);
    assert.equal(
      exported.headers.get("content-type"),
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    );
    assert(
      exported.headers.get("content-disposition").includes("filename*=UTF-8''"),
    );
    await inspectPresentation(
      Buffer.from(await exported.arrayBuffer()),
      (await read()).slides,
    );
    await req(`/projects/${id}/export?revision=-1`, undefined, "GET", 409);
    // Reject stale candidates instead of overwriting newer saved styles.
    await req(
      `/styles/${style.id}`,
      { rules: style.rules + "保留全部细线。" },
      "PATCH",
    );
    await req(`${route}/${refined.id}/apply`, {}, "POST", 409);
    style = (await req("/bootstrap")).styles.find((s) => s.id === style.id);
    const contrastNotes = [
      "有了这张地图，我们在哪个层级？目前是个人赋能。",
      "一个环节变快，如果前后环节没有连接，整体不会更好。",
    ];
    for (const text of contrastNotes) {
      const j = await req(`/projects/${id}/batches`, { text }, "POST", 202);
      assert.equal((await poll(j)).status, "completed");
    }
    const newer = (await read()).slides.slice(-2);
    assert.equal(newer[0].plan.visualForm, "position");
    assert.equal(newer[1].plan.visualForm, "flow");
    assert(
      calls
        .filter((c) => c.type === "design")
        .at(-1)
        .data.nearbyPages.some((p) => p.visualForm === "position"),
    );
    assert(
      calls
        .filter((c) => c.type === "design")
        .every(
          (c) =>
            !("visualDirections" in c.data.style) &&
            !("requiredLayoutId" in c.data),
        ),
    );
    assert(
      calls
        .filter((c) => c.type === "meaning")
        .every((c) => !("style" in c.data) && c.refs === 0),
    );
    assert(
      calls.filter((c) => c.type === "language").every((c) => c.refs === 0),
    );
    // Both old raster and old web pages survive the transition until explicitly regenerated.
    await shutdown();
    const db = new DatabaseSync(path.join(dir, "autoppt.sqlite"));
    let legacy = JSON.parse(
      db
        .prepare("SELECT data FROM records WHERE kind='project' AND id=?")
        .get(id).data,
    );
    const old = legacy.slides[0];
    old.image = "legacy.png";
    old.notes = "## 旧版撰写标题\n\n" + old.notes;
    delete old.manuscriptVersion;
    old.scene = null;
    old.plan.engine = undefined;
    legacy.slides[1].scene = composeScene(samplePlan(sys.layouts[0]), sys);
    legacy.slides[1].image = null;
    legacy.slides[1].plan.engine = "web";
    writeFileSync(path.join(dir, "assets", "legacy.png"), image);
    db.prepare("UPDATE records SET data=? WHERE kind='project' AND id=?").run(
      JSON.stringify(legacy),
      id,
    );
    db.close();
    await boot();
    project = await read();
    assert.equal(project.slides[0].image, "legacy.png");
    assert(!project.slides[0].notes.includes("旧版撰写标题"));
    const rawVersion = project.slides[0].versions.at(-1);
    assert(rawVersion.notes.startsWith("## 旧版撰写标题"));
    await req(`/projects/${id}/slides/${project.slides[0].id}/restore`, {
      versionId: rawVersion.id,
    });
    project = await read();
    assert(!project.slides[0].notes.includes("旧版撰写标题"));
    const legacyExport = await fetch(base + `/projects/${id}/export`);
    assert.equal(legacyExport.status, 200);
    await inspectPresentation(
      Buffer.from(await legacyExport.arrayBuffer()),
      project.slides,
    );
    job = await req(
      `/projects/${id}/render`,
      {
        slideIds: [old.id],
        redesign: true,
        feedback: "保留原有构图，只补对齐和说明细节",
      },
      "POST",
      202,
    );
    assert.equal((await poll(job)).status, "completed");
    const legacyRequest = calls.filter((c) => c.type === "design").at(-1).data;
    assert.equal(legacyRequest.previous.layout, old.plan.layout);
    assert.deepEqual(legacyRequest.previous.displayText, old.plan.displayText);
    assert.equal(legacyRequest.feedback, "保留原有构图，只补对齐和说明细节");
    project = await read();
    assert(project.slides[0].image);
    assert.equal(project.slides[0].versions.at(-1).image, "legacy.png");
    const oldWebId = project.slides[1].id;
    assert(project.slides[1].scene);
    job = await req(
      `/projects/${id}/render`,
      { slideIds: [oldWebId], redesign: true },
      "POST",
      202,
    );
    assert.equal((await poll(job)).status, "completed");
    assert.equal(
      calls.filter((c) => c.type === "design").at(-1).data.previous,
      null,
    );
    project = await read();
    assert(project.slides[1].image);
    assert.equal(project.slides[1].scene, null);
    assert(project.slides[1].versions.at(-1).scene);
    // A changed manuscript invalidates approved copy, even when feedback asks for detail polish.
    const revisedNotes = project.slides[0].notes + "新的限定条件。";
    await req(
      `/projects/${id}/slides/${project.slides[0].id}`,
      { notes: revisedNotes },
      "PATCH",
    );
    const changedSourceJob = await req(
      `/projects/${id}/render`,
      {
        slideIds: [project.slides[0].id],
        redesign: true,
        feedback: "保留布局，只精修细节",
      },
      "POST",
      202,
    );
    assert.equal((await poll(changedSourceJob)).status, "completed");
    const changedSourceRequest = calls
      .filter((c) => c.type === "design")
      .at(-1).data;
    assert.equal(changedSourceRequest.previous, null);
    assert.equal(changedSourceRequest.notes, revisedNotes);
    assert.equal(
      calls.filter((c) => c.type === "design").some((c) => c.refs !== 0),
      false,
    );
    assert(
      calls
        .filter((c) => c.type === "design")
        .every((c) => !("referenceImages" in c.data)),
    );
    assert(imageCalls > 0);
    assert(
      imageRequests.every(
        (r) =>
          Object.keys(r).sort().join() ===
            "background,model,n,prompt,quality,size" &&
          r.background === "opaque",
      ),
    );
    assert(
      imageRequests.some((r) =>
        r.prompt.includes("轻细线条与标注，直接表达关系，不套原插画"),
      ),
    );
    assert(
      imageRequests.every((r) => r.prompt.includes("RESOLVED STYLE EXECUTION")),
    );
    assert(imageRequests.every((r) => r.prompt.includes("DETAIL LABEL")));
    assert(
      imageRequests.every((r) =>
        r.prompt.includes("正文更小，微型标注保持明确的尺度反差"),
      ),
    );
    assert(imageRequests.every((r) => !r.prompt.includes("savedObservations")));
    assert(
      imageRequests.every(
        (r) => !r.prompt.includes("UNRESOLVED LIBRARY VARIANTS"),
      ),
    );
    if (process.env.BROWSER_TEST) {
      const { chromium, expect } = await import("@playwright/test");
      const browser = await chromium.launch({
        headless: true,
        args: ["--disable-gpu"],
        executablePath: process.env.CHROMIUM_EXECUTABLE,
      });
      t.after(() => browser.close());
      const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
      });
      page.setDefaultTimeout(10000);
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(base.replace("/api", "") + "/#project/" + id);
      await page.waitForTimeout(500);
      // Route uses the app's actual project path; navigate from homepage if this version differs.
      if (
        (await page
          .getByRole("heading", { name: "图片演讲验收", exact: true })
          .count()) === 0
      ) {
        await page.goto(base.replace("/api", ""));
        await page
          .getByRole("button", { name: /图片演讲验收/ })
          .first()
          .click();
      }
      await expect(
        page.getByRole("heading", { name: "图片演讲验收", exact: true }),
      ).toBeVisible();
      await page.getByRole("button", { name: "导出 PPT", exact: true }).click();
      const initialDownload = page.waitForEvent("download");
      await page.getByRole("button", { name: "下载 PPT", exact: true }).click();
      const initialFile = await initialDownload;
      assert.equal(initialFile.suggestedFilename(), "图片演讲验收.pptx");
      assert.equal(await initialFile.failure(), null);
      await inspectPresentation(
        readFileSync(await initialFile.path()),
        (await read()).slides,
      );
      const first = page.locator(".slide-card").first();
      await first.locator(".slide-image").click();
      await expect(
        page.getByRole("link", { name: "保存图片", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "导出 PPT", exact: true }),
      ).toHaveCount(1);
      await expect(
        page.getByRole("button", { name: "编辑画面", exact: true }),
      ).toHaveCount(0);
      await page
        .getByLabel("本页逐字稿", { exact: true })
        .fill("## 撰写用标题\n\n浏览器修改后的原稿。");
      await page.getByRole("button", { name: "保存讲稿", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "保存讲稿", exact: true }),
      ).toBeDisabled();
      await expect(page.getByLabel("本页逐字稿", { exact: true })).toHaveValue(
        "浏览器修改后的原稿。",
      );
      await page
        .getByLabel("本页逐字稿", { exact: true })
        .fill("# 只加标题\n\n浏览器修改后的原稿。");
      await page.getByRole("button", { name: "保存讲稿", exact: true }).click();
      await expect(page.getByLabel("本页逐字稿", { exact: true })).toHaveValue(
        "浏览器修改后的原稿。",
      );
      await expect(
        page.getByRole("button", { name: "保存讲稿", exact: true }),
      ).toBeDisabled();
      await page.getByRole("button", { name: "关闭", exact: true }).click();
      mkdirSync(".impeccable/review", { recursive: true });
      await req(`/projects/${id}/export`, undefined, "GET", 409);
      await req(`/projects/${id}/export?allowStale=1`, undefined, "GET", 409);
      await page.getByRole("button", { name: "导出 PPT", exact: true }).click();
      await expect(
        page.getByText(/图片尚未更新。本次将使用当前图片/),
      ).toBeVisible();
      // Failed downloads stay in the dialog with a recoverable error.
      await page.route("**/api/projects/*/export?*", (route) =>
        route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "测试导出暂时失败" }),
        }),
      );
      await page
        .getByRole("button", {
          name: "使用当前图片与最新备注下载",
          exact: true,
        })
        .click();
      await expect(page.getByRole("alert")).toHaveText("测试导出暂时失败");
      await page.unroute("**/api/projects/*/export?*");
      await page.screenshot({
        path: ".impeccable/review/export-desktop.png",
        fullPage: true,
      });
      await page.setViewportSize({ width: 390, height: 844 });
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 1,
        ),
      );
      await page.screenshot({
        path: ".impeccable/review/export-mobile.png",
        fullPage: true,
      });
      const downloadEvent = page.waitForEvent("download");
      await page
        .getByRole("button", {
          name: "使用当前图片与最新备注下载",
          exact: true,
        })
        .click();
      const downloaded = await downloadEvent;
      assert.equal(downloaded.suggestedFilename(), "图片演讲验收.pptx");
      assert.equal(await downloaded.failure(), null);
      const current = await read();
      await inspectPresentation(
        readFileSync(await downloaded.path()),
        current.slides,
      );
      await downloaded.saveAs(path.join(dir, "browser-export.pptx"));
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.goto(base.replace("/api", "") + "/#styles");
      await page
        .getByRole("article")
        .filter({
          has: page.getByRole("heading", { name: "图片风格验收", exact: true }),
        })
        .getByRole("button", { name: "查看风格" })
        .click();
      await expect(
        page.getByRole("region", { name: "风格版式库" }),
      ).toHaveCount(0);
      await page
        .getByRole("button", { name: "打开风格试做", exact: true })
        .click();
      await page
        .getByRole("button", { name: "从正式风格重新开始", exact: true })
        .click();
      await page
        .getByLabel("试做讲稿", { exact: true })
        .fill("这是浏览器图片试做。");
      await expect(
        page.getByLabel("风格中的视觉方向", { exact: true }),
      ).toHaveCount(0);
      await page
        .getByRole("button", { name: "生成图片试做", exact: true })
        .click();
      await expect(
        page.getByRole("img", { name: "本次风格试做图片", exact: true }),
      ).toBeVisible({ timeout: 15000 });
      await expect(page.getByText("画面偏差检查", { exact: true })).toHaveCount(
        0,
      );
      await expect(page.getByRole("button", { name: /复刻参考/ })).toHaveCount(
        0,
      );
      await page.getByText("完整设计规范", { exact: true }).click();
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: ".impeccable/review/image-desktop.png",
        fullPage: true,
      });
      await page.setViewportSize({ width: 1039, height: 900 });
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: ".impeccable/review/image-user-1039.png",
        fullPage: true,
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: ".impeccable/review/image-mobile.png",
        fullPage: true,
      });
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 1,
        ),
      );
      assert.deepEqual(errors, []);
      await page.reload();
      await page
        .getByRole("article")
        .filter({
          has: page.getByRole("heading", { name: "图片风格验收", exact: true }),
        })
        .getByRole("button", { name: "查看风格" })
        .click();
      await page
        .getByRole("button", { name: "打开风格试做", exact: true })
        .click();
      await expect(page.getByLabel("试做讲稿", { exact: true })).toHaveValue(
        "这是浏览器图片试做。",
      );
      await browser.close();
    }
    await shutdown();
    await boot();
    assert((await read()).slides.every((s) => s.scene || s.image));
    assert(imageCalls > 0);
    assert(
      imageRequests.every(
        (r) =>
          Object.keys(r).sort().join() ===
            "background,model,n,prompt,quality,size" &&
          r.background === "opaque",
      ),
    );
    assert(
      imageRequests.some((r) =>
        r.prompt.includes("轻细线条与标注，直接表达关系，不套原插画"),
      ),
    );
    console.log(
      `Verified ${dir}; ${calls.filter((c) => c.type === "design").length} text-only designs; image requests=${imageCalls}`,
    );
  },
);
