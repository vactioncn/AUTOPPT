import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  statSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fork } from "node:child_process";
import { once } from "node:events";
import http from "node:http";
import { ModelServices } from "../server/hosted/model-services.mjs";
import { workspaceTarget } from "../shared/web-routes.mjs";

test("model services inherit both secrets, retain blank keys, persist privately and reject stale/unsafe edits", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "autoppt-model-config-"));
  try {
    writeFileSync(path.join(dir, "text-key"), "text-secret");
    const config = new ModelServices(dir, {
      AUTOPPT_TEXT_API_KEY_FILE: path.join(dir, "text-key"),
      AUTOPPT_IMAGE_API_KEY: "image-secret",
    });
    assert(!existsSync(config.file));
    assert(config.public().text.hasKey && config.public().image.hasKey);
    assert(!JSON.stringify(config.public()).includes("secret"));
    const draft = {
      ...config.public().text,
      revision: 0,
      model: "new-text",
      apiKey: "",
    };
    assert.throws(
      () =>
        config.save("text", {
          ...draft,
          baseUrl: "https://different.example/v1",
        }),
      /新地址/,
    );
    assert.throws(
      () =>
        config.save("text", {
          ...draft,
          baseUrl: "http://remote.example/v1",
          apiKey: "new-key",
        }),
      /HTTPS/,
    );
    assert.throws(
      () =>
        config.save("text", {
          ...draft,
          baseUrl: "https://host/v1?key=secret",
        }),
      /查询/,
    );
    assert(!existsSync(config.file));
    const saved = config.save("text", draft);
    assert.equal(saved.revision, 1);
    assert.equal(config.providers.text.apiKey, "text-secret");
    assert.equal(config.providers.image.apiKey, "image-secret");
    assert.equal(statSync(config.file).mode & 0o777, 0o600);
    assert.throws(() => config.save("text", draft), /配置已更新/);
    const restored = new ModelServices(dir, {
      AUTOPPT_TEXT_API_KEY: "wrong-environment",
    });
    assert.equal(restored.providers.text.model, "new-text");
    assert.equal(restored.providers.text.apiKey, "text-secret");
    assert.equal(restored.providers.image.apiKey, "image-secret");
    restored.save("image", {
      ...restored.public().image,
      revision: 1,
      apiKey: "replacement-secret",
    });
    assert.equal(
      new ModelServices(dir, {}).providers.image.apiKey,
      "replacement-secret",
    );
    writeFileSync(config.file, "{}");
    assert.throws(() => new ModelServices(dir, {}), /不会改用空配置/);
    assert.equal(workspaceTarget("#admin/models"), "admin/models");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test(
  "admin model HTTP permissions, idle gate, live worker replacement and persistence use the same workspace",
  { timeout: 45000 },
  async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "autoppt-admin-models-"));
    let hold = false,
      release,
      entered,
      child;
    const seen = [];
    const provider = http.createServer(async (req, res) => {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      seen.push({
        method: req.method,
        path: req.url,
        auth: req.headers.authorization,
        body: chunks.length ? JSON.parse(Buffer.concat(chunks)) : null,
      });
      if (hold) {
        entered();
        await new Promise((r) => {
          release = r;
        });
      }
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify(
          req.method === "GET"
            ? { data: [] }
            : {
                choices: [
                  {
                    message: {
                      content: JSON.stringify({ brief: "Mock audience brief" }),
                    },
                  },
                ],
              },
        ),
      );
    });
    provider.listen(0, "127.0.0.1");
    await once(provider, "listening");
    const socket = http.createServer();
    socket.listen(0, "127.0.0.1");
    await once(socket, "listening");
    const port = socket.address().port;
    await new Promise((r) => socket.close(r));
    const origin = `http://127.0.0.1:${port}`,
      baseUrl = `http://127.0.0.1:${provider.address().port}/v1`;
    const start = async () => {
      child = fork("server/hosted/index.mjs", [], {
        env: {
          ...process.env,
          HOST: "127.0.0.1",
          PORT: String(port),
          AUTOPPT_HOSTED_DATA_DIR: dir,
          AUTOPPT_PUBLIC_URL: origin,
          AUTOPPT_ADMIN_PASSWORD: "test-password",
          AUTOPPT_ADMIN_PASSWORD_FILE: "",
          AUTOPPT_TEXT_API_KEY_FILE: "",
          AUTOPPT_IMAGE_API_KEY_FILE: "",
          AUTOPPT_TEXT_BASE_URL: baseUrl,
          AUTOPPT_IMAGE_BASE_URL: baseUrl,
          AUTOPPT_TEXT_API_KEY: "old-text-secret",
          AUTOPPT_IMAGE_API_KEY: "old-image-secret",
          AUTOPPT_TEXT_MODEL: "text-before",
          AUTOPPT_IMAGE_MODEL: "image-before",
        },
        stdio: ["ignore", "ignore", "pipe", "ipc"],
      });
      let log = "";
      child.stderr.on("data", (c) => {
        log += c;
      });
      await Promise.race([
        once(child, "message"),
        once(child, "exit").then(() => {
          throw Error(log);
        }),
      ]);
    };
    const stop = async () => {
      if (child?.exitCode === null) {
        const done = once(child, "exit");
        child.kill("SIGTERM");
        await done;
      }
    };
    const req = async (
      route,
      { body, cookie = "", status = 200, from = origin } = {},
    ) => {
      const response = await fetch(origin + "/api" + route, {
        method: body ? "POST" : "GET",
        headers: {
          Origin: from,
          Cookie: cookie,
          "Content-Type": "application/json",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const data = await response.json();
      assert.equal(response.status, status, JSON.stringify(data));
      assert(
        !JSON.stringify(data).includes("-secret"),
        "provider keys must not be returned",
      );
      return {
        data,
        cookie: response.headers.get("set-cookie")?.split(";")[0],
      };
    };
    try {
      await start();
      await req("/admin/models", { status: 401 });
      const { cookie: admin } = await req("/account/login", {
        body: { name: "admin", password: "test-password" },
      });
      const invite = (await req("/admin/invites", { cookie: admin, body: {} }))
        .data;
      const { cookie: member } = await req("/account/register", {
        body: {
          name: "member",
          password: "test-password",
          invite: invite.code,
        },
      });
      await req("/admin/models", { cookie: member, status: 403 });
      await req("/admin/models/text", {
        cookie: member,
        body: {},
        status: 403,
      });
      await req("/admin/models/text/test", {
        cookie: member,
        body: {},
        status: 403,
      });
      let snapshot = (await req("/admin/models", { cookie: admin })).data;
      const draft = {
        baseUrl,
        model: "text-after",
        apiKey: "",
        revision: snapshot.revision,
      };
      await req("/admin/models/text", {
        cookie: admin,
        body: draft,
        from: "https://other.example",
        status: 403,
      });
      const project = (
        await req("/projects", {
          cookie: admin,
          body: { title: "Keep this project" },
          status: 201,
        })
      ).data;
      const before = (await req("/bootstrap", { cookie: admin })).data;
      hold = true;
      const inProvider = new Promise((r) => {
        entered = r;
      });
      const pending = req("/design-options/audience", {
        cookie: admin,
        body: { description: "mock busy request" },
      });
      await inProvider;
      await req("/admin/models/text", {
        cookie: admin,
        body: draft,
        status: 409,
      });
      assert.equal(
        (await req("/admin/models", { cookie: admin })).data.revision,
        0,
      );
      hold = false;
      release();
      await pending;
      snapshot = (
        await req("/admin/models/text", { cookie: admin, body: draft })
      ).data;
      assert.equal(snapshot.text.model, "text-after");
      assert.equal(snapshot.image.model, "image-before");
      const after = (await req("/bootstrap", { cookie: admin })).data;
      assert.deepEqual(after.projects, before.projects);
      assert.deepEqual(after.styles, before.styles);
      assert.equal(after.settings.text.model, "text-after");
      await req("/design-options/audience", {
        cookie: admin,
        body: { description: "mock new model request" },
      });
      assert.equal(seen.at(-1).body.model, "text-after");
      assert.equal(seen.at(-1).auth, "Bearer old-text-secret");
      await req("/admin/models/image", {
        cookie: admin,
        body: {
          ...snapshot.image,
          revision: 1,
          model: "image-after",
          apiKey: "new-image-secret",
        },
      });
      const updated = (await req("/bootstrap", { cookie: admin })).data;
      assert.equal(updated.settings.image.model, "image-after");
      await req("/admin/models/image/test", {
        cookie: admin,
        body: { baseUrl, model: "image-after", apiKey: "", revision: 2 },
      });
      assert.deepEqual(seen.at(-1), {
        method: "GET",
        path: "/v1/models",
        auth: "Bearer new-image-secret",
        body: null,
      });
      await stop();
      await start();
      snapshot = (await req("/admin/models", { cookie: admin })).data;
      assert.equal(snapshot.text.model, "text-after");
      assert.equal(snapshot.image.model, "image-after");
      assert.equal(
        (await req("/projects/" + project.id, { cookie: admin })).data.title,
        "Keep this project",
      );
      assert.equal(
        JSON.parse(readFileSync(path.join(dir, "model-services.json"))).text
          .apiKey,
        "old-text-secret",
      );
    } finally {
      release?.();
      await stop();
      provider.closeAllConnections();
      await new Promise((r) => provider.close(r));
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
