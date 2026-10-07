import { useMutation } from "@tanstack/react-query";
import { type FormEvent, type ReactNode, useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { correctEntry, removeEntry } from "../api/workItems";
import { fieldIssues, RequestError } from "./ApiErrors";
import { Button, TextButton } from "./Button";
import { IconLabel } from "./Icon";
import { ConfirmPanel } from "./Notice";

interface Trace {
  id: number;
  type: string;
  body: string;
  can_remove: boolean;
  can_correct: boolean;
}

/** Removing or correcting a trace, wherever it shows: `children` is the
 * trace's text, replaced by the correction while it is open. The buttons
 * follow the rights the server sent with the trace. */
export function EntryActions({
  entry,
  onChanged,
  currentBody,
  children,
}: {
  entry: Trace;
  onChanged: () => Promise<void>;
  // Reads the text as the server now holds it, once a correction is
  // refused: the screens find a trace in different queries.
  currentBody: () => Promise<string | null>;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const textId = useId();
  const changedId = useId();
  const [isConfirmingRemove, setIsConfirmingRemove] = useState(false);
  const [isCorrecting, setIsCorrecting] = useState(false);
  const [body, setBody] = useState(entry.body);
  // The version the correction is written over, fixed when it opens.
  const [bodyWas, setBodyWas] = useState(entry.body);
  const [theirs, setTheirs] = useState<string | null>(null);

  const remove = useMutation({
    mutationFn: () => removeEntry(entry.id),
    onSuccess: onChanged,
  });
  const correct = useMutation({
    mutationFn: () => correctEntry(entry.id, { body, body_was: bodyWas }),
    onSuccess: async () => {
      setIsCorrecting(false);
      setTheirs(null);
      await onChanged();
    },
    onError: async (error) => {
      if (fieldIssues(error, "detail")[0]?.code !== "entry_changed") {
        return;
      }
      const current = await currentBody();
      if (current !== null) {
        setTheirs(current);
        setBodyWas(current);
      }
    },
  });

  function openCorrection() {
    setBody(entry.body);
    setBodyWas(entry.body);
    setTheirs(null);
    correct.reset();
    setIsCorrecting(true);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    correct.mutate();
  }

  if (!entry.can_remove && !entry.can_correct) {
    return <>{children}</>;
  }

  return (
    <>
      {isCorrecting ? (
        <form className="mt-4" onSubmit={submit}>
          <label htmlFor={textId} className="text-sm font-semibold text-ink">
            {t("entryActions.correctLabel")}
          </label>
          <textarea
            id={textId}
            className="mt-2 min-h-28 w-full rounded-xl border border-primary/20 px-3 py-2 text-body"
            value={body}
            aria-describedby={theirs !== null ? changedId : undefined}
            onChange={(event) => setBody(event.target.value)}
          />
          {theirs !== null && (
            <div
              id={changedId}
              role="alert"
              className="mt-2 rounded-xl border border-warning/35 bg-warning-wash p-3 text-sm text-body"
            >
              <p className="font-semibold">
                {t("entryActions.changedMeanwhile")}
              </p>
              <p className="mt-1 whitespace-pre-wrap">{theirs}</p>
            </div>
          )}
          {correct.isError && theirs === null && (
            <RequestError error={correct.error} />
          )}
          <div className="mt-3 flex flex-wrap gap-3">
            <Button
              variant="primary"
              type="submit"
              disabled={correct.isPending}
            >
              {t("entryActions.save")}
            </Button>
            <Button onClick={() => setIsCorrecting(false)}>
              {t("entryActions.cancel")}
            </Button>
          </div>
        </form>
      ) : (
        children
      )}

      {!isCorrecting && !isConfirmingRemove && (
        <div className="mt-3 flex flex-wrap gap-4 text-sm">
          {entry.can_correct && (
            <TextButton onClick={openCorrection}>
              {t("entryActions.correct")}
            </TextButton>
          )}
          {entry.can_remove && (
            <TextButton danger onClick={() => setIsConfirmingRemove(true)}>
              <IconLabel icon="xmark">{t("entryActions.remove")}</IconLabel>
            </TextButton>
          )}
        </div>
      )}

      {isConfirmingRemove && (
        <ConfirmPanel
          className="mt-3"
          message={t(
            entry.type === "progress"
              ? "entryActions.removeProgress"
              : entry.type === "decision"
                ? "entryActions.removeDecision"
                : "entryActions.removeNote",
          )}
          cancelLabel={t("entryActions.cancel")}
          confirmLabel={t("entryActions.confirmRemove")}
          pending={remove.isPending}
          error={remove.isError ? remove.error : undefined}
          onCancel={() => setIsConfirmingRemove(false)}
          onConfirm={() => remove.mutate()}
        />
      )}
    </>
  );
}
