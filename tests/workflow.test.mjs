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
import JSZip from "jszip";
import { DEFAULT_STYLE_ID } from "../shared/styles.mjs";
import { defaultSystem, composeScene, samplePlan } from "../shared/slides.mjs";
import { inspectPresentation } from "./helpers/presentation.mjs";
import {
  observationsFixture,
  creationFixture,
} from "./fixtures/style-creation.mjs";
import { compositionFixture } from "./fixtures/composition.mjs";
import { copyFixture, reviewFixture } from "./fixtures/screen-copy.mjs";

test(
  "image workflow: verbatim styles, independent copy, append, retry, split/merge, history, image PPT with notes",
  { timeout: 120000 },
  async (t) => {
    const dir = mkdtempSync(path.join(tmpdir(), "autoppt-image-test-"));
    const sys = defaultSystem({
      rules: "清晰的细字体和蓝色线条",
      colors: ["#f7f7f3", "#20272b", "#284fa3"],
    });
    const calls = [];
    const imageRequests = [];
    const editRequests = [];
    let holdImages = false;
    const imageGates = [];
    let concurrentImages = 0,
      peakImages = 0;
    let failImage = false;
    let transparentImage = false;
    let rejectCopyReview = false;
    let imageCalls = 0,
      failDesign = false,
      failSegment = false,
      holdDesign = false,
      held,
      splitCount = 1;
    const provider = http.createServer(async (req, res) => {
      const chunks = [];
      for await (const p of req) chunks.push(p);
      const bytes = Buffer.concat(chunks),
        body = bytes.toString();
      res.setHeader("Content-Type", "application/json");
      if (req.url.includes("/images/")) {
        imageCalls++;
        if (holdImages) {
          concurrentImages++;
          peakImages = Math.max(peakImages, concurrentImages);
          const failed = await new Promise((resolve) =>
            imageGates.push(resolve),
          );
          concurrentImages--;
          if (failed) {
            res.statusCode = 503;
            res.end('{"error":{"message":"Concurrent image failure"}}');
            return;
          }
        }
        if (req.url.endsWith("/images/edits")) {
          const form = await new Response(bytes, {
            headers: { "Content-Type": req.headers["content-type"] },
          }).formData();
          editRequests.push({
            prompt: form.get("prompt"),
            model: form.get("model"),
            background: form.get("background"),
            size: form.get("size"),
            files: await Promise.all(
              form
                .getAll("image[]")
                .map(async (file) => Buffer.from(await file.arrayBuffer())),
            ),
          });
        } else imageRequests.push(JSON.parse(body));
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
      if (
        system.includes("风格规范整理师") ||
        system.includes("演讲页面设计师")
      ) {
        assert.fail(
          "Generation must not rewrite styles or call a visual planner",
        );
      } else if (system.includes("演讲的受众与行业语境编辑")) {
        const data = JSON.parse(user);
        calls.push({ type: "audience", data });
        output = {
          brief: `受众与语境：${data.description}。场景仅为可选联想，内容适合时使用，不增加原稿没有的判断。`,
        };
      } else if (system.includes("风格配色提取器")) {
        const data = JSON.parse(user);
        calls.push({ type: "palette", data });
        output = data.rules.includes("#112233")
          ? {
              palette: {
                name: "原文蓝",
                instructions: "强调色 #112233。",
                colors: ["#112233"],
              },
              evidence: ["#112233"],
            }
          : { palette: null, evidence: [] };
      } else if (system.includes("本阶段只负责本页构图")) {
        const data = JSON.parse(user);
        calls.push({ type: "composition", refs, data });
        output = compositionFixture();
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
        output = system.includes("本阶段只做参考图视觉观察")
          ? observationsFixture(refs)
          : creationFixture();
      } else if (system.includes("演讲上屏文案编辑")) {
        const data = JSON.parse(user);
        calls.push({
          type: "copy",
          refs,
          data,
          imageInputs: input.messages[1].content
            .filter((c) => c.type === "image_url")
            .map((c) => Buffer.from(c.image_url.url.split(",")[1], "base64")),
        });
        assert(!("style" in data));
        if (holdDesign) {
          holdDesign = false;
          await new Promise((r) => {
            held = r;
          });
        }
        if (failDesign) {
          failDesign = false;
          res.statusCode = 503;
          res.end('{"error":{"message":"Test copy failure"}}');
          return;
        }
        output = copyFixture(data);
        if (output.editScope === "composition")
          output.entries.push({
            text: data.notes,
            role: "support",
            sourceQuote: data.notes,
          });
      } else if (system.includes("演讲上屏文案复核编辑")) {
        const data = JSON.parse(user);
        calls.push({ type: "copyReview", refs, data });
        output = reviewFixture(data);
        if (data.candidate.editScope === "composition") {
          output.entries = output.entries.slice(0, 2);
          output.changes = ["移除重复展开的整段解释，保留讲稿全文供口播"];
        }
        if (rejectCopyReview) {
          rejectCopyReview = false;
          output.checks.readable = false;
          output.splitSuggestion = "建议把两个独立观点手动拆页";
        }
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
      imageGates.forEach((release) => release());
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
    const jobsBeforeManual = await req("/jobs");
    const callsBeforeManual = calls.length;
    const manualRules = "  手写风格\n\n保留原有空格与换行。\n";
    for (const rules of ["", "  ", 12, "x".repeat(30001)])
      await req("/styles", { name: "无效提示词", rules }, "POST", 400);
    await req("/styles", { name: "空风格" }, "POST", 400);
    const manualCreated = await req(
      "/styles",
      { name: "手写风格验收", rules: manualRules },
      "POST",
      201,
    );
    const manualStyle = manualCreated.style;
    assert.equal(manualCreated.job, null);
    assert.equal(manualStyle.rules, manualRules);
    assert.deepEqual(manualStyle.refs, []);
    assert.equal(manualStyle.status, "ready");
    assert.equal(manualStyle.compositionMode, "direct");
    await req(`/styles/${manualStyle.id}/analyze`, {}, "POST", 400);
    assert.equal(calls.length, callsBeforeManual);
    assert.deepEqual(await req("/jobs"), jobsBeforeManual);
    const initialManualVersion = await req(
      `/styles/${manualStyle.id}/versions`,
    );
    assert.equal(initialManualVersion.versions[0].rules, manualRules);
    const editedManual = await req(
      `/styles/${manualStyle.id}`,
      {
        rules: manualRules + "新版",
        expectedVersion: manualStyle.versionToken,
      },
      "PATCH",
    );
    await req(
      `/styles/${manualStyle.id}/versions/${(await req(`/styles/${manualStyle.id}/versions`)).versions[1].id}/restore`,
      { expectedVersion: editedManual.versionToken },
    );
    assert.equal(
      (await req(`/styles/${manualStyle.id}/versions`)).versions[0].rules,
      manualRules,
    );
    const defaultStyle = (await req("/bootstrap")).styles[0];
    assert.equal(defaultStyle.id, DEFAULT_STYLE_ID);
    assert.equal(defaultStyle.compositionMode, "direct");
    const defaultProject = await req(
      "/projects",
      { title: "默认风格接口验收" },
      "POST",
      201,
    );
    assert.equal(defaultProject.styleId, defaultStyle.id);
    await req(
      "/projects",
      { title: "无效选择不能静默替换", styleId: "not-a-style" },
      "POST",
      400,
    );
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
    assert.equal(style.styleAnalysis.version, 1);
    assert.match(style.rules, /十二、设计自检与效果标准/);
    const creationCalls = calls.filter((c) => c.type === "system");
    assert.deepEqual(
      creationCalls.map((c) => c.refs),
      [1, 0],
    );
    assert.equal(
      JSON.parse(creationCalls[1].user).observations.referenceProfiles[0].ref,
      style.refs[0],
    );
    assert.equal(
      (await req(`/styles/${style.id}/versions`)).versions[0].source,
      "extraction",
    );
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
    const contentCallsBeforeStyleChange = calls.length;
    const stableCopy = project.slides[0].plan.screenCopy;
    for (const nextStyle of ["night", style.id]) {
      await req(`/projects/${id}`, { styleId: nextStyle }, "PATCH");
      const changeStyleJob = await req(
        `/projects/${id}/render`,
        { slideIds: [sid], redesign: true },
        "POST",
        202,
      );
      assert.equal((await poll(changeStyleJob)).status, "completed");
      const changed = (await read()).slides[0];
      assert.equal(changed.imageStyle.id, nextStyle);
      assert(changed.plan.copyReused);
      assert.deepEqual(changed.plan.screenCopy, stableCopy);
      assert.equal(
        calls.length,
        contentCallsBeforeStyleChange,
        "style changes must not repeat content analysis or copy editing",
      );
    }
    const options = {
      audience: {
        description: "儿童摄影影楼管理者",
        brief: "按内容选择场景，不添加结论。",
      },
      palette: {
        name: "独立蓝",
        instructions: "白底、深蓝文字、蓝色强调。",
        colors: ["#FFFFFF", "#112233"],
      },
    };
    const beforeOptions = await read();
    const originalRules = (await req("/bootstrap")).styles.find(
      (s) => s.id === style.id,
    ).rules;
    for (const designOptions of [options, { audience: null, palette: null }]) {
      await req(`/projects/${id}`, { designOptions }, "PATCH");
      assert.deepEqual(
        (await read()).slides,
        beforeOptions.slides,
        "saving choices must not rewrite existing slides",
      );
      const optionsJob = await req(
        `/projects/${id}/render`,
        { slideIds: [sid], redesign: true },
        "POST",
        202,
      );
      assert.equal((await poll(optionsJob)).status, "completed");
      const result = (await read()).slides[0].plan;
      assert.deepEqual(result.screenCopy, stableCopy);
      assert.deepEqual(result.designOptions, designOptions);
      assert.equal(
        calls.length,
        contentCallsBeforeStyleChange,
        "recoloring cannot re-extract copy",
      );
      assert.equal(
        imageRequests.at(-1).prompt.includes("独立配色方案"),
        !!designOptions.palette,
      );
      beforeOptions.slides = (await read()).slides;
    }
    assert.equal(
      (await req("/bootstrap")).styles.find((s) => s.id === style.id).rules,
      originalRules,
    );
    const draftAudience = await req("/design-options/audience", {
      description: "自行车比赛参赛者",
    });
    assert.match(draftAudience.brief, /自行车比赛参赛者/);
    const extracted = await req("/design-options/palette", {
      styleId: style.id,
      rules: "强调色 #112233",
    });
    assert.deepEqual(extracted.palette.colors, ["#112233"]);
    assert.equal(
      (
        await req("/design-options/palette", {
          styleId: style.id,
          rules: "柔和纸张质感",
        })
      ).palette,
      null,
    );
    await req("/design-options/audience", { description: " " }, "POST", 400);
    await req(
      `/projects/${id}`,
      {
        designOptions: {
          palette: {
            name: "bad",
            instructions: "test",
            colors: ["not-a-color"],
          },
        },
      },
      "PATCH",
      400,
    );
    assert.deepEqual((await read()).designOptions, {
      audience: null,
      palette: null,
    });
    project = await read();
    const originalImage = project.slides[0].image;
    assert.equal(project.slides[0].plan.screenCopy.review.status, "reviewed");
    assert(
      project.slides[0].plan.screenCopy.review.draftCharacters >
        project.slides[0].plan.screenCopy.metrics.characters,
    );
    assert(!imageRequests[0].prompt.includes(text));
    assert(
      project.slides[0].plan.screenCopy.displayText.every((text) =>
        imageRequests[0].prompt.includes(text),
      ),
    );
    assert.equal(
      project.slides[0].plan.screenCopy.metrics.sourceCharacters,
      [...text].length,
    );
    for (const kind of ["review"]) {
      const imageCount = imageCalls;
      rejectCopyReview = true;
      const rejectedCopy = await req(
        `/projects/${id}/render`,
        { slideIds: [sid], redesign: true, copyFeedback: "重新提炼文字" },
        "POST",
        202,
      );
      assert.equal((await poll(rejectedCopy)).status, "failed");
      const preserved = await read();
      assert.equal(imageCalls, imageCount);
      assert.equal(preserved.slides[0].notes, text);
      assert.equal(preserved.slides[0].image, originalImage);
      assert.equal(preserved.slides.length, 1);
      assert.match(
        preserved.slides[0].error,
        kind === "review" ? /文案复核.*未开始出图/ : /排版改动/,
      );
    }
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
    const designCount = calls.filter((c) => c.type === "copy").length;
    const copyReviewCount = calls.filter((c) => c.type === "copyReview").length;
    assert((await read()).slides[0].pendingPlan);
    // An old semantic prompt must be rebuilt without re-extracting approved copy.
    const pendingDb = new DatabaseSync(path.join(dir, "autoppt.sqlite"));
    const oldPendingProject = await read();
    const approvedPendingCopy = structuredClone(
      oldPendingProject.slides[0].pendingPlan.screenCopy,
    );
    oldPendingProject.slides[0].pendingPlan.promptMode = "verbatim-style-v3";
    oldPendingProject.slides[0].pendingPlan.contentPrompt =
      "OLD_SEMANTIC_BOUNDARY";
    pendingDb
      .prepare("UPDATE records SET data=? WHERE kind='project' AND id=?")
      .run(JSON.stringify(oldPendingProject), id);
    pendingDb.close();
    await poll(await req(`/jobs/${job.id}/retry`, {}));
    assert.equal(calls.filter((c) => c.type === "copy").length, designCount);
    assert.equal(
      calls.filter((c) => c.type === "copyReview").length,
      copyReviewCount,
    );
    project = await read();
    assert.equal(project.slides[0].plan.promptMode, "verbatim-style-v5");
    assert.deepEqual(project.slides[0].plan.screenCopy, approvedPendingCopy);
    assert(
      !project.slides[0].plan.imageRequest.prompt.includes(
        "OLD_SEMANTIC_BOUNDARY",
      ),
    );
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
    const beforeOpaqueRetry = calls.filter((c) => c.type === "copy").length;
    await req(`/projects/${id}`, { designOptions: options }, "PATCH");
    assert.equal(
      (await poll(await req(`/jobs/${transparentJob.id}/retry`, {}))).status,
      "completed",
    );
    assert.equal(
      calls.filter((c) => c.type === "copy").length,
      beforeOpaqueRetry,
    );
    assert.deepEqual((await read()).slides[0].plan.designOptions, options);
    assert.match(imageRequests.at(-1).prompt, /独立配色方案/);
    assert.deepEqual(
      (await read()).slides[0].plan.screenCopy,
      approvedPendingCopy,
    );
    // Manual split persists immediately, without any model call or proposal phase.
    const originalBeforeSplit = (await read()).slides[0];
    const splitUrl = `/projects/${id}/slides/${sid}/split`;
    const splitModelCalls = [calls.length, imageCalls];
    await req(splitUrl, { cuts: [5], expectedNotes: "outdated" }, "POST", 409);
    await req(
      splitUrl,
      { cuts: [0], expectedNotes: originalBeforeSplit.notes },
      "POST",
      400,
    );
    assert.deepEqual((await read()).slides[0], originalBeforeSplit);
    const instant = await req(splitUrl, {
      cuts: [5],
      expectedNotes: originalBeforeSplit.notes,
      generate: false,
    });
    assert.deepEqual([calls.length, imageCalls], splitModelCalls);
    assert.deepEqual(instant.jobs, []);
    assert.equal(instant.project.slides.length, 2);
    assert.equal(
      instant.project.slides.map((s) => s.notes).join(""),
      originalBeforeSplit.notes,
    );
    assert.equal(instant.project.proposal, null);
    for (const s of instant.project.slides) {
      assert.equal(s.image, null);
      assert.equal(s.plan, null);
      assert.deepEqual(s.attachments, originalBeforeSplit.attachments ?? []);
    }
    assert.deepEqual(
      instant.project.batches[0].slideIds,
      instant.project.slides.map((s) => s.id),
    );
    await req(
      splitUrl,
      { cuts: [5], expectedNotes: originalBeforeSplit.notes },
      "POST",
      400,
    );
    await req(`/projects/${id}/undo`, {});
    assert.deepEqual((await read()).slides[0], originalBeforeSplit);
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
    for (const plan of project.proposal.plans)
      assert.deepEqual(plan.designOptions, options);
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
    await req(`/projects/${id}`, { designOptions: null }, "PATCH");
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
    await req(`/projects/${id}`, undefined, "DELETE", 409);
    await req(`/projects/${id}`, { designOptions: options }, "PATCH", 409);
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
    assert.equal(trial.plan.promptMode, "verbatim-style-v5");
    assert.equal(trial.plan.styleRules, style.rules);
    assert.equal(trial.review, null);
    assert.equal(
      trial.plan.imageRequest.prompt,
      style.rules + "\n\n" + trial.plan.contentPrompt,
    );
    assert.equal(trial.plan.imageResponse.width, 1600);
    assert.equal(trial.plan.imageRequest.size, "2560x1440");
    assert.equal(trial.plan.imageResponse.height, 900);
    assert.equal(trial.plan.imageResponse.reportedModel, null);
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
        designOptions: options,
        parentId: trial.id,
        feedback: "微型标注更轻",
      },
      "POST",
      202,
    );
    assert.equal((await poll({ id: refined.jobId })).status, "completed");
    assert.equal(calls.filter((c) => c.type === "system").length, frozenCalls);
    const refinedTrial = (await trials()).trials.find(
      (t) => t.id === refined.id,
    );
    assert.equal(refinedTrial.styleSnapshot.rules, style.rules);
    assert(refinedTrial.plan.copyReused);
    assert.deepEqual(refinedTrial.plan.designOptions, options);
    assert.deepEqual(refinedTrial.plan.screenCopy, trial.plan.screenCopy);
    assert.match(refinedTrial.plan.imageRequest.prompt, /儿童摄影影楼管理者/);
    assert.match(refinedTrial.plan.imageRequest.prompt, /独立配色方案/);
    assert.equal(
      style.designOptions,
      undefined,
      "trial settings cannot leak into the shared style",
    );
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
    assert.equal(
      (await req(`/styles/${style.id}/versions`)).versions[0].source,
      "manual",
    );
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
    assert.equal(newer[0].plan.contentBrief.relationship, "positioning");
    assert.equal(newer[1].plan.contentBrief.relationship, "causality");
    assert(
      calls
        .filter((c) => ["meaning", "copy", "copyReview"].includes(c.type))
        .every((c) => !("style" in c.data)),
    );
    assert.equal(
      calls.filter((c) => ["design", "language"].includes(c.type)).length,
      0,
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
    assert(
      imageRequests.at(-1).prompt.includes("保留原有构图，只补对齐和说明细节"),
    );
    assert(imageRequests.at(-1).prompt.includes(style.rules));
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
    assert.equal((await read()).slides[1].plan.promptMode, "verbatim-style-v5");
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
      .filter((c) => c.type === "copy")
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
    assert(imageRequests.every((r) => !r.prompt.includes("不要自行补写")));
    assert(imageRequests.every((r) => !r.prompt.includes("【输出规格】")));
    assert(imageRequests.every((r) => r.prompt.includes("DETAIL LABEL")));
    assert(imageRequests.every((r) => !r.prompt.includes("savedObservations")));
    assert(
      imageRequests.every(
        (r) => !r.prompt.includes("UNRESOLVED LIBRARY VARIANTS"),
      ),
    );
    // Insert one page without segmentation; preserve neighbours even while they render.
    const insertProject = await req(
      "/projects",
      { title: "插页验收", styleId: style.id },
      "POST",
      201,
    );
    const ip = `/projects/${insertProject.id}`;
    const insertBody = (afterSlideId, notes, generate = false) => ({
      afterSlideId,
      notes,
      generate,
      requestId: crypto.randomUUID(),
    });
    const firstBody = insertBody(null, "第一张原稿。完整口播内容。");
    const insertFirst = await req(ip + "/slides", firstBody, "POST", 201);
    const tail = await req(
      ip + "/slides",
      insertBody(insertFirst.slideId, "原来的第二张。"),
      "POST",
      201,
    );
    const beforeInsertCalls = [calls.length, imageCalls];
    const middleBody = insertBody(
      insertFirst.slideId,
      "## 写作标题\n\n中间新插入的完整原稿。",
    );
    const middle = await req(ip + "/slides", middleBody, "POST", 201);
    assert.deepEqual(
      middle.project.slides.map((s) => s.id),
      [insertFirst.slideId, middle.slideId, tail.slideId],
    );
    assert.equal(middle.project.slides[1].notes, "中间新插入的完整原稿。");
    assert.equal(middle.project.slides[1].styleId, style.id);
    assert.deepEqual([calls.length, imageCalls], beforeInsertCalls);
    assert.equal(
      (await req(ip + "/slides", middleBody)).slideId,
      middle.slideId,
    );
    assert.equal((await req(ip)).slides.length, 3);
    await req(
      ip + "/slides",
      { ...middleBody, notes: "不同内容" },
      "POST",
      409,
    );
    await req(ip + "/slides", insertBody("gone-page", "位置失效"), "POST", 409);
    await req(ip + "/slides", insertBody(null, "## 只有标题"), "POST", 400);
    holdImages = true;
    const insertGate = imageGates.length;
    const neighbourJob = await req(
      ip + "/render",
      {
        slideIds: [insertFirst.slideId],
      },
      "POST",
      202,
    );
    await until(() => imageGates.length === insertGate + 1);
    const newPage = await req(
      ip + "/slides",
      insertBody(insertFirst.slideId, "继续插入，可以后台生成。", true),
      "POST",
      201,
    );
    await until(() => imageGates.length === insertGate + 2);
    assert.equal((await req(ip)).slides.length, 4);
    holdImages = false;
    imageGates[insertGate]();
    imageGates[insertGate + 1]();
    assert.equal((await poll(neighbourJob)).status, "completed");
    await until(
      async () =>
        (await req(ip)).slides.find((s) => s.id === newPage.slideId).image,
    );
    const insertedState = await req(ip);
    assert.deepEqual(
      insertedState.slides.map((s) => s.id),
      [insertFirst.slideId, newPage.slideId, middle.slideId, tail.slideId],
    );
    const manuscriptDownload = await fetch(
      base + ip + `/manuscript?download=1&revision=${insertedState.revision}`,
    );
    assert.equal(manuscriptDownload.status, 200);
    const manuscriptText = await manuscriptDownload.text();
    assert(
      manuscriptText.indexOf("继续插入") < manuscriptText.indexOf("中间新插入"),
    );
    assert(manuscriptText.includes("原来的第二张。"));
    await req(ip + "/manuscript?download=1&revision=-1", undefined, "GET", 409);

    // A failed append retried after a manual insertion must still append at the end.
    const orderProject = await req(
      "/projects",
      { title: "追加与插页顺序", styleId: style.id },
      "POST",
      201,
    );
    const op = `/projects/${orderProject.id}`;
    const orderFirst = await req(
      op + "/slides",
      insertBody(null, "已有开场。"),
      "POST",
      201,
    );
    const orderTail = await req(
      op + "/slides",
      insertBody(orderFirst.slideId, "已有结尾。"),
      "POST",
      201,
    );
    failSegment = true;
    const appendBeforeInsert = await req(
      op + "/batches",
      { text: "最后追加的一段。保持在所有已有页面后面。" },
      "POST",
      202,
    );
    assert.equal((await poll(appendBeforeInsert)).status, "failed");
    const orderMiddle = await req(
      op + "/slides",
      insertBody(orderFirst.slideId, "中间插入页。"),
      "POST",
      201,
    );
    failSegment = false;
    await req(`/jobs/${appendBeforeInsert.id}/retry`, {});
    assert.equal((await poll(appendBeforeInsert)).status, "completed");
    const ordered = await req(op);
    assert.deepEqual(
      ordered.slides.slice(0, 3).map((s) => s.id),
      [orderFirst.slideId, orderMiddle.slideId, orderTail.slideId],
    );
    assert.equal(
      ordered.slides.at(-1).notes,
      "最后追加的一段。保持在所有已有页面后面。",
    );

    imageGates.length = 0;
    // Six independent page edits: four execute, two queue; a seventh remains editable.
    const concurrentProject = await req(
      "/projects",
      {
        title: "并发逐页修改验收",
        styleId: style.id,
      },
      "POST",
      201,
    );
    const sourceSlide = (await read()).slides.find((s) => s.image && s.plan);
    const concurrentSlides = Array.from({ length: 7 }, (_, i) => ({
      ...structuredClone(sourceSlide),
      id: `concurrent-page-${i}`,
      versions: [],
      batchIds: ["concurrent-batch"],
      status: "ready",
      error: null,
    }));
    const seedDb = new DatabaseSync(path.join(dir, "autoppt.sqlite"));
    seedDb
      .prepare("UPDATE records SET data=? WHERE kind='project' AND id=?")
      .run(
        JSON.stringify({
          ...concurrentProject,
          slides: concurrentSlides,
          batches: [
            {
              id: "concurrent-batch",
              text: concurrentSlides.map((s) => s.notes).join("\n"),
              slideIds: concurrentSlides.map((s) => s.id),
            },
          ],
        }),
        concurrentProject.id,
      );
    seedDb.close();
    const cp = `/projects/${concurrentProject.id}`;
    holdImages = true;
    const concurrentJobs = [];
    for (const slide of concurrentSlides.slice(0, 6)) {
      concurrentJobs.push(
        await req(
          cp + "/render",
          { slideIds: [slide.id], redesign: true },
          "POST",
          202,
        ),
      );
      if (concurrentJobs.length <= 4)
        await until(() => imageGates.length === concurrentJobs.length);
    }
    await until(() => imageGates.length === 4);
    let cjobs = await req(`/jobs?projectId=${concurrentProject.id}`);
    assert.equal(cjobs.filter((j) => j.status === "running").length, 4);
    assert.equal(cjobs.filter((j) => j.status === "queued").length, 2);
    assert(cjobs.every((j) => j.slideIds.length === 1));
    await req(`/jobs/${concurrentJobs[5].id}/cancel`, {});
    assert.equal((await poll(concurrentJobs[5])).status, "cancelled");
    assert.equal(
      imageGates.length,
      4,
      "cancel queued job without calling image model",
    );
    await req(`/jobs/${concurrentJobs[5].id}/retry`, {});
    await req(
      cp + "/render",
      { slideIds: [concurrentSlides[0].id] },
      "POST",
      409,
    );
    await req(
      cp + `/slides/${concurrentSlides[0].id}`,
      { notes: "不得覆盖正在制作的页面" },
      "PATCH",
      409,
    );
    await req(
      cp + `/slides/${concurrentSlides[6].id}`,
      { notes: "其他页面可以继续修改。" },
      "PATCH",
    );
    await req(cp, { styleId: "night" }, "PATCH", 409);
    imageGates[0]();
    assert.equal((await poll(concurrentJobs[0])).status, "completed");
    await until(() => imageGates.length === 5);
    assert.equal(
      (await req(cp)).slides[1].status,
      "generating",
      "completion must not reset another job's status",
    );
    await req(`/jobs/${concurrentJobs[1].id}/cancel`, {});
    imageGates[1]();
    await until(() => imageGates.length === 6);
    imageGates[3](true);
    assert.equal((await poll(concurrentJobs[3])).status, "failed");
    assert.equal(
      (await req(cp)).slides[3].image,
      concurrentSlides[3].image,
      "failure preserves old image",
    );
    for (const release of imageGates) release();
    await Promise.all(concurrentJobs.map(poll));
    holdImages = false;
    assert.equal(peakImages, 4);
    const finishedConcurrent = await req(cp);
    for (const i of [0, 2, 4, 5])
      assert.equal(finishedConcurrent.slides[i].versions.length, 1);
    assert.equal(finishedConcurrent.slides[1].image, concurrentSlides[1].image);
    assert.equal(finishedConcurrent.slides[6].notes, "其他页面可以继续修改。");
    assert.equal(
      (await poll(await req(`/jobs/${concurrentJobs[3].id}/retry`, {}))).status,
      "completed",
    );
    // A split preview must not lock unrelated pages or newly submitted manuscript batches.
    held = null;
    holdDesign = true;
    const proposalJob = await req(
      cp + "/proposal",
      {
        type: "split",
        slideId: concurrentSlides[0].id,
        cuts: [3],
      },
      "POST",
      202,
    );
    await until(() => held);
    const proposalState = (
      await req(`/jobs?projectId=${concurrentProject.id}`)
    ).find((j) => j.id === proposalJob.id);
    assert.deepEqual(proposalState.slideIds, [concurrentSlides[0].id]);
    await req(
      cp + `/slides/${concurrentSlides[0].id}`,
      { notes: "blocked source edit" },
      "PATCH",
      409,
    );
    await req(
      cp + `/slides/${concurrentSlides[6].id}`,
      { notes: "拆分期间继续改其他页。" },
      "PATCH",
    );
    holdImages = true;
    const gateStart = imageGates.length;
    const unrelatedRender = await req(
      cp + "/render",
      { slideIds: [concurrentSlides[1].id] },
      "POST",
      202,
    );
    const appendA = await req(
      cp + "/batches",
      { text: "并行追加第一段。完整保留。" },
      "POST",
      202,
    );
    const appendB = await req(
      cp + "/batches",
      { text: "并行追加第二段。完整保留。" },
      "POST",
      202,
    );
    await until(() => imageGates.length === gateStart + 2);
    const mixedJobs = await req(`/jobs?projectId=${concurrentProject.id}`);
    assert.equal(mixedJobs.find((j) => j.id === appendB.id).status, "queued");
    assert.equal(
      mixedJobs.filter((j) => j.type === "append" && j.status === "running")
        .length,
      1,
    );
    held();
    assert.equal(
      (await poll(proposalJob)).status,
      "completed",
      "other pages and batches do not invalidate a split preview",
    );
    assert.equal(
      (await req(cp)).slides[1].status,
      "generating",
      "finishing proposal must not reset unrelated image job",
    );
    const savedProposalId = (await req(cp)).proposal.id;
    await req(
      cp + `/slides/${concurrentSlides[6].id}`,
      { notes: "方案完成后继续改其他页。" },
      "PATCH",
    );
    assert.equal((await req(cp)).proposal.id, savedProposalId);
    holdImages = false;
    imageGates.slice(gateStart).forEach((release) => release());
    for (const j of [unrelatedRender, appendA, appendB])
      assert.equal((await poll(j)).status, "completed");
    const mixedFinished = await req(cp);
    assert.equal(mixedFinished.proposal.id, savedProposalId);
    assert.equal(mixedFinished.slides[6].notes, "方案完成后继续改其他页。");
    assert.deepEqual(
      mixedFinished.batches.slice(-2).map((b) => b.text),
      ["并行追加第一段。完整保留。", "并行追加第二段。完整保留。"],
    );
    // Confirm a legacy proposal while another page renders; undo must keep its result.
    holdImages = true;
    const legacyGate = imageGates.length;
    const legacyOther = await req(
      cp + "/render",
      {
        slideIds: [concurrentSlides[2].id],
      },
      "POST",
      202,
    );
    await until(() => imageGates.length === legacyGate + 1);
    const legacySource = (await req(cp)).slides[0];
    const legacyCommit = await req(
      cp + "/proposal/commit",
      {
        proposalId: savedProposalId,
      },
      "POST",
      202,
    );
    await until(() => imageGates.length === legacyGate + 2);
    assert.equal(
      (await req(cp)).slides.length,
      mixedFinished.slides.length + 1,
    );
    imageGates[legacyGate]();
    await poll(legacyOther);
    const legacyOtherResult = (await req(cp)).slides.find(
      (s) => s.id === concurrentSlides[2].id,
    );
    holdImages = false;
    imageGates[legacyGate + 1]();
    assert.equal((await poll(legacyCommit)).status, "completed");
    await req(cp + "/undo", {});
    assert.deepEqual((await req(cp)).slides[0], legacySource);
    assert.deepEqual(
      (await req(cp)).slides.find((s) => s.id === legacyOtherResult.id),
      legacyOtherResult,
    );
    // A finished page in a still-running batch is safe to edit immediately.
    holdImages = true;
    const releaseStart = imageGates.length;
    const twoPageJob = await req(
      cp + "/render",
      { slideIds: [concurrentSlides[3].id, concurrentSlides[4].id] },
      "POST",
      202,
    );
    await until(() => imageGates.length === releaseStart + 1);
    imageGates[releaseStart]();
    await until(() => imageGates.length === releaseStart + 2);
    assert.deepEqual(
      (await req(`/jobs?projectId=${concurrentProject.id}`)).find(
        (j) => j.id === twoPageJob.id,
      ).targetSlideIds,
      [concurrentSlides[3].id, concurrentSlides[4].id],
    );
    assert.deepEqual(
      (await req(`/jobs?projectId=${concurrentProject.id}`)).find(
        (j) => j.id === twoPageJob.id,
      ).slideIds,
      [concurrentSlides[4].id],
    );
    await req(
      cp + `/slides/${concurrentSlides[3].id}`,
      { notes: "这页已完成，不等整批完成也能修改。" },
      "PATCH",
    );
    await req(
      cp + `/slides/${concurrentSlides[4].id}`,
      { notes: "仍在制作的页面" },
      "PATCH",
      409,
    );
    holdImages = false;
    imageGates[releaseStart + 1]();
    assert.equal((await poll(twoPageJob)).status, "completed");
    const completedProduction = (
      await req(`/jobs?projectId=${concurrentProject.id}`)
    ).find((j) => j.id === twoPageJob.id);
    assert.deepEqual(completedProduction.slideIds, []);
    assert.deepEqual(completedProduction.targetSlideIds, [
      concurrentSlides[3].id,
      concurrentSlides[4].id,
    ]);
    assert.equal(
      (await req(cp)).slides[3].notes,
      "这页已完成，不等整批完成也能修改。",
    );
    // Splitting an idle page while another renders creates two independent jobs.
    holdImages = true;
    const instantGateStart = imageGates.length;
    const parallelRender = await req(
      cp + "/render",
      {
        slideIds: [concurrentSlides[2].id],
      },
      "POST",
      202,
    );
    await until(() => imageGates.length === instantGateStart + 1);
    const beforeInstant = await req(cp);
    const instantSource = beforeInstant.slides[0];
    const concurrentSplit = await req(
      cp + `/slides/${instantSource.id}/split`,
      {
        expectedNotes: instantSource.notes,
        cuts: [3],
      },
    );
    assert.equal(concurrentSplit.jobs.length, 2);
    assert.equal(
      concurrentSplit.project.slides.length,
      beforeInstant.slides.length + 1,
    );
    assert.equal(
      concurrentSplit.project.slides.map((s) => s.notes).join(""),
      beforeInstant.slides.map((s) => s.notes).join(""),
    );
    assert(
      concurrentSplit.jobs.every(
        (j) => j.type === "render" && j.slideIds.length === 1,
      ),
    );
    await until(() => imageGates.length === instantGateStart + 3);
    await req(cp + "/undo", {}, "POST", 409);
    // An unrelated completion must survive undo of the split.
    imageGates[instantGateStart]();
    await poll(parallelRender);
    const completedOther = (await req(cp)).slides.find(
      (s) => s.id === concurrentSlides[2].id,
    );
    imageGates[instantGateStart + 1]();
    imageGates[instantGateStart + 2]();
    for (const j of concurrentSplit.jobs)
      assert.equal((await poll(j)).status, "completed");
    await req(cp + "/undo", {});
    const restoredInstant = await req(cp);
    assert.deepEqual(restoredInstant.slides[0], instantSource);
    assert.deepEqual(
      restoredInstant.slides.find((s) => s.id === completedOther.id),
      completedOther,
    );
    // Split and undo without rendering also work while an unrelated page is busy.
    const backgroundOther = await req(
      cp + "/render",
      { slideIds: [concurrentSlides[2].id] },
      "POST",
      202,
    );
    await until(() => imageGates.length === instantGateStart + 4);
    await req(cp + `/slides/${instantSource.id}/split`, {
      expectedNotes: instantSource.notes,
      cuts: [3],
      generate: false,
    });
    await req(cp + "/undo", {});
    await req(
      cp + `/slides/${concurrentSlides[6].id}`,
      { notes: "拆分后仍可编辑其他空闲页。" },
      "PATCH",
    );
    holdImages = false;
    imageGates[instantGateStart + 3]();
    assert.equal((await poll(backgroundOther)).status, "completed");
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
      // Insert from the visible gap while another page is generating.
      holdImages = true;
      const uiInsertGate = imageGates.length;
      const uiNeighbourJob = await req(
        ip + "/render",
        {
          slideIds: [insertFirst.slideId],
          redesign: true,
        },
        "POST",
        202,
      );
      await until(() => imageGates.length === uiInsertGate + 1);
      await page.goto(
        base.replace("/api", "") + "/#project/" + insertProject.id + "/studio",
      );
      await page.getByLabel("查看段落").selectOption("all");
      await page
        .getByRole("button", { name: "在第 1、2 页之间插入", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "插入并生成", exact: true }),
      ).toBeDisabled();
      await page
        .getByLabel("新页面逐字稿", { exact: true })
        .fill("浏览器插入的这一页。完整讲稿保留。");
      mkdirSync(".local/verification/insert-export", { recursive: true });
      await page.screenshot({
        path: ".local/verification/insert-export/insert-desktop.png",
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({
        path: ".local/verification/insert-export/insert-mobile.png",
      });
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      );
      await page
        .getByRole("button", { name: "插入并生成", exact: true })
        .click();
      await expect(
        page.getByLabel("新页面逐字稿", { exact: true }),
      ).toHaveCount(0);
      await until(() => imageGates.length === uiInsertGate + 2);
      await expect(page.locator(".slide-card")).toHaveCount(5);
      const uiInsertedState = await req(ip);
      assert.equal(
        uiInsertedState.slides[1].notes,
        "浏览器插入的这一页。完整讲稿保留。",
      );
      await expect(page.locator(".workspace-heading")).toContainText(
        `母版 r${uiInsertedState.revision}`,
      );
      await page
        .getByRole("navigation", { name: "项目区域" })
        .getByRole("button", { name: "交付中心", exact: true })
        .click();
      await page.locator(".journey-panel .btn.primary").click();
      const scriptDownload = page.waitForEvent("download");
      await page
        .getByRole("button", { name: "仅下载逐字稿", exact: true })
        .click();
      const scriptFile = await scriptDownload;
      assert.match(scriptFile.suggestedFilename(), /逐字稿-v\d+\.md$/);
      assert(
        readFileSync(await scriptFile.path(), "utf8").includes(
          uiInsertedState.slides[1].notes,
        ),
      );
      await page
        .getByRole("navigation", { name: "项目区域" })
        .getByRole("button", { name: "制作台", exact: true })
        .click();
      await page.getByRole("button", { name: "演说稿", exact: true }).click();
      await expect(page.getByRole("heading", { name: /演说稿/ })).toBeVisible();
      await page
        .getByRole("navigation", { name: "项目区域" })
        .getByRole("button", { name: "交付中心", exact: true })
        .click();
      const directScriptDownload = page.waitForEvent("download");
      await page
        .getByRole("button", { name: "导出演说稿（Markdown）", exact: true })
        .click();
      const directScriptFile = await directScriptDownload;
      assert(
        readFileSync(await directScriptFile.path(), "utf8").includes(
          "## 第 2 页\n\n" + uiInsertedState.slides[1].notes,
        ),
      );
      holdImages = false;
      imageGates[uiInsertGate]();
      imageGates[uiInsertGate + 1]();
      await poll(uiNeighbourJob);
      await until(async () => (await req(ip)).slides[1].image);
      await page
        .getByRole("navigation", { name: "项目区域" })
        .getByRole("button", { name: "制作台", exact: true })
        .click();
      await page.reload();
      await page.getByLabel("查看段落").selectOption("all");
      await expect(page.locator(".slide-card")).toHaveCount(5);
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.screenshot({
        path: ".local/verification/insert-export/inserted-desktop.png",
      });
      // Reproduce the disabled confirmation reported for an already prepared split.
      await poll(
        await req(
          cp + "/proposal",
          {
            type: "split",
            slideId: concurrentSlides[0].id,
            cuts: [3],
          },
          "POST",
          202,
        ),
      );
      holdImages = true;
      const confirmGate = imageGates.length;
      const confirmOther = await req(
        cp + "/render",
        {
          slideIds: [concurrentSlides[6].id],
        },
        "POST",
        202,
      );
      await until(() => imageGates.length === confirmGate + 1);
      await page.goto(
        base.replace("/api", "") +
          "/#project/" +
          concurrentProject.id +
          "/studio",
      );
      await page.getByLabel("查看段落").selectOption("all");
      await page
        .getByRole("button", { name: "查看新方案", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "确认并生成页面", exact: true }),
      ).toBeEnabled();
      // Failed confirmations are visible inside the modal, rather than behind it.
      let releaseConfirmation;
      await page.route("**/proposal/commit", async (route) => {
        await new Promise((resolve) => {
          releaseConfirmation = resolve;
        });
        await route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({ error: "测试确认冲突" }),
        });
      });
      await page
        .getByRole("button", { name: "确认并生成页面", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "正在提交…", exact: true }),
      ).toBeDisabled();
      await until(() => releaseConfirmation);
      releaseConfirmation();
      await expect(page.getByRole("dialog").getByRole("alert")).toHaveText(
        "上次提交未成功：测试确认冲突",
      );
      await page.keyboard.press("Escape");
      await page
        .getByRole("button", { name: "查看新方案", exact: true })
        .click();
      await expect(page.getByRole("dialog").getByRole("alert")).toHaveCount(0);
      await page.unroute("**/proposal/commit");
      await page
        .getByRole("button", { name: "确认并生成页面", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: "预览拆分方案", exact: true }),
      ).toHaveCount(0);
      await until(() => imageGates.length === confirmGate + 2);
      holdImages = false;
      imageGates.slice(confirmGate).forEach((release) => release());
      await poll(confirmOther);
      const confirmJobs = await req(`/jobs?projectId=${concurrentProject.id}`);
      await Promise.all(
        confirmJobs
          .filter((j) => ["queued", "running"].includes(j.status))
          .map(poll),
      );
      await req(cp + "/undo", {});
      await page.reload();
      // The manual split UI remains usable during another page's image request.
      holdImages = true;
      const splitUiGate = imageGates.length;
      const splitUiOther = await req(
        cp + "/render",
        {
          slideIds: [concurrentSlides[6].id],
        },
        "POST",
        202,
      );
      await until(() => imageGates.length === splitUiGate + 1);
      await page.goto(
        base.replace("/api", "") +
          "/#project/" +
          concurrentProject.id +
          "/studio",
      );
      await page.getByLabel("查看段落").selectOption("all");
      const splitUiCount = (await req(cp)).slides.length;
      await page.getByRole("button", { name: /^打开第 1 页/ }).click();
      await page
        .getByRole("button", { name: "拆分这一页", exact: true })
        .click();
      await expect(page.getByAltText("拆分前的原画面")).toBeVisible();
      await expect
        .poll(() =>
          page
            .getByAltText("拆分前的原画面")
            .evaluate((img) => img.naturalWidth),
        )
        .toBeGreaterThan(0);
      await page.getByLabel("选择逐字稿分界位置").evaluate((el) => {
        el.focus();
        el.setSelectionRange(3, 3);
        el.dispatchEvent(new Event("select", { bubbles: true }));
      });
      await page.getByLabel("选择逐字稿分界位置").press("ArrowRight");
      await page
        .getByRole("button", { name: "在这里插入分界", exact: true })
        .click();
      await expect(page.locator(".split-unit")).toHaveCount(2);
      await page
        .getByRole("checkbox", { name: /拆分后在后台生成图片/ })
        .uncheck();
      mkdirSync(".local/verification/instant-split", { recursive: true });
      for (const [label, width, height] of [
        ["desktop", 1440, 1000],
        ["mobile", 390, 844],
      ]) {
        await page.setViewportSize({ width, height });
        await page.waitForTimeout(100);
        await page.screenshot({
          path: `.local/verification/instant-split/${label}.png`,
        });
        assert(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        );
      }
      await page.setViewportSize({ width: 1440, height: 1000 });
      const splitUiCalls = [calls.length, imageCalls];
      await page
        .getByRole("button", { name: "拆分为 2 页", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: "你来决定，在哪里翻页" }),
      ).toHaveCount(0);
      await expect(page.locator(".slide-card")).toHaveCount(splitUiCount + 1);
      assert.deepEqual([calls.length, imageCalls], splitUiCalls);
      await page.getByRole("button", { name: /^打开第 1 页/ }).click();
      await expect(
        page.getByLabel("本页逐字稿", { exact: true }),
      ).toBeEnabled();
      await page.keyboard.press("Escape");
      await page
        .getByRole("button", { name: "撤销拆分页面", exact: true })
        .click();
      await expect(page.locator(".slide-card")).toHaveCount(splitUiCount);
      holdImages = false;
      imageGates[splitUiGate]();
      assert.equal((await poll(splitUiOther)).status, "completed");
      holdImages = true;
      const uiGateStart = imageGates.length;
      await page.goto(
        base.replace("/api", "") +
          "/#project/" +
          concurrentProject.id +
          "/studio",
      );
      await page.getByLabel("查看段落").selectOption("all");
      await page.getByRole("button", { name: /^打开第 1 页/ }).click();
      await page
        .getByLabel("重新设计要求", { exact: true })
        .fill("第一页面调整");
      await page
        .getByRole("button", { name: "重新设计这页", exact: true })
        .click();
      await until(() => imageGates.length === uiGateStart + 1);
      await expect(
        page.getByRole("button", { name: "正在制作中", exact: true }),
      ).toBeDisabled();
      await page.getByRole("button", { name: "下一页", exact: true }).click();
      await expect(
        page.getByLabel("重新设计要求", { exact: true }),
      ).toBeEnabled();
      await page
        .getByLabel("本页逐字稿", { exact: true })
        .fill(concurrentSlides[1].notes + "\n补充的原文。");
      await page
        .getByLabel("重新设计要求", { exact: true })
        .fill("第二页面调整");
      await page
        .getByRole("button", { name: "按新稿重新设计", exact: true })
        .click();
      await until(() => imageGates.length === uiGateStart + 2);
      await page.getByRole("button", { name: "下一页", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "重新设计这页", exact: true }),
      ).toBeEnabled();
      await expect(
        page.getByRole("button", { name: "拆分这一页", exact: true }),
      ).toBeEnabled();
      mkdirSync(".impeccable/review", { recursive: true });
      await page.screenshot({
        path: ".impeccable/review/concurrent-edit-next-page.png",
      });
      holdImages = false;
      imageGates.slice(uiGateStart).forEach((release) => release());
      await until(
        async () =>
          !(await req(`/jobs?projectId=${concurrentProject.id}`)).some((j) =>
            ["queued", "running"].includes(j.status),
          ),
      );
      held = null;
      holdDesign = true;
      const uiProposal = await req(
        cp + "/proposal",
        { type: "split", slideId: concurrentSlides[0].id, cuts: [3] },
        "POST",
        202,
      );
      await until(() => held);
      // Third page is unrelated to the split and remains editable.
      await expect(
        page.getByRole("button", { name: "重新设计这页", exact: true }),
      ).toBeEnabled();
      await page.getByRole("button", { name: "上一页", exact: true }).click();
      await page.getByRole("button", { name: "上一页", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "正在制作中", exact: true }),
      ).toBeDisabled();
      await expect(
        page.getByLabel("本页逐字稿", { exact: true }),
      ).toBeEnabled();
      await page
        .getByLabel("重新设计要求", { exact: true })
        .fill("正在制作时也可以起草下次修改");
      await page.getByRole("button", { name: "下一页", exact: true }).click();
      await expect(
        page.getByText("有修改尚未提交", { exact: true }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "放弃修改并离开", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "重新设计这页", exact: true }),
      ).toBeEnabled();
      await page.getByRole("button", { name: "关闭", exact: true }).click();
      await page
        .getByRole("button", { name: "继续添加讲稿", exact: true })
        .click();
      await page
        .getByLabel("添加逐字稿", { exact: true })
        .fill("浏览器在拆分任务期间提交新的段落。");
      await expect(
        page.getByRole("button", { name: "提交讲稿并制作", exact: true }),
      ).toBeEnabled();
      await page
        .getByRole("button", { name: "提交讲稿并制作", exact: true })
        .click();
      await expect(page.getByLabel("添加逐字稿", { exact: true })).toHaveValue(
        "",
      );
      held();
      assert.equal((await poll(uiProposal)).status, "completed");
      await until(
        async () =>
          !(await req(`/jobs?projectId=${concurrentProject.id}`)).some((j) =>
            ["queued", "running"].includes(j.status),
          ),
      );
      assert.equal(errors.length, 0);
      await page.goto(base.replace("/api", ""));
      await page
        .getByRole("complementary")
        .getByRole("button", { name: "新建演讲项目", exact: true })
        .click();
      const newProjectDialog = page.getByRole("dialog");
      await expect(
        newProjectDialog.getByRole("button", {
          name: /克制儿童摄影杂志风 · 内置默认/,
        }),
      ).toHaveAttribute("aria-pressed", "true");
      const defaultCover =
        newProjectDialog.getByAltText("克制儿童摄影杂志风封面");
      await expect(defaultCover).toBeVisible();
      await expect
        .poll(() => defaultCover.evaluate((img) => img.naturalWidth))
        .toBeGreaterThan(1000);
      mkdirSync(".impeccable/review", { recursive: true });
      for (const [label, width, height] of [
        ["desktop", 1440, 1000],
        ["mobile", 390, 844],
      ]) {
        await page.setViewportSize({ width, height });
        await page.screenshot({
          path: `.impeccable/review/builtin-default-${label}.png`,
        });
        assert(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth + 1,
          ),
        );
      }
      await page.setViewportSize({ width: 1440, height: 1000 });
      await newProjectDialog.getByRole("button", { name: /极简叙事/ }).click();
      await expect(
        newProjectDialog.getByRole("button", { name: /极简叙事/ }),
      ).toHaveAttribute("aria-pressed", "true");
      await newProjectDialog
        .getByRole("button", { name: /克制儿童摄影杂志风 · 内置默认/ })
        .click();
      await newProjectDialog
        .getByPlaceholder("例如：儿童摄影行业的下一步")
        .fill("默认风格浏览器验收");
      const optionCallsBefore = calls.filter(
        (c) => c.type === "audience" || c.type === "palette",
      ).length;
      await expect(
        newProjectDialog.getByRole("button", {
          name: "默认 · 沿用风格",
          exact: true,
        }),
      ).toHaveAttribute("aria-pressed", "true");
      await newProjectDialog
        .getByLabel("内容倾向（可选）", { exact: true })
        .fill("面向自行车比赛参赛者");
      await newProjectDialog
        .getByRole("button", { name: "暖白 · 深蓝", exact: true })
        .click();
      assert.equal(
        calls.filter((c) => c.type === "audience" || c.type === "palette")
          .length,
        optionCallsBefore,
        "simple edits and color selection never call a model",
      );
      await page.screenshot({
        path: ".impeccable/review/design-options-create.png",
      });
      await newProjectDialog
        .getByRole("button", { name: "创建项目", exact: true })
        .click();
      await expect(newProjectDialog).toHaveCount(0);
      assert.equal(
        (await req("/bootstrap")).projects.find(
          (p) => p.title === "默认风格浏览器验收",
        ).styleId,
        DEFAULT_STYLE_ID,
      );
      const createdWithOptions = (await req("/bootstrap")).projects.find(
        (p) => p.title === "默认风格浏览器验收",
      );
      await page
        .getByRole("navigation", { name: "项目区域" })
        .getByRole("button", { name: "制作台", exact: true })
        .click();
      const savedOptions = (await req(`/projects/${createdWithOptions.id}`))
        .designOptions;
      assert.match(savedOptions.audience.description, /自行车/);
      assert.equal(savedOptions.audience.brief, "");
      assert.equal(savedOptions.palette.name, "暖白 · 深蓝");
      if (!(await page.locator(".studio-settings").evaluate((el) => el.open)))
        await page.locator(".studio-settings > summary").click();
      await page
        .getByRole("button", { name: "内容倾向与配色", exact: true })
        .click();
      const optionsDialog = page.getByRole("dialog");
      await expect(
        optionsDialog.getByLabel("内容倾向（可选）", { exact: true }),
      ).toHaveValue(savedOptions.audience.description);
      await optionsDialog
        .getByRole("button", { name: "保存设置", exact: true })
        .click();
      await expect(optionsDialog).toHaveCount(0);
      assert.deepEqual(
        (await req(`/projects/${createdWithOptions.id}`)).designOptions,
        savedOptions,
        "opening and saving without editing preserves settings",
      );
      if (!(await page.locator(".studio-settings").evaluate((el) => el.open)))
        await page.locator(".studio-settings > summary").click();
      await page
        .getByRole("button", { name: "内容倾向与配色", exact: true })
        .click();
      await optionsDialog
        .getByRole("button", { name: "自定义", exact: true })
        .click();
      await optionsDialog.getByLabel("强调色", { exact: true }).fill("#cc5522");
      await optionsDialog
        .getByRole("button", { name: "保存设置", exact: true })
        .click();
      await expect(optionsDialog).toHaveCount(0);
      assert.equal(
        (await req(`/projects/${createdWithOptions.id}`)).designOptions.palette
          .colors[2],
        "#cc5522",
      );
      if (!(await page.locator(".studio-settings").evaluate((el) => el.open)))
        await page.locator(".studio-settings > summary").click();
      await page
        .getByRole("button", { name: "内容倾向与配色", exact: true })
        .click();
      await optionsDialog
        .getByRole("button", { name: "默认 · 沿用风格", exact: true })
        .click();
      await optionsDialog
        .getByLabel("内容倾向（可选）", { exact: true })
        .fill("");
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({
        path: ".impeccable/review/design-options-mobile.png",
      });
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 1,
        ),
      );
      await optionsDialog
        .getByRole("button", { name: "保存设置", exact: true })
        .click();
      await expect(optionsDialog).toHaveCount(0);
      assert.equal(
        (await req(`/projects/${createdWithOptions.id}`)).designOptions.palette,
        null,
      );
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.goto(base.replace("/api", "") + "/#project/" + id + "/studio");
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
      await page
        .getByRole("navigation", { name: "项目区域" })
        .getByRole("button", { name: "交付中心", exact: true })
        .click();
      await page.locator(".journey-panel .btn.primary").click();
      const initialDownload = page.waitForEvent("download");
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "下载 PPTX＋逐字稿", exact: true })
        .click();
      const initialFile = await initialDownload;
      assert.match(initialFile.suggestedFilename(), /^图片演讲验收-v\d+\.zip$/);
      assert.equal(await initialFile.failure(), null);
      const initialBundle = await JSZip.loadAsync(
        readFileSync(await initialFile.path()),
      );
      await inspectPresentation(
        await initialBundle.file("图片演讲验收.pptx").async("nodebuffer"),
        (await read()).slides,
      );
      // New frontend keeps the original PPT workflow when an old backend is still running.
      await page.route("**/api/bootstrap", async (route) => {
        const response = await route.fetch();
        const body = await response.json();
        delete body.features.insertAndManuscriptExport;
        delete body.capabilities.bundleExport;
        await route.fulfill({ response, json: body });
      });
      await page.reload();
      await expect(
        page.getByRole("heading", { name: "图片演讲验收", exact: true }),
      ).toBeVisible();
      await expect(page.locator(".insert-page")).toHaveCount(0);
      await page
        .getByRole("navigation", { name: "项目区域" })
        .getByRole("button", { name: "交付中心", exact: true })
        .click();
      await page.locator(".journey-panel .btn.primary").click();
      await expect(
        page.getByRole("button", { name: "仅下载逐字稿", exact: true }),
      ).toBeVisible();
      const legacyDownload = page.waitForEvent("download");
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "下载 PPTX", exact: true })
        .click();
      assert.equal(
        (await legacyDownload).suggestedFilename(),
        "图片演讲验收.pptx",
      );
      await page.unroute("**/api/bootstrap");
      await page.reload();
      await page
        .getByRole("navigation", { name: "项目区域" })
        .getByRole("button", { name: "制作台", exact: true })
        .click();
      await expect(page.locator(".insert-page").first()).toBeVisible();
      const first = page.locator(".slide-card").first();
      await first.locator(".slide-image").click();
      await expect(
        page.getByRole("link", { name: "保存图片", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "下载 PPTX＋逐字稿", exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "编辑画面", exact: true }),
      ).toHaveCount(0);
      await page
        .getByRole("button", { name: "上屏文案与风格", exact: true })
        .click();
      const copyReview = page.locator(".copy-review").filter({
        has: page.locator("summary", { hasText: "文字取舍与密度" }),
      });
      await copyReview.locator("summary").click();
      await expect(copyReview).toContainText("方案生成时的讲稿");
      await expect(copyReview).toContainText("不含附件图片内的文字");
      const rawStyle = page.locator(".copy-review").filter({
        has: page.locator("summary", { hasText: "本次风格提示词原文" }),
      });
      await rawStyle.locator("summary").click();
      await expect(rawStyle.locator(".rules-text")).toHaveText(style.rules);
      const sentPrompt = page.locator(".copy-review").filter({
        has: page.locator("summary", { hasText: "实际发送的出图提示词" }),
      });
      await sentPrompt.locator("summary").click();
      await expect(sentPrompt.locator(".rules-text")).toContainText(
        style.rules,
      );
      await sentPrompt.locator("summary").click();
      await rawStyle.locator("summary").click();
      mkdirSync(".impeccable/review", { recursive: true });
      for (const [label, width, height] of [
        ["desktop", 1440, 1000],
        ["mobile", 390, 844],
      ]) {
        await page.setViewportSize({ width, height });
        await copyReview.scrollIntoViewIfNeeded();
        await page.screenshot({
          path: `.impeccable/review/copy-density-${label}.png`,
        });
        assert(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth + 1,
          ),
        );
      }
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.getByRole("button", { name: "逐字稿", exact: true }).click();
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
      await page
        .getByRole("navigation", { name: "项目区域" })
        .getByRole("button", { name: "交付中心", exact: true })
        .click();
      await page.locator(".journey-panel .btn.primary").click();
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
      assert.match(downloaded.suggestedFilename(), /^图片演讲验收-v\d+\.zip$/);
      assert.equal(await downloaded.failure(), null);
      const current = await read();
      const bundle = await JSZip.loadAsync(
        readFileSync(await downloaded.path()),
      );
      await inspectPresentation(
        await bundle.file("图片演讲验收.pptx").async("nodebuffer"),
        current.slides,
      );
      const script = await bundle
        .file(Object.keys(bundle.files).find((f) => f.endsWith(".md")))
        .async("string");
      assert(script.includes("浏览器修改后的原稿。"));
      await downloaded.saveAs(path.join(dir, "browser-export.zip"));
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.goto(base.replace("/api", "") + "/#styles");
      const modelsBeforeCreate = calls.length;
      await page.getByRole("button", { name: "创建风格", exact: true }).click();
      await page.getByRole("button", { name: "手动填写", exact: true }).click();
      await page
        .getByRole("textbox", { name: "风格名称", exact: true })
        .fill("浏览器手写风格");
      await expect(
        page.getByRole("button", { name: "保存风格", exact: true }),
      ).toBeDisabled();
      await page
        .getByRole("textbox", { name: "风格提示词", exact: true })
        .fill(manualRules);
      await page.getByRole("button", { name: "上传图片", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "保存并提炼风格", exact: true }),
      ).toBeDisabled();
      await page.getByRole("button", { name: "手动填写", exact: true }).click();
      await expect(
        page.getByRole("textbox", { name: "风格提示词", exact: true }),
      ).toHaveValue(manualRules);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({
        path: path.join(dir, "manual-style-mobile.png"),
        fullPage: true,
      });
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.getByRole("button", { name: "保存风格", exact: true }).click();
      await expect(
        page.getByRole("button", {
          name: "生成一页 demo / 调试风格",
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "重新提炼风格", exact: true }),
      ).toBeDisabled();
      await expect(page.locator(".rules-text")).toHaveText(manualRules);
      const savedManual = (await req("/bootstrap")).styles.find(
        (s) => s.name === "浏览器手写风格",
      );
      assert.equal(savedManual.rules, manualRules);
      assert.equal(calls.length, modelsBeforeCreate);
      await page.screenshot({
        path: path.join(dir, "manual-style-desktop.png"),
        fullPage: true,
      });
      await page.getByRole("button", { name: "关闭", exact: true }).click();

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
      const originalRules = (await req("/bootstrap")).styles.find(
        (s) => s.id === style.id,
      ).rules;
      const beforeVersions = (await req(`/styles/${style.id}/versions`))
        .versions;
      await page.getByRole("button", { name: "手动调整", exact: true }).click();
      await page
        .getByRole("textbox", { name: "风格设计规则" })
        .fill(originalRules + "\n浏览器版本验证");
      await page.getByRole("button", { name: "保存规则", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "手动调整", exact: true }),
      ).toBeVisible();
      // An external save while a draft is open must not discard either side.
      await page.getByRole("button", { name: "手动调整", exact: true }).click();
      const browserDraft = originalRules + "\n浏览器版本验证";
      await page
        .getByRole("textbox", { name: "风格设计规则" })
        .fill(browserDraft);
      await req(
        `/styles/${style.id}`,
        { rules: originalRules + "\n另一窗口" },
        "PATCH",
      );
      await page.getByRole("button", { name: "保存规则", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "已比较，继续编辑", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("textbox", { name: "风格设计规则" }),
      ).toHaveValue(browserDraft);
      await page
        .getByRole("button", { name: "已比较，继续编辑", exact: true })
        .click();
      await page.getByRole("button", { name: "保存规则", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "手动调整", exact: true }),
      ).toBeVisible();
      await page.locator(".style-versions > summary").click();
      await page
        .getByLabel("选择提示词版本")
        .selectOption(beforeVersions[0].id);
      await expect(page.getByLabel("所选版本提示词")).toHaveText(originalRules);
      await page.getByText("与当前版本比较", { exact: true }).click();
      await expect(page.getByLabel("提示词差异")).toContainText(
        "浏览器版本验证",
      );
      await page
        .getByRole("button", { name: "恢复此版本", exact: true })
        .click();
      await expect(page.locator(".rules-text")).toHaveText(originalRules);
      const afterVersions = (await req(`/styles/${style.id}/versions`))
        .versions;
      assert.equal(afterVersions.length, beforeVersions.length + 4);
      assert.equal(afterVersions[0].source, "restore");
      assert.equal(afterVersions[1].rules, originalRules + "\n浏览器版本验证");
      await page.setViewportSize({ width: 390, height: 844 });
      await page
        .getByRole("button", { name: "恢复此版本", exact: true })
        .scrollIntoViewIfNeeded();
      await page.screenshot({
        path: path.join(dir, "style-versions-mobile.png"),
        fullPage: true,
      });
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      );
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.screenshot({
        path: path.join(dir, "style-versions-desktop.png"),
        fullPage: true,
      });
      await page
        .getByRole("checkbox", { name: "按内容构思（仅当前风格）" })
        .click();
      await expect(
        page.getByRole("checkbox", { name: "按内容构思（仅当前风格）" }),
      ).toBeChecked();
      await page
        .getByRole("button", { name: "生成一页 demo / 调试风格", exact: true })
        .click();
      await page
        .getByRole("button", { name: "从正式风格重新开始", exact: true })
        .click();
      await page
        .getByLabel("试做讲稿", { exact: true })
        .fill("这是浏览器图片试做。");
      const preview = page.getByRole("region", {
        name: "本次提炼的上屏内容",
        exact: true,
      });
      await expect(preview).toContainText("生成试做后");
      await expect(
        page.getByLabel("风格中的视觉方向", { exact: true }),
      ).toHaveCount(0);
      await page
        .getByRole("button", { name: "生成图片试做", exact: true })
        .click();
      await expect(
        page.getByRole("img", { name: "本次风格试做图片", exact: true }),
      ).toBeVisible({ timeout: 15000 });
      const browserTrial = (await trials()).trials.find(
        (t) => t.notes === "这是浏览器图片试做。" && t.status === "completed",
      );
      assert(browserTrial.plan.compositionPlan);
      await preview
        .getByText("本页构图与五维构思自检", { exact: true })
        .click();
      await expect(preview).toContainText("COMPOSITION_MARKER");
      await expect(preview).toContainText("不是对实际成图的验收");
      const expectedCopy = browserTrial.plan.displayText.join("\n\n");
      await expect(
        preview.getByLabel("本次上屏文案", { exact: true }),
      ).toHaveValue(expectedCopy);
      const callsBeforeCopy = [calls.length, imageCalls];
      await page
        .context()
        .grantPermissions(["clipboard-read", "clipboard-write"], {
          origin: new URL(base).origin,
        });
      const assertCopied = async (button, expected) => {
        await preview
          .getByRole("button", { name: button, exact: true })
          .click();
        await expect
          .poll(() => page.evaluate(() => navigator.clipboard.readText()))
          .toBe(expected);
      };
      await assertCopied("复制上屏文案", expectedCopy);
      await assertCopied(
        "复制内容部分（含辅助信息）",
        browserTrial.plan.contentPrompt,
      );
      await assertCopied("复制本次风格提示词", browserTrial.plan.styleRules);
      await assertCopied(
        "复制完整出图提示词",
        browserTrial.plan.imageRequest.prompt,
      );
      await page.getByText("查看上屏文案与生成依据", { exact: true }).click();
      await page.getByText("实际发送的出图提示词", { exact: true }).click();
      await expect(page.getByText(/请求模型：test-image/)).toBeVisible();
      await expect(page.getByText(/实际图片：1600×900/)).toBeVisible();
      await expect(page.getByText(/服务未返回模型标识/)).toBeVisible();
      await page.getByText("查看上屏文案与生成依据", { exact: true }).click();
      // Editing the draft must not change the input copied for the selected image.
      await page
        .getByLabel("试做讲稿", { exact: true })
        .fill("新的讲稿尚未生成。");
      await expect(preview).toContainText("讲稿已修改");
      await assertCopied("复制上屏文案", expectedCopy);
      await assertCopied(
        "复制内容部分（含辅助信息）",
        browserTrial.plan.contentPrompt,
      );
      await page.getByText("设计提示词原文", { exact: true }).click();
      await page
        .getByLabel("试做设计规范", { exact: true })
        .fill("新的风格尚未生成");
      await expect(preview).toContainText("风格提示词已修改");
      await assertCopied("复制本次风格提示词", browserTrial.plan.styleRules);
      await assertCopied(
        "复制完整出图提示词",
        browserTrial.plan.imageRequest.prompt,
      );
      await page
        .getByLabel("试做讲稿", { exact: true })
        .fill(browserTrial.notes);
      await page
        .getByLabel("试做设计规范", { exact: true })
        .fill(browserTrial.styleSnapshot.rules);
      await page.getByText("设计提示词原文", { exact: true }).click();
      await page.evaluate(() => {
        const write = navigator.clipboard.writeText.bind(navigator.clipboard);
        navigator.clipboard.writeText = async () => {
          navigator.clipboard.writeText = write;
          throw new Error("Clipboard denied for test");
        };
      });
      await preview
        .getByRole("button", { name: "复制完整出图提示词", exact: true })
        .click();
      await expect(
        preview.getByLabel("待手动复制的内容", { exact: true }),
      ).toHaveValue(browserTrial.plan.imageRequest.prompt);
      await assertCopied(
        "复制完整出图提示词",
        browserTrial.plan.imageRequest.prompt,
      );
      assert.deepEqual(
        [calls.length, imageCalls],
        callsBeforeCopy,
        "Viewing and copying must not call a model",
      );
      for (const [label, width, height] of [
        ["desktop", 1440, 1000],
        ["mobile", 390, 844],
      ]) {
        await page.setViewportSize({ width, height });
        await preview.scrollIntoViewIfNeeded();
        await page.screenshot({
          path: `.impeccable/review/trial-copy-${label}.png`,
        });
        assert(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth + 1,
          ),
        );
      }
      await page.setViewportSize({ width: 1440, height: 1000 });
      await expect(page.getByText("画面偏差检查", { exact: true })).toHaveCount(
        0,
      );
      await expect(page.getByRole("button", { name: /复刻参考/ })).toHaveCount(
        0,
      );
      await expect(
        page.getByLabel("画面调整（可选）", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByLabel("上屏文字调整（可选）", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "调整规范并再试", exact: true }),
      ).toHaveCount(0);
      await page.getByText("设计提示词原文", { exact: true }).click();
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
      await page
        .getByLabel("画面调整（可选）", { exact: true })
        .scrollIntoViewIfNeeded();
      await page.screenshot({
        path: ".impeccable/review/direct-style-mobile.png",
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
        .getByRole("button", { name: "生成一页 demo / 调试风格", exact: true })
        .click();
      await expect(page.getByLabel("试做讲稿", { exact: true })).toHaveValue(
        "这是浏览器图片试做。",
      );
      await browser.close();
      await req(`/styles/${style.id}`, { compositionMode: "direct" }, "PATCH");
      // The UI intentionally changed notes and style rules. Establish a reviewed
      // current version before the later attachment-history test asserts reuse.
      const afterBrowser = await read();
      assert.equal(
        (
          await poll(
            await req(
              `/projects/${id}/render`,
              {
                slideIds: [afterBrowser.slides[0].id],
                redesign: true,
              },
              "POST",
              202,
            ),
          )
        ).status,
        "completed",
      );
    }
    // Content attachments are actual image inputs, independently of style references.
    project = await read();
    const attachmentSid = project.slides[0].id;
    const attachmentRoute = `/projects/${id}/slides/${attachmentSid}/attachments`;
    const uploadMaterials = async (count, type = "image/png", bytes) => {
      const data = new FormData();
      for (let i = 0; i < count; i++) {
        const material =
          bytes ||
          (await sharp({
            create: {
              width: 240 + i,
              height: 160,
              channels: 3,
              background: { r: 40 + i * 40, g: 100, b: 160 },
            },
          })
            .png()
            .toBuffer());
        data.append(
          "images",
          new Blob([material], { type }),
          `产品截图-${i + 1}.png`,
        );
      }
      return fetch(base + attachmentRoute, { method: "POST", body: data });
    };
    assert.equal((await uploadMaterials(5)).status, 400);
    assert.equal((await uploadMaterials(1, "image/svg+xml")).status, 400);
    assert.equal(
      (await uploadMaterials(1, "image/png", Buffer.from("not an image")))
        .status,
      400,
    );
    assert.equal(
      (
        await uploadMaterials(
          1,
          "image/png",
          Buffer.alloc(12 * 1024 * 1024 + 1),
        )
      ).status,
      400,
    );
    const materialsResponse = await uploadMaterials(4);
    assert.equal(materialsResponse.status, 201);
    const { attachments } = await materialsResponse.json();
    const attachmentIds = attachments.map((a) => a.id);
    assert.equal(attachments[0].name, "产品截图-1.png");
    assert.equal(attachments[3].width, 243);
    assert.equal((await read()).slides[0].attachments?.length || 0, 0);
    const foreign = await req(
      "/projects",
      { title: "附件隔离验收", styleId: project.styleId },
      "POST",
      201,
    );
    // An existing attachment id from a different project must not be accepted.
    await req(
      `/projects/${id}/render`,
      { slideIds: [attachmentSid], attachmentIds: ["missing"] },
      "POST",
      400,
    );
    await req(
      `/projects/${id}/render`,
      {
        slideIds: [attachmentSid],
        attachmentIds: [...attachmentIds, attachmentIds[0]],
      },
      "POST",
      400,
    );
    // A foreign id is backed by a real record to cover ownership, not just missing input.
    const fixtureDb = new DatabaseSync(path.join(dir, "autoppt.sqlite"));
    fixtureDb.prepare("INSERT INTO records(kind,id,data) VALUES(?,?,?)").run(
      "attachment",
      "foreign",
      JSON.stringify({
        ...attachments[0],
        id: "foreign",
        projectId: foreign.id,
      }),
    );
    fixtureDb.close();
    await req(
      `/projects/${id}/render`,
      { slideIds: [attachmentSid], attachmentIds: ["foreign"] },
      "POST",
      400,
    );
    const rendered = async (ids = attachmentIds) =>
      poll(
        await req(
          `/projects/${id}/render`,
          {
            slideIds: [attachmentSid],
            attachmentIds: ids,
            redesign: false,
            feedback: "将这些产品截图和图表直接放进画面，与文字一起重新设计。",
          },
          "POST",
          202,
        ),
      );
    assert.equal((await rendered()).status, "completed");
    let materialSlide = (await read()).slides[0];
    assert.deepEqual(
      materialSlide.attachments.map((a) => a.id),
      attachmentIds,
    );
    assert.equal(materialSlide.plan.editScope, "composition");
    assert.equal(
      materialSlide.plan.imageRequest.referenceMode,
      "content-attachments",
    );
    assert.deepEqual(
      materialSlide.plan.imageRequest.attachmentIds,
      attachmentIds,
    );
    assert.deepEqual(materialSlide.imageStyle.imageRefs, []);
    const priorVersion = materialSlide.versions.at(-1);
    assert.deepEqual(priorVersion.attachments, []);
    const designInput = calls.filter((c) => c.type === "copy").at(-1);
    const edit = editRequests.at(-1);
    assert.equal(edit.size, "2560x1440");
    assert.equal(materialSlide.plan.imageRequest.size, "2560x1440");
    assert.equal(designInput.refs, 4);
    for (const type of ["copy", "copyReview"]) {
      const editorial = calls.filter((c) => c.type === type).at(-1);
      assert.equal(editorial.refs, 4);
      assert.equal(editorial.data.profile.kind, "attachment");
      assert.deepEqual(
        editorial.data.attachments.map((a) => a.id),
        attachmentIds,
      );
    }
    assert.equal(edit.files.length, 4);
    assert.match(edit.prompt, /内容素材，不是风格参考/);
    // Multipart serializes text-field line endings as CRLF.
    assert(
      edit.prompt
        .replace(/\r\n/g, "\n")
        .startsWith(
          materialSlide.plan.styleRules.replace(/\r\n/g, "\n") + "\n\n",
        ),
    );
    assert.match(edit.prompt, /先结合本页文案判断每张附件的作用/);
    assert.match(edit.prompt, /照片或实物：/);
    assert.match(edit.prompt, /图表、表格或界面截图：/);
    assert.match(edit.prompt, /不能改数、删掉比较条件或重新编造界面/);
    assert(!edit.prompt.includes("Text-only generation"));
    for (let i = 0; i < attachments.length; i++) {
      const original = readFileSync(
        path.join(dir, "assets", attachments[i].filename),
      );
      assert.deepEqual(designInput.imageInputs[i], original);
      assert.deepEqual(edit.files[i], original);
      assert.notDeepEqual(original, image);
    }
    // Failed content review with new materials stops before image generation.
    const savedImage = materialSlide.image;
    const editsBeforeInvalid = editRequests.length;
    rejectCopyReview = true;
    assert.equal((await rendered(attachmentIds.slice(0, 1))).status, "failed");
    assert.equal(editRequests.length, editsBeforeInvalid);
    assert.equal((await read()).slides[0].image, savedImage);
    assert.equal((await read()).slides[0].pendingAttachments.length, 1);
    // No silent fallback to text-only if the provider rejects image edits; retry keeps material bytes.
    failImage = true;
    const failedJob = await rendered(attachmentIds.slice(0, 2));
    assert.equal(failedJob.status, "failed");
    assert.match((await read()).slides[0].error, /Images Edits/);
    assert.equal((await read()).slides[0].image, savedImage);
    const plansBeforeRetry = calls.filter((c) => c.type === "copy").length;
    const textOnlyBeforeRetry = imageRequests.length;
    assert.equal(
      (await poll(await req(`/jobs/${failedJob.id}/retry`, {}))).status,
      "completed",
    );
    assert.equal(
      calls.filter((c) => c.type === "copy").length,
      plansBeforeRetry,
    );
    assert.equal(imageRequests.length, textOnlyBeforeRetry);
    assert.equal(editRequests.at(-1).files.length, 2);
    materialSlide = (await read()).slides[0];
    assert.equal(materialSlide.attachments.length, 2);
    assert.equal(materialSlide.pendingAttachments, undefined);
    await req(`/projects/${id}/slides/${attachmentSid}/restore`, {
      versionId: priorVersion.id,
    });
    assert.deepEqual((await read()).slides[0].attachments, []);
    assert.equal((await rendered([])).status, "completed");
    assert.deepEqual((await read()).slides[0].plan.attachments, []);
    assert((await read()).slides[0].plan.copyReused);
    assert(!imageRequests.at(-1).prompt.includes("【内容附件：参与整页设计】"));
    assert.equal(
      (await read()).slides[0].plan.imageRequest.referenceMode,
      "rules-only",
    );
    // Opt-in scope, persisted directions, failure retry, and nearby-page context.
    const originalOtherStyles = (await req("/bootstrap")).styles.filter(
      (s) => s.id !== style.id,
    );
    await req(
      `/styles/${style.id}`,
      { compositionMode: "invalid" },
      "PATCH",
      400,
    );
    await req(
      `/styles/${style.id}`,
      { compositionMode: "content-led" },
      "PATCH",
    );
    const directionIds = (await read()).slides.slice(0, 2).map((s) => s.id);
    const callCount = () =>
      calls.filter((c) => c.type === "composition").length;
    const countBefore = callCount();
    const directionJob = await req(
      `/projects/${id}/render`,
      { slideIds: directionIds, redesign: true },
      "POST",
      202,
    );
    assert.equal((await poll(directionJob)).status, "completed");
    assert.equal(callCount(), countBefore + directionIds.length);
    if (directionIds.length > 1)
      assert(
        calls.filter((c) => c.type === "composition").at(-1).data.recent
          .length > 0,
      );
    failImage = true;
    const retryDirectionJob = await req(
      `/projects/${id}/render`,
      { slideIds: [directionIds[0]], redesign: true },
      "POST",
      202,
    );
    assert.equal((await poll(retryDirectionJob)).status, "failed");
    const countBeforeRetry = callCount();
    await req(`/jobs/${retryDirectionJob.id}/retry`, {});
    assert.equal((await poll(retryDirectionJob)).status, "completed");
    assert.equal(
      callCount(),
      countBeforeRetry,
      "Retry reuses persisted art direction",
    );
    assert.deepEqual(
      (await req("/bootstrap")).styles.filter((s) => s.id !== style.id),
      originalOtherStyles,
    );
    assert(
      (await read()).slides
        .filter((s) => directionIds.includes(s.id))
        .every((s) =>
          s.plan.imageRequest.prompt.includes("COMPOSITION_MARKER"),
        ),
    );
    await req(`/styles/${style.id}`, { compositionMode: "direct" }, "PATCH");
    // Report is read-only, counts current notes and detects the changed source used above.
    const beforeReport = await read();
    const report = await req(`/projects/${id}/report`);
    assert.equal(report.status, "different");
    assert.equal(
      report.notes,
      Array.from(
        beforeReport.slides
          .map((s) => s.notes)
          .join("")
          .replace(/\s/gu, ""),
      ).length,
    );
    assert.equal(report.speech, report.notes);
    assert.equal(report.pages, beforeReport.slides.length);
    assert.equal((await read()).revision, beforeReport.revision);
    const currentStyle = (await req("/bootstrap")).styles.find(
      (s) => s.id === style.id,
    );
    const versionTrial = await req(
      route,
      { notes: text, rules: currentStyle.rules + "\n版本试做规则" },
      "POST",
      202,
    );
    assert.equal((await poll({ id: versionTrial.jobId })).status, "completed");
    await req(`${route}/${versionTrial.id}/apply`, {});
    const persistedVersions = await req(`/styles/${style.id}/versions`);
    assert.equal(persistedVersions.versions[0].source, "trial");
    assert.equal(
      persistedVersions.versions[0].rules,
      currentStyle.rules + "\n版本试做规则",
    );
    const manualTrial = await req(
      `/styles/${manualStyle.id}/trials`,
      { notes: text, rules: manualRules },
      "POST",
      202,
    );
    assert.equal((await poll({ id: manualTrial.jobId })).status, "completed");
    const manualResult = (
      await req(`/styles/${manualStyle.id}/trials`)
    ).trials.find((t) => t.id === manualTrial.id);
    assert(
      manualResult.plan.imageRequest.prompt.startsWith(manualRules + "\n\n"),
    );
    assert.equal(manualResult.plan.styleRules, manualRules);
    await shutdown();
    await boot();
    assert.deepEqual(
      await req(`/styles/${style.id}/versions`),
      persistedVersions,
    );
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
    assert(imageRequests.some((r) => r.prompt.includes(style.rules)));
    assert(imageRequests.every((r) => r.size === "2560x1440"));
    assert(editRequests.every((r) => r.size === "2560x1440"));
    assert(
      imageRequests.every(
        (r) => !r.prompt.includes("RESOLVED STYLE EXECUTION"),
      ),
    );
    // Deletion is explicit, blocked during jobs, durable, and leaves shared assets/history intact.
    const beforeDelete = await read();
    await req(`/projects/${id}`, undefined, "DELETE");
    assert(!(await req("/bootstrap")).projects.some((p) => p.id === id));
    await req(`/projects/${id}`, undefined, "GET", 404);
    await req(`/projects/${id}`, { title: "不能修改已删除项目" }, "PATCH", 404);
    await req(`/projects/${id}/render`, {}, "POST", 404);
    const deletedDb = new DatabaseSync(path.join(dir, "autoppt.sqlite"));
    const deletedProject = JSON.parse(
      deletedDb
        .prepare("SELECT data FROM records WHERE kind='project' AND id=?")
        .get(id).data,
    );
    deletedDb.close();
    assert(deletedProject.deletedAt);
    assert.deepEqual(deletedProject.slides, beforeDelete.slides);
    assert.deepEqual(deletedProject.batches, beforeDelete.batches);
    for (const slide of beforeDelete.slides)
      if (slide.image)
        assert(readFileSync(path.join(dir, "assets", slide.image)).length);
    const disposableStyle = (
      await req(
        "/styles",
        { name: "删除风格浏览器验收", rules: "临时风格，仅供删除测试。" },
        "POST",
        201,
      )
    ).style;
    const disposableProject = await req(
      "/projects",
      { title: "删除项目浏览器验收", styleId: disposableStyle.id },
      "POST",
      201,
    );
    if (process.env.BROWSER_TEST) {
      const { chromium, expect } = await import("@playwright/test");
      const browser = await chromium.launch({
        headless: true,
        executablePath: process.env.CHROMIUM_EXECUTABLE,
      });
      try {
        const page = await browser.newPage({
          viewport: { width: 1440, height: 1000 },
        });
        await page.goto(base.replace("/api", ""));
        await page
          .getByRole("button", {
            name: "删除项目：删除项目浏览器验收",
            exact: true,
          })
          .click();
        await page
          .getByRole("dialog")
          .getByRole("button", { name: "取消", exact: true })
          .click();
        assert(
          (await req("/bootstrap")).projects.some(
            (p) => p.id === disposableProject.id,
          ),
        );
        await page
          .getByRole("button", {
            name: "删除项目：删除项目浏览器验收",
            exact: true,
          })
          .click();
        await page.screenshot({
          path: ".impeccable/review/delete-project.png",
        });
        await page
          .getByRole("dialog")
          .getByRole("button", { name: "确认删除项目", exact: true })
          .click();
        await expect(page.getByRole("dialog")).toHaveCount(0);
        await expect(
          page.getByRole("button", {
            name: "删除项目：删除项目浏览器验收",
            exact: true,
          }),
        ).toHaveCount(0);
        await page.goto(base.replace("/api", "") + "/#styles");
        await page
          .getByRole("button", {
            name: "删除风格：删除风格浏览器验收",
            exact: true,
          })
          .click();
        await page
          .getByRole("dialog")
          .getByRole("button", { name: "取消", exact: true })
          .click();
        assert(
          !(await req("/bootstrap")).styles.find(
            (s) => s.id === disposableStyle.id,
          ).deletedAt,
        );
        await page
          .getByRole("button", {
            name: "删除风格：删除风格浏览器验收",
            exact: true,
          })
          .click();
        await page
          .getByRole("dialog")
          .getByRole("button", { name: "确认删除风格", exact: true })
          .click();
        await expect(page.getByRole("dialog")).toHaveCount(0);
        await expect(
          page.getByRole("button", {
            name: "删除风格：删除风格浏览器验收",
            exact: true,
          }),
        ).toHaveCount(0);
      } finally {
        await browser.close();
      }
    } else {
      await req(`/projects/${disposableProject.id}`, undefined, "DELETE");
      await req(`/styles/${disposableStyle.id}`, undefined, "DELETE");
    }
    await shutdown();
    await boot();
    const afterDeletion = await req("/bootstrap");
    assert(
      !afterDeletion.projects.some(
        (p) => p.id === id || p.id === disposableProject.id,
      ),
    );
    assert(
      afterDeletion.styles.find((s) => s.id === disposableStyle.id).deletedAt,
    );
    assert(!afterDeletion.styles.find((s) => s.id === style.id).deletedAt);
    console.log(
      `Verified ${dir}; ${calls.filter((c) => c.type === "copy").length} designs (style refs excluded); image requests=${imageCalls}`,
    );
  },
);
