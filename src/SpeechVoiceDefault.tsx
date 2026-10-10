import { useEffect, useState } from "react";
import { api } from "./api";
import { Button, Field } from "./components";
import type { Voice, SpeechConnection } from "./speech-types";
export function SpeechVoiceDefault({
  notify,
}: {
  notify: (text: string) => void;
}) {
  const [voices, setVoices] = useState<Voice[]>([]),
    [value, setValue] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    const load = () =>
      void Promise.all([
        api<Voice[]>("/speech/voices"),
        api<SpeechConnection & { defaultVoiceId?: string }>("/settings/speech"),
      ])
        .then(([list, c]) => {
          setVoices(list);
          setValue(c.defaultVoiceId || "");
        })
        .catch((e) => setError(e.message));
    load();
    window.addEventListener("autoppt-speech-updated", load);
    return () => window.removeEventListener("autoppt-speech-updated", load);
  }, []);
  return (
    <div className="speech-default-settings">
      <Field
        label="新项目默认声音"
        hint="只影响尚未保存本场声音的新项目。已有项目和音频保持原选择。"
      >
        <select
          value={value}
          disabled={busy}
          onChange={(e) => setValue(e.target.value)}
        >
          <option value="">自动选择可用声音</option>
          {voices.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
              {v.custom ? " · 我的声音" : ""}
            </option>
          ))}
        </select>
      </Field>
      <Button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            await api("/settings/speech", {
              method: "PUT",
              body: JSON.stringify({ defaultVoiceId: value }),
            });
            window.dispatchEvent(new Event("autoppt-speech-updated"));
            notify("新项目默认声音已保存。");
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        保存默认声音
      </Button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
