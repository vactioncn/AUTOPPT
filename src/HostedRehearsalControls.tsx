import { Button, Field } from "./components";
import { SPEECH_EMOTIONS } from "../shared/speech.mjs";
import type { RehearsalPlan, RehearsalResources } from "./rehearsal-types";

export function HostedRehearsalControls({
  plan,
  resources,
  busy,
  text,
  onText,
  choose,
  trialLength,
  onTrialLength,
  onSave,
}: {
  plan: RehearsalPlan;
  resources: RehearsalResources;
  busy: boolean;
  text: string;
  onText: (text: string) => void;
  choose: <K extends keyof RehearsalPlan>(
    key: K,
    value: RehearsalPlan[K],
  ) => void;
  trialLength: "short" | "page";
  onTrialLength: (value: "short" | "page") => void;
  onSave: () => void;
}) {
  const narration = resources.narrations.find(
    (n) => n.id === plan.narrationId && n.available,
  );
  return (
    <div className="rehearsal-controls rehearsal-web-controls">
      <div
        className="rehearsal-web-mode"
        role="group"
        aria-label="这场演讲，谁来讲？"
      >
        <strong>讲述方式</strong>
        <div className="rehearsal-choice">
          {(["self", "voice"] as const).map((actor) => (
            <button
              key={actor}
              type="button"
              aria-pressed={plan.actor === actor}
              disabled={busy}
              onClick={() => choose("actor", actor)}
            >
              {actor === "self" ? "自己讲" : "AI 口播"}
            </button>
          ))}
        </div>
      </div>
      {plan.actor === "voice" && !narration && (
        <>
          <div className="rehearsal-web-voice">
            <Field label="选择本场声音">
              <select
                value={plan.voiceId}
                disabled={busy}
                onChange={(e) => choose("voiceId", e.target.value)}
              >
                <option value="">请选择声音</option>
                {resources.context.voices.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                    {v.custom ? " · 我的声音" : ""}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="语速">
              <select
                value={plan.speed}
                disabled={busy}
                onChange={(e) => choose("speed", Number(e.target.value))}
              >
                {[0.75, 1, 1.1, 1.25, 1.5].map((speed) => (
                  <option key={speed} value={speed}>
                    {speed} 倍
                  </option>
                ))}
              </select>
            </Field>
          </div>
          {!resources.context.speech.hasKey && (
            <p className="rehearsal-note">
              管理员尚未连接 MiniMax，请联系管理员；已有音频仍可播放。
            </p>
          )}
          <Field label="当前页口播正文" hint="仅保存口播版本，原逐字稿保留。">
            <textarea
              rows={5}
              value={text}
              disabled={busy}
              placeholder="填写本页口播正文，先试一小段声音。"
              onChange={(e) => onText(e.target.value)}
            />
          </Field>
        </>
      )}
      {plan.actor === "voice" && narration && (
        <p className="rehearsal-note">
          沿用“{narration.voiceName}”的原音频和表达，试播使用本页完整音频。
        </p>
      )}
      {plan.actor === "self" && (
        <p className="rehearsal-note">直接放映画面，用自己的节奏讲述。</p>
      )}
      <details className="rehearsal-web-options">
        <summary>
          更多选项
          {plan.actor === "voice" && !narration
            ? ` · ${trialLength === "short" ? "短片段试播" : "完整一页试播"}`
            : ""}
        </summary>
        <div className="rehearsal-web-options-body">
          {plan.actor === "voice" && (
            <>
              <Field label="口播来源">
                <select
                  value={plan.narrationId}
                  disabled={busy}
                  onChange={(e) => choose("narrationId", e.target.value)}
                >
                  <option value="">按当前口播正文生成新版本</option>
                  {resources.narrations.map((n) => (
                    <option key={n.id} value={n.id} disabled={!n.available}>
                      沿用已有口播 · {n.voiceName}
                      {n.available ? "" : "（页面已变）"}
                    </option>
                  ))}
                </select>
              </Field>
              {!narration && (
                <div className="rehearsal-inline-fields">
                  <Field label="表达">
                    <select
                      value={plan.emotion}
                      disabled={busy}
                      onChange={(e) => choose("emotion", e.target.value)}
                    >
                      {SPEECH_EMOTIONS.map((emotion) => (
                        <option key={emotion.id} value={emotion.id}>
                          {emotion.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="试播长度">
                    <select
                      value={trialLength}
                      disabled={busy}
                      onChange={(e) =>
                        onTrialLength(e.target.value as "short" | "page")
                      }
                    >
                      <option value="short">开头短片段 · 最多 100 字</option>
                      <option value="page">当前完整一页 · 整场可复用</option>
                    </select>
                  </Field>
                </div>
              )}
            </>
          )}
          <Button disabled={busy} onClick={onSave}>
            保存本场选择
          </Button>
          <p>
            试播与生成时会保存本场选择和口播正文。MiniMax 服务配置由管理员维护。
          </p>
          <p>
            语音使用 MiniMax 预算，不扣图片张数；播放和复用已有音频不重新合成。
          </p>
        </div>
      </details>
    </div>
  );
}
