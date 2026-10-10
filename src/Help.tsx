import { ArrowLeft } from "@phosphor-icons/react";
import { useState } from "react";
import { Button } from "./components";
import { VersionWorkspace } from "./VersionWorkspace";
import type { Bootstrap } from "./types";
import { helpTopics } from "../shared/help-content.mjs";
import { hostedHelpTopics } from "../shared/hosted-help.mjs";
import "./review-help.css";
export function Help({
  data,
  onBack,
  onSettings,
  onGuide,
}: {
  data: Bootstrap;
  onBack: () => void;
  onSettings: () => void;
  onGuide: () => void;
}) {
  const [query, setQuery] = useState("");
  const hosted = data.buildInfo?.runtimeMode === "hosted";
  const sourceTopics = hosted ? hostedHelpTopics : helpTopics;
  const topics = sourceTopics
    .map((t) => ({
      ...t,
      items: t.items.filter((item) =>
        (t.title + item.join(" ")).includes(query.trim()),
      ),
    }))
    .filter((t) => t.items.length);
  return (
    <section className="page help-page" aria-label="使用帮助">
      <Button variant="ghost" onClick={onBack}>
        <ArrowLeft size={17} />
        返回刚才的页面
      </Button>
      <div className="page-heading">
        <div>
          {!hosted && (
            <span className="speech-eyebrow">AUTOPPT · 使用帮助</span>
          )}
          <h1>有问题，从这里找答案。</h1>
          <p>
            {hosted
              ? "从邀请码注册，到试做、普通放映和把项目带走。"
              : "从第一次打开 Mac App，到口播、放映和把项目带走。"}
          </p>
        </div>
      </div>
      <label className="help-search">
        <span>搜索常见问题</span>
        <input
          type="search"
          placeholder={
            hosted ? "例如：邀请码、额度、项目迁移" : "例如：核对、语速、换电脑"
          }
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <nav className="help-topic-links" aria-label="帮助分类">
        {sourceTopics.map((t) => (
          <a
            key={t.id}
            href={`#help-${t.id}`}
            onClick={(e) => {
              e.preventDefault();
              setQuery("");
              requestAnimationFrame(() =>
                document
                  .getElementById(`help-${t.id}`)
                  ?.scrollIntoView({ behavior: "smooth" }),
              );
            }}
          >
            {t.title}
          </a>
        ))}
      </nav>
      <div className="help-layout">
        {topics.map((topic) => (
          <section
            id={`help-${topic.id}`}
            className="help-topic"
            key={topic.id}
          >
            <h2>{topic.title}</h2>
            {topic.items.map(([question, answer]) => (
              <details key={question} open={!!query}>
                <summary>{question}</summary>
                <p>{answer}</p>
              </details>
            ))}
          </section>
        ))}
      </div>
      {!topics.length && (
        <p role="status">没有找到对应问题，试试更短的关键词。</p>
      )}
      <div className="help-actions">
        <Button onClick={onSettings}>打开设置</Button>
        <Button onClick={onGuide}>重新查看新手引导</Button>
      </div>
      <details className="help-diagnostics">
        <summary>版本与工作区 · 连接问题排查</summary>
        <VersionWorkspace data={data} />
      </details>
    </section>
  );
}
