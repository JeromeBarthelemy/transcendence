import { useQuery } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { Link, Navigate, useParams } from "react-router-dom";

import { getDaySummary, type SummaryEntry } from "../api/workdays";
import { formatWorkdayDate, nameFormatter } from "../app/formatters";
import { useCurrentUser } from "../app/useCurrentUser";
import { RequestError } from "../components/ApiErrors";
import { Avatar, AvatarStack } from "../components/Avatar";

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
    <article className="rounded-2xl border border-[#004fc5]/12 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-3">
        {entry.work_item && (
          <h3 className="brand-title text-lg text-[#041894]">
            {entry.work_item.title}
          </h3>
        )}
        {entry.step && (
          <span className="rounded-full bg-[#eaf5ff] px-3 py-1 text-xs font-semibold text-[#0078dd]">
            {t(`teamHome.steps.${entry.step}`)}
          </span>
        )}
        <span className="flex items-center gap-2 text-sm text-[#506784]">
          <AvatarStack people={entry.participants} />
          {nameFormatter.format(
            entry.participants.map((person) => person.display_name),
          )}
        </span>
      </div>
      {entry.body && <p className="mt-2 text-[#041894]">{entry.body}</p>}
      {attachments && (
        <p className="mt-2 text-sm text-[#506784]">{attachments}</p>
      )}
      {entry.handover && (
        <div className="mt-3 border-l-4 border-[#d59600] bg-[#fff7dc] py-2 pr-3 pl-3 text-[#634c12]">
          <p className="text-xs font-bold tracking-[0.12em] uppercase">
            {t("teamHome.handover")}
          </p>
          <p className="mt-1 text-sm">{entry.handover}</p>
        </div>
      )}
    </article>
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
      className="text-sm font-semibold text-[#0078dd] hover:underline"
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
      <main className="mx-auto w-full max-w-4xl flex-1 px-5 py-14 sm:px-8">
        <p role="status" className="text-sm text-[#506784]">
          {t("auth.checkingSession")}
        </p>
      </main>
    );
  }
  if (currentUser.isError) {
    return (
      <main className="mx-auto w-full max-w-4xl flex-1 px-5 py-14 sm:px-8">
        <RequestError error={currentUser.error} />
      </main>
    );
  }
  if (!currentUser.data) {
    return <Navigate to="/login" replace />;
  }
  if (summary.isPending) {
    return (
      <main className="mx-auto w-full max-w-4xl flex-1 px-5 py-14 sm:px-8">
        <p role="status" className="text-sm text-[#506784]">
          {t("daySummary.loading")}
        </p>
      </main>
    );
  }
  if (summary.isError) {
    return (
      <main className="mx-auto w-full max-w-4xl flex-1 px-5 py-14 sm:px-8">
        <RequestError error={summary.error} />
      </main>
    );
  }

  const { entries, present, roster, previous, next } = summary.data;
  const progress = entries.filter((entry) => entry.type === "progress");
  const others = entries.filter((entry) => entry.type !== "progress");
  const title = formatWorkdayDate(summary.data.day);

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-5 py-10 sm:px-8 sm:py-14">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <h1 className="brand-title text-3xl tracking-[-0.035em] text-[#041894] sm:text-4xl">
            {title.charAt(0).toUpperCase() + title.slice(1)}
          </h1>
          {teamSeason && (
            <p className="mt-2 text-sm text-[#506784]">
              {t("teamHome.teamTitle", {
                number: teamSeason.team.number,
                name: teamSeason.team.name,
              })}
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
        <h2
          id="day-produced"
          className="text-xs font-bold tracking-[0.14em] text-[#0078dd] uppercase"
        >
          {t("daySummary.produced")}
        </h2>
        {entries.length === 0 ? (
          <p className="mt-3 text-sm text-[#506784]">{t("daySummary.empty")}</p>
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
                  <li key={entry.id} className="text-sm text-[#041894]">
                    <span className="mr-2 rounded-full bg-[#eaf5ff] px-3 py-1 text-xs font-semibold text-[#0078dd]">
                      {entry.type === "decision"
                        ? t("daySummary.decision")
                        : t("daySummary.note")}
                    </span>
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
          <h2
            id="day-present"
            className="text-xs font-bold tracking-[0.14em] text-[#0078dd] uppercase"
          >
            {t("daySummary.present", { count: present.length, roster })}
          </h2>
          <span className="text-xs text-[#506784]">
            {t("daySummary.presentFrom")}
          </span>
        </div>
        <ul className="mt-3 flex flex-wrap gap-2">
          {present.map((person) => (
            <li
              key={person.display_name}
              className="flex items-center gap-2 rounded-full border border-[#004fc5]/20 bg-[#eaf5ff] py-1 pr-3 pl-1 text-sm font-semibold text-[#041894]"
            >
              <Avatar person={person} size="sm" />
              {person.display_name}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
