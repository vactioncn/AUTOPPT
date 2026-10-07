import { useEffect, useRef } from "react";
import { ArrowLeft } from "@phosphor-icons/react";
import { Button } from "./components";

export function Introduction({
  onBack,
  onHelp,
}: {
  onBack: () => void;
  onHelp: () => void;
}) {
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
        <Button variant="ghost" onClick={onHelp}>
          使用帮助与常见问题
        </Button>
      </div>
      <iframe ref={frame} title="AutoPPT 产品介绍" src="/intro/?embedded=1" />
    </section>
  );
}
