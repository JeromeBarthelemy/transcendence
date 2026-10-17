import {
  type UseQueryResult,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";

import type { Identity, TeamSeasonSummary } from "../api/auth";
import { getTeamSeasonRoster } from "../api/members";
import {
  getRuleSources,
  isDismissed,
  ruleSourcesQueryKey,
} from "../api/ruleSources";
import { createTeamNote, getWorkday, type Workday } from "../api/workdays";
import { getWorkItems, type WorkItem } from "../api/workItems";
import { fetchFreshEntry } from "../app/entries";
import { useFormatters } from "../app/formatters";
import { RequestError } from "../components/ApiErrors";
import { Avatar, AvatarStack, OnlineDot } from "../components/Avatar";
import { Button, ButtonLink, buttonClass } from "../components/Button";
import { StatusChip } from "../components/Chip";
import { EmptyState } from "../components/EmptyState";
import { EntryActions } from "../components/EntryActions";
import { Label, Select, TextArea } from "../components/Field";
import { IconLabel, type IconName } from "../components/Icon";
import { Notice, SuccessMessage } from "../components/Notice";
import { Page } from "../components/Page";
import { Panel } from "../components/Panel";
import { SectionTabs } from "../components/SectionTabs";
import { TeamActivity } from "../components/TeamActivity";
import { Eyebrow, Heading } from "../components/Typography";
import { OpenWorkItemPanel } from "./OpenWorkItemPanel";

type StatusFilter = "all" | WorkItem["status"];
type TeamSection = "work-items" | "activity";

const WORK_ITEM_STATUSES: WorkItem["status"][] = ["open", "done", "dropped"];
const TEAM_SECTIONS: TeamSection[] = ["work-items", "activity"];
const SECTION_ICONS: Record<TeamSection, IconName> = {
  "work-items": "wrench",
  activity: "chart",
};

function teamLabel(teamSeason: TeamSeasonSummary) {
  return `${teamSeason.team.number} · ${teamSeason.team.name}`;
}

function WorkItemCard({
  item,
  currentWorkday,
}: {
  item: WorkItem;
  currentWorkday?: string;
}) {
  const { t } = useTranslation();
  const { nameFormatter, formatActivityDate } = useFormatters();
  const participants = item.last_progress
    ? nameFormatter.format(
        item.last_progress.participants.map((person) => person.display_name),
      )
    : null;

  return (
    <article>
      <Link
        to={`/work-items/${item.id}`}
        className="group block border-l-2 border-transparent p-4 transition-colors hover:border-primary hover:bg-mist focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-lagoon sm:p-5"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <Heading
            size="card"
            className="min-w-0 flex-1 group-hover:text-primary"
          >
            {item.title}
          </Heading>
          <StatusChip status={item.status} />
        </div>

        {item.current_step && (
          <p className="mt-3 text-sm font-semibold text-accent">
            {t(`teamHome.steps.${item.current_step}`)}
          </p>
        )}

        {item.last_progress ? (
          <p className="mt-2 flex flex-wrap items-center gap-2 text-sm leading-6 text-muted">
            <AvatarStack people={item.last_progress.participants} />
            {t("teamHome.lastProgress", {
              people: participants || t("teamHome.noParticipants"),
              date: formatActivityDate(item.last_progress.day, currentWorkday),
            })}
          </p>
        ) : (
          <p className="mt-2 text-sm text-muted">{t("teamHome.notStarted")}</p>
        )}

        {item.handover && (
          <Notice tone="warning" callout className="mt-3">
            <Eyebrow tracking="tight" tone="inherit">
              {t("teamHome.handover")}
            </Eyebrow>
            <p className="mt-2 text-sm leading-6">{item.handover.body}</p>
            <p className="mt-2 text-xs text-warning-muted">
              {t("teamHome.handoverMeta", {
                author: item.handover.author,
                date: formatActivityDate(item.handover.day, currentWorkday),
              })}
            </p>
          </Notice>
        )}
      </Link>
    </article>
  );
}

function WorkItemSection({
  id,
  title,
  icon,
  items,
  currentWorkday,
}: {
  id: string;
  title: string;
  icon: IconName;
  items: WorkItem[];
  currentWorkday?: string;
}) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(true);
  const contentId = `${id}-content`;

  return (
    <section aria-labelledby={id}>
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <Heading size="section" id={id}>
          <button
            type="button"
            className="flex items-center gap-2 rounded-sm text-left focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-lagoon"
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
            <IconLabel icon={icon}>{title}</IconLabel>
          </button>
        </Heading>
        <span className="shrink-0 text-xs text-muted tabular-nums">
          {t("teamHome.workItemCount", { count: items.length })}
        </span>
      </div>
      <div id={contentId} hidden={!isOpen}>
        {items.length > 0 ? (
          <Panel padding="none">
            {items.map((item) => (
              <WorkItemCard
                key={item.id}
                item={item}
                currentWorkday={currentWorkday}
              />
            ))}
          </Panel>
        ) : (
          <EmptyState>{t("teamHome.noWorkItems")}</EmptyState>
        )}
      </div>
    </section>
  );
}

