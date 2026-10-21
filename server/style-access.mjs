export const canManageStyles = (req) =>
  !process.env.AUTOPPT_WORKER_TOKEN ||
  req.headers["x-autoppt-role"] === "admin";

export function styleAccess(req, res, next) {
  if (!canManageStyles(req))
    return res
      .status(403)
      .json({ error: "风格由管理员创建和管理，请从风格库选择使用。" });
  next();
}

export function customerStyle(style) {
  return {
    id: style.id,
    name: style.name,
    description: style.description,
    colors: style.colors || [],
    cover: style.cover,
    builtin: style.builtin,
    deletedAt: style.deletedAt,
    status: style.status,
    catalogSourceId: style.catalogSourceId,
    replacesStyleId: style.replacesStyleId,
    catalogHidden: style.catalogHidden,
    projectOnly: style.projectOnly,
    canUse: !!style.rules?.trim() && !style.deletedAt,
    // Keep the customer payload intentionally small, without editing metadata.
    refs: [],
    rules: "",
    examples: style.examples || [],
  };
}
