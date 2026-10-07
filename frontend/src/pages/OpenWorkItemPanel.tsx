import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, type ReactNode, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";

import { openWorkItem, type WorkItem } from "../api/workItems";
import {
  FieldErrors,
  fieldIssues,
  RequestError,
} from "../components/ApiErrors";
import { Button } from "../components/Button";
import { Panel } from "../components/Panel";
import { SUGGESTIONS, sameTitle, suggestionsFor } from "./suggestions";

const OTHER = ":other";

const inputClass =
  "mt-1 block w-full rounded-xl border border-primary/20 bg-white px-3 py-2 text-sm font-normal";

function OpenWorkItemForm({
  teamSeasonId,
  workItems,
}: {
  teamSeasonId: number;
  workItems: WorkItem[];
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const choiceId = useId();
  const inputId = useId();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [choice, setChoice] = useState("");
  const [name, setName] = useState("");
  // No default: nothing lets a member move a work item across afterwards.
  const [onRobot, setOnRobot] = useState<boolean | null>(null);
  const open = useMutation({
    mutationFn: (input: { title: string; on_robot: boolean }) =>
      openWorkItem(teamSeasonId, input),
    onSuccess: async (item) => {
      await queryClient.invalidateQueries({
        queryKey: ["team-seasons", teamSeasonId, "work-items"],
      });
      navigate(`/work-items/${item.id}`);
    },
  });
  const issues = fieldIssues(open.error, "title");
  const suggestions = suggestionsFor(workItems);
  const picked = suggestions.find((suggestion) => suggestion.title === choice);
  const other = choice === OTHER;
  const title = picked ? picked.title : name.trim();
  // A suggestion typed by hand is on its usual side, until the member says
  // otherwise.
  const typed = SUGGESTIONS.find((suggestion) =>
    sameTitle(suggestion.title, title),
  );
  const side = picked ? picked.onRobot : (onRobot ?? typed?.onRobot ?? null);
  const existing = other
    ? workItems.find((item) => title && sameTitle(item.title, title))
    : undefined;
  const ready = Boolean(title) && side !== null && !existing;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (ready && side !== null) {
      open.mutate({ title, on_robot: side });
    }
  }

  return (
    <Panel as="section" aria-labelledby={titleId} className="mt-4">
      <h2
        id={titleId}
        className="text-xs font-bold tracking-[0.14em] text-accent uppercase"
      >
        {t("openWorkItem.title")}
      </h2>
      <form className="mt-4 space-y-4" onSubmit={submit}>
        <div>
          <label htmlFor={choiceId} className="text-sm font-semibold text-ink">
            {t("openWorkItem.choice")}
          </label>
          <select
            id={choiceId}
            className={inputClass}
            value={choice}
            onChange={(event) => setChoice(event.target.value)}
          >
            <option value="">{t("openWorkItem.choose")}</option>
            {[true, false].map((value) => {
              const group = suggestions.filter(
                (suggestion) => suggestion.onRobot === value,
              );
              return (
                group.length > 0 && (
                  <optgroup
                    key={String(value)}
                    label={
                      value
                        ? t("openWorkItem.robot")
                        : t("openWorkItem.offRobot")
                    }
                  >
                    {group.map((suggestion) => (
                      <option key={suggestion.title} value={suggestion.title}>
                        {suggestion.title}
                      </option>
                    ))}
                  </optgroup>
                )
              );
            })}
            <option value={OTHER}>{t("openWorkItem.other")}</option>
          </select>
        </div>

        {other && (
          <>
            <div>
              <label
                htmlFor={inputId}
                className="text-sm font-semibold text-ink"
              >
                {t("openWorkItem.name")}
              </label>
              <input
                id={inputId}
                className={inputClass}
                value={name}
                maxLength={120}
                placeholder={t("openWorkItem.namePlaceholder")}
                aria-invalid={issues.length > 0}
                aria-describedby={
                  issues.length > 0 ? `${inputId}-errors` : undefined
                }
                onChange={(event) => setName(event.target.value)}
              />
              <FieldErrors id={`${inputId}-errors`} issues={issues} />
              {existing && (
                <p className="mt-2 text-sm text-muted">
                  {t("openWorkItem.taken")}{" "}
                  <Link
                    to={`/work-items/${existing.id}`}
                    className="font-semibold text-accent hover:text-ink"
                  >
                    {t("openWorkItem.goTo", { title: existing.title })}
                  </Link>
                </p>
              )}
            </div>

            <fieldset className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-body">
              <legend className="mb-1 font-semibold text-ink">
                {t("openWorkItem.place")}
              </legend>
              {[true, false].map((value) => (
                <label key={String(value)} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name={`${inputId}-place`}
                    checked={side === value}
                    onChange={() => setOnRobot(value)}
                  />
                  {value ? t("openWorkItem.robot") : t("openWorkItem.offRobot")}
                </label>
              ))}
            </fieldset>
          </>
        )}

        <Button
          variant="primary"
          type="submit"
          disabled={open.isPending || !ready}
        >
          {open.isPending
            ? t("openWorkItem.opening")
            : t("openWorkItem.submit")}
        </Button>
        <RequestError error={open.error} handledFields={["title"]} />
      </form>
    </Panel>
  );
}

/** The button sits in the list's toolbar, `children` on its right; the panel
 * opens under the whole row. */
export function OpenWorkItemPanel({
  teamSeasonId,
  workItems,
  children,
}: {
  teamSeasonId: number;
  workItems: WorkItem[];
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <Button
          variant="dark"
          className="self-start sm:self-auto"
          aria-expanded={isOpen}
          onClick={() => setIsOpen((open) => !open)}
        >
          {t("openWorkItem.action")}
        </Button>
        {children}
      </div>
      {isOpen && (
        <OpenWorkItemForm teamSeasonId={teamSeasonId} workItems={workItems} />
      )}
    </div>
  );
}
