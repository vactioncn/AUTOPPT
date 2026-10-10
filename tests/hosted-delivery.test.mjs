import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { tmpdir } from "node:os";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  rmSync,
  copyFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import JSZip from "jszip";
import { Accounts } from "../server/hosted/accounts.mjs";
import { acquireLock } from "../server/hosted/process-lock.mjs";
import { backupHosted, restoreHosted } from "../scripts/hosted-backup.mjs";
import { deploymentPaths, packageWeb } from "../scripts/package-web.mjs";
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
test("offline backup restores accounts, sessions and user assets to a new volume without overwriting originals", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "autoppt-backup-test-"));
  const source = path.join(root, "source"),
    target = path.join(root, "target"),
    backup = path.join(root, "saved.tar.gz");
  mkdirSync(target);
  let account;
  try {
    account = new Accounts(source);
    await account.bootstrap("admin", "Backup-password-12345");
    const admin = await account.login("admin", "Backup-password-12345");
    const member = await account.register(
      "member",
      "Backup-password-12345",
      account.invite(admin.id).code,
    );
    const cookie = account.session(member.id);
    const userDir = path.join(source, "users", member.id);
    mkdirSync(path.join(userDir, "assets"), { recursive: true });
    const workspace = new DatabaseSync(path.join(userDir, "autoppt.sqlite"));
    workspace.exec(
      "CREATE TABLE saved(project TEXT); INSERT INTO saved VALUES('keep my project');",
    );
    workspace.close();
    writeFileSync(path.join(userDir, "assets", "picture.jpg"), "asset bytes");
    account.db.close();
    account = null;
    const first = await backupHosted(source, backup);
    assert.equal(first.databases, 2);
    const before = sha(readFileSync(path.join(source, "accounts.sqlite")));
    const restored = await restoreHosted(target, backup);
    assert.equal(restored.databases, 2);
    assert.equal(
      sha(readFileSync(path.join(source, "accounts.sqlite"))),
      before,
    );
    assert.equal(
      readFileSync(
        path.join(target, "users", member.id, "assets", "picture.jpg"),
        "utf8",
      ),
      "asset bytes",
    );
    account = new Accounts(target);
    assert.equal(account.authenticate(cookie).available, 20);
    account.db.close();
    account = null;
    await assert.rejects(restoreHosted(target, backup), /空数据目录/);
    await assert.rejects(backupHosted(source, backup), /不覆盖/);
    const corrupt = path.join(root, "corrupt.tar.gz");
    writeFileSync(corrupt, "corrupt bytes");
    writeFileSync(corrupt + ".json", readFileSync(backup + ".json"));
    const empty = path.join(root, "empty");
    mkdirSync(empty);
    await assert.rejects(restoreHosted(empty, corrupt), /校验失败/);
    assert.deepEqual(readdirSync(empty), []);
    acquireLock(path.join(source, "hosted.lock"));
    // A known live process lock is rejected conservatively on every platform.
    await assert.rejects(
      backupHosted(source, path.join(root, "locked.tar.gz")),
      /正常停止/,
    );
  } finally {
    account?.db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
test("deployment preflight validates required settings without revealing secrets or calling a provider", () => {
  const root = mkdtempSync(path.join(tmpdir(), "autoppt-preflight-"));
  try {
    const deploy = path.join(root, "deploy");
    mkdirSync(path.join(deploy, "secrets"), { recursive: true });
    copyFileSync(new URL("../deploy/check.mjs", import.meta.url), path.join(deploy, "check.mjs"));
    const env = readFileSync(new URL("../deploy/.env.example", import.meta.url), "utf8")
      .replace("ppt.example.com", "ppt.fixture.invalid") + "\nAUTOPPT_BUILD_GIT_SHA=" + "a".repeat(40) + "\n";
    writeFileSync(path.join(deploy, ".env"), env);
    const privateValue = "Do-not-print-this-fixture-secret";
    for (const name of ["admin_password", "text_key", "image_key"])
      writeFileSync(path.join(deploy, "secrets", name), privateValue);
    const run = () => execFileSync(process.execPath, [path.join(deploy, "check.mjs")], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    assert.match(run(), /检查通过/);
    writeFileSync(path.join(deploy, ".env"), env.replace("AUTOPPT_MODEL_CONCURRENCY=2", "AUTOPPT_MODEL_CONCURRENCY=0"));
    assert.throws(run, (error) => {
      assert.match(error.stderr, /AUTOPPT_MODEL_CONCURRENCY/);
      assert(!error.stderr.includes(privateValue));
      return error.status === 1;
    });
    writeFileSync(path.join(deploy, ".env"), env);
    rmSync(path.join(deploy, "secrets", "image_key"));
    assert.throws(run, (error) => {
      assert.match(error.stderr, /secrets\/image_key/);
      assert(!error.stderr.includes(privateValue));
      return error.status === 1;
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("source package freezes a clean commit, hashes files, excludes local secrets and refuses tracked secrets", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "autoppt-web-package-"));
  const git = (...args) =>
    execFileSync("git", args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  try {
    const folders = new Set([
      "src",
      "server",
      "shared",
      "public",
      "site",
      "scripts",
      "tests",
      "deploy",
    ]);
    for (const entry of deploymentPaths) {
      const file = path.join(
        root,
        folders.has(entry) ? entry + "/fixture.txt" : entry,
      );
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, "fixture\n");
    }
    writeFileSync(
      path.join(root, "deploy/.env.example"),
      "AUTOPPT_SIGNUP_IMAGE_CREDITS=20\n",
    );
    git("init", "-q");
    git("add", "--", ...deploymentPaths);
    const commit = () =>
      git(
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.invalid",
        "commit",
        "-qm",
        "fixture",
      );
    commit();
    mkdirSync(path.join(root, "deploy/secrets"));
    writeFileSync(
      path.join(root, "deploy/secrets/image_key"),
      "private-not-for-package",
    );
    mkdirSync(path.join(root, ".local"));
    writeFileSync(path.join(root, ".local/user-project"), "keep me");
    const result = await packageWeb({ root });
    const zip = await JSZip.loadAsync(readFileSync(result.output), {
      checkCRC32: true,
    });
    assert.equal(sha(readFileSync(result.output)), result.sha256);
    assert(
      !Object.keys(zip.files).some(
        (name) => name.includes("secrets") || name.includes(".local"),
      ),
    );
    const manifest = JSON.parse(
      await zip.file("AutoPPT-Web/RELEASE.json").async("string"),
    );
    assert.equal(manifest.gitSha, git("rev-parse", "HEAD").toString().trim());
    for (const file of manifest.files)
      assert.equal(
        sha(await zip.file("AutoPPT-Web/" + file.path).async("nodebuffer")),
        file.sha256,
      );
    await assert.rejects(packageWeb({ root }), /EEXIST/);
    writeFileSync(path.join(root, "README.md"), "changed");
    await assert.rejects(packageWeb({ root }), /干净提交/);
    git("add", "README.md", "deploy/secrets/image_key");
    commit();
    await assert.rejects(packageWeb({ root }), /不能包含个人数据或密钥/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