function TodaySummary({
  teamSeasonId,
  day,
}: {
  teamSeasonId: number;
  day: UseQueryResult<Workday, Error>;
}) {
  const { t } = useTranslation();
  const { formatWorkdayDate, noteTimeFormatter } = useFormatters();
  const queryClient = useQueryClient();
  const [isNoteOpen, setIsNoteOpen] = useState(false);
  const [noteBody, setNoteBody] = useState("");
  const [noteSaved, setNoteSaved] = useState(false);
  // Every day of the team, so a summary already opened shows the note too.
  const daysQueryKey = ["team-seasons", teamSeasonId, "days"] as const;
  const note = useMutation({
    mutationFn: (body: string) => createTeamNote(teamSeasonId, body),
    onSuccess: async () => {
      setNoteBody("");
      setIsNoteOpen(false);
      setNoteSaved(true);
      await queryClient.invalidateQueries({ queryKey: daysQueryKey });
    },
  });
  const dayNotes =
    day.data?.entries.filter(
      (entry) => entry.type === "note" && entry.work_item === null,
    ) ?? [];
  const reloadDays = () =>
    queryClient.invalidateQueries({ queryKey: daysQueryKey });

  async function currentBody(entryId: number) {
    const entry = await fetchFreshEntry(
      queryClient,
      {
        queryKey: ["team-seasons", teamSeasonId, "days", "today"],
        queryFn: () => getWorkday(teamSeasonId, "today"),
      },
      (day) => day.entries,
      entryId,
    );
    return entry?.body ?? null;
  }

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
    <Panel
      as="section"
      aria-labelledby="today-summary"
      className="border-t-2 border-t-primary"
    >
      <div className="flex flex-col gap-5">
        <div>
          <Eyebrow as="h2" id="today-summary">
            {t("teamHome.today")}
          </Eyebrow>
          {day.isPending ? (
            <p role="status" className="mt-2 text-sm text-muted">
              {t("teamHome.loadingDay")}
            </p>
          ) : day.isError ? (
            <div className="mt-2">
              <RequestError error={day.error} />
            </div>
          ) : (
            <div className="mt-3 text-sm text-muted">
              <p className="font-semibold text-ink">
                {formatWorkdayDate(day.data.day)}
              </p>
              <ul className="mt-3 space-y-1.5 leading-6 tabular-nums">
                <li>
                  {t("teamHome.advancedWorkItemCount", {
                    count: day.data.advanced_work_items,
                  })}
                </li>
                <li>
                  {t("teamHome.presentCount", {
                    count: day.data.present.length,
                    roster: day.data.roster,
                  })}
                </li>
              </ul>
            </div>
          )}
          {day.data && (
            <p className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-sm font-semibold">
              {day.data.previous && (
                <Link
                  to={`/team-seasons/${teamSeasonId}/days/${day.data.previous}`}
                  className="text-accent hover:underline"
                >
                  {t("teamHome.previousDayLink")}
                </Link>
              )}
              <Link
                to={`/team-seasons/${teamSeasonId}/days/${day.data.day}`}
                className="text-accent hover:underline"
              >
                {t("teamHome.daySummaryLink")}
              </Link>
            </p>
          )}
        </div>

        <Button
          variant="dark"
          className="self-start"
          aria-expanded={isNoteOpen}
          aria-controls="team-note-form"
          onClick={toggleNote}
        >
          {t("teamHome.addNote")}
        </Button>
      </div>

      {noteSaved && (
        <SuccessMessage className="mt-4">
          {t("teamHome.noteSaved")}
        </SuccessMessage>
      )}

      {dayNotes.length > 0 && (
        <div className="mt-5 border-t border-line pt-5">
          <h3 className="text-sm font-semibold text-ink">
            {t("teamHome.dayNotes")}
          </h3>
          <ul className="mt-3 divide-y divide-line">
            {dayNotes.map((entry) => (
              <li key={entry.id} className="py-3 first:pt-0 last:pb-0">
                <EntryActions
                  entry={entry}
                  onChanged={reloadDays}
                  currentBody={() => currentBody(entry.id)}
                >
                  <p className="text-sm leading-6 whitespace-pre-wrap break-words text-body">
                    {entry.body}
                  </p>
                </EntryActions>
                <p className="mt-1 text-xs text-muted">
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
          className="mt-5 border-t border-line pt-5"
          onSubmit={submitNote}
        >
          <Label htmlFor="team-note-body">{t("teamHome.noteLabel")}</Label>
          <TextArea
            className="min-h-24"
            id="team-note-body"
            value={noteBody}
            placeholder={t("teamHome.notePlaceholder")}
            required
            onChange={(event) => setNoteBody(event.target.value)}
          />

          {note.isError && <RequestError error={note.error} />}

          <div className="mt-3 flex justify-end gap-3">
            <Button
              disabled={note.isPending}
              onClick={() => {
                setIsNoteOpen(false);
                setNoteBody("");
                note.reset();
              }}
            >
              {t("teamHome.cancelNote")}
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={note.isPending || noteBody.trim().length === 0}
            >
              {note.isPending
                ? t("teamHome.savingNote")
                : t("teamHome.saveNote")}
            </Button>
          </div>
        </form>
      )}
    </Panel>
  );
}

const EXPORT_CATEGORIES = ["robot", "outreach", "team-life"] as const;

function NotebookExport({ teamSeasonId }: { teamSeasonId: number }) {
  const { t } = useTranslation();
  const [category, setCategory] = useState("");
  // A plain link: the session cookie goes with it, and the response names
  // the file. Every team shown here is one the export lets this user read.
  const query = new URLSearchParams({ format: "markdown" });
  if (category) {
    query.set("category", category);
  }

  // Folded away: a season is exported once or twice, at its end.
  return (
    <details className="mt-8 border-t border-line pt-5 text-sm text-muted">
      <summary className="cursor-pointer font-semibold text-primary">
        {t("teamHome.exportNotebook")}
      </summary>
      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
        <Label>
          {t("teamHome.exportCategory")}
          <Select
            className="sm:w-auto"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
          >
            <option value="">{t("teamHome.exportWholeSeason")}</option>
            {EXPORT_CATEGORIES.map((key) => (
              <option key={key} value={key}>
                {t(`teamHome.exportCategories.${key}`)}
              </option>
            ))}
          </Select>
        </Label>
        <a
          className={buttonClass({ variant: "primary" })}
          href={`/api/team-seasons/${teamSeasonId}/export/?${query}`}
          download
        >
          {t("teamHome.downloadNotebook")}
        </a>
      </div>
    </details>
  );
}

/** A teammate's name or avatar, opening their profile (#176) — the students
 * this team counts on; mentors are left out, same as the roster count
 * `TodaySummary` already shows for the day. */
function TeamRoster({ teamSeasonId }: { teamSeasonId: number }) {
  const roster = useQuery({
    queryKey: ["team-seasons", teamSeasonId, "roster"],
    queryFn: () => getTeamSeasonRoster(teamSeasonId),
  });
  if (!roster.data || roster.data.length === 0) {
    return null;
  }
  return (
    <ul className="mt-4 flex flex-wrap gap-2">
      {roster.data.map((member) => (
        <li key={member.id}>
          <Link
            to={`/members/${member.id}`}
            className="inline-flex items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-body transition-colors hover:bg-tint focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lagoon"
          >
            <Avatar person={member} size="sm" />
            {member.display_name}
            <OnlineDot online={member.online} />
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function TeamHomePage({ identity }: { identity: Identity }) {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("open");
  const requestedSection = searchParams.get("section");
  const section: TeamSection = TEAM_SECTIONS.includes(
    requestedSection as TeamSection,
  )
    ? (requestedSection as TeamSection)
    : "work-items";
  const selectedTeamSeason =
    identity.team_seasons.find(
      (item) => item.id === Number(searchParams.get("team")),
    ) ?? identity.team_seasons[0];
  const teamSeasonId = selectedTeamSeason?.id ?? null;
  const workItems = useQuery({
    queryKey: ["team-seasons", teamSeasonId, "work-items"],
    queryFn: () =>
      teamSeasonId === null ? Promise.resolve([]) : getWorkItems(teamSeasonId),
    enabled: teamSeasonId !== null && section === "work-items",
  });
  const day = useQuery({
    queryKey: ["team-seasons", teamSeasonId, "days", "today"],
    queryFn: () =>
      teamSeasonId === null
        ? Promise.reject(new Error("A team is required"))
        : getWorkday(teamSeasonId, "today"),
    enabled: teamSeasonId !== null,
  });
  // Never fetched for anyone who cannot open the review screen it badges.
  const ruleSources = useQuery({
    queryKey: ruleSourcesQueryKey,
    queryFn: getRuleSources,
    enabled: identity.is_club_admin,
  });
  const hasSourceUpdate =
    ruleSources.data?.some(
      (row) => row.pending !== null && !isDismissed(row),
    ) ?? false;

  if (!selectedTeamSeason) {
    return (
      <Page message>
        <Eyebrow size="sm">
          <IconLabel icon="user">
            {t("teamHome.welcome", { name: identity.display_name })}
          </IconLabel>
        </Eyebrow>
        <Panel padding="xl" className="mt-6">
          <Heading size="large" as="h1">
            {t("teamHome.noTeamTitle")}
          </Heading>
          <p className="mt-3 max-w-xl leading-7 text-muted">
            {t("teamHome.noTeamDescription")}
          </p>
        </Panel>
      </Page>
    );
  }

  const visibleItems = (workItems.data ?? []).filter(
    (item) => statusFilter === "all" || item.status === statusFilter,
  );
  const robotItems = visibleItems.filter((item) => item.on_robot);
  const offRobotItems = visibleItems.filter((item) => !item.on_robot);

  return (
    <Page width="6xl">
      <header className="border-b border-line pb-6">
        <Eyebrow>
          <IconLabel icon="user">
            {t("teamHome.welcome", { name: identity.display_name })}
          </IconLabel>
        </Eyebrow>
        {hasSourceUpdate && (
          <Link
            to="/rules/sources"
            className="mt-3 inline-flex items-center gap-2 rounded-md border border-warning/40 bg-warning-tint px-3 py-2 text-sm font-semibold text-warning-ink transition hover:brightness-95"
          >
            {t("teamHome.sourceUpdateBadge")}
          </Link>
        )}
        <div className="mt-3 flex flex-col justify-between gap-5 md:flex-row md:items-end">
          <div>
            <Heading size="page">
              <IconLabel icon="team" before>
                {t("teamHome.teamTitle", {
                  number: selectedTeamSeason.team.number,
                  name: selectedTeamSeason.team.name,
                })}
              </IconLabel>
            </Heading>
            <p className="mt-2 text-sm text-muted">
              {t("teamHome.season", {
                start: selectedTeamSeason.season.start_year,
                end: selectedTeamSeason.season.start_year + 1,
                game: selectedTeamSeason.season.game_name,
              })}
            </p>
          </div>

          {identity.team_seasons.length > 1 && (
            <Label>
              {t("teamHome.chooseTeam")}
              <Select
                className="sm:w-auto"
                value={selectedTeamSeason.id}
                onChange={(event) =>
                  setSearchParams((current) => {
                    const next = new URLSearchParams(current);
                    next.set("team", event.target.value);
                    return next;
                  })
                }
              >
                {identity.team_seasons.map((teamSeason) => (
                  <option key={teamSeason.id} value={teamSeason.id}>
                    {teamLabel(teamSeason)}
                  </option>
                ))}
              </Select>
            </Label>
          )}
        </div>

        {/* No key: it would repeat its sibling's, and React draws a second
          roster on the next update. Its query already follows the team. */}
        <TeamRoster teamSeasonId={selectedTeamSeason.id} />
      </header>

      <SectionTabs
        label={t("teamHome.sectionsLabel")}
        className="mt-3 sm:max-w-md"
        current={section}
        tabs={TEAM_SECTIONS.map((item) => ({
          key: item,
          label: t(`teamHome.sections.${item}`),
          icon: SECTION_ICONS[item],
          to: {
            pathname: "/",
            search: searchParams.has("team")
              ? `?section=${item}&team=${selectedTeamSeason.id}`
              : `?section=${item}`,
          },
        }))}
      />

      <div
        className={
          section === "work-items"
            ? "mt-7 grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_19rem]"
            : "mt-7 space-y-8"
        }
      >
        <div className="min-w-0">
          {section === "activity" && (
            <TeamActivity
              teamSeason={selectedTeamSeason}
              currentWorkday={day.data?.day}
            />
          )}

          {section === "work-items" && (
            <div>
              {workItems.isPending ? (
                <p role="status" className="text-sm text-muted">
                  {t("teamHome.loading")}
                </p>
              ) : workItems.isError ? (
                <div>
                  <RequestError error={workItems.error} />
                </div>
              ) : (
                <div>
                  <OpenWorkItemPanel
                    key={selectedTeamSeason.id}
                    teamSeasonId={selectedTeamSeason.id}
                    workItems={workItems.data}
                    beside={
                      <ButtonLink
                        variant="secondary"
                        to={`/team-seasons/${selectedTeamSeason.id}/search`}
                      >
                        <IconLabel icon="search" before>
                          {t("search.open")}
                        </IconLabel>
                      </ButtonLink>
                    }
                  >
                    <Label>
                      {t("teamHome.filterByStatus")}
                      <Select
                        className="sm:w-auto"
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
                      </Select>
                    </Label>
                  </OpenWorkItemPanel>

                  <div className="mt-7 space-y-8">
                    <WorkItemSection
                      id="robot-work-items"
                      title={t("teamHome.robot")}
                      icon="robot"
                      items={robotItems}
                      currentWorkday={day.data?.day}
                    />
                    <WorkItemSection
                      id="off-robot-work-items"
                      title={t("teamHome.offRobot")}
                      icon="toolbox"
                      items={offRobotItems}
                      currentWorkday={day.data?.day}
                    />
                  </div>
                </div>
              )}

              <NotebookExport teamSeasonId={selectedTeamSeason.id} />
            </div>
          )}
        </div>
        <aside className="min-w-0" aria-labelledby="today-summary">
          <TodaySummary
            key={selectedTeamSeason.id}
            teamSeasonId={selectedTeamSeason.id}
            day={day}
          />
        </aside>
      </div>
    </Page>
  );
}
