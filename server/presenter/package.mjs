import { videoName, validateVideo, validateImage, avatarFingerprint } from "./media.mjs";
import { createHash } from "node:crypto";
const pick = (v, keys) =>
  Object.fromEntries(
    keys.filter((k) => v[k] !== undefined).map((k) => [k, v[k]]),
  );
const avatarKeys = [
  "id",
  "name",
  "sourceAsset",
  "previewAsset",
  "kind",
  "provider",
  "createdAt",
  "updatedAt",
  "deletedAt",
];
const versionKeys = [
  "id",
  "projectId",
  "narrationId",
  "avatarId",
  "sourceRevision",
  "status",
  "progress",
  "placement",
  "size",
  "provider",
  "createdAt",
  "updatedAt",
];
const pageKeys = [
  "pageId",
  "sourceFingerprint",
  "audioFingerprint",
  "avatarFingerprint",
  "status",
];
const videoKeys = ["videoFile", "videoFingerprint", "duration"];
export function portablePresenter(kind, value) {
  if (kind === "avatar") return pick(value, avatarKeys);
  return {
    ...pick(value, versionKeys),
    progress: "由本地数字人版本迁移",
    pages: value.pages.map((page) =>
      pick(page, [...pageKeys, ...(page.status === "ready" ? videoKeys : [])]),
    ),
  };
}
export function validatePresenterRecord(kind, v) {
  const error = () => {
    throw new Error("项目包数字人记录或素材无效");
  };
  const only = (value, keys) => {
    if (Object.keys(value).some((k) => !keys.includes(k))) error();
  };
  const filename = (name) =>
    typeof name === "string" && /^[\w-]+\.(png|jpg|webp)$/.test(name);
  if (kind === "avatar") {
    only(v, avatarKeys);
    if (
      !filename(v.sourceAsset) ||
      !filename(v.previewAsset) ||
      !["photo", "preset", "generated"].includes(v.kind) ||
      typeof v.name !== "string" ||
      v.name.length > 80
    )
      error();
  } else {
    only(v, [...versionKeys, "pages"]);
    if (
      !Array.isArray(v.pages) ||
      v.pages.length > 500 ||
      !["top-left", "top-right", "bottom-left", "bottom-right"].includes(
        v.placement,
      ) ||
      !["small", "medium", "large"].includes(v.size)
    )
      error();
    if (
      !["ready", "partial", "queued", "running", "interrupted"].includes(
        v.status,
      )
    )
      error();
    if (new Set(v.pages.map((p) => p.pageId)).size !== v.pages.length) error();
    for (const p of v.pages) {
      only(p, [...pageKeys, ...videoKeys]);
      if (
        typeof p.pageId !== "string" ||
        !["ready", "pending", "running", "interrupted", "failed"].includes(
          p.status,
        )
      )
        error();
      if (
        ![p.sourceFingerprint, p.audioFingerprint, p.avatarFingerprint].every(
          (h) => /^[a-f0-9]{64}$/.test(h),
        )
      )
        error();
      if (
        p.videoFile &&
        (p.status !== "ready" ||
          !videoName(p.videoFile) ||
          !/^[a-f0-9]{64}$/.test(p.videoFingerprint) ||
          !Number.isFinite(p.duration) ||
          p.duration <= 0 ||
          p.duration > 1800)
      )
        error();
    }
  }
  if (!/^[a-z][a-z0-9-]{0,40}$/.test(v.provider)) error();
}
export async function validatePresenterAsset(name, bytes, records) {
  let normalized;
  const fingerprints = [];
  for (const { kind, value } of records) {
    if (kind === "presenter")
      for (const p of value.pages)
        if (p.videoFile === name) {
          validateVideo({
            bytes,
            status: 200,
            contentType: "video/mp4",
            duration: p.duration,
          });
          if (
            createHash("sha256").update(bytes).digest("hex") !==
            p.videoFingerprint
          )
            throw new Error("项目包数字人视频指纹无效");
        }
    if (
      kind === "avatar" &&
      [value.sourceAsset, value.previewAsset].includes(name)
    ) {
      normalized ||= await validateImage(
        bytes,
        name.endsWith(".jpg")
          ? "image/jpeg"
          : name.endsWith(".webp")
            ? "image/webp"
            : "image/png",
      );
      if (value.sourceAsset === name)
        fingerprints.push({
          avatarId: value.id,
          before: avatarFingerprint(bytes, value),
          after: avatarFingerprint(normalized, value),
        });
    }
  }
  return { bytes: normalized || bytes, extension: normalized ? ".png" : null, fingerprints };
}
