import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  copyFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

const root = path.resolve(import.meta.dirname, "..");
const actualRsync = execFileSync("which", ["rsync"], {
  encoding: "utf8",
}).trim();

function fixture(extra = {}) {
  const temp = mkdtempSync(path.join(tmpdir(), "autoppt-publish-test-"));
  const local = path.join(temp, "Mac's project");
  const remote = path.join(temp, "server");
  const bin = path.join(temp, "bin");
  const data = path.join(temp, "data");
  const log = path.join(temp, "commands.jsonl");
  for (const folder of [local, remote, bin, data])
    mkdirSync(folder, { recursive: true });
  for (const file of [
    "scripts/deploy-server.sh",
    "scripts/deploy-remote.sh",
    "deploy/rsync.exclude",
  ]) {
    const to = path.join(local, file);
    mkdirSync(path.dirname(to), { recursive: true });
    copyFileSync(path.join(root, file), to);
  }
  mkdirSync(path.join(remote, "deploy/secrets"), { recursive: true });
  mkdirSync(path.join(remote, "music"));
  writeFileSync(path.join(remote, "deploy/.env"), "SERVER_CONFIG=keep\n");
  writeFileSync(path.join(remote, "deploy/secrets/image_key"), "SERVER_KEY");
  writeFileSync(path.join(remote, "music/track.mp3"), "music");
  writeFileSync(path.join(remote, "obsolete.mjs"), "old");
  writeFileSync(
    path.join(remote, "deploy/compose.nginx.yaml"),
    "existing config",
  );
  writeFileSync(
    path.join(local, "deploy/compose.nginx.yaml"),
    "updated config",
  );
  writeFileSync(
    path.join(local, "deploy/.env"),
    "LOCAL_CONFIG=must-not-upload\n",
  );
  mkdirSync(path.join(local, "deploy/secrets"));
  writeFileSync(path.join(local, "deploy/secrets/image_key"), "LOCAL_KEY");
  writeFileSync(path.join(local, "tokenhub-adapter-v2.zip"), "archive");
  mkdirSync(path.join(local, "AutoPPTweb-codex"));
  writeFileSync(path.join(local, "AutoPPTweb-codex/old.mjs"), "old release");
  mkdirSync(path.join(remote, "deploy/fonts"));
  writeFileSync(
    path.join(remote, "deploy/fonts/font-1.fntdata"),
    "verified-font",
  );
  writeFileSync(
    path.join(remote, "AutoPPTweb-codex.tar.gz"),
    "original-release",
  );
  writeFileSync(path.join(local, "new.mjs"), "new committed code");
  execFileSync("git", ["init", "-q"], { cwd: local });
  execFileSync(
    "git",
    [
      "add",
      "scripts",
      "deploy/rsync.exclude",
      "deploy/compose.nginx.yaml",
      "new.mjs",
    ],
    { cwd: local },
  );
  execFileSync(
    "git",
    [
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "-qm",
      "initial",
    ],
    { cwd: local },
  );
  const nodeTool = (name, code) =>
    writeFileSync(path.join(bin, name), `#!${process.execPath}\n${code}`, {
      mode: 0o755,
    });
  nodeTool(
    "ssh",
    `
const {spawnSync}=require('child_process');
const r=spawnSync('bash',['-c',process.argv.at(-1)],{stdio:'inherit',env:process.env});process.exit(r.status??1);
`,
  );
  nodeTool(
    "rsync",
    `
const {spawnSync}=require('child_process');
const args=process.argv.slice(2).map(x=>x.startsWith('root@mock:')?x.slice('root@mock:'.length):x);
const r=spawnSync(${JSON.stringify(actualRsync)},args,{stdio:'inherit',env:process.env});process.exit(r.status??1);
`,
  );
  nodeTool(
    "curl",
    `
const fs=require('fs'),p=require('path'),a=process.argv.slice(2);
const out=a[a.indexOf('-o')+1],url=a.find(x=>x.startsWith('https://'));
let d=url.includes('/api/health')?{app:'AutoPPT',hosted:true,ok:true}:JSON.parse(fs.readFileSync(p.join(process.env.MOCK_ROOT,'build-info.json')));
if(process.env.FAIL_PUBLIC==='1'&&url.includes('build-info'))d.buildTime='old';
if(process.env.FAIL_MAC==='1'&&out.includes('autoppt-deploy.')&&url.includes('build-info'))d.gitSha='wrong';
fs.writeFileSync(out,JSON.stringify(d));
`,
  );
  nodeTool(
    "docker",
    `
const fs=require('fs'),p=require('path'),{spawnSync}=require('child_process');
const a=process.argv.slice(2),r=process.env.MOCK_ROOT;
fs.appendFileSync(process.env.MOCK_LOG,JSON.stringify(a)+'\\n');
const marker=p.join(r,'.deploy','mock-new');
if(a[0]==='ps'){console.log('old-app');process.exit(0);}
if(a[0]==='inspect'){
 const f=a[a.indexOf('-f')+1]||'';
 if(f.includes('.Image'))console.log('sha256:old');
 else if(f.includes('working_dir'))console.log(p.join(r,'deploy'));
 else if(f.includes('config_files'))console.log(p.join(r,'deploy/compose.nginx.yaml'));
 else if(f.includes('.Mounts'))console.log('autoppt-web_autoppt_data');
 else if(f.includes('.State.Health'))console.log(process.env.FAIL_HEALTH==='1'?'unhealthy':'healthy');
 process.exit(0);
}
if(a[0]==='image'||a[0]==='start')process.exit(0);
if(a[0]==='compose'){
 if(a[1]==='version')process.exit(0);
 const cmd=a.find(x=>['config','build','ps','stop','up','logs'].includes(x));
 if(cmd==='config'&&a.includes('json'))console.log(JSON.stringify({services:{app:{volumes:[{target:'/data',type:'volume',source:'autoppt_data'}],environment:{AUTOPPT_PUBLIC_URL:'https://aippt.pinguo.cn'}}},volumes:{autoppt_data:{name:process.env.FAIL_VOLUME==='1'?'wrong-volume':'autoppt-web_autoppt_data'}}}));
 if(cmd==='ps')console.log(exists(marker)?'new-app':'old-app');
 if(cmd==='build'){
  if(process.env.FAIL_BUILD==='1')process.exit(7);
  const args=a.filter(x=>x.startsWith('AUTOPPT_BUILD_')),info={runtimeMode:'hosted'};
  for(const v of args){const i=v.indexOf('=');info[v.slice(0,i)==='AUTOPPT_BUILD_GIT_SHA'?'gitSha':'buildTime']=v.slice(i+1);}
  fs.mkdirSync(p.join(r,'dist'),{recursive:true});for(const f of ['build-info.json','dist/build-info.json'])fs.writeFileSync(p.join(r,f),JSON.stringify(info));
 }
 if(cmd==='up')fs.writeFileSync(marker,'new');
 process.exit(0);
}
function exists(x){return fs.existsSync(x);}
if(a[0]==='run'){
 if(process.env.FAIL_BACKUP==='1')process.exit(9);
 const mount=a.find(x=>x.endsWith(':/backup')),folder=mount.slice(0,-8);
 fs.writeFileSync(p.join(folder,'data.tar.gz'),'backup');fs.writeFileSync(p.join(folder,'data.tar.gz.json'),'{}');process.exit(0);
}
if(a[0]==='exec'){
 if(a.includes('-p')){console.log('https://aippt.pinguo.cn');process.exit(0);}
 const index=a.indexOf('node');
 const result=spawnSync(${JSON.stringify(process.execPath)},a.slice(index+1),{cwd:r,env:{...process.env,AUTOPPT_HOSTED_DATA_DIR:process.env.MOCK_DATA,AUTOPPT_PUBLIC_URL:'https://aippt.pinguo.cn'},stdio:'inherit'});process.exit(result.status??1);
}
console.error('Unhandled docker command',a);process.exit(10);
`,
  );
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    AUTOPPT_DEPLOY_HOST: "root@mock",
    AUTOPPT_DEPLOY_ROOT: remote,
    MOCK_ROOT: remote,
    MOCK_LOG: log,
    MOCK_DATA: data,
    ...extra,
  };
  return {
    local,
    remote,
    data,
    log,
    run: (args = [], source = local) =>
      spawnSync(
        "bash",
        [path.join(source, "scripts/deploy-server.sh"), ...args],
        { env, encoding: "utf8", timeout: 30000 },
      ),
    commands: () =>
      existsSync(log)
        ? readFileSync(log, "utf8")
            .trim()
            .split("\n")
            .map((x) => JSON.parse(x))
        : [],
    close: () => rmSync(temp, { recursive: true, force: true }),
  };
}

