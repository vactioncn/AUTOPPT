import {
  existsSync,
  readFileSync,
  writeFileSync,
  chmodSync,
  renameSync,
} from "node:fs";
import path from "node:path";

const failure = (message, status = 400) =>
  Object.assign(new Error(message), { status });
const validLimit = (value) =>
  Number.isSafeInteger(value) && value >= 1 && value <= 100;

// Image requests have their own live limit. Text/speech keep the deployment
// limit, so waiting for a long image response cannot occupy their slots.
export class ModelConcurrency {
  constructor(
    dir,
    { initialConcurrency = 2, queueLimit = 80, waitMs = 540000 } = {},
  ) {
    this.file = path.join(dir, "image-concurrency.json");
    this.revision = 0;
    this.imageConcurrency = initialConcurrency;
    this.otherConcurrency = initialConcurrency;
    this.running = { image: 0, other: 0 };
    this.queue = [];
    this.queueLimit = queueLimit;
    this.waitMs = waitMs;
    if (existsSync(this.file)) {
      const saved = JSON.parse(readFileSync(this.file, "utf8"));
      if (
        saved.version !== 1 ||
        !Number.isSafeInteger(saved.revision) ||
        saved.revision < 1 ||
        !validLimit(saved.imageConcurrency)
      )
        throw failure(
          "图片并发配置文件无效，请恢复备份；不会自动改用默认配置。",
        );
      this.revision = saved.revision;
      this.imageConcurrency = saved.imageConcurrency;
    }
  }

  get active() {
    return this.running.image + this.running.other;
  }
  get waiting() {
    return this.queue.length;
  }
  public() {
    return {
      revision: this.revision,
      imageConcurrency: this.imageConcurrency,
      otherConcurrency: this.otherConcurrency,
      activeImages: this.running.image,
      waitingImages: this.queue.filter((item) => item.pool === "image").length,
    };
  }
  save(draft) {
    if (!draft || draft.revision !== this.revision)
      throw failure("并发设置已更新，请重新读取后再保存。", 409);
    if (!validLimit(draft.imageConcurrency))
      throw failure("图片并发上限须为 1–100 的整数。");
    const saved = {
      version: 1,
      revision: this.revision + 1,
      imageConcurrency: draft.imageConcurrency,
    };
    writeFileSync(this.file + ".tmp", JSON.stringify(saved, null, 2), {
      mode: 0o600,
      flush: true,
    });
    chmodSync(this.file + ".tmp", 0o600);
    renameSync(this.file + ".tmp", this.file);
    this.revision = saved.revision;
    this.imageConcurrency = saved.imageConcurrency;
    // Decreases never cancel existing requests. Increases dispatch queued work
    // immediately; no restart, retry, or extra generation is created here.
    this.drain();
    return this.public();
  }
  available(pool) {
    return (
      this.running[pool] <
      (pool === "image" ? this.imageConcurrency : this.otherConcurrency)
    );
  }
  take(pool) {
    this.running[pool]++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.running[pool]--;
      this.drain();
    };
  }
  drain() {
    // FIFO within each pool. A full image pool does not block text/speech.
    for (const item of [...this.queue]) {
      if (this.available(item.pool)) item.run();
    }
  }
  async acquire(kind, res) {
    const pool = kind === "image" ? "image" : "other";
    if (res.destroyed) throw failure("请求已取消。", 499);
    if (this.available(pool)) return this.take(pool);
    if (this.queue.length >= this.queueLimit)
      throw failure("等待生成的任务较多，请稍后继续。", 429);
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        res.off("close", closed);
        const index = this.queue.indexOf(item);
        if (index >= 0) this.queue.splice(index, 1);
      };
      const closed = () => {
        cleanup();
        reject(failure("请求已取消。", 499));
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(failure("等待模型服务超时，请稍后继续任务。", 429));
      }, this.waitMs);
      const item = {
        pool,
        run: () => {
          cleanup();
          if (res.destroyed) reject(failure("请求已取消。", 499));
          else resolve(this.take(pool));
        },
      };
      res.once("close", closed);
      this.queue.push(item);
    });
  }
}
