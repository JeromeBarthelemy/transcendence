import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";

import type { Identity, TeamSeasonSummary } from "../api/auth";
import { createTeamNote, getWorkday } from "../api/workdays";
import { getWorkItems, type WorkItem } from "../api/workItems";
import { RequestError } from "../components/ApiErrors";

const WORKDAY_BOUNDARY_HOURS = 4;

type StatusFilter = "all" | WorkItem["status"];
const WORK_ITEM_STATUSES: WorkItem["status"][] = [
  "suggested",
  "open",
  "done",
  "dropped",
];

const dateFormatter = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "long",
});
const weekdayFormatter = new Intl.DateTimeFormat("fr-FR", {
  weekday: "long",
});
const relativeFormatter = new Intl.RelativeTimeFormat("fr-FR", {
  numeric: "auto",
});
const nameFormatter = new Intl.ListFormat("fr-FR", {
  style: "long",
  type: "conjunction",
});

const workdayDateFormatter = new Intl.DateTimeFormat("fr-FR", {
  weekday: "long",
  day: "numeric",
  month: "long",
});
const noteTimeFormatter = new Intl.DateTimeFormat("fr-FR", {
  hour: "2-digit",
  minute: "2-digit",
});
const parisCalendarFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Paris",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
});

function workdayKey(value: Date | string) {
  const date = typeof value === "string" ? new Date(value) : value;
  const parts = Object.fromEntries(
    parisCalendarFormatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  const day = `${parts.year}-${parts.month}-${parts.day}`;
  if (Number(parts.hour) >= WORKDAY_BOUNDARY_HOURS) {
    return day;
  }

  const previousDay = new Date(
    Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day) - 1,
    ),
  );
  return previousDay.toISOString().slice(0, 10);
}

