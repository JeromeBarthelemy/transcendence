import { useQuery } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { Link, Navigate, useParams } from "react-router-dom";

import {
  getActivityCalendar,
  getDaySummary,
  type SummaryEntry,
} from "../api/workdays";
import { useFormatters } from "../app/formatters";
import { useCurrentUser } from "../app/useCurrentUser";
import { RequestError } from "../components/ApiErrors";
import { Avatar, AvatarStack } from "../components/Avatar";
import { ButtonLink } from "../components/Button";
import { Chip } from "../components/Chip";
import { IconLabel } from "../components/Icon";
import { Notice } from "../components/Notice";
import { Page } from "../components/Page";
import { Panel } from "../components/Panel";
import { SessionCalendarPicker } from "../components/SessionCalendarPicker";
import { Eyebrow, Heading } from "../components/Typography";

function attachmentCounts(entry: SummaryEntry, t: TFunction) {
  const types = entry.attachments.map((file) => file.content_type);
  const photos = types.filter((type) => type.startsWith("image/")).length;
  const videos = types.filter((type) => type.startsWith("video/")).length;
  const files = types.length - photos - videos;
  return [
    photos && t("daySummary.photos", { count: photos }),
    videos && t("daySummary.videos", { count: videos }),
    files && t("daySummary.files", { count: files }),
  ]
    .filter(Boolean)
    .join(" · ");
}

function Progress({ entry }: { entry: SummaryEntry }) {
  const { t } = useTranslation();
  const { nameFormatter } = useFormatters();
  const attachments = attachmentCounts(entry, t);

  return (
    <Panel as="article" padding="sm">
      <div className="flex flex-wrap items-center gap-3">
        {entry.work_item && (
          <Heading size="small">{entry.work_item.title}</Heading>
        )}
        {entry.step && <Chip>{t(`teamHome.steps.${entry.step}`)}</Chip>}
        <span className="flex items-center gap-2 text-sm text-muted">
          <AvatarStack people={entry.participants} />
          {nameFormatter.format(
            entry.participants.map((person) => person.display_name),
          )}
        </span>
      </div>
      {entry.body && <p className="mt-2 text-ink">{entry.body}</p>}
      {attachments && <p className="mt-2 text-sm text-muted">{attachments}</p>}
      {entry.handover && (
        <Notice tone="warning" callout className="mt-3">
          <Eyebrow tracking="tight" tone="inherit">
            {t("teamHome.handover")}
          </Eyebrow>
          <p className="mt-1 text-sm">{entry.handover}</p>
        </Notice>
      )}
    </Panel>
  );
}

function DayLink({
  teamSeasonId,
  day,
  direction,
}: {
  teamSeasonId: number;
  day: string;
  direction: "previous" | "next";
}) {
  const { t } = useTranslation();
  const { formatWorkdayDate } = useFormatters();
  return (
    <Link
      to={`/team-seasons/${teamSeasonId}/days/${day}`}
      aria-label={t(`daySummary.${direction}Session`, {
        date: formatWorkdayDate(day),
      })}
      className="text-sm font-semibold text-accent hover:underline"
    >
      {direction === "previous" && <span aria-hidden="true">◂ </span>}
      {formatWorkdayDate(day)}
      {direction === "next" && <span aria-hidden="true"> ▸</span>}
    </Link>
  );
}

