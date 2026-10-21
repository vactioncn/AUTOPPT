import test from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import sharp from "sharp";
import {
  observationsFixture,
  creationFixture,
} from "./fixtures/style-creation.mjs";
import { STYLE_WRITING_EXAMPLES } from "../server/style-writing-examples.mjs";

test(
  "style upload and refinement use four examples, save dynamic chapters and preserve prior results on failure",
  { timeout: 30000 },
  async (t) => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "autoppt-four-examples-"));
    const provider = express();
    provider.use(express.json({ limit: "25mb" }));
    const calls = [];
    let failAuthor = false;
    provider.post("/v1/chat/completions", (req, res) => {
      const content = req.body.messages[1].content,
        input = JSON.parse(content[0].text);
      const refs = content.filter((part) => part.type === "image_url").length;
      const observing =
        req.body.messages[0].content.includes("本阶段只做参考图视觉观察");
      calls.push({ observing, input, refs });
      res.json({
        choices: [
          {
            message: {
              content: JSON.stringify(
                observing
                  ? observationsFixture(refs)
                  : failAuthor
                    ? { description: "incomplete" }
                    : creationFixture(),
              ),
            },
          },
        ],
      });
    });
    const model = provider.listen(0, "127.0.0.1");
    await once(model, "listening");
    writeFileSync(
      path.join(dir, "settings.json"),
      JSON.stringify({
        text: {
          baseUrl: `http://127.0.0.1:${model.address().port}/v1`,
          model: "custom-provider-alias",
          apiKey: "local-fixture",
        },
      }),
    );
    const child = fork("server/index.mjs", [], {
      env: {
        ...process.env,
        AUTOPPT_DATA_DIR: dir,
        PORT: "0",
        NODE_ENV: "production",
        AUTOPPT_WORKER_TOKEN: "",
        AUTOPPT_DESKTOP_TOKEN: "",
      },
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    });
    let errors = "";
    child.stderr.on("data", (part) => {
      errors += part;
    });
    t.after(async () => {
      child.kill("SIGTERM");
      await once(child, "exit");
      await new Promise((resolve) => model.close(resolve));
      rmSync(dir, { recursive: true, force: true });
    });
    const [ready] = await once(child, "message");
    assert.equal(ready.type, "ready", errors);
    const base = `http://127.0.0.1:${ready.port}`;
    const read = async (url) => {
      const response = await fetch(base + url);
      assert(response.ok);
      return response.json();
    };
    const original = (await read("/api/bootstrap")).styles;
    const form = new FormData(),
      image = await sharp({
        create: {
          width: 1600,
          height: 900,
          channels: 3,
          background: "#f8e8cd",
        },
      })
        .jpeg()
        .toBuffer();
    form.append(
      "images",
      new Blob([image], { type: "image/jpeg" }),
      "reference.jpg",
    );
    form.append(
      "images",
      new Blob([image], { type: "image/jpeg" }),
      "reference-two.jpg",
    );
    const response = await fetch(base + "/api/styles", {
      method: "POST",
      body: form,
    });
    assert.equal(response.status, 201);
    const created = await response.json();
    async function finished(id) {
      for (let i = 0; i < 150; i++) {
        const job = (await read("/api/jobs")).find((j) => j.id === id);
        if (["completed", "failed"].includes(job?.status)) return job;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      assert.fail("style job did not finish: " + errors);
    }
    assert.equal((await finished(created.job.id)).status, "completed");
    const current = (await read("/api/bootstrap")).styles.find(
      (s) => s.id === created.style.id,
    );
    assert.deepEqual(
      calls.map((c) => c.refs),
      [2, 2],
    );
    assert.deepEqual(calls[1].input.writingExamples, STYLE_WRITING_EXAMPLES);
    assert.equal(calls[1].input.template, undefined);
    assert.equal(current.styleAnalysis.styles[0].writingExamples.length, 4);
    assert.match(current.rules, /暖纸与透明笔触的视觉世界/);
    assert(!current.rules.includes("【每页生成底线】"));
    const versions = await read(`/api/styles/${current.id}/versions`);
    failAuthor = true;
    const retry = await fetch(base + `/api/styles/${current.id}/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feedback: "保留当前成果" }),
    });
    assert.equal(retry.status, 202);
    assert.equal((await finished((await retry.json()).id)).status, "failed");
    const after = (await read("/api/bootstrap")).styles;
    assert.equal(after.find((s) => s.id === current.id).rules, current.rules);
    assert.deepEqual(after.find((s) => s.id === current.id).refs, current.refs);
    assert.deepEqual(
      await read(`/api/styles/${current.id}/versions`),
      versions,
    );
    assert.deepEqual(
      after.filter((s) => s.id !== current.id),
      original,
    );
  },
);
