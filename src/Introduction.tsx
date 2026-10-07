import { useEffect, useRef, useState } from "react";
import type { Bootstrap } from "./types";
import { VersionWorkspace } from "./VersionWorkspace";
import { ArrowLeft } from "@phosphor-icons/react";
import { Button } from "./components";

export function Introduction({
  onBack,
  data,
}: {
  onBack: () => void;
  data: Bootstrap;
}) {
  const [diagnostics, setDiagnostics] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (
        event.origin === location.origin &&
        event.source === frame.current?.contentWindow &&
        event.data?.type === "autoppt:intro-back"
      )
        onBack();
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [onBack]);
  return (
    <section className="introduction-panel" aria-label="产品介绍">
      <div className="introduction-toolbar">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft size={17} />
          返回刚才的页面
        </Button>
        <Button variant="ghost" onClick={() => setDiagnostics(!diagnostics)}>
          {diagnostics ? "产品介绍" : "版本与工作区"}
        </Button>
      </div>
      {diagnostics ? (
        <VersionWorkspace data={data} />
      ) : (
        <iframe ref={frame} title="AutoPPT 产品介绍" src="/intro/?embedded=1" />
      )}
    </section>
  );
}
