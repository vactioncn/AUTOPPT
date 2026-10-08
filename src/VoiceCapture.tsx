import { useRiskConfirmation } from "./Feedback";
import { useEffect, useRef, useState } from "react";
import { Button, Field } from "./components";
import { api } from "./api";
import type { Voice } from "./speech-types";
async function normalizedSample(file: Blob): Promise<File> {
  if (file.size > 20 * 1024 * 1024) throw new Error("录音不能超过 20 MB");
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await file.arrayBuffer());
    if (decoded.duration < 10 || decoded.duration > 300)
      throw new Error("请使用 10 秒至 5 分钟的录音");
    const offline = new OfflineAudioContext(
      1,
      Math.ceil(decoded.duration * 16000),
      16000,
    );
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const samples = (await offline.startRendering()).getChannelData(0);
    const bytes = new ArrayBuffer(44 + samples.length * 2),
      view = new DataView(bytes);
    const text = (at: number, value: string) =>
      [...value].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
    text(0, "RIFF");
    view.setUint32(4, 36 + samples.length * 2, true);
    text(8, "WAVE");
    text(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, 16000, true);
    view.setUint32(28, 32000, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    text(36, "data");
    view.setUint32(40, samples.length * 2, true);
    samples.forEach((sample, i) =>
      view.setInt16(
        44 + i * 2,
        Math.round(
          Math.max(-1, Math.min(1, sample)) * (sample < 0 ? 32768 : 32767),
        ),
        true,
      ),
    );
    return new File([bytes], "speaker.wav", { type: "audio/wav" });
  } finally {
    await context.close();
  }
}
export function VoiceCapture({
  onVoices,
  disabled,
  onRecordingStart,
}: {
  onVoices: (voices: Voice[]) => void;
  disabled: boolean;
  onRecordingStart: () => void;
}) {
  const [name, setName] = useState("我的演讲声音"),
    [consent, setConsent] = useState(false);
  const [sample, setSample] = useState<File | null>(null),
    [url, setUrl] = useState("");
  const [recording, setRecording] = useState(false),
    [seconds, setSeconds] = useState(0);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const recorder = useRef<MediaRecorder | null>(null),
    stream = useRef<MediaStream | null>(null),
    alive = useRef(true);
  const localPreview = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      recorder.current?.state === "recording" && recorder.current.stop();
      stream.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);
  useEffect(() => {
    const value = sample ? URL.createObjectURL(sample) : "";
    setUrl(value);
    return () => {
      if (value) URL.revokeObjectURL(value);
    };
  }, [sample]);
  useEffect(() => {
    if (!recording) return;
    const started = Date.now();
    const timer = setInterval(() => {
      const s = Math.floor((Date.now() - started) / 1000);
      setSeconds(s);
      if (s >= 120) recorder.current?.stop();
    }, 250);
    return () => clearInterval(timer);
  }, [recording]);
  async function prepare(file: Blob) {
    setBusy(true);
    setError("");
    setMessage("");
    setSample(null);
    try {
      const wav = await normalizedSample(file);
      if (alive.current) setSample(wav);
    } catch (e) {
      if (alive.current)
        setError(
          (e as Error).message || "无法读取录音，请换一个 WAV、MP3 或 M4A 文件",
        );
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function record() {
    onRecordingStart();
    localPreview.current?.pause();
    setError("");
    setMessage("");
    setBusy(true);
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!alive.current) {
        media.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.current = media;
      const r = new MediaRecorder(media),
        chunks: Blob[] = [];
      recorder.current = r;
      r.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      r.onstop = () => {
        media.getTracks().forEach((t) => t.stop());
        if (!alive.current) return;
        setRecording(false);
        void prepare(new Blob(chunks, { type: r.mimeType }));
      };
      r.onerror = () => {
        media.getTracks().forEach((t) => t.stop());
        setRecording(false);
        setError("录音中断，请重新录制或上传录音");
      };
      r.start();
      setSeconds(0);
      setRecording(true);
    } catch {
      stream.current?.getTracks().forEach((t) => t.stop());
      setError("无法访问麦克风，请允许麦克风权限，或上传已有录音。");
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  const risk = useRiskConfirmation();
  async function clone() {
    if (!sample) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const form = new FormData();
      form.set("audio", sample);
      form.set("name", name);
      form.set("consent", String(consent));
      const voices = await api<Voice[]>("/speech/voices/clone", {
        method: "POST",
        body: form,
      });
      if (!alive.current) return;
      onVoices(voices);
      setSample(null);
      setConsent(false);
      setMessage(
        "声音已创建。请选择它并试听；7 天内至少生成一次口播，以免供应商清理未使用的音色。",
      );
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <details className="voice-capture">
      {risk.dialog}
      <summary>采集演讲者的声音</summary>
      <p>
        安静环境下自然讲述 30–60 秒，保留你平时的起伏和停顿。支持录音或上传 10
        秒至 5 分钟、20 MB 以内的 WAV / MP3 / M4A。
      </p>
      <blockquote>
        大家好。今天我想和大家分享一个故事。它开始于一个很小的问题，却让我重新思考，我们到底希望给听众留下些什么？
      </blockquote>
      <div className="speech-inline">
        <Button
          disabled={busy || disabled}
          onClick={recording ? () => recorder.current?.stop() : record}
        >
          {recording ? `结束录音 · ${seconds} 秒` : "开始录音"}
        </Button>
        <label className="speech-upload">
          上传录音
          <input
            aria-label="上传演讲者录音"
            type="file"
            accept=".wav,.mp3,.m4a,audio/wav,audio/mpeg,audio/mp4"
            disabled={recording || busy || disabled}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void prepare(f);
              e.target.value = "";
            }}
          />
        </label>
      </div>
      {url && (
        <audio
          ref={localPreview}
          controls
          src={url}
          aria-label="原始录音试听"
        />
      )}
      <Field label="声音名称">
        <input
          maxLength={60}
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={busy}
        />
      </Field>
      <label className="speech-consent">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          disabled={busy}
        />
        <span>
          这是本人声音或已获得演讲者授权，同意将录音上传至已配置的 MiniMax
          服务，用于创建口播音色。
        </span>
      </label>
      <Button
        disabled={
          !sample || !consent || !name.trim() || busy || recording || disabled
        }
        onClick={() =>
          risk.ask(
            "创建我的声音",
            clone,
            "将上传本次录音用于声音复刻，声音复刻及首次使用可能单独计费。原始录音不写入项目包。",
          )
        }
      >
        {busy ? "处理中…" : "创建我的声音"}
      </Button>
      {message && <p role="status">{message}</p>}
      {error && (
        <p role="alert" className="speech-error">
          {error}
        </p>
      )}
    </details>
  );
}
