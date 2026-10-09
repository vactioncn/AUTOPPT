import { RELEASE_STYLES } from "../shared/builtin-style-catalog.mjs";
import { createHash } from "node:crypto";
import { fork } from "node:child_process";
import { once } from "node:events";
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { readBuildInfo } from "../server/build-info.mjs";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";

export async function verifyMacApp(appPath) {
  const root = path.join(appPath, "Contents/Resources/app");
  const expectedBuild = readBuildInfo();
  assert.equal(expectedBuild.runtimeMode, "desktop");
  assert.deepEqual(readBuildInfo(root), expectedBuild);
  assert.deepEqual(
    JSON.parse(readFileSync(path.join(root, "dist/build-info.json"), "utf8")),
    expectedBuild,
  );
  const frontend = readdirSync(path.join(root, "dist/assets"))
    .filter((n) => /^index-.*\.js$/.test(n))
    .map((n) => readFileSync(path.join(root, "dist/assets", n), "utf8"))
    .join("\n");
  for (const key of ["gitSha", "buildTime", "appVersion"])
    assert.ok(frontend.includes(expectedBuild[key]), `前端构建缺少 ${key}`);
  assert.ok(frontend.includes("HeyGen"), "Mac App 前端缺少数字人设置入口");
  assert.ok(
    frontend.includes("数字人工作室") && frontend.includes("生成本页讲解"),
    "Mac App 前端缺少项目数字人入口",
  );
  assert.ok(
    frontend.includes("生成本页数字人口型"),
    "Mac App 前端缺少口型生成入口",
  );
  assert.ok(
    frontend.includes("生成整场数字人讲解"),
    "Mac App 前端缺少整场生成入口",
  );
  assert.ok(
    readFileSync(path.join(root, "desktop/context-menu.cjs"), "utf8").includes(
      "复制图片",
    ),
    "Mac App 缺少原生图片复制菜单",
  );
  for (const privateName of [".local", ".hosted", ".env", "deploy", "tests"])
    assert(
      !existsSync(path.join(root, privateName)),
      `不应打包 ${privateName}`,
    );
  const temp = mkdtempSync(path.join(os.tmpdir(), "autoppt-package-"));
  const child = fork(path.join(root, "server/index.mjs"), [], {
    execPath: path.join(appPath, "Contents/MacOS/AutoPPT"),
    execArgv: [],
    cwd: root,
    silent: true,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      TMPDIR: os.tmpdir(),
      ELECTRON_RUN_AS_NODE: "1",
      NODE_ENV: "production",
      PORT: "0",
      AUTOPPT_DATA_DIR: temp,
      AUTOPPT_DESKTOP_TOKEN: "package-verification-only",
    },
  });
  let errors = "";
  child.stderr.on("data", (chunk) => {
    errors += chunk;
  });
  let timer;
  try {
    const ready = new Promise((resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error("App 内置后端启动超时")),
        20000,
      );
      child.once("error", reject);
      child.once("exit", (code) =>
        reject(new Error(`App 内置后端退出 ${code}: ${errors}`)),
      );
      child.once("message", resolve);
    });
    const { port } = await ready;
    const url = `http://127.0.0.1:${port}`;
    const headers = { "X-AutoPPT-Desktop": "package-verification-only" };
    assert.equal((await fetch(url)).status, 403);
    const data = await (
      await fetch(url + "/api/bootstrap", { headers })
    ).json();
    assert.deepEqual(data.buildInfo, expectedBuild);
    assert.equal(data.dataRootLabel, "Mac App 独立工作区");
    assert.equal(data.capabilities.localModelSettings.enabled, true);
    assert.equal(data.projects.length, 0);
    assert.ok(data.styles.some((s) => s.name === "克制儿童摄影杂志风"));
    assert.equal(data.styles.length, 13);
    assert.equal(data.settings.image.hasKey, false);
    assert.equal(data.settings.text.hasKey, false);
    const presenterUrl = url + "/api/settings/presenter";
    const presenterHeaders = { ...headers, "Content-Type": "application/json" };
    const emptyPresenterSettings = {
      provider: "heygen",
      hasKey: false,
      generationAvailable: true,
    };
    assert.equal((await fetch(presenterUrl)).status, 403);
    assert.deepEqual(
      await (await fetch(presenterUrl, { headers })).json(),
      emptyPresenterSettings,
    );
    const savedPresenter = await fetch(presenterUrl, {
      method: "PUT",
      headers: presenterHeaders,
      body: JSON.stringify({ apiKey: "synthetic-package-check-only" }),
    });
    assert.equal(savedPresenter.status, 200);
    assert.deepEqual(await savedPresenter.json(), {
      ...emptyPresenterSettings,
      hasKey: true,
    });
    const clearedPresenter = await fetch(presenterUrl, {
      method: "PUT",
      headers: presenterHeaders,
      body: JSON.stringify({ clearKey: true }),
    });
    assert.deepEqual(await clearedPresenter.json(), emptyPresenterSettings);
    const missingPresenter = await fetch(presenterUrl + "/test", {
      method: "POST",
      headers: presenterHeaders,
    });
    assert.equal(missingPresenter.status, 200);
    assert.equal((await missingPresenter.json()).ok, false);
    const projectResponse = await fetch(url + "/api/projects", {
      method: "POST",
      headers: presenterHeaders,
      body: JSON.stringify({
        title: "安装包数字人配置验证",
        styleId: data.styles[0].id,
      }),
    });
    assert.equal(projectResponse.status, 201);
    const project = await projectResponse.json();
    const projectSetupUrl = `${url}/api/projects/${project.id}/presenter/setup`;
    const studioUrl = url + "/api/presenter/studio";
    assert.equal((await fetch(studioUrl)).status, 403);
    const studio = await (await fetch(studioUrl, { headers })).json();
    assert.deepEqual(studio.avatars, []);
    assert.deepEqual(
      studio.styles.map((s) => s.id),
      ["original", "professional", "cartoon", "costume"],
    );
    assert.equal(
      (
        await fetch(url + "/api/presenter/previews", {
          method: "POST",
          headers: presenterHeaders,
          body: JSON.stringify({ confirmed: false }),
        })
      ).status,
      400,
    );
    assert.equal((await fetch(projectSetupUrl)).status, 403);
    const projectSetup = await (
      await fetch(projectSetupUrl, { headers })
    ).json();
    assert.equal(projectSetup.generationAvailable, true);
    assert.deepEqual(projectSetup.setup, {
      avatarId: "",
      narrationId: "",
      placement: "bottom-right",
      size: "small",
    });
    const savedSetup = await fetch(projectSetupUrl, {
      method: "PUT",
      headers: presenterHeaders,
      body: JSON.stringify({
        ...projectSetup.setup,
        placement: "top-left",
        size: "large",
      }),
    });
    assert.equal(savedSetup.status, 200);
    assert.equal((await savedSetup.json()).setup.placement, "top-left");
    const generationUrl = `${url}/api/projects/${project.id}/presenter/generations`;
    assert.equal((await fetch(generationUrl)).status, 403);
    assert.deepEqual(
      await (await fetch(generationUrl, { headers })).json(),
      [],
    );
    assert.equal(
      (
        await fetch(generationUrl, {
          method: "POST",
          headers: presenterHeaders,
          body: JSON.stringify({ confirmed: false }),
        })
      ).status,
      400,
    );
    assert.equal(
      (await (await fetch(projectSetupUrl, { headers })).json()).setup.size,
      "large",
    );
    const unchanged = await (
      await fetch(`${url}/api/projects/${project.id}`, { headers })
    ).json();
    assert.equal(unchanged.revision, project.revision);
    assert.deepEqual(unchanged.slides, project.slides);
    for (const expected of RELEASE_STYLES) {
      const style = data.styles.find((s) => s.id === expected.id);
      assert.equal(style?.name, expected.name);
      assert.equal(style?.builtin, true);
      assert.deepEqual(style?.refs, []);
      assert.equal(
        createHash("sha256").update(style.rules).digest("hex"),
        expected.promptSha256,
      );
      const cover = await fetch(url + expected.cover, { headers });
      assert.equal(cover.status, 200);
      assert.equal(
        createHash("sha256")
          .update(Buffer.from(await cover.arrayBuffer()))
          .digest("hex"),
        expected.coverSha256,
      );
    }
    assert.equal((await fetch(url, { headers })).status, 200);
    assert.equal(
      (await (await fetch(url + "/api/account", { headers })).json()).hosted,
      false,
    );
    assert.equal(
      (await (await fetch(url + "/api/desktop/status", { headers })).json())
        .activeJobs,
      0,
    );
    console.log(
      "安装包验证通过：自带运行环境、13 个内置风格及 8 个新增封面逐一校验、免登录、独立空工作区、私有本机接口。",
    );
    console.log(
      `安装包 buildInfo 与源码构建、前端资源、内置后端一致：${JSON.stringify(expectedBuild)}`,
    );
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill();
      await exited;
    }
    rmSync(temp, { recursive: true, force: true });
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename)
  await verifyMacApp(path.resolve(process.argv[2]));
