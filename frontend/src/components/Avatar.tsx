import { useState, useSyncExternalStore } from "react";

export interface Person {
  display_name: string;
  avatar: string | null;
}

// A member's photo keeps the same address when it changes. The server tells
// the browser to ask again, but an image already drawn in this page is reused
// without asking, so a change made here moves every address on by one.
let version = 0;
const listeners = new Set<() => void>();

export function photoChanged() {
  version += 1;
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function useAvatarSrc(src: string | null): string | null {
  const current = useSyncExternalStore(subscribe, () => version);
  return src && current > 0 ? `${src}?v=${current}` : src;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => [...word][0].toUpperCase())
    .join("");
}

const sizes = {
  sm: "size-6 text-[0.6rem]",
  md: "size-8 text-xs",
  lg: "size-32 text-4xl",
} as const;

export function Avatar({
  person,
  size = "md",
  alt = "",
}: {
  person: Person;
  size?: keyof typeof sizes;
  /** Empty by default: the name is almost always written beside it. */
  alt?: string;
}) {
  const src = useAvatarSrc(person.avatar);
  // A photo removed since the list was fetched answers 404: show the
  // initials rather than a broken image.
  const [failed, setFailed] = useState<string | null>(null);

  if (src && failed !== src) {
    return (
      <img
        src={src}
        alt={alt}
        className={`${sizes[size]} max-w-none shrink-0 rounded-full bg-[#eaf5ff] object-cover`}
        onError={() => setFailed(src)}
      />
    );
  }
  const className = `${sizes[size]} grid shrink-0 place-items-center rounded-full bg-[#eaf5ff] font-bold text-[#0078dd]`;
  if (alt) {
    return (
      <span role="img" aria-label={alt} className={className}>
        {initials(person.display_name)}
      </span>
    );
  }
  return (
    <span aria-hidden="true" className={className}>
      {initials(person.display_name)}
    </span>
  );
}

/** The faces of a group whose names are written next to it. */
export function AvatarStack({ people }: { people: Person[] }) {
  if (people.length === 0) {
    return null;
  }
  return (
    <span aria-hidden="true" className="inline-flex shrink-0 -space-x-1.5">
      {people.map((person) => (
        <span
          key={person.display_name}
          className="flex rounded-full ring-2 ring-white"
        >
          <Avatar person={person} size="sm" />
        </span>
      ))}
    </span>
  );
}
