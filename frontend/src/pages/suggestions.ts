import type { WorkItem } from "../api/workItems";
import { foldText } from "../app/text";
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

export function sameTitle(a: string, b: string) {
  return foldText(a) === foldText(b);
}

/** Whatever the team already has, open or closed, is not suggested again:
 * working on it reopens it. */
export function suggestionsFor(workItems: WorkItem[]) {
  return SUGGESTIONS.filter(
    (suggestion) =>
      !workItems.some((item) => matchesSuggestion(suggestion, item.title)),
  );
}
