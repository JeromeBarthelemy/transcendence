import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useId,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

import {
  addMember,
  createTeam,
  deleteTeam,
  getTeams,
  type ManagedTeam,
  removeMember,
  renameTeam,
  searchUsers,
  type TeamList,
  type UserSearchResult,
} from "../api/teams";
import { currentUserQueryKey } from "../app/useCurrentUser";
import { AdminOnly } from "../components/AdminOnly";
import {
  FieldErrors,
  fieldIssues,
  RequestError,
} from "../components/ApiErrors";
import { Avatar } from "../components/Avatar";

const teamsQueryKey = ["teams"] as const;
const SEARCH_DELAY_MS = 250;
const nameCollator = new Intl.Collator("fr-FR", { sensitivity: "base" });

const inputClass =
  "mt-2 block w-full rounded-xl border border-[#004fc5]/20 bg-white px-3 py-2 font-normal text-[#13294b]";
const primaryButtonClass =
  "rounded-xl bg-[#0078dd] px-4 py-2 text-sm font-semibold text-white hover:bg-[#004fc5] disabled:opacity-50";
const secondaryButtonClass =
  "rounded-xl border border-[#004fc5]/20 px-3 py-1.5 text-sm font-semibold text-[#041894] hover:bg-[#eaf5ff] disabled:opacity-50";
const dropdownClass =
  "absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-[#004fc5]/15 bg-white py-2 shadow-lg";
const dangerButtonClass =
  "rounded-xl border border-red-800/25 px-3 py-1.5 text-sm font-semibold text-red-800 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50";

/** Every change here can alter a mentor's `team_seasons` as well. */
function useInvalidateTeams() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: teamsQueryKey }),
      queryClient.invalidateQueries({ queryKey: currentUserQueryKey }),
      queryClient.invalidateQueries({ queryKey: ["users", "search"] }),
    ]);
}

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timeout = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timeout);
  }, [value, delay]);
  return debounced;
}