function formatWorkdayDate(day: string) {
  return workdayDateFormatter.format(new Date(`${day}T12:00:00Z`));
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function formatActivityDate(value: string) {
  const date = new Date(value);
  const elapsedDays = Math.round(
    (startOfDay(new Date()).getTime() - startOfDay(date).getTime()) /
      (24 * 60 * 60 * 1000),
  );

  if (elapsedDays >= 0 && elapsedDays < 2) {
    return relativeFormatter.format(-elapsedDays, "day");
  }
  if (elapsedDays < 7) {
    return weekdayFormatter.format(date);
  }
  if (elapsedDays < 28) {
    return relativeFormatter.format(-Math.floor(elapsedDays / 7), "week");
  }
  return dateFormatter.format(date);
}

function WorkItemCard({ item }: { item: WorkItem }) {
  const { t } = useTranslation();
  const participants = item.last_progress
    ? nameFormatter.format(
        item.last_progress.participants.map((person) => person.display_name),
      )
    : null;

  return (
    <article className="p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h3 className="brand-title text-xl text-[#041894]">{item.title}</h3>
        <span className="rounded-full bg-[#eaf5ff] px-3 py-1 text-xs font-semibold text-[#0078dd]">
          {t(`teamHome.statuses.${item.status}`)}
        </span>
      </div>

      {item.current_step && (
        <p className="mt-3 text-sm font-semibold text-[#0078dd]">
          {t(`teamHome.steps.${item.current_step}`)}
        </p>
      )}

      {item.last_progress ? (
        <p className="mt-2 text-sm text-[#506784]">
          {t("teamHome.lastProgress", {
            people: participants || t("teamHome.noParticipants"),
            date: formatActivityDate(item.last_progress.occurred_at),
          })}
        </p>
      ) : (
        <p className="mt-2 text-sm text-[#506784]">
          {t("teamHome.notStarted")}
        </p>
      )}

      {item.handover && (
        <div className="mt-3 border-l-4 border-[#d59600] bg-[#fff7dc] py-2 pr-3 pl-3 text-[#634c12]">
          <p className="text-xs font-bold tracking-[0.12em] uppercase">
            {t("teamHome.handover")}
          </p>
          <p className="mt-2 text-sm leading-6">{item.handover.body}</p>
          <p className="mt-2 text-xs text-[#7a6221]">
            {t("teamHome.handoverMeta", {
              author: item.handover.author,
              date: formatActivityDate(item.handover.occurred_at),
            })}
          </p>
        </div>
      )}
    </article>
  );
}

function WorkItemSection({
  id,
  title,
  items,
}: {
  id: string;
  title: string;
  items: WorkItem[];
}) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(true);
  const contentId = `${id}-content`;

  return (
    <section aria-labelledby={id}>
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <h2 id={id} className="brand-title text-2xl text-[#041894]">
          <button
            type="button"
            className="flex items-center gap-2 text-left"
            aria-expanded={isOpen}
            aria-controls={contentId}
            onClick={() => setIsOpen((open) => !open)}
          >
            <svg
              aria-hidden="true"
              className={`h-4 w-4 transition-transform ${isOpen ? "rotate-90" : ""}`}
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="m6 3 5 5-5 5" />
            </svg>
            {title}
          </button>
        </h2>
        <span className="text-sm text-[#506784]">
          {t("teamHome.workItemCount", { count: items.length })}
        </span>
      </div>
      <div id={contentId} hidden={!isOpen}>
        {items.length > 0 ? (
          <div className="divide-y divide-[#004fc5]/10 overflow-hidden rounded-2xl border border-[#004fc5]/12 bg-white shadow-sm">
            {items.map((item) => (
              <WorkItemCard key={item.id} item={item} />
            ))}
          </div>
        ) : (
          <p className="rounded-2xl border border-dashed border-[#004fc5]/20 p-5 text-sm text-[#506784]">
            {t("teamHome.noWorkItems")}
          </p>
        )}
      </div>
    </section>
  );
}

function DayFooter({
  teamSeasonId,
  workItems,
}: {
  teamSeasonId: number;
  workItems: WorkItem[];
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const today = workdayKey(new Date());
  const [isNoteOpen, setIsNoteOpen] = useState(false);
  const [noteBody, setNoteBody] = useState("");
  const [noteSaved, setNoteSaved] = useState(false);
  const dayQueryKey = ["team-seasons", teamSeasonId, "days", today] as const;
  const day = useQuery({
    queryKey: dayQueryKey,
    queryFn: () => getWorkday(teamSeasonId, today),
  });
  const note = useMutation({
    mutationFn: (body: string) => createTeamNote(teamSeasonId, body),
    onSuccess: async () => {
      setNoteBody("");
      setIsNoteOpen(false);
      setNoteSaved(true);
      await queryClient.invalidateQueries({ queryKey: dayQueryKey });
    },
  });
  const advancedWorkItems = workItems.filter(
    (item) =>
      item.last_progress !== null &&
      workdayKey(item.last_progress.occurred_at) === today,
  ).length;
  const dayNotes =
    day.data?.entries.filter((entry) => entry.type === "note") ?? [];

  function submitNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = noteBody.trim();
    if (body) {
      note.mutate(body);
    }
  }

  function toggleNote() {
    setIsNoteOpen((open) => !open);
    setNoteSaved(false);
    note.reset();
  }

  return (
    <section
      aria-labelledby="today-summary"
      className="mt-10 rounded-2xl border border-[#004fc5]/12 bg-white p-5 shadow-sm"
    >
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h2
            id="today-summary"
            className="text-xs font-bold tracking-[0.14em] text-[#0078dd] uppercase"
          >
            {t("teamHome.today")}
          </h2>
          {day.isPending ? (
            <p role="status" className="mt-2 text-sm text-[#506784]">
              {t("teamHome.loadingDay")}
            </p>
          ) : day.isError ? (
            <div className="mt-2">
              <RequestError error={day.error} />
            </div>
          ) : (
            <p className="mt-2 text-sm text-[#506784]">
              <span className="font-semibold text-[#041894]">
                {formatWorkdayDate(day.data.day)}
              </span>
              <span aria-hidden="true"> · </span>
              {t("teamHome.advancedWorkItemCount", {
                count: advancedWorkItems,
              })}
              <span aria-hidden="true"> · </span>
              {t("teamHome.presentCount", {
                count: day.data.present.length,
                roster: day.data.roster,
              })}
            </p>
          )}
        </div>

        <button
          type="button"
          className="self-start rounded-xl bg-[#041894] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0078dd] sm:self-auto"
          aria-expanded={isNoteOpen}
          aria-controls="team-note-form"
          onClick={toggleNote}
        >
          {t("teamHome.addNote")}
        </button>
      </div>

      {noteSaved && (
        <p role="status" className="mt-4 text-sm font-semibold text-[#167448]">
          {t("teamHome.noteSaved")}
        </p>
      )}

      {dayNotes.length > 0 && (
        <div className="mt-5 border-t border-[#004fc5]/10 pt-5">
          <h3 className="text-sm font-semibold text-[#041894]">
            {t("teamHome.dayNotes")}
          </h3>
          <ul className="mt-3 space-y-3">
            {dayNotes.map((entry) => (
              <li key={entry.id} className="rounded-xl bg-[#f4f8ff] px-4 py-3">
                <p className="text-sm text-[#13294b]">{entry.body}</p>
                <p className="mt-1 text-xs text-[#506784]">
                  {t("teamHome.noteMeta", {
                    author: entry.author,
                    time: noteTimeFormatter.format(new Date(entry.occurred_at)),
                  })}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {isNoteOpen && (
        <form
          id="team-note-form"
          className="mt-5 border-t border-[#004fc5]/10 pt-5"
          onSubmit={submitNote}
        >
          <label
            htmlFor="team-note-body"
            className="text-sm font-semibold text-[#041894]"
          >
            {t("teamHome.noteLabel")}
          </label>
          <textarea
            id="team-note-body"
            className="mt-2 min-h-24 w-full rounded-xl border border-[#004fc5]/20 px-3 py-2 text-[#13294b]"
            value={noteBody}
            placeholder={t("teamHome.notePlaceholder")}
            required
            onChange={(event) => setNoteBody(event.target.value)}
          />

          {note.isError && <RequestError error={note.error} />}

          <div className="mt-3 flex justify-end gap-3">
            <button
              type="button"
              className="rounded-xl border border-[#004fc5]/20 px-4 py-2 text-sm font-semibold text-[#041894]"
              disabled={note.isPending}
              onClick={() => {
                setIsNoteOpen(false);
                setNoteBody("");
                note.reset();
              }}
            >
              {t("teamHome.cancelNote")}
            </button>
            <button
              type="submit"
              className="rounded-xl bg-[#0078dd] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              disabled={note.isPending || noteBody.trim().length === 0}
            >
              {note.isPending
                ? t("teamHome.savingNote")
                : t("teamHome.saveNote")}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

function teamLabel(teamSeason: TeamSeasonSummary) {
  return `${teamSeason.team.number} · ${teamSeason.team.name}`;
}

export function TeamHomePage({ identity }: { identity: Identity }) {
  const { t } = useTranslation();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const selectedTeamSeason =
    identity.team_seasons.find((item) => item.id === selectedId) ??
    identity.team_seasons[0];
  const teamSeasonId = selectedTeamSeason?.id ?? null;
  const workItems = useQuery({
    queryKey: ["team-seasons", teamSeasonId, "work-items"],
    queryFn: () =>
      teamSeasonId === null ? Promise.resolve([]) : getWorkItems(teamSeasonId),
    enabled: teamSeasonId !== null,
  });

  if (!selectedTeamSeason) {
    return (
      <main className="mx-auto w-full max-w-4xl flex-1 px-5 py-14 sm:px-8">
        <p className="text-sm font-bold tracking-[0.14em] text-[#0078dd] uppercase">
          {t("teamHome.welcome", { name: identity.display_name })}
        </p>
        <div className="mt-6 rounded-3xl border border-[#004fc5]/15 bg-white p-8 shadow-sm">
          <h1 className="brand-title text-3xl text-[#041894]">
            {t("teamHome.noTeamTitle")}
          </h1>
          <p className="mt-3 max-w-xl leading-7 text-[#506784]">
            {t("teamHome.noTeamDescription")}
          </p>
        </div>
      </main>
    );
  }

  const visibleItems = (workItems.data ?? []).filter(
    (item) => statusFilter === "all" || item.status === statusFilter,
  );
  const robotItems = visibleItems.filter((item) => item.on_robot);
  const offRobotItems = visibleItems.filter((item) => !item.on_robot);

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-10 sm:px-8 sm:py-14">
      <p className="text-sm font-bold tracking-[0.14em] text-[#0078dd] uppercase">
        {t("teamHome.welcome", { name: identity.display_name })}
      </p>

      <div className="mt-3 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <h1 className="brand-title text-3xl tracking-[-0.035em] text-[#041894] sm:text-4xl">
            {t("teamHome.teamTitle", {
              number: selectedTeamSeason.team.number,
              name: selectedTeamSeason.team.name,
            })}
          </h1>
          <p className="mt-2 text-sm text-[#506784]">
            {t("teamHome.season", {
              start: selectedTeamSeason.season.start_year,
              end: selectedTeamSeason.season.start_year + 1,
              game: selectedTeamSeason.season.game_name,
            })}
          </p>
        </div>

        {identity.team_seasons.length > 1 && (
          <label className="text-sm font-semibold text-[#041894]">
            {t("teamHome.chooseTeam")}
            <select
              className="mt-2 block w-full rounded-xl border border-[#004fc5]/20 bg-white px-3 py-2 font-normal sm:w-auto"
              value={selectedTeamSeason.id}
              onChange={(event) => setSelectedId(Number(event.target.value))}
            >
              {identity.team_seasons.map((teamSeason) => (
                <option key={teamSeason.id} value={teamSeason.id}>
                  {teamLabel(teamSeason)}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {workItems.isPending ? (
        <p role="status" className="mt-10 text-sm text-[#506784]">
          {t("teamHome.loading")}
        </p>
      ) : workItems.isError ? (
        <RequestError error={workItems.error} />
      ) : (
        <div className="mt-10">
          <div className="flex justify-end">
            <label className="text-sm font-semibold text-[#041894]">
              {t("teamHome.filterByStatus")}
              <select
                className="mt-2 block w-full rounded-xl border border-[#004fc5]/20 bg-white px-3 py-2 font-normal sm:w-auto"
                value={statusFilter}
                onChange={(event) =>
                  setStatusFilter(event.target.value as StatusFilter)
                }
              >
                <option value="all">{t("teamHome.allStatuses")}</option>
                {WORK_ITEM_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {t(`teamHome.statuses.${status}`)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="mt-8 space-y-10">
            <WorkItemSection
              id="robot-work-items"
              title={t("teamHome.robot")}
              items={robotItems}
            />
            <WorkItemSection
              id="off-robot-work-items"
              title={t("teamHome.offRobot")}
              items={offRobotItems}
            />
          </div>
        </div>
      )}

      <DayFooter
        key={selectedTeamSeason.id}
        teamSeasonId={selectedTeamSeason.id}
        workItems={workItems.data ?? []}
      />
    </main>
  );
}
