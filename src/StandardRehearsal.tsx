import { useEffect, useRef, useState } from "react";
import { Button, Modal } from "./components";
import { Feedback } from "./Feedback";
import { SceneView } from "./SceneView";
import { asset, post } from "./api";
import {
  contentSignature,
  type RehearsalRecord,
} from "../shared/rehearsal.mjs";
import { speakerNotes } from "../shared/manuscript.mjs";
import type { Project } from "./types";

export function StandardRehearsal({
  project: source,
  onClose,
  onComplete,
  onDelivery,
}: {
  project: Project;
  onClose: (interrupted: boolean) => void;
  onComplete: (record: RehearsalRecord) => void;
  onDelivery: () => void;
}) {
  const [project] = useState(source); // The playback snapshot never silently changes.
  const [session, setSession] = useState(""),
    [index, setIndex] = useState(0);
  const [loaded, setLoaded] = useState(false),
    [seen, setSeen] = useState(-1);
  const [done, setDone] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const lock = useRef(false),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const nextButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        ["ArrowRight", "PageDown"].includes(e.key) &&
        !(e.target as HTMLElement).closest("input, textarea, summary")
      ) {
        e.preventDefault();
        nextButton.current?.click();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const page = project.slides[index];
  useEffect(() => {
    if (!session || !loaded) return;
    let active = true;
    setError("");
    post(`/projects/${project.id}/rehearsal/page`, { session, index })
      .then(() => {
        if (active) setSeen(index);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [session, loaded, index, project.id]);
  useEffect(() => {
    if (page?.scene) setLoaded(true);
  }, [page]);
  const close = () => onClose(!!session && !done);
  const last = index === project.slides.length - 1;
  const act = async (fn: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  };
  return (
    <Modal wide title="标准演练" onClose={close}>
      <div className="standard-rehearsal">
        {done ? (
          <Feedback
            kind="success"
            title="已完成当前版本演练"
            action={{ label: "进入交付", onClick: onDelivery }}
          >
            已记录本次母版的演练结果，可以检查并下载交付物。
          </Feedback>
        ) : (
          <>
            <p role="status">
              {session
                ? `演练中 · 第 ${index + 1} / ${project.slides.length} 页`
                : "从第一页开始，逐页演练后结束。中途关闭会保留上次完成记录。"}
            </p>
            {page?.scene ? (
              <SceneView scene={page.scene} label={`第 ${index + 1} 页`} />
            ) : (
              page?.image && (
                <img
                  key={index}
                  className="rehearsal-image"
                  src={asset(page.image)}
                  alt={`第 ${index + 1} 页画面`}
                  onLoad={() => setLoaded(true)}
                  onError={() =>
                    setError("这页画面未能读取，请关闭后重新打开演练。")
                  }
                />
              )
            )}
            <details>
              <summary>查看本页讲稿</summary>
              <p className="rehearsal-notes">{speakerNotes(page)}</p>
            </details>
            {error && (
              <Feedback
                kind="blocking"
                action={{ label: "关闭并检查", onClick: close }}
              >
                {error}
              </Feedback>
            )}
            <div className="modal-actions">
              <Button onClick={close}>中途关闭</Button>
              {!session ? (
                <Button
                  variant="primary"
                  loading={busy}
                  disabled={!loaded || !!error}
                  disabledReason={
                    !loaded ? "正在读取第一页画面。" : error || undefined
                  }
                  onClick={() =>
                    void act(async () => {
                      const result = await post<{ session: string }>(
                        `/projects/${project.id}/rehearsal/start`,
                        { signature: contentSignature(project) },
                      );
                      if (alive.current) setSession(result.session);
                    })
                  }
                >
                  从头开始演练
                </Button>
              ) : (
                <Button
                  ref={nextButton}
                  variant="primary"
                  loading={busy}
                  disabled={seen !== index || !!error}
                  disabledReason={
                    error || (seen !== index ? "正在确认本页画面。" : undefined)
                  }
                  onClick={() => {
                    if (!last) {
                      setLoaded(!!project.slides[index + 1].scene);
                      setIndex(index + 1);
                    } else
                      void act(async () => {
                        const record = await post<RehearsalRecord>(
                          `/projects/${project.id}/rehearsal/complete`,
                          { session },
                        );
                        if (alive.current) {
                          setDone(true);
                          onComplete(record);
                        }
                      });
                  }}
                >
                  {last ? "完成演练" : "下一页"}
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