test("dry-run changes no server files and does not build or stop containers", () => {
  const f = fixture();
  try {
    const r = f.run(["--dry-run"]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(
      readFileSync(path.join(f.remote, "obsolete.mjs"), "utf8"),
      "old",
    );
    assert.equal(existsSync(path.join(f.remote, ".deploy")), false);
    assert.equal(
      f.commands().some((a) => a.includes("build") || a.includes("stop")),
      false,
    );
  } finally {
    f.close();
  }
});
test("publishes committed code, excludes old releases, preserves secrets/fonts/music and verifies public version", () => {
  const f = fixture();
  try {
    const r = f.run();
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /发版成功/);
    assert.equal(
      readFileSync(path.join(f.remote, "deploy/.env"), "utf8"),
      "SERVER_CONFIG=keep\n",
    );
    assert.equal(
      readFileSync(path.join(f.remote, "deploy/secrets/image_key"), "utf8"),
      "SERVER_KEY",
    );
    assert.equal(
      readFileSync(path.join(f.remote, "music/track.mp3"), "utf8"),
      "music",
    );
    assert.equal(
      readFileSync(path.join(f.remote, "new.mjs"), "utf8"),
      "new committed code",
    );
    assert.equal(existsSync(path.join(f.remote, "AutoPPTweb-codex")), false);
    assert.equal(
      readFileSync(path.join(f.remote, "deploy/fonts/font-1.fntdata"), "utf8"),
      "verified-font",
    );
    assert.equal(
      readFileSync(path.join(f.remote, "AutoPPTweb-codex.tar.gz"), "utf8"),
      "original-release",
    );
    assert.equal(
      existsSync(path.join(f.remote, "tokenhub-adapter-v2.zip")),
      false,
    );
    assert.equal(existsSync(path.join(f.remote, "obsolete.mjs")), false);
    const release = readFileSync(
      path.join(f.remote, ".deploy/last-success"),
      "utf8",
    ).split(" ")[0];
    for (const file of [
      "source-before/obsolete.mjs",
      "data.tar.gz",
      "data.tar.gz.json",
      "success",
    ])
      assert.ok(
        existsSync(path.join(f.remote, ".deploy/releases", release, file)),
        file,
      );
    assert.equal(existsSync(path.join(f.remote, ".deploy/lock")), false);
    assert.equal(
      f.commands().some((a) => a.includes("web") || a.includes("down")),
      false,
    );
    const commands = f.commands();
    assert.ok(
      commands.findIndex((a) => a.includes("build")) <
        commands.findIndex((a) => a.includes("stop")),
    );
  } finally {
    f.close();
  }
});
test("uncommitted tracked code is rejected before contacting the server", () => {
  const f = fixture();
  try {
    writeFileSync(path.join(f.local, "new.mjs"), "unfinished edit");
    const r = f.run();
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /先验证并提交/);
    assert.equal(f.commands().length, 0);
  } finally {
    f.close();
  }
});
test("a nested old release cannot borrow the parent repository version", () => {
  const f = fixture();
  try {
    const nested = path.join(f.local, "AutoPPTweb-codex");
    mkdirSync(path.join(nested, "scripts"));
    copyFileSync(
      path.join(f.local, "scripts/deploy-server.sh"),
      path.join(nested, "scripts/deploy-server.sh"),
    );
    const r = f.run([], nested);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /旧发行目录/);
    assert.equal(f.commands().length, 0);
  } finally {
    f.close();
  }
});
for (const flag of [
  "FAIL_BUILD",
  "FAIL_VOLUME",
  "FAIL_BACKUP",
  "FAIL_HEALTH",
  "FAIL_PUBLIC",
  "FAIL_MAC",
]) {
  test(`${flag} refuses to report success and releases the lock`, () => {
    const f = fixture({ [flag]: "1" });
    try {
      const r = f.run();
      assert.notEqual(r.status, 0, r.stdout + r.stderr);
      assert.doesNotMatch(r.stdout, /发版成功/);
      assert.equal(
        existsSync(path.join(f.remote, ".deploy/last-success")),
        false,
      );
      assert.equal(existsSync(path.join(f.remote, ".deploy/lock")), false);
      if (["FAIL_BUILD", "FAIL_VOLUME"].includes(flag))
        assert.equal(
          f.commands().some((a) => a.includes("stop")),
          false,
        );
      if (flag === "FAIL_BACKUP") {
        assert.equal(
          f.commands().some((a) => a[0] === "start" && a[1] === "old-app"),
          true,
        );
        assert.equal(
          f.commands().some((a) => a.includes("up")),
          false,
        );
      }
    } finally {
      f.close();
    }
  });
}
test("active generation tasks prevent stopping the old service", () => {
  const f = fixture();
  try {
    mkdirSync(path.join(f.data, "users/test"), { recursive: true });
    const db = new DatabaseSync(path.join(f.data, "users/test/autoppt.sqlite"));
    db.exec("CREATE TABLE records(data TEXT)");
    db.prepare("INSERT INTO records VALUES(?)").run(
      JSON.stringify({ status: "running" }),
    );
    db.close();
    const r = f.run();
    assert.notEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stderr, /仍有 1 项任务/);
    assert.equal(
      f.commands().some((a) => a.includes("stop")),
      false,
    );
  } finally {
    f.close();
  }
});
test("an existing release lock prevents synchronization and is never removed", () => {
  const f = fixture();
  try {
    mkdirSync(path.join(f.remote, ".deploy/lock"), { recursive: true });
    writeFileSync(path.join(f.remote, ".deploy/lock/owner"), "other-release\n");
    const r = f.run();
    assert.notEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stderr, /已有发布锁/);
    assert.equal(
      readFileSync(path.join(f.remote, ".deploy/lock/owner"), "utf8"),
      "other-release\n",
    );
    assert.equal(existsSync(path.join(f.remote, "new.mjs")), false);
  } finally {
    f.close();
  }
});
