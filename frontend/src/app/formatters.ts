export const nameFormatter = new Intl.ListFormat("fr-FR", {
  style: "long",
  type: "conjunction",
});

const workdayDateFormatter = new Intl.DateTimeFormat("fr-FR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});

export function formatWorkdayDate(day: string) {
  return workdayDateFormatter.format(new Date(`${day}T12:00:00Z`));
}
