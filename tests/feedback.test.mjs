import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
const output = await build({
  entryPoints: ["src/Feedback.tsx"],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
  packages: "external",
  loader: { ".css": "empty" },
});
// Resolve React from the repository, including when the test uses an in-memory module.
const code = output.outputFiles[0].text.replace(
  /from "([^".][^"]*)"/g,
  (_, name) => `from ${JSON.stringify(import.meta.resolve(name))}`,
);
const { Feedback } = await import(
  `data:text/javascript,${encodeURIComponent(code)}`
);
test("feedback roles are restrained, blocking has exactly one repair, risk is described before a decision", () => {
  for (const [kind, role] of [
    ["blocking", "alert"],
    ["risk", "note"],
    ["recommendation", "note"],
    ["teaching", "note"],
    ["success", "status"],
  ]) {
    const html = renderToStaticMarkup(
      createElement(
        Feedback,
        {
          kind,
          title: "反馈标题",
          action:
            kind === "blocking"
              ? { label: "连接模型", onClick() {} }
              : undefined,
          onDismiss: kind === "teaching" ? () => {} : undefined,
        },
        "反馈原因",
      ),
    );
    assert.match(html, new RegExp(`role="${role}"`));
    assert.match(html, /aria-describedby=/);
    assert.equal(
      (html.match(/>连接模型</g) || []).length,
      kind === "blocking" ? 1 : 0,
    );
    assert.equal(
      (html.match(/role="alert"/g) || []).length,
      kind === "blocking" ? 1 : 0,
    );
    if (kind === "teaching") assert.match(html, /关闭提示/);
    if (kind === "success") assert.match(html, /aria-live="polite"/);
  }
});

test("downloads reject empty/JSON/wrong archive responses and error feedback removes internal identifiers", async () => {
  const built = await build({
    entryPoints: ["src/api.ts"],
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
  });
  const { downloadFile, userMessage } = await import(
    `data:text/javascript,${encodeURIComponent(built.outputFiles[0].text)}`
  );
  const fetchBefore = globalThis.fetch;
  try {
    for (const response of [
      new Response("", { headers: { "Content-Type": "application/zip" } }),
      new Response('{"message":"started"}', {
        headers: { "Content-Type": "application/json" },
      }),
      new Response("<html>error</html>", {
        headers: { "Content-Type": "text/html" },
      }),
    ]) {
      globalThis.fetch = async () => response;
      await assert.rejects(
        downloadFile("/fixture", "project.zip"),
        /未收到|不完整/,
      );
    }
    for (const message of [
      "provider failure",
      "worker timeout",
      "requestId=private",
      "/Users/private/file",
      "C:\\Users\\private",
      "Authorization: Bearer secret",
      "API Key is secret",
    ]) {
      assert.equal(
        userMessage(message),
        "操作没有完成，请检查当前内容后重试。",
      );
    }
    assert.equal(userMessage("请先补齐页面。"), "请先补齐页面。");
  } finally {
    globalThis.fetch = fetchBefore;
  }
});

test("downloadFile returns exactly the response filename assigned to the browser download", async () => {
  const built = await build({
    entryPoints: ["src/api.ts"],
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
  });
  const { downloadFile } = await import(
    `data:text/javascript,${encodeURIComponent(built.outputFiles[0].text)}`
  );
  const before = {
    fetch: globalThis.fetch,
    document: globalThis.document,
    setTimeout: globalThis.setTimeout,
  };
  const link = {
    click() {
      this.clicked = true;
    },
    remove() {},
  };
  globalThis.document = {
    createElement: () => link,
    body: { appendChild() {} },
  };
  globalThis.setTimeout = (fn) => {
    fn();
    return 0;
  };
  try {
    for (const [disposition, expected] of [
      [
        "attachment; filename=\"fallback.zip\"; filename*=UTF-8''%E6%BC%94%E8%AE%B2-v7.autoppt.zip",
        "演讲-v7.autoppt.zip",
      ],
      ['attachment; filename="actual-v8.zip"', "actual-v8.zip"],
      ["", "fallback.zip"],
    ]) {
      globalThis.fetch = async () =>
        new Response(new Uint8Array([0x50, 0x4b, 3, 4]), {
          headers: {
            "Content-Type": "application/zip",
            "Content-Disposition": disposition,
          },
        });
      assert.equal(await downloadFile("/fixture", "fallback.zip"), expected);
      assert.equal(link.download, expected);
      assert.equal(link.clicked, true);
    }
  } finally {
    Object.assign(globalThis, before);
  }
});
