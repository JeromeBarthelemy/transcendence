import type { ReactNode } from "react";

import chart from "../assets/icons/chart.svg?raw";
import chat from "../assets/icons/chat.svg?raw";
import penToSquare from "../assets/icons/pen-to-square.svg?raw";
import robot from "../assets/icons/robot.svg?raw";
import scroll from "../assets/icons/scroll.svg?raw";
import search from "../assets/icons/search.svg?raw";
import team from "../assets/icons/team.svg?raw";
import toolbox from "../assets/icons/toolbox.svg?raw";
import user from "../assets/icons/user.svg?raw";
import userPlus from "../assets/icons/user-plus.svg?raw";
import wrench from "../assets/icons/wrench.svg?raw";
import xmark from "../assets/icons/xmark.svg?raw";

// Font Awesome Free (CC BY 4.0, https://fontawesome.com/license/free): the
// attribution stays in each file under assets/icons/, which remain the source
// — replacing a file there is all it takes to change an icon.
const SOURCES = {
  chart,
  chat,
  "pen-to-square": penToSquare,
  robot,
  scroll,
  search,
  team,
  toolbox,
  "user-plus": userPlus,
  user,
  wrench,
  xmark,
} as const;

export type IconName = keyof typeof SOURCES;
export const ICON_NAMES = Object.keys(SOURCES) as IconName[];

/** Only the shape is kept from each file: its viewBox and its paths. The
 * colour is never the file's — `currentColor` is the text's own, through
 * hover and focus. */
function shape(svg: string) {
  const viewBox = /viewBox="([^"]+)"/.exec(svg)?.[1];
  const paths = [...svg.matchAll(/<path\b[^>]*\sd="([^"]+)"/g)].map(
    (match) => match[1],
  );
  if (!viewBox || paths.length === 0) {
    throw new Error("An icon file has no viewBox or no path");
  }
  return { viewBox, paths };
}

const SHAPES = Object.fromEntries(
  Object.entries(SOURCES).map(([name, svg]) => [name, shape(svg)]),
) as Record<IconName, ReturnType<typeof shape>>;

/** One em square in the text's colour: it grows with the font it sits in.
 * Decorative — the words beside it say what it means. */
export function Icon({
  name,
  className = "",
}: {
  name: IconName;
  className?: string;
}) {
  const { viewBox, paths } = SHAPES[name];
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      data-icon={name}
      viewBox={viewBox}
      fill="currentColor"
      className={`inline-block size-[1em] shrink-0 ${className}`}
    >
      {paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

/** A label and its icon: after it by default, `before` it where the icon
 * leads — navigation, the home tabs, a team's name. */
export function IconLabel({
  icon,
  before = false,
  children,
  className = "",
}: {
  icon: IconName;
  before?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-[0.4em] ${className}`}>
      {before && <Icon name={icon} />}
      {children}
      {!before && <Icon name={icon} />}
    </span>
  );
}
