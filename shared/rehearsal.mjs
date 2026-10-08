// A deterministic content identity, shared by all runtimes. This is not a security
// token. Drafts, visits, progress, history and rehearsal metadata are excluded.
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter((k) => value[k] !== undefined)
        .map((k) => [k, stable(value[k])]),
    );
  return value ?? null;
}
export function contentSignature(project) {
  const text = JSON.stringify(
    stable({
      title: project.title,
      styleId: project.styleId,
      designOptions: project.designOptions,
      slides: project.slides.map((s) => ({
        id: s.id,
        notes: s.notes,
        manuscript: s.manuscript,
        manuscriptVersion: s.manuscriptVersion,
        image: s.image,
        scene: s.scene,
        plan: s.plan,
        styleId: s.styleId,
        designOptions: s.designOptions,
      })),
    }),
  );
  // Two independent 64-bit FNV streams keep the portable identity compact.
  let a = 0xcbf29ce484222325n,
    b = 0x84222325cbf29ce4n;
  for (let i = 0; i < text.length; i++) {
    const c = BigInt(text.charCodeAt(i));
    a = BigInt.asUintN(64, (a ^ c) * 0x100000001b3n);
    b = BigInt.asUintN(64, (b ^ c) * 0x100000001b3n);
  }
  return (
    "v1-" + a.toString(16).padStart(16, "0") + b.toString(16).padStart(16, "0")
  );
}
export function cleanRehearsal(record) {
  if (
    !record ||
    !/^v1-[a-f0-9]{32}$/.test(record.signature) ||
    typeof record.completedAt !== "string" ||
    !Number.isFinite(Date.parse(record.completedAt))
  )
    return undefined;
  return { signature: record.signature, completedAt: record.completedAt };
}
export function rehearsalState(project, capability = { enabled: true }) {
  if (!capability.enabled)
    return {
      status: "unavailable",
      label: capability.reason || "当前平台未开放标准放映。",
    };
  const record = cleanRehearsal(project.rehearsal);
  if (!record) return { status: "unstarted", label: "尚未开始演练" };
  return record.signature === contentSignature(project)
    ? {
        status: "complete",
        label: "已完成当前版本演练",
        completedAt: record.completedAt,
      }
    : {
        status: "stale",
        label: "上次演练基于修改前内容，本次修改尚未演练。",
        completedAt: record.completedAt,
      };
}