function CreateTeamForm({ seasonYear }: { seasonYear: number }) {
  const { t } = useTranslation();
  const invalidateTeams = useInvalidateTeams();
  const [number, setNumber] = useState("");
  const [name, setName] = useState("");
  const create = useMutation({
    mutationFn: () =>
      createTeam({
        number: Number(number),
        name: name.trim(),
        season: seasonYear,
      }),
    onSuccess: async () => {
      setNumber("");
      setName("");
      await invalidateTeams();
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    create.mutate();
  }

  return (
    <form
      aria-labelledby="create-team-title"
      className="rounded-2xl border border-[#004fc5]/12 bg-white p-5 shadow-sm"
      onSubmit={submit}
    >
      <h2
        id="create-team-title"
        className="text-xs font-bold tracking-[0.14em] text-[#0078dd] uppercase"
      >
        {t("teams.createTitle")}
      </h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-[10rem_1fr_auto] sm:items-start">
        <label className="text-sm font-semibold text-[#041894]">
          {t("teams.number")}
          <input
            className={inputClass}
            type="number"
            min={1}
            inputMode="numeric"
            required
            value={number}
            aria-describedby="create-team-number-errors"
            onChange={(event) => setNumber(event.target.value)}
          />
          <FieldErrors
            id="create-team-number-errors"
            issues={fieldIssues(create.error, "number")}
          />
        </label>
        <label className="text-sm font-semibold text-[#041894]">
          {t("teams.name")}
          <input
            className={inputClass}
            required
            maxLength={120}
            value={name}
            aria-describedby="create-team-name-errors"
            onChange={(event) => setName(event.target.value)}
          />
          <FieldErrors
            id="create-team-name-errors"
            issues={fieldIssues(create.error, "name")}
          />
        </label>
        <button
          type="submit"
          className={`${primaryButtonClass} sm:mt-7`}
          disabled={
            create.isPending || number === "" || name.trim().length === 0
          }
        >
          {create.isPending ? t("teams.creating") : t("teams.create")}
        </button>
      </div>
      <FieldErrors
        id="create-team-season-errors"
        issues={fieldIssues(create.error, "season")}
      />
      {create.isError && (
        <RequestError
          error={create.error}
          handledFields={["number", "name", "season"]}
        />
      )}
    </form>
  );
}

function MemberSearch({ team }: { team: ManagedTeam }) {
  const { t } = useTranslation();
  const invalidateTeams = useInvalidateTeams();
  const inputId = useId();
  const listboxId = useId();
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  // The highlighted person, not a position: results replaced under the
  // cursor must not turn Enter into adding whoever now sits at that index.
  const [activeUserId, setActiveUserId] = useState<number | null>(null);
  const search = useDebouncedValue(query.trim(), SEARCH_DELAY_MS);
  const users = useQuery({
    queryKey: ["users", "search", team.team_season, search],
    queryFn: () => searchUsers(search, team.team_season),
    enabled: search.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
  const add = useMutation({
    mutationFn: (user: UserSearchResult) =>
      addMember(user.id, team.team_season),
    onSuccess: async () => {
      setQuery("");
      setIsOpen(false);
      setActiveUserId(null);
      await invalidateTeams();
    },
  });

  // The server already leaves the team's members out, before its cap.
  const candidates = search ? (users.data ?? []) : [];
  const activeIndex = candidates.findIndex((user) => user.id === activeUserId);
  const showList = isOpen && search.length > 0;
  const optionId = (index: number) => `${listboxId}-option-${index}`;

  function choose(user: UserSearchResult) {
    if (!add.isPending) {
      add.mutate(user);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" && candidates.length > 0) {
      event.preventDefault();
      setIsOpen(true);
      setActiveUserId(candidates[(activeIndex + 1) % candidates.length].id);
    } else if (event.key === "ArrowUp" && candidates.length > 0) {
      event.preventDefault();
      setActiveUserId(
        candidates[activeIndex <= 0 ? candidates.length - 1 : activeIndex - 1]
          .id,
      );
    } else if (event.key === "Enter") {
      event.preventDefault();
      const user = candidates[activeIndex];
      if (showList && user) {
        choose(user);
      }
    } else if (event.key === "Escape") {
      setIsOpen(false);
      setActiveUserId(null);
    }
  }

  return (
    <div className="relative">
      <label htmlFor={inputId} className="text-sm font-semibold text-[#041894]">
        {t("teams.addMember")}
      </label>
      <input
        id={inputId}
        className={inputClass}
        type="text"
        role="combobox"
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={showList && candidates.length > 0}
        aria-controls={listboxId}
        aria-activedescendant={
          showList && activeIndex >= 0 ? optionId(activeIndex) : undefined
        }
        placeholder={t("teams.searchPlaceholder")}
        value={query}
        disabled={add.isPending}
        onChange={(event) => {
          setQuery(event.target.value);
          setIsOpen(true);
          setActiveUserId(null);
          add.reset();
        }}
        onFocus={() => setIsOpen(true)}
        onBlur={() => setIsOpen(false)}
        onKeyDown={onKeyDown}
      />
      {showList && candidates.length > 0 && (
        <div
          id={listboxId}
          role="listbox"
          aria-label={t("teams.searchResults")}
          className={dropdownClass}
        >
          {candidates.map((user, index) => (
            // biome-ignore lint/a11y/useKeyWithClickEvents: the combobox input handles the keyboard, pointing at the option through aria-activedescendant.
            <div
              key={user.id}
              id={optionId(index)}
              role="option"
              tabIndex={-1}
              aria-selected={index === activeIndex}
              className={`flex cursor-pointer items-center gap-3 px-3 py-2 text-sm text-[#13294b] ${
                index === activeIndex ? "bg-[#eaf5ff]" : "hover:bg-[#f4f8ff]"
              }`}
              // Keeps the input focused, so blur does not close the list first.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(user)}
            >
              <Avatar person={user} />
              <span className="flex-1">{user.display_name}</span>
              <span className="text-xs text-[#506784]">
                {t(`teams.roles.${user.club_role}`)}
              </span>
            </div>
          ))}
        </div>
      )}
      {showList && candidates.length === 0 && (
        <p
          role="status"
          className={`${dropdownClass} px-3 text-sm text-[#506784]`}
        >
          {users.isFetching || search !== query.trim()
            ? t("teams.searching")
            : users.isError
              ? t("errors.unknown")
              : t("teams.noUserFound")}
        </p>
      )}
      {add.isPending && (
        <p role="status" className="mt-2 text-sm text-[#506784]">
          {t("teams.addingMember")}
        </p>
      )}
      {add.isError && (
        <RequestError error={add.error} handledFields={["user"]} />
      )}
      <FieldErrors
        id={`${inputId}-errors`}
        issues={fieldIssues(add.error, "user")}
      />
    </div>
  );
}

function MemberRow({
  member,
  teamName,
}: {
  member: ManagedTeam["members"][number];
  teamName: string;
}) {
  const { t } = useTranslation();
  const invalidateTeams = useInvalidateTeams();
  const remove = useMutation({
    mutationFn: () => removeMember(member.membership),
    onSuccess: invalidateTeams,
  });

  return (
    <li className="flex flex-wrap items-center gap-3 py-2">
      <Avatar person={member} />
      <span className="flex-1 text-sm text-[#13294b]">
        {member.display_name}
      </span>
      <button
        type="button"
        className={secondaryButtonClass}
        disabled={remove.isPending}
        aria-label={t("teams.removeMemberLabel", {
          name: member.display_name,
          team: teamName,
        })}
        onClick={() => remove.mutate()}
      >
        {remove.isPending ? t("teams.removing") : t("teams.removeMember")}
      </button>
      {remove.isError && (
        <div className="w-full">
          <RequestError error={remove.error} />
        </div>
      )}
    </li>
  );
}

function TeamCard({ team }: { team: ManagedTeam }) {
  const { t } = useTranslation();
  const invalidateTeams = useInvalidateTeams();
  const titleId = useId();
  const deleteHintId = useId();
  const [isRenaming, setIsRenaming] = useState(false);
  const [newName, setNewName] = useState(team.name);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const rename = useMutation({
    mutationFn: () => renameTeam(team.id, newName.trim()),
    onSuccess: async () => {
      setIsRenaming(false);
      await invalidateTeams();
    },
  });
  const remove = useMutation({
    mutationFn: () => deleteTeam(team.id),
    onSuccess: invalidateTeams,
  });
  const hasMembers = team.members.length > 0;
  const members = [...team.members].sort((a, b) =>
    nameCollator.compare(a.display_name, b.display_name),
  );
  const label = t("teams.teamLabel", { number: team.number, name: team.name });

  function submitRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    rename.mutate();
  }

  return (
    <article
      aria-labelledby={titleId}
      className="rounded-2xl border border-[#004fc5]/12 bg-white p-5 shadow-sm"
    >
      {isRenaming ? (
        <form onSubmit={submitRename}>
          <label className="text-sm font-semibold text-[#041894]">
            {t("teams.renameLabel", { number: team.number })}
            <input
              className={inputClass}
              required
              maxLength={120}
              value={newName}
              // biome-ignore lint/a11y/noAutofocus: the field the button just opened.
              autoFocus
              onChange={(event) => setNewName(event.target.value)}
            />
          </label>
          <FieldErrors
            id={`${titleId}-rename-errors`}
            issues={fieldIssues(rename.error, "name")}
          />
          {rename.isError && (
            <RequestError error={rename.error} handledFields={["name"]} />
          )}
          <div className="mt-3 flex justify-end gap-3">
            <button
              type="button"
              className={secondaryButtonClass}
              disabled={rename.isPending}
              onClick={() => {
                setIsRenaming(false);
                setNewName(team.name);
                rename.reset();
              }}
            >
              {t("teams.cancel")}
            </button>
            <button
              type="submit"
              className={primaryButtonClass}
              disabled={rename.isPending || newName.trim().length === 0}
            >
              {rename.isPending ? t("teams.saving") : t("teams.save")}
            </button>
          </div>
          {/* Keeps the card labelled while its title is being edited. */}
          <h2 id={titleId} className="sr-only">
            {label}
          </h2>
        </form>
      ) : (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h2 id={titleId} className="brand-title text-2xl text-[#041894]">
            {label}
          </h2>
          <div className="flex gap-2">
            <button
              type="button"
              className={secondaryButtonClass}
              onClick={() => {
                setNewName(team.name);
                setIsRenaming(true);
                setIsConfirmingDelete(false);
              }}
            >
              {t("teams.rename")}
            </button>
            <button
              type="button"
              className={dangerButtonClass}
              disabled={hasMembers || remove.isPending}
              aria-describedby={hasMembers ? deleteHintId : undefined}
              onClick={() => {
                remove.reset();
                setIsConfirmingDelete(true);
              }}
            >
              {t("teams.delete")}
            </button>
          </div>
        </div>
      )}

      {hasMembers && !isRenaming && (
        <p id={deleteHintId} className="mt-1 text-xs text-[#506784]">
          {t("teams.deleteBlockedHint")}
        </p>
      )}

      {isConfirmingDelete && !hasMembers && (
        <div
          role="alertdialog"
          aria-labelledby={`${titleId}-confirm`}
          className="mt-4 rounded-xl border border-red-800/20 bg-red-50 p-4"
        >
          <p id={`${titleId}-confirm`} className="text-sm text-red-900">
            {t("teams.deleteConfirm", { team: label })}
          </p>
          <div className="mt-3 flex justify-end gap-3">
            <button
              type="button"
              className={secondaryButtonClass}
              disabled={remove.isPending}
              onClick={() => {
                setIsConfirmingDelete(false);
                remove.reset();
              }}
            >
              {t("teams.cancel")}
            </button>
            <button
              type="button"
              className="rounded-xl bg-red-800 px-4 py-2 text-sm font-semibold text-white hover:bg-red-900 disabled:opacity-50"
              disabled={remove.isPending}
              onClick={() => remove.mutate()}
            >
              {remove.isPending
                ? t("teams.deleting")
                : t("teams.confirmDelete")}
            </button>
          </div>
          {remove.isError && <RequestError error={remove.error} />}
        </div>
      )}

      <section className="mt-5 border-t border-[#004fc5]/10 pt-4">
        <h3 className="text-sm font-semibold text-[#041894]">
          {t("teams.memberCount", { count: team.members.length })}
        </h3>
        {members.length > 0 ? (
          <ul className="mt-2 divide-y divide-[#004fc5]/8">
            {members.map((member) => (
              <MemberRow
                key={member.membership}
                member={member}
                teamName={label}
              />
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-[#506784]">{t("teams.noMembers")}</p>
        )}
        <div className="mt-4">
          <MemberSearch team={team} />
        </div>
      </section>
    </article>
  );
}

function TeamManagement() {
  const { t } = useTranslation();
  const teams = useQuery<TeamList>({
    queryKey: teamsQueryKey,
    queryFn: getTeams,
  });

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-5 py-10 sm:px-8 sm:py-14">
      <p className="text-sm font-bold tracking-[0.14em] text-[#0078dd] uppercase">
        {t("teams.eyebrow")}
      </p>
      <h1 className="brand-title mt-3 text-3xl tracking-[-0.035em] text-[#041894] sm:text-4xl">
        {t("teams.title")}
      </h1>

      {teams.isPending ? (
        <p role="status" className="mt-8 text-sm text-[#506784]">
          {t("teams.loading")}
        </p>
      ) : teams.isError ? (
        <RequestError error={teams.error} />
      ) : teams.data.season === null ? (
        <p className="mt-8 rounded-2xl border border-dashed border-[#004fc5]/20 p-5 text-sm text-[#506784]">
          {t("teams.noSeason")}
        </p>
      ) : (
        <>
          <p className="mt-2 text-sm text-[#506784]">
            {t("teamHome.season", {
              start: teams.data.season.start_year,
              end: teams.data.season.start_year + 1,
              game: teams.data.season.game_name,
            })}
          </p>
          <div className="mt-8 space-y-6">
            <CreateTeamForm seasonYear={teams.data.season.start_year} />
            {teams.data.teams.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-[#004fc5]/20 p-5 text-sm text-[#506784]">
                {t("teams.noTeams")}
              </p>
            ) : (
              teams.data.teams.map((team) => (
                <TeamCard key={team.id} team={team} />
              ))
            )}
          </div>
        </>
      )}
    </main>
  );
}

export function TeamsPage() {
  return <AdminOnly>{() => <TeamManagement />}</AdminOnly>;
}
