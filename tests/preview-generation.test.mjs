import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fork } from "node:child_process";
import { once } from "node:events";
import http from "node:http";
import sharp from "sharp";
import { copyFixture, reviewFixture } from "./fixtures/screen-copy.mjs";

test(
  "hosted preview saves all manuscript pages, charges one image, then completes only missing images across restart",
  { timeout: 90000 },
  async (t) => {
    const dir = mkdtempSync(path.join(tmpdir(), "autoppt-preview-"));
    const png = await sharp({
      create: { width: 1280, height: 720, channels: 3, background: "white" },
    })
      .png()
      .toBuffer();
    const prompts = [];
    const provider = http.createServer(async (req, res) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks));
      res.setHeader("Content-Type", "application/json");
      if (req.url.includes("/images/")) {
        prompts.push(body.prompt);
        res.end(
          JSON.stringify({ data: [{ b64_json: png.toString("base64") }] }),
        );
        return;
      }
      const system = body.messages[0].content,
        raw = body.messages[1].content[0].text;
      let output;
      if (system.includes("演讲内容编辑")) {
        output = {
          ends: Array.from(raw.matchAll(/(?:^|\n)\[(\d+)\]/g), (m) =>
            Number(m[1]),
          ),
        };
      } else {
        const content = JSON.parse(raw);
        if (system.includes("演讲上屏文案复核编辑"))
          output = reviewFixture(content);
        else if (system.includes("演讲上屏文案编辑"))
          output = copyFixture(content, [content.notes]);
        else if (system.includes("演讲内容关系分析师"))
          output = {
            pages: content.pages.map((p) => ({
              id: p.id,
              claim: "原文重点",
              relationship: "statement",
              literalSpatial: false,
              evidence: p.notes,
              entities: ["原文"],
              visualTask: "表达原文",
              mustNotImply: [],
            })),
          };
        else throw new Error("Unexpected mock model operation");
      }
      res.end(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(output) } }],
        }),
      );
    });
    provider.listen(0, "127.0.0.1");
    await once(provider, "listening");
    const probe = http.createServer();
    probe.listen(0, "127.0.0.1");
    await once(probe, "listening");
    const port = probe.address().port;
    await new Promise((resolve) => probe.close(resolve));
    const origin = `http://127.0.0.1:${port}`;
    writeFileSync(path.join(dir, "admin-password"), "Preview-password-12345", {
      mode: 0o600,
    });
    let child;
    const start = async () => {
      child = fork("server/hosted/index.mjs", [], {
        env: {
          ...process.env,
          PORT: String(port),
          HOST: "127.0.0.1",
          AUTOPPT_PUBLIC_URL: origin,
          AUTOPPT_HOSTED_DATA_DIR: dir,
          AUTOPPT_ADMIN_PASSWORD_FILE: path.join(dir, "admin-password"),
          AUTOPPT_TEXT_BASE_URL: `http://127.0.0.1:${provider.address().port}/v1`,
          AUTOPPT_IMAGE_BASE_URL: `http://127.0.0.1:${provider.address().port}/v1`,
          AUTOPPT_TEXT_API_KEY: "fixture-only",
          AUTOPPT_IMAGE_API_KEY: "fixture-only",
        },
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      });
      let log = "";
      child.stdout.on("data", (c) => (log += c));
      child.stderr.on("data", (c) => (log += c));
      await Promise.race([
        once(child, "message"),
        once(child, "exit").then(() => {
          throw new Error(log);
        }),
        new Promise((_, reject) => {
          const timer = setTimeout(
            () => reject(new Error("Startup timeout")),
            20000,
          );
          timer.unref();
        }),
      ]);
    };
    const stop = async () => {
      if (child?.exitCode === null) {
        const exited = once(child, "exit");
        child.kill();
        await exited;
      }
    };
    t.after(async () => {
      await stop();
      await new Promise((resolve) => provider.close(resolve));
      rmSync(dir, { recursive: true, force: true });
    });
    await start();
    let cookie = "";
    const request = async (url, body, status = 200) => {
      const response = await fetch(origin + url, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Origin: origin,
          Cookie: cookie,
          "Content-Type": "application/json",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const data = await response.json();
      assert.equal(response.status, status, `${url}: ${JSON.stringify(data)}`);
      cookie = response.headers.get("set-cookie")?.split(";")[0] || cookie;
      return data;
    };
    const finished = async (id) => {
      for (let n = 0; n < 300; n++) {
        const job = (await request("/api/jobs")).find((j) => j.id === id);
        if (
          ["completed", "failed", "interrupted", "cancelled"].includes(
            job.status,
          )
        ) {
          assert.equal(job.status, "completed", JSON.stringify(job));
          return job;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      assert.fail("Preview generation timed out");
    };
    await request("/api/account/login", {
      name: "admin",
      password: "Preview-password-12345",
    });
    const rules = "\t黑白摄影与鲜明色块。\n示例标题：记录孩子的成长。\n";
    const { style } = await request(
      "/api/styles",
      { name: "保留原风格的试做", rules },
      201,
    );
    const project = await request(
      "/api/projects",
      { title: "试一页再整场", styleId: style.id },
      201,
    );
    const notes =
      "第一段先确认关键观点。第二段检查实际画面。第三段满意后生成整场。";
    const requestId = randomUUID();
    await request(
      `/api/projects/${project.id}/batches`,
      { text: notes, generationMode: "invalid", requestId },
      400,
    );
    const job = await request(
      `/api/projects/${project.id}/batches`,
      { text: notes, generationMode: "preview", requestId },
      202,
    );
    const done = await finished(job.id);
    assert.equal(done.preview.totalPages, 3);
    assert.equal(done.pageProgress.total, 1);
    assert.equal(prompts.length, 1);
    assert(prompts[0].startsWith(rules + "\n\n"));
    assert.match(prompts[0], /本页文字核对清单/);
    assert.match(prompts[0], /第一段先确认关键观点/);
    const before = await request(`/api/projects/${project.id}`);
    assert.equal(before.batches[0].text, notes);
    assert.equal(before.slides.map((s) => s.notes).join(""), notes);
    assert.equal(before.slides.filter((s) => s.image).length, 1);
    assert.equal((await request("/api/account")).user.available, 19);
    assert.equal(
      (
        await request(
          `/api/projects/${project.id}/batches`,
          { text: notes, generationMode: "preview", requestId },
          202,
        )
      ).id,
      job.id,
    );
    await request(
      `/api/projects/${project.id}/batches`,
      { text: notes, generationMode: "full", requestId },
      409,
    );
    await stop();
    await start();
    assert.equal((await request("/api/account")).user.available, 19);
    assert.equal(
      (await request(`/api/projects/${project.id}`)).slides[0].image,
      before.slides[0].image,
    );
    assert.equal(
      prompts.length,
      1,
      "Restart must not generate any image automatically",
    );
    const finishJob = await request(
      `/api/projects/${project.id}/render`,
      { slideIds: before.slides.map((s) => s.id), redesign: false },
      202,
    );
    await finished(finishJob.id);
    const after = await request(`/api/projects/${project.id}`);
    assert.equal(prompts.length, 3);
    assert.equal(after.slides.filter((s) => s.image).length, 3);
    assert.equal(after.slides[0].image, before.slides[0].image);
    assert.deepEqual(after.slides[0].versions, before.slides[0].versions);
    assert.equal(after.slides.map((s) => s.notes).join(""), notes);
    const noOp = await request(
      `/api/projects/${project.id}/render`,
      { slideIds: after.slides.map((s) => s.id), redesign: false },
      202,
    );
    await finished(noOp.id);
    assert.equal(
      prompts.length,
      3,
      "Completion retries only fill missing images",
    );
    const account = await request("/api/account");
    assert.equal(account.user.available, 17);
    assert.equal(account.user.held, 0);
  },
);
