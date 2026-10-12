import type { WorkItem } from "../api/workItems";
import en from "../locales/en.json";
import es from "../locales/es.json";
import fr from "../locales/fr.json";

export interface Suggestion {
  id: keyof typeof fr.suggestions;
  onRobot: boolean;
}

const ROBOT = [
  "elevator",
  "autonomous",
  "arm",
  "chassis",
  "electronics",
  "intake",
  "odometry",
  "gripper",
  "shooter",
  "teleop",
  "transfer",
  "vision",
] as const;
const OFF_ROBOT = [
  "sponsorship",
  "outreach",
  "portfolio",
  "homeTournament",
] as const;

// Stable option IDs survive language changes. Persist only the chosen
// title, which then becomes team content and is no longer translated.
export const SUGGESTIONS: Suggestion[] = [
  ...ROBOT.map((id) => ({ id, onRobot: true })),
  ...OFF_ROBOT.map((id) => ({ id, onRobot: false })),
];

export function matchesSuggestion(suggestion: Suggestion, title: string) {
  return [fr, en, es].some((catalogue) =>
    sameTitle(catalogue.suggestions[suggestion.id], title),
  );
}

/** The backend's `fold_title`, so the screen hides what the server would
 * refuse as taken. It stays the judge: this only spares a round trip. */
export function foldTitle(title: string) {
  return title
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

export function sameTitle(a: string, b: string) {
  return foldTitle(a) === foldTitle(b);
}

/** Whatever the team already has, open or closed, is not suggested again:
 * working on it reopens it. */
export function suggestionsFor(workItems: WorkItem[]) {
  return SUGGESTIONS.filter(
    (suggestion) =>
      !workItems.some((item) => matchesSuggestion(suggestion, item.title)),
  );
}
