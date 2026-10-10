import { useState } from "react";
import { Button, Modal } from "./components";
import { SpeechSettings } from "./SpeechSettings";
import { PresenterSettings } from "./PresenterSettings";
// Reuse global settings as a separate surface; project orchestration only consumes IDs.
export function RehearsalResourceSettings({
  kind,
  onClose,
}: {
  kind: "speech" | "avatar";
  onClose: () => void;
}) {
  const [message, setMessage] = useState("");
  return (
    <Modal
      wide
      title={kind === "speech" ? "设置 · 语音与声音" : "设置 · 数字人库"}
      subtitle="一次准备，供所有项目复用。关闭后回到本场演讲。"
      onClose={onClose}
    >
      {kind === "speech" ? (
        <SpeechSettings notify={setMessage} />
      ) : (
        <PresenterSettings notify={setMessage} />
      )}
      {message && <p role="status">{message}</p>}
      <Button onClick={onClose}>完成设置，返回演练</Button>
    </Modal>
  );
}
