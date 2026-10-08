import { useQuery } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { Link, Navigate, useParams } from "react-router-dom";

import { getDaySummary, type SummaryEntry } from "../api/workdays";
import { formatWorkdayDate, nameFormatter } from "../app/formatters";
import { useCurrentUser } from "../app/useCurrentUser";
import { RequestError } from "../components/ApiErrors";
import { Avatar, AvatarStack } from "../components/Avatar";
import { Chip } from "../components/Chip";
import { IconLabel } from "../components/Icon";
import { Notice } from "../components/Notice";
import { Page } from "../components/Page";
import { Panel } from "../components/Panel";
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
          <p className="text-xs font-bold tracking-[0.12em] uppercase">
            {t("teamHome.handover")}
          </p>
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
  return (
    <Link
      to={`/team-seasons/${teamSeasonId}/days/${day}`}
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
  const params = useParams();
  const teamSeasonId = Number(params.teamSeasonId);
  const day = params.day ?? "";
  const currentUser = useCurrentUser();
  const summary = useQuery({
    queryKey: ["team-seasons", teamSeasonId, "days", day, "summary"],
    queryFn: () => getDaySummary(teamSeasonId, day),
    enabled: Boolean(currentUser.data),
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

  return (
    <Page>
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <Heading size="page">
            {title.charAt(0).toUpperCase() + title.slice(1)}
          </Heading>
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
        <nav className="flex gap-4">
          {previous && (
            <DayLink
              teamSeasonId={teamSeasonId}
              day={previous}
              direction="previous"
            />
          )}
          {next && (
            <DayLink teamSeasonId={teamSeasonId} day={next} direction="next" />
          )}
        </nav>
      </div>

      <section aria-labelledby="day-produced" className="mt-10">
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

      <section aria-labelledby="day-present" className="mt-10">
        <div className="flex items-baseline justify-between gap-3">
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
              className="flex items-center gap-2 rounded-full border border-primary/20 bg-tint py-1 pr-3 pl-1 text-sm font-semibold text-ink"
            >
              <Avatar person={person} size="sm" />
              {person.display_name}
            </li>
          ))}
        </ul>
      </section>
    </Page>
  );
}
