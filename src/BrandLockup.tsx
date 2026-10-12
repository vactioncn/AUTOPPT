import { BRAND } from "../shared/brand.mjs";

export function BrandLockup({ compact = false }: { compact?: boolean }) {
  return (
    <span className="jianghao-lockup">
      <img src="/brand/mark.svg" width="40" height="40" alt="" />
      <span className="jianghao-wordmark">{BRAND.name}</span>
      {!compact && (
        <span className="jianghao-descriptor">{BRAND.descriptor}</span>
      )}
    </span>
  );
}