export function DaySummaryPage() {
  const { t } = useTranslation();
  const { formatWorkdayDate } = useFormatters();
  const params = useParams();
  const teamSeasonId = Number(params.teamSeasonId);
  const day = params.day ?? "";
  const currentUser = useCurrentUser();
  const summary = useQuery({
    queryKey: ["team-seasons", teamSeasonId, "days", day, "summary"],
    queryFn: () => getDaySummary(teamSeasonId, day),
    enabled: Boolean(currentUser.data),
  });
  // Share the calendar's request and use its server-resolved 4 a.m. workday.
  const month = summary.data?.day.slice(0, 7) ?? "";
  const calendar = useQuery({
    queryKey: ["team-seasons", teamSeasonId, "calendar", month],
    queryFn: () => getActivityCalendar(teamSeasonId, month),
    enabled: Boolean(currentUser.data) && summary.isSuccess,
  });
  const teamSeason = currentUser.data?.team_seasons.find(
    (item) => item.id === teamSeasonId,
  );

  if (currentUser.isPending) {
    return (
      <Page message>
        <p role="status" className="text-sm text-muted">
          {t("auth.checkingSession")}
        </p>
      </Page>
    );
  }
  if (currentUser.isError) {
    return (
      <Page message>
        <RequestError error={currentUser.error} />
      </Page>
    );
  }
  if (!currentUser.data) {
    return <Navigate to="/login" replace />;
  }
  if (summary.isPending) {
    return (
      <Page message>
        <p role="status" className="text-sm text-muted">
          {t("daySummary.loading")}
        </p>
      </Page>
    );
  }
  if (summary.isError) {
    return (
      <Page message>
        <RequestError error={summary.error} />
      </Page>
    );
  }

  const { entries, present, roster, previous, next } = summary.data;
  const progress = entries.filter((entry) => entry.type === "progress");
  const others = entries.filter((entry) => entry.type !== "progress");
  const title = formatWorkdayDate(summary.data.day);
  const isToday = day === "today" || summary.data.day === calendar.data?.today;

  return (
    <Page>
      <div className="flex flex-col justify-between gap-5 border-b border-line pb-6 md:flex-row md:items-end">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <Heading size="page">
              {title.charAt(0).toUpperCase() + title.slice(1)}
            </Heading>
            {isToday && <Chip tone="mint">{t("daySummary.today")}</Chip>}
          </div>
          {teamSeason && (
            <p className="mt-2 text-sm text-muted">
              <IconLabel icon="team" before>
                {t("teamHome.teamTitle", {
                  number: teamSeason.team.number,
                  name: teamSeason.team.name,
                })}
              </IconLabel>
            </p>
          )}
        </div>
        <div className="relative flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <ButtonLink
              to={`/team-seasons/${teamSeasonId}/days/today`}
              aria-current={isToday ? "date" : undefined}
            >
              {t("daySummary.today")}
            </ButtonLink>
            <SessionCalendarPicker
              key={`${teamSeasonId}:${summary.data.day}`}
              teamSeasonId={teamSeasonId}
              day={summary.data.day}
            />
          </div>
          <nav
            aria-label={t("daySummary.recordedSessions")}
            className="flex flex-wrap gap-4"
          >
            {previous && (
              <DayLink
                teamSeasonId={teamSeasonId}
                day={previous}
                direction="previous"
              />
            )}
            {next && (
              <DayLink
                teamSeasonId={teamSeasonId}
                day={next}
                direction="next"
              />
            )}
          </nav>
        </div>
      </div>

      <div className="mt-8 grid items-start gap-8 md:grid-cols-[minmax(0,1fr)_15rem]">
        <section aria-labelledby="day-produced" className="min-w-0">
          <Eyebrow as="h2" id="day-produced">
            {t("daySummary.produced")}
          </Eyebrow>
          {entries.length === 0 ? (
            <p className="mt-3 text-sm text-muted">{t("daySummary.empty")}</p>
          ) : (
            <>
              <div className="mt-4 space-y-3">
                {progress.map((entry) => (
                  <Progress key={entry.id} entry={entry} />
                ))}
              </div>
              {others.length > 0 && (
                <ul className="mt-4 space-y-2">
                  {others.map((entry) => (
                    <li key={entry.id} className="text-sm text-ink">
                      <Chip className="mr-2">
                        {entry.type === "decision"
                          ? t("daySummary.decision")
                          : t("daySummary.note")}
                      </Chip>
                      {entry.work_item && (
                        <>
                          <strong>{entry.work_item.title}</strong>
                          {" · "}
                        </>
                      )}
                      {entry.body}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </section>

        <section
          aria-labelledby="day-present"
          className="min-w-0 border-t-2 border-primary pt-4"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <Eyebrow as="h2" id="day-present">
              {t("daySummary.present", { count: present.length, roster })}
            </Eyebrow>
            <span className="text-xs text-muted">
              {t("daySummary.presentFrom")}
            </span>
          </div>
          <ul className="mt-3 flex flex-wrap gap-2">
            {present.map((person) => (
              <li
                key={person.display_name}
                className="flex items-center gap-2 rounded-md bg-white py-1 pr-3 pl-1 text-sm font-semibold text-ink"
              >
                <Avatar person={person} size="sm" />
                {person.display_name}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </Page>
  );
}
