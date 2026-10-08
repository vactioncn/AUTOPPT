import { useEffect, useRef, useState, type RefObject } from "react";
import { api } from "./api";
import { Button } from "./components";
import { speechAudio } from "./speech-types";
import { useRiskConfirmation } from "./Feedback";

type Status =
  | "idle"
  | "generating"
  | "loading"
  | "playing"
  | "paused"
  | "ended"
  | "blocked"
  | "error";
export function SpeechPreview({
  body,
  disabledReason,
  audioRef,
  onBusy,
  onStart,
}: {
  body: object;
  disabledReason: string;
  audioRef: RefObject<HTMLAudioElement | null>;
  onBusy: (busy: boolean) => void;
  onStart: () => void;
}) {
  const risk = useRiskConfirmation();
  const requestKey = JSON.stringify(body);
  const [status, setStatus] = useState<Status>("idle");
  const [url, setUrl] = useState("");
  const [feedback, setFeedback] = useState("");
  const [seconds, setSeconds] = useState(0);
  const controller = useRef<AbortController | null>(null);
  const operation = useRef(0),
    playAttempt = useRef(0);
  const playTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  useEffect(() => {
    setUrl("");
    setStatus("idle");
    setFeedback("");
    const el = audioRef.current;
    el?.removeAttribute("src");
    el?.load();
    return () => {
      operation.current++;
      playAttempt.current++;
      controller.current?.abort();
      controller.current = null;
      clearTimeout(playTimer.current);
      el?.pause();
      onBusy(false);
    };
  }, [requestKey, audioRef, onBusy]);
  useEffect(() => {
    if (status !== "generating") return;
    const start = Date.now();
    setSeconds(0);
    const timer = setInterval(
      () => setSeconds(Math.floor((Date.now() - start) / 1000)),
      1000,
    );
    return () => clearInterval(timer);
  }, [status]);

  async function play(file: string) {
    const el = audioRef.current;
    if (!el) return;
    const attempt = ++playAttempt.current;
    clearTimeout(playTimer.current);
    onStart();
    setStatus("loading");
    setFeedback("试听已生成，正在读取并播放…");
    // Keep this element mounted. A retry uses the saved file and never calls TTS.
    if (el.getAttribute("src") !== file) el.src = file;
    else if (el.error || status === "error") el.load();
    else if (el.ended) el.currentTime = 0;
    playTimer.current = setTimeout(() => {
      if (attempt !== playAttempt.current) return;
      playAttempt.current++;
      el.pause();
      setStatus("error");
      setFeedback(
        "试听已生成，但音频读取超时。点击“播放已生成试听”重试，不会重新生成或计费。",
      );
    }, 15000);
    try {
      await el.play();
      if (attempt !== playAttempt.current) return;
      setStatus("playing");
      setFeedback("正在播放试听");
    } catch (e) {
      if (attempt !== playAttempt.current) return;
      const name = (e as Error).name;
      setStatus(name === "NotAllowedError" ? "blocked" : "error");
      setFeedback(
        name === "NotAllowedError"
          ? "试听已生成，自动播放被拦截。点击“播放已生成试听”即可继续，不会重新生成或计费。"
          : "试听已生成，但暂时无法播放。点击“播放已生成试听”重试，不会重新生成或计费。",
      );
    } finally {
      if (attempt === playAttempt.current) clearTimeout(playTimer.current);
    }
  }
  async function generate() {
    if (controller.current || disabledReason) return;
    const ticket = ++operation.current;
    const current = new AbortController();
    controller.current = current;
    onStart();
    onBusy(true);
    setStatus("generating");
    setFeedback("");
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      current.abort();
    }, 180000);
    try {
      const data = await api<{ file: string }>("/speech/preview", {
        method: "POST",
        body: requestKey,
        signal: current.signal,
      });
      if (ticket !== operation.current) return;
      if (!data.file) throw new Error("语音服务未返回试听文件，请重试。");
      const file = speechAudio(data.file);
      setUrl(file);
      void play(file);
    } catch (e) {
      if (ticket !== operation.current) return;
      setStatus("error");
      setFeedback(
        timedOut
          ? "等待试听超时，已停止等待。请重试；已保存的相同内容会自动复用。"
          : `试听未完成：${(e as Error).message === "Failed to fetch" ? "连接中断，请检查服务后重试。" : (e as Error).message}`,
      );
    } finally {
      clearTimeout(timeout);
      if (ticket === operation.current) {
        controller.current = null;
        onBusy(false);
      }
    }
  }
  const waiting = status === "generating" || status === "loading";
  return (
    <section
      className="speech-preview"
      aria-label="本页试听"
      aria-busy={waiting}
    >
      {risk.dialog}
      <div className="speech-inline">
        <Button
          loading={waiting}
          disabled={!!disabledReason}
          onClick={() => {
            if (status === "playing") audioRef.current?.pause();
            else if (url) void play(url);
            else
              risk.ask(
                "试听本页开头",
                async () => {
                  void generate();
                },
                "将合成本页开头的口播试听；已有试听可直接播放。",
              );
          }}
        >
          {status === "generating"
            ? "正在生成试听…"
            : status === "loading"
              ? "正在读取试听…"
              : status === "playing"
                ? "暂停试听"
                : url
                  ? status === "blocked" || status === "error"
                    ? "播放已生成试听"
                    : status === "ended"
                      ? "重播试听"
                      : "继续试听"
                  : "试听本页开头"}
        </Button>
        {status === "generating" && (
          <Button
            variant="ghost"
            onClick={() => {
              operation.current++;
              controller.current?.abort();
              controller.current = null;
              onBusy(false);
              setStatus("idle");
              setFeedback(
                "已停止等待试听。再次点击可重试，已保存的相同内容会自动复用。",
              );
            }}
          >
            停止等待
          </Button>
        )}
      </div>
      {disabledReason && <p className="speech-callout">{disabledReason}</p>}
      {(feedback || status === "generating") && (
        <p
          role={status === "error" ? "alert" : "status"}
          className={status === "error" ? "speech-error" : "speech-callout"}
        >
          {status === "generating"
            ? `正在生成试听，已等待 ${seconds} 秒；完成后会自动尝试播放。`
            : feedback}
        </p>
      )}
      <audio
        ref={audioRef}
        controls
        hidden={!url}
        preload="auto"
        aria-label="合成口播试听"
        onPlaying={() => {
          onStart();
          setStatus("playing");
          setFeedback("正在播放试听");
        }}
        onPause={() => {
          if (status === "playing") {
            setStatus("paused");
            setFeedback("试听已暂停，可继续播放，无需重新生成。");
          }
        }}
        onEnded={() => {
          setStatus("ended");
          setFeedback("试听播放结束，可直接重播，无需重新生成。");
        }}
        onError={() => {
          if (!url) return;
          setStatus("error");
          setFeedback(
            "试听文件读取失败。点击“播放已生成试听”重试，不会重新生成或计费。",
          );
        }}
      />
    </section>
  );
}
