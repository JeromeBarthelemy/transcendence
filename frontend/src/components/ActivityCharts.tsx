import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DailyActivity, WeeklyActivity } from "../api/activityAnalytics";
import { useFormatters } from "../app/formatters";

export function WeeklyActivityChart({
  data,
  title,
  weekLabel,
  progressLabel,
  membersLabel,
  daysLabel,
}: {
  data: WeeklyActivity[];
  title: string;
  weekLabel: string;
  progressLabel: string;
  membersLabel: string;
  daysLabel: string;
}) {
  const { formatShortDay, formatNumber, formatChartValue } = useFormatters();
  return (
    <div>
      <div className="h-72 w-full" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 12, right: 12, left: 0 }}>
            <CartesianGrid stroke="var(--color-line)" strokeDasharray="4 4" />
            <XAxis
              dataKey="week_start"
              tickFormatter={formatShortDay}
              stroke="var(--color-muted)"
            />
            <YAxis
              width="auto"
              tickFormatter={formatNumber}
              allowDecimals={false}
              stroke="var(--color-muted)"
            />
            <Tooltip
              formatter={formatChartValue}
              labelFormatter={(day) =>
                `${weekLabel} ${formatShortDay(String(day))}`
              }
            />
            <Legend />
            <Bar
              dataKey="progress_entries"
              name={progressLabel}
              fill="var(--color-accent)"
              radius={[4, 4, 0, 0]}
            />
            <Bar
              dataKey="active_members"
              name={membersLabel}
              fill="var(--color-mint-deep)"
              radius={[4, 4, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="sr-only">
        <table>
          <caption>{title}</caption>
          <thead>
            <tr>
              <th scope="col">{weekLabel}</th>
              <th scope="col">{progressLabel}</th>
              <th scope="col">{membersLabel}</th>
              <th scope="col">{daysLabel}</th>
            </tr>
          </thead>
          <tbody>
            {data.map((week) => (
              <tr key={week.week_start}>
                <th scope="row">{formatShortDay(week.week_start)}</th>
                <td>{formatNumber(week.progress_entries)}</td>
                <td>{formatNumber(week.active_members)}</td>
                <td>{formatNumber(week.active_days)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ActivityByCategoryChart({
  data,
  title,
  categoryLabel,
  progressLabel,
}: {
  data: { on_robot: boolean; label: string; progress_entries: number }[];
  title: string;
  categoryLabel: string;
  progressLabel: string;
}) {
  const { formatNumber, formatChartValue } = useFormatters();
  return (
    <div>
      <div className="h-72 w-full" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="progress_entries"
              nameKey="label"
              innerRadius={60}
              outerRadius={95}
              paddingAngle={3}
            >
              {data.map((item) => (
                <Cell
                  key={String(item.on_robot)}
                  fill={
                    item.on_robot
                      ? "var(--color-accent)"
                      : "var(--color-mint-deep)"
                  }
                />
              ))}
            </Pie>
            <Tooltip formatter={formatChartValue} />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="sr-only">
        <table>
          <caption>{title}</caption>
          <thead>
            <tr>
              <th scope="col">{categoryLabel}</th>
              <th scope="col">{progressLabel}</th>
            </tr>
          </thead>
          <tbody>
            {data.map((item) => (
              <tr key={String(item.on_robot)}>
                <th scope="row">{item.label}</th>
                <td>{formatNumber(item.progress_entries)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
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
  const { formatShortDay, formatNumber, formatChartValue } = useFormatters();
  return (
    <div>
      <div className="h-72 w-full" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 12, right: 12, left: 0 }}>
            <CartesianGrid stroke="var(--color-line)" strokeDasharray="4 4" />
            <XAxis
              dataKey="day"
              tickFormatter={formatShortDay}
              stroke="var(--color-muted)"
            />
            <YAxis
              width="auto"
              tickFormatter={formatNumber}
              allowDecimals={false}
              stroke="var(--color-muted)"
            />
            <Tooltip
              formatter={formatChartValue}
              labelFormatter={(day) => formatShortDay(String(day))}
            />
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
                <th scope="row">{formatShortDay(item.day)}</th>
                <td>{formatNumber(item.progress_entries)}</td>
                <td>{formatNumber(item.active_members)}</td>
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
  const { formatNumber, formatChartValue } = useFormatters();
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
              tickFormatter={formatNumber}
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
            <Tooltip formatter={formatChartValue} />
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
                <td>{formatNumber(item.count)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
