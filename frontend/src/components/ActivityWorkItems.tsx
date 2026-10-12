import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import type { WorkItemActivity } from "../api/activityAnalytics";
import { useFormatters } from "../app/formatters";
import { EmptyState } from "./EmptyState";

/** Period counts alongside explicitly current status/step, not a historical snapshot. */
export function ActivityWorkItems({ items }: { items: WorkItemActivity[] }) {
  const { t } = useTranslation();
  const { formatMediumDay, formatNumber } = useFormatters();
  if (items.length === 0) {
    return (
      <EmptyState className="mt-4">{t("activity.noWorkItems")}</EmptyState>
    );
  }
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full min-w-[48rem] border-collapse text-left text-sm">
        <caption className="sr-only">{t("activity.byWorkItem")}</caption>
        <thead>
          <tr className="border-b border-primary/15 text-xs tracking-wide text-muted uppercase">
            <th scope="col" className="px-3 py-3">
              {t("activity.workItem")}
            </th>
            <th scope="col" className="px-3 py-3">
              {t("activity.currentState")}
            </th>
            <th scope="col" className="px-3 py-3 text-right">
              {t("activity.progressEntries")}
            </th>
            <th scope="col" className="px-3 py-3 text-right">
              {t("activity.recordedDays")}
            </th>
            <th scope="col" className="px-3 py-3 text-right">
              {t("activity.uniqueParticipants")}
            </th>
            <th scope="col" className="px-3 py-3 text-right">
              {t("activity.lastProgressInPeriod")}
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr
              key={item.id}
              className="border-b border-primary/8 last:border-0"
            >
              <th scope="row" className="px-3 py-4 font-semibold">
                <Link
                  to={`/work-items/${item.id}`}
                  className="text-accent underline underline-offset-4"
                >
                  {item.title}
                </Link>{" "}
                <span className="mt-1 block text-xs font-normal text-muted">
                  {t(item.on_robot ? "teamHome.robot" : "teamHome.offRobot")}
                </span>
              </th>
              <td className="px-3 py-4 text-body">
                {t(`teamHome.statuses.${item.status}`)}
                {item.current_step && (
                  <>
                    {" "}
                    <span className="mt-1 block text-xs text-muted">
                      {t(`teamHome.steps.${item.current_step}`)}
                    </span>
                  </>
                )}
              </td>
              <td className="px-3 py-4 text-right text-body">
                {formatNumber(item.progress_entries)}
              </td>
              <td className="px-3 py-4 text-right text-body">
                {formatNumber(item.active_days)}
              </td>
              <td className="px-3 py-4 text-right text-body">
                {formatNumber(item.active_members)}
              </td>
              <td className="px-3 py-4 text-right text-body">
                {item.last_progress_day
                  ? formatMediumDay(item.last_progress_day)
                  : t("activity.noParticipation")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
