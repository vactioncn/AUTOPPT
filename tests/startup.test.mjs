import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

test(
  "occupied port cannot interrupt jobs owned by the existing server",
  { timeout: 15000 },
  async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "autoppt-startup-"));
    const db = new DatabaseSync(path.join(dir, "autoppt.sqlite"));
    db.exec(
      "CREATE TABLE records (kind TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(kind,id))",
    );
    const job = {
      id: "running",
      type: "render",
      status: "running",
      payload: { slideIds: ["s84"] },
    };
    db.prepare("INSERT INTO records VALUES (?,?,?)").run(
      "job",
      job.id,
      JSON.stringify(job),
    );
    const occupied = http.createServer((req, res) => res.end("busy"));
    occupied.listen(0, "127.0.0.1");
    await once(occupied, "listening");
    let child;
    try {
      child = spawn(process.execPath, ["server/index.mjs"], {
        env: {
          ...process.env,
          NODE_ENV: "production",
          AUTOPPT_DATA_DIR: dir,
          PORT: String(occupied.address().port),
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "";
      child.stdout.on("data", (s) => (output += s));
      child.stderr.on("data", (s) => (output += s));
      const [code] = await once(child, "exit");
      assert.equal(code, 1);
      assert.match(output, /EADDRINUSE/);
      assert.deepEqual(
        JSON.parse(
          db
            .prepare(
              "SELECT data FROM records WHERE kind='job' AND id='running'",
            )
            .get().data,
        ),
        job,
      );
    } finally {
      child?.kill();
      db.close();
      await new Promise((r) => occupied.close(r));
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
