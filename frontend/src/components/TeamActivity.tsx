import { useQuery } from "@tanstack/react-query";
import { lazy, Suspense, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  type ActivityPeriod,
  activityAnalyticsCsvUrl,
  activityAnalyticsQueryKey,
  getActivityAnalytics,
  type MemberActivity,
} from "../api/activityAnalytics";
import type { TeamSeasonSummary } from "../api/auth";
import { RequestError } from "./ApiErrors";
import { Avatar } from "./Avatar";
import { buttonClass } from "./Button";
import { EmptyState } from "./EmptyState";
import { Label, Select, TextInput } from "./Field";
import { Panel } from "./Panel";
import { Eyebrow, Heading } from "./Typography";

type PeriodChoice = "last30" | "season" | "custom";

const ActivityOverTimeChart = lazy(async () => {
  const charts = await import("./ActivityCharts");
  return { default: charts.ActivityOverTimeChart };
});
const WorkItemsByStepChart = lazy(async () => {
  const charts = await import("./ActivityCharts");
  return { default: charts.WorkItemsByStepChart };
});

const fullDateFormatter = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "long",
  timeZone: "UTC",
});

function formatDate(day: string) {
  return fullDateFormatter.format(new Date(`${day}T12:00:00Z`));
}

function shiftDay(day: string, amount: number) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function parisToday() {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function seasonPeriod(startYear: number, today: string): ActivityPeriod {
  const since = `${startYear}-09-01`;
  const seasonEnd = `${startYear + 1}-08-31`;
  return {
    since,
    until: today < since ? since : today > seasonEnd ? seasonEnd : today,
  };
}

function ParticipationTable({ members }: { members: MemberActivity[] }) {
  const { t } = useTranslation();

  if (members.length === 0) {
    return <p className="mt-4 text-sm text-muted">{t("activity.noMembers")}</p>;
  }

  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full min-w-[44rem] border-collapse text-left text-sm">
        <caption className="sr-only">{t("activity.participation")}</caption>
        <thead>
          <tr className="border-b border-primary/15 text-xs tracking-wide text-muted uppercase">
            <th scope="col" className="px-3 py-3">
              {t("activity.member")}
            </th>
            <th scope="col" className="px-3 py-3 text-right">
              {t("activity.activeDays")}
            </th>
            <th scope="col" className="px-3 py-3 text-right">
              {t("activity.progressEntries")}
            </th>
            <th scope="col" className="px-3 py-3 text-right">
              {t("activity.distinctWorkItems")}
            </th>
            <th scope="col" className="px-3 py-3 text-right">
              {t("activity.lastParticipation")}
            </th>
          </tr>
        </thead>
        <tbody>
          {members.map((member) => (
            <tr
              key={member.id}
              className="border-b border-primary/8 last:border-0"
            >
              <th scope="row" className="px-3 py-4 font-semibold text-ink">
                <span className="flex items-center gap-3">
                  <Avatar person={member} />
                  <span>
                    {member.display_name}
                    {!member.is_current_member && (
                      <span className="mt-0.5 block text-xs font-normal text-muted">
                        {t("activity.formerMember")}
                      </span>
                    )}
                  </span>
                </span>
              </th>
              <td className="px-3 py-4 text-right text-body">
                {member.active_days}
              </td>
              <td className="px-3 py-4 text-right text-body">
                {member.progress_entries}
              </td>
              <td className="px-3 py-4 text-right text-body">
                {member.work_items}
              </td>
              <td className="px-3 py-4 text-right text-body">
                {member.last_progress_day
                  ? formatDate(member.last_progress_day)
                  : t("activity.noParticipation")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TeamActivity({
  teamSeason,
  currentWorkday,
}: {
  teamSeason: TeamSeasonSummary;
  currentWorkday?: string;
}) {
  const { t } = useTranslation();
  const today = currentWorkday ?? parisToday();
  const defaultPeriod = useMemo<ActivityPeriod>(
    () => ({ since: shiftDay(today, -29), until: today }),
    [today],
  );
  const [periodChoice, setPeriodChoice] = useState<PeriodChoice>("last30");
  const [customSince, setCustomSince] = useState(defaultPeriod.since);
  const [customUntil, setCustomUntil] = useState(defaultPeriod.until);
  const period =
    periodChoice === "season"
      ? seasonPeriod(teamSeason.season.start_year, today)
      : periodChoice === "custom"
        ? { since: customSince, until: customUntil }
        : defaultPeriod;
  const periodIsValid =
    Boolean(period.since && period.until) && period.since <= period.until;
  const analytics = useQuery({
    queryKey: activityAnalyticsQueryKey(teamSeason.id, period),
    queryFn: () => getActivityAnalytics(teamSeason.id, period),
    enabled: periodIsValid,
  });

  const snapshot = analytics.data?.snapshot;
  const statusCounts = new Map(
    snapshot?.work_items_by_status.map((item) => [item.status, item.count]),
  );
  const summary = [
    { key: "open", value: statusCounts.get("open") ?? 0 },
    { key: "done", value: statusCounts.get("done") ?? 0 },
    { key: "dropped", value: statusCounts.get("dropped") ?? 0 },
    {
      key: "withoutProgress",
      value: snapshot?.work_items_without_progress ?? 0,
    },
  ] as const;
  const stepData =
    snapshot?.work_items_by_step.map((item) => ({
      ...item,
      label: t(`teamHome.steps.${item.step}`),
    })) ?? [];
  const hasStartedWorkItems = stepData.some((item) => item.count > 0);

  return (
    <Panel
      as="section"
      padding="lg"
      aria-labelledby="team-activity-title"
      className="mt-10"
    >
      <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
        <div>
          <Eyebrow>{t("activity.eyebrow")}</Eyebrow>
          <Heading size="large" className="mt-1" id="team-activity-title">
            {t("activity.title")}
          </Heading>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
            {t("activity.description")}
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <Label>
            {t("activity.period")}
            <Select
              className="lg:w-auto"
              value={periodChoice}
              onChange={(event) =>
                setPeriodChoice(event.target.value as PeriodChoice)
              }
            >
              <option value="last30">{t("activity.last30Days")}</option>
              <option value="season">{t("activity.wholeSeason")}</option>
              <option value="custom">{t("activity.customPeriod")}</option>
            </Select>
          </Label>
          {periodIsValid && analytics.isSuccess && (
            <a
              className={buttonClass({ variant: "primary" })}
              href={activityAnalyticsCsvUrl(
                teamSeason.id,
                analytics.data.period,
              )}
              download
            >
              {t("activity.exportCsv")}
            </a>
          )}
        </div>
      </div>

      {periodChoice === "custom" && (
        <div className="mt-5 grid gap-4 rounded-2xl bg-mist p-4 sm:grid-cols-2">
          <Label>
            {t("activity.since")}
            <TextInput
              type="date"
              value={customSince}
              onChange={(event) => setCustomSince(event.target.value)}
            />
          </Label>
          <Label>
            {t("activity.until")}
            <TextInput
              type="date"
              value={customUntil}
              onChange={(event) => setCustomUntil(event.target.value)}
            />
          </Label>
        </div>
      )}

      {!periodIsValid ? (
        <p role="alert" className="mt-5 text-sm font-semibold text-danger">
          {t("activity.invalidPeriod")}
        </p>
      ) : analytics.isPending ? (
        <p role="status" className="mt-6 text-sm text-muted">
          {t("activity.loading")}
        </p>
      ) : analytics.isError ? (
        <div className="mt-6">
          <RequestError error={analytics.error} />
        </div>
      ) : (
        <div className="mt-7 space-y-9">
          <div>
            <Heading size="card">{t("activity.currentSnapshot")}</Heading>
            <p className="mt-1 text-sm text-muted">
              {t("activity.currentSnapshotHint")}
            </p>
            <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {summary.map((item) => (
                <div key={item.key} className="rounded-2xl bg-mist p-4">
                  <dt className="text-sm text-muted">
                    {item.key === "withoutProgress"
                      ? t("activity.withoutProgress")
                      : t(`teamHome.statuses.${item.key}`)}
                  </dt>
                  <dd className="brand-title mt-1 text-3xl text-ink">
                    {item.value}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="grid gap-8 xl:grid-cols-2">
            <section aria-labelledby="activity-over-time-title">
              <Heading size="card" id="activity-over-time-title">
                {t("activity.overTime")}
              </Heading>
              {analytics.data.activity_by_day.length === 0 ? (
                <EmptyState className="mt-4">
                  {t("activity.noActivity")}
                </EmptyState>
              ) : (
                <Suspense
                  fallback={
                    <p role="status" className="mt-4 text-sm text-muted">
                      {t("activity.loadingChart")}
                    </p>
                  }
                >
                  <ActivityOverTimeChart
                    data={analytics.data.activity_by_day}
                    title={t("activity.overTimeData")}
                    dayLabel={t("activity.day")}
                    progressLabel={t("activity.progressEntries")}
                    membersLabel={t("activity.activeMembers")}
                  />
                </Suspense>
              )}
            </section>

            <section aria-labelledby="activity-steps-title">
              <Heading size="card" id="activity-steps-title">
                {t("activity.byStep")}
              </Heading>
              {!hasStartedWorkItems ? (
                <EmptyState className="mt-4">
                  {t("activity.noStartedWorkItems")}
                </EmptyState>
              ) : (
                <Suspense
                  fallback={
                    <p role="status" className="mt-4 text-sm text-muted">
                      {t("activity.loadingChart")}
                    </p>
                  }
                >
                  <WorkItemsByStepChart
                    data={stepData}
                    title={t("activity.byStepData")}
                    stepLabel={t("activity.step")}
                    countLabel={t("activity.workItems")}
                  />
                </Suspense>
              )}
            </section>
          </div>

          <section aria-labelledby="activity-participation-title">
            <Heading size="card" id="activity-participation-title">
              {t("activity.participation")}
            </Heading>
            <p className="mt-1 text-sm text-muted">
              {t("activity.participationHint")}
            </p>
            <ParticipationTable members={analytics.data.members} />
          </section>
        </div>
      )}
    </Panel>
  );
}
