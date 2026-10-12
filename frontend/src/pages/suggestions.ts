import type { WorkItem } from "../api/workItems";
import { foldText } from "../app/text";

export interface Suggestion {
  title: string;
  onRobot: boolean;
}

// The work items a team will almost certainly have: a season starts by
// picking from this list, not by typing it.
const ROBOT = [
  "Ascenseur",
  "Autonome",
  "Bras",
  "Châssis",
  "Électronique",
  "Intake",
  "Odométrie",
  "Pince",
  "Shooter",
  "Téléop",
  "Transfert",
  "Vision",
];
const OFF_ROBOT = [
  "Dossier de sponsoring",
  "Outreach",
  "Portfolio",
  "Tournoi à domicile",
];

export const SUGGESTIONS: Suggestion[] = [
  ...ROBOT.map((title) => ({ title, onRobot: true })),
  ...OFF_ROBOT.map((title) => ({ title, onRobot: false })),
];

export function sameTitle(a: string, b: string) {
  return foldText(a) === foldText(b);
}

/** Whatever the team already has, open or closed, is not suggested again:
 * working on it reopens it. */
export function suggestionsFor(workItems: WorkItem[]) {
  return SUGGESTIONS.filter(
    (suggestion) =>
      !workItems.some((item) => sameTitle(item.title, suggestion.title)),
  );
}
