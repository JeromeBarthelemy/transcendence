import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { openWorkItem } from "../api/workItems";
import {
  FieldErrors,
  fieldIssues,
  RequestError,
} from "../components/ApiErrors";

const inputClass =
  "mt-1 block w-full rounded-xl border border-[#004fc5]/20 bg-white px-3 py-2 text-sm font-normal";

function Panel({ teamSeasonId }: { teamSeasonId: number }) {
  const { t } = useTranslation();
  const titleId = useId();
  const inputId = useId();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
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
  const title = name.trim();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (title && onRobot !== null) {
      open.mutate({ title, on_robot: onRobot });
    }
  }

  return (
    <section
      aria-labelledby={titleId}
      className="mt-4 rounded-2xl border border-[#004fc5]/12 bg-white p-5 shadow-sm"
    >
      <h2
        id={titleId}
        className="text-xs font-bold tracking-[0.14em] text-[#0078dd] uppercase"
      >
        {t("openWorkItem.title")}
      </h2>
      <form className="mt-4 space-y-4" onSubmit={submit}>
        <div>
          <label
            htmlFor={inputId}
            className="text-sm font-semibold text-[#041894]"
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
        </div>

        <fieldset className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-[#13294b]">
          <legend className="mb-1 font-semibold text-[#041894]">
            {t("openWorkItem.place")}
          </legend>
          {[true, false].map((value) => (
            <label key={String(value)} className="flex items-center gap-2">
              <input
                type="radio"
                name={`${inputId}-place`}
                checked={onRobot === value}
                onChange={() => setOnRobot(value)}
              />
              {value ? t("openWorkItem.robot") : t("openWorkItem.offRobot")}
            </label>
          ))}
        </fieldset>

        <button
          type="submit"
          className="rounded-xl bg-[#0078dd] px-4 py-2 text-sm font-semibold text-white hover:bg-[#004fc5] disabled:opacity-50"
          disabled={open.isPending || !title || onRobot === null}
        >
          {open.isPending
            ? t("openWorkItem.opening")
            : t("openWorkItem.submit")}
        </button>
        <RequestError error={open.error} handledFields={["title"]} />
      </form>
    </section>
  );
}

export function OpenWorkItemPanel({ teamSeasonId }: { teamSeasonId: number }) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div>
      <button
        type="button"
        className="rounded-xl bg-[#041894] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0078dd]"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
      >
        {t("openWorkItem.action")}
      </button>
      {isOpen && <Panel teamSeasonId={teamSeasonId} />}
    </div>
  );
}
