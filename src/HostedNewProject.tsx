import { useCallback, useRef, useState } from "react";
import { NewProject, type NewProjectDraft } from "./NewProject";
import { emptyDesignOptions } from "./DesignOptionsEditor";
import { createGenerationRequest, exampleManuscript } from "./onboarding";
import { manuscriptTitle } from "../shared/first-picture.mjs";
import { defaultStyleId } from "../shared/styles.mjs";
import { post } from "./api";
import type { DesignOptions, Project, Style } from "./types";

// Hosted uses the same settings form as local. This adapter only handles
// account-scoped drafts and creation retries; it never submits a batch.
export function HostedNewProject({
  userId,
  styles,
  initialStyle,
  example,
  onStyles,
  onClose,
  onCreated,
}: {
  userId: string;
  styles: Style[];
  initialStyle?: string;
  example: boolean;
  onStyles: (draft: NewProjectDraft) => void;
  onClose: () => void;
  onCreated: (project: Project) => void;
}) {
  const key = `autoppt-new-project:v1:${userId}`;
  const legacyKey = `autoppt-first-picture:v1:${userId}`;
  const [initial] = useState(() => {
    const read = (name: string) => {
      try {
        return localStorage.getItem(name);
      } catch {
        return null;
      }
    };
    const parse = (raw: string | null) => {
      try {
        const value = JSON.parse(raw || "null");
        return value && typeof value === "object" && !Array.isArray(value)
          ? value
          : {};
      } catch {
        return {};
      }
    };
    const legacyRaw = read(legacyKey);
    const legacy = parse(legacyRaw);
    const saved = parse(read(key));
    const text =
      typeof saved.text === "string"
        ? saved.text
        : typeof legacy.text === "string"
          ? legacy.text
          : example
            ? exampleManuscript
            : "";
    const available = styles.filter((s) => s.rules && !s.deletedAt);
    const preferredStyles =
      saved.routeStyle === (initialStyle || null)
        ? [saved.draft?.styleId, initialStyle, legacy.styleId]
        : [initialStyle, saved.draft?.styleId, legacy.styleId];
    const styleId =
      preferredStyles.find((id) => available.some((s) => s.id === id)) ||
      defaultStyleId(available);
    const draft: NewProjectDraft = {
      title: saved.draft?.title ?? legacy.title ?? "",
      styleId,
      choices: saved.draft?.choices || emptyDesignOptions,
      audienceKind: saved.draft?.audienceKind || "none",
      customAudience: saved.draft?.customAudience || {
        description: "",
        brief: "",
      },
    };
    if (!draft.title && text.trim()) draft.title = manuscriptTitle(text);
    return { draft, text, legacyRaw };
  });
  const lastSaved = useRef<string | null>(null);
  const saveDraft = useCallback(
    (draft: NewProjectDraft) => {
      try {
        const raw = JSON.stringify({
          draft,
          text: initial.text,
          routeStyle: initialStyle || null,
        });
        localStorage.setItem(key, raw);
        lastSaved.current = raw;
      } catch {
        /* In-memory form remains available when storage is denied. */
      }
    },
    [key, initial, initialStyle],
  );
  const [request] = useState(() =>
    createGenerationRequest(`new-project:${userId}`),
  );
  const create = async (input: {
    title: string;
    styleId: string;
    designOptions: DesignOptions;
  }) => {
    const body = { ...input, draft: initial.text };
    const requestId = await request.forText(JSON.stringify(body));
    const project = await post<Project>("/projects", { ...body, requestId });
    request.accepted();
    // Clear only acknowledged drafts. Never erase newer work in another tab.
    for (const [name, raw] of [
      [key, lastSaved.current],
      [legacyKey, initial.legacyRaw],
    ]) {
      try {
        if (raw !== null && localStorage.getItem(name!) === raw)
          localStorage.removeItem(name!);
      } catch {
        /* The project is already durably saved on the server. */
      }
    }
    return project;
  };
  return (
    <NewProject
      styles={styles}
      initialStyle={initial.draft.styleId}
      initialDraft={initial.draft}
      onDraftChange={saveDraft}
      retainedManuscript={!!initial.text}
      createProject={create}
      onStyles={onStyles}
      onClose={onClose}
      onCreated={onCreated}
    />
  );
}
