import { userError } from "../shared/user-error.mjs";
export function publicErrorHandler(err, req, res, _next) {
  const error =
    err.code === "LIMIT_FILE_SIZE"
      ? req.path === "/api/projects/import"
        ? "项目包不能超过 1 GB。"
        : req.path === "/api/avatars"
          ? "头像图片不能超过 8 MB。"
          : req.path.startsWith("/api/speech")
            ? "录音不能超过 20 MB。"
            : "单张图片不能超过 12 MB。"
      : userError(err);
  console.error("[AutoPPT]", error);
  if (!res.headersSent)
    res
      .status(err.status >= 400 && err.status <= 599 ? err.status : 400)
      .json({ error });
}
