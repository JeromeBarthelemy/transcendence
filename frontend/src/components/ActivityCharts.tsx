import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { DailyActivity } from "../api/activityAnalytics";

const shortDateFormatter = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

function formatDay(day: string) {
  return shortDateFormatter.format(new Date(`${day}T12:00:00Z`));
}

/** A team's activity day by day, as lines; its data stays readable as a
 * table for whoever cannot see the chart. */
export function ActivityOverTimeChart({
  data,
  title,
  dayLabel,
  progressLabel,
  membersLabel,
}: {
  data: DailyActivity[];
  title: string;
  dayLabel: string;
  progressLabel: string;
  membersLabel: string;
}) {
  return (
    <div>
      <div className="h-72 w-full" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 12, right: 12, left: -20 }}>
            <CartesianGrid stroke="var(--color-line)" strokeDasharray="4 4" />
            <XAxis
              dataKey="day"
              tickFormatter={formatDay}
              stroke="var(--color-muted)"
            />
            <YAxis allowDecimals={false} stroke="var(--color-muted)" />
            <Tooltip labelFormatter={(day) => formatDay(String(day))} />
            <Legend />
            <Line
              type="monotone"
              dataKey="progress_entries"
              name={progressLabel}
              stroke="var(--color-accent)"
              strokeWidth={3}
              activeDot={{ r: 5 }}
            />
            <Line
              type="monotone"
              dataKey="active_members"
              name={membersLabel}
              stroke="var(--color-mint-deep)"
              strokeWidth={3}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* On a wrapper: a table never shrinks below its content, so sr-only
          on the table itself would leave it overflowing a phone's width. */}
      <div className="sr-only">
        <table>
          <caption>{title}</caption>
          <thead>
            <tr>
              <th scope="col">{dayLabel}</th>
              <th scope="col">{progressLabel}</th>
              <th scope="col">{membersLabel}</th>
            </tr>
          </thead>
          <tbody>
            {data.map((item) => (
              <tr key={item.day}>
                <th scope="row">{formatDay(item.day)}</th>
                <td>{item.progress_entries}</td>
                <td>{item.active_members}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export interface StepDatum {
  step: string;
  label: string;
  count: number;
}

/** How many work items stand at each step today, as bars; its data stays
 * readable as a table for whoever cannot see the chart. */
export function WorkItemsByStepChart({
  data,
  title,
  stepLabel,
  countLabel,
}: {
  data: StepDatum[];
  title: string;
  stepLabel: string;
  countLabel: string;
}) {
  return (
    <div>
      <div className="h-72 w-full" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            layout="vertical"
            margin={{ top: 4, right: 12, bottom: 4, left: 18 }}
          >
            <CartesianGrid
              stroke="var(--color-line)"
              strokeDasharray="4 4"
              horizontal={false}
            />
            <XAxis
              type="number"
              allowDecimals={false}
              stroke="var(--color-muted)"
            />
            <YAxis
              type="category"
              dataKey="label"
              width={95}
              stroke="var(--color-muted)"
              tick={{ fontSize: 12 }}
            />
            <Tooltip />
            <Bar
              dataKey="count"
              name={countLabel}
              fill="var(--color-lagoon)"
              radius={[0, 6, 6, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="sr-only">
        <table>
          <caption>{title}</caption>
          <thead>
            <tr>
              <th scope="col">{stepLabel}</th>
              <th scope="col">{countLabel}</th>
            </tr>
          </thead>
          <tbody>
            {data.map((item) => (
              <tr key={item.step}>
                <th scope="row">{item.label}</th>
                <td>{item.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
