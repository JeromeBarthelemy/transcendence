import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  type FormEvent,
  type KeyboardEvent,
  type SyntheticEvent,
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
import { useFormatters } from "../app/formatters";
import { currentUserQueryKey } from "../app/useCurrentUser";
import { AdminOnly } from "../components/AdminOnly";
import {
  FieldErrors,
  fieldIssues,
  RequestError,
} from "../components/ApiErrors";
import { Avatar } from "../components/Avatar";
import { Button } from "../components/Button";
import { EmptyState } from "../components/EmptyState";
import { Label, TextInput } from "../components/Field";
import { IconLabel } from "../components/Icon";
import { ConfirmPanel } from "../components/Notice";
import { Page } from "../components/Page";
import { Panel } from "../components/Panel";
import { Eyebrow, Heading } from "../components/Typography";

const teamsQueryKey = ["teams"] as const;
const SEARCH_DELAY_MS = 250;

const dropdownClass =
  "absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-primary/15 bg-white py-2 shadow-lg";

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

  function submit(event: SyntheticEvent) {
    event.preventDefault();
    create.mutate();
  }

  return (
    <Panel as="form" aria-labelledby="create-team-title" onSubmit={submit}>
      <Eyebrow as="h2" id="create-team-title">
        {t("teams.createTitle")}
      </Eyebrow>
      <div className="mt-4 grid gap-4 sm:grid-cols-[10rem_1fr_auto] sm:items-start">
        <Label>
          {t("teams.number")}
          <TextInput
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
        </Label>
        <Label>
          {t("teams.name")}
          <TextInput
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
        </Label>
        <Button
          variant="primary"
          className="sm:mt-7"
          type="submit"
          disabled={
            create.isPending || number === "" || name.trim().length === 0
          }
        >
          {create.isPending ? t("teams.creating") : t("teams.create")}
        </Button>
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
    </Panel>
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
      <Label htmlFor={inputId}>
        <IconLabel icon="user-plus">{t("teams.addMember")}</IconLabel>
      </Label>
      <TextInput
        id={inputId}
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
              className={`flex cursor-pointer items-center gap-3 px-3 py-2 text-sm text-body ${
                index === activeIndex ? "bg-tint" : "hover:bg-mist"
              }`}
              // Keeps the input focused, so blur does not close the list first.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(user)}
            >
              <Avatar person={user} />
              <span className="flex-1">{user.display_name}</span>
              <span className="text-xs text-muted">
                {t(`teams.roles.${user.club_role}`)}
              </span>
            </div>
          ))}
        </div>
      )}
      {showList && candidates.length === 0 && (
        <p role="status" className={`${dropdownClass} px-3 text-sm text-muted`}>
          {users.isFetching || search !== query.trim()
            ? t("teams.searching")
            : users.isError
              ? t("errors.unknown")
              : t("teams.noUserFound")}
        </p>
      )}
      {add.isPending && (
        <p role="status" className="mt-2 text-sm text-muted">
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
      <span className="flex-1 text-sm text-body">{member.display_name}</span>
      <Button
        size="sm"
        disabled={remove.isPending}
        aria-label={t("teams.removeMemberLabel", {
          name: member.display_name,
          team: teamName,
        })}
        onClick={() => remove.mutate()}
      >
        <IconLabel icon="xmark">
          {remove.isPending ? t("teams.removing") : t("teams.removeMember")}
        </IconLabel>
      </Button>
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
  const { nameCollator } = useFormatters();
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
    <Panel as="article" aria-labelledby={titleId}>
      {isRenaming ? (
        <form onSubmit={submitRename}>
          <Label>
            {t("teams.renameLabel", { number: team.number })}
            <TextInput
              required
              maxLength={120}
              value={newName}
              // Autofocus: the field the button just opened.
              autoFocus
              onChange={(event) => setNewName(event.target.value)}
            />
          </Label>
          <FieldErrors
            id={`${titleId}-rename-errors`}
            issues={fieldIssues(rename.error, "name")}
          />
          {rename.isError && (
            <RequestError error={rename.error} handledFields={["name"]} />
          )}
          <div className="mt-3 flex justify-end gap-3">
            <Button
              size="sm"
              disabled={rename.isPending}
              onClick={() => {
                setIsRenaming(false);
                setNewName(team.name);
                rename.reset();
              }}
            >
              {t("teams.cancel")}
            </Button>
            <Button
              variant="primary"
              type="submit"
              disabled={rename.isPending || newName.trim().length === 0}
            >
              {rename.isPending ? t("teams.saving") : t("teams.save")}
            </Button>
          </div>
          {/* Keeps the card labelled while its title is being edited. */}
          <h2 id={titleId} className="sr-only">
            {label}
          </h2>
        </form>
      ) : (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <Heading size="section" id={titleId}>
            <IconLabel icon="team" before>
              {label}
            </IconLabel>
          </Heading>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => {
                setNewName(team.name);
                setIsRenaming(true);
                setIsConfirmingDelete(false);
              }}
            >
              <IconLabel icon="pen-to-square">{t("teams.rename")}</IconLabel>
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={hasMembers || remove.isPending}
              aria-describedby={hasMembers ? deleteHintId : undefined}
              onClick={() => {
                remove.reset();
                setIsConfirmingDelete(true);
              }}
            >
              <IconLabel icon="xmark">{t("teams.delete")}</IconLabel>
            </Button>
          </div>
        </div>
      )}

      {hasMembers && !isRenaming && (
        <p id={deleteHintId} className="mt-1 text-xs text-muted">
          {t("teams.deleteBlockedHint")}
        </p>
      )}

      {isConfirmingDelete && !hasMembers && (
        <ConfirmPanel
          className="mt-4"
          message={t("teams.deleteConfirm", { team: label })}
          cancelLabel={t("teams.cancel")}
          confirmLabel={
            remove.isPending ? t("teams.deleting") : t("teams.confirmDelete")
          }
          pending={remove.isPending}
          error={remove.isError ? remove.error : undefined}
          onCancel={() => {
            setIsConfirmingDelete(false);
            remove.reset();
          }}
          onConfirm={() => remove.mutate()}
        />
      )}

      <section className="mt-5 border-t border-primary/10 pt-4">
        <h3 className="text-sm font-semibold text-ink">
          {t("teams.memberCount", { count: team.members.length })}
        </h3>
        {members.length > 0 ? (
          <ul className="mt-2 divide-y divide-primary/8">
            {members.map((member) => (
              <MemberRow
                key={member.membership}
                member={member}
                teamName={label}
              />
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-muted">{t("teams.noMembers")}</p>
        )}
        <div className="mt-4">
          <MemberSearch team={team} />
        </div>
      </section>
    </Panel>
  );
}

function TeamManagement() {
  const { t } = useTranslation();
  const teams = useQuery<TeamList>({
    queryKey: teamsQueryKey,
    queryFn: getTeams,
  });

  return (
    <Page>
      <Eyebrow size="sm">{t("teams.eyebrow")}</Eyebrow>
      <Heading size="page" className="mt-3">
        {t("teams.title")}
      </Heading>

      {teams.isPending ? (
        <p role="status" className="mt-8 text-sm text-muted">
          {t("teams.loading")}
        </p>
      ) : teams.isError ? (
        <RequestError error={teams.error} />
      ) : teams.data.season === null ? (
        <EmptyState className="mt-8">{t("teams.noSeason")}</EmptyState>
      ) : (
        <>
          <p className="mt-2 text-sm text-muted">
            {t("teamHome.season", {
              start: teams.data.season.start_year,
              end: teams.data.season.start_year + 1,
              game: teams.data.season.game_name,
            })}
          </p>
          <div className="mt-8 space-y-6">
            <CreateTeamForm seasonYear={teams.data.season.start_year} />
            {teams.data.teams.length === 0 ? (
              <EmptyState>{t("teams.noTeams")}</EmptyState>
            ) : (
              teams.data.teams.map((team) => (
                <TeamCard key={team.id} team={team} />
              ))
            )}
          </div>
        </>
      )}
    </Page>
  );
}

export function TeamsPage() {
  return <AdminOnly>{() => <TeamManagement />}</AdminOnly>;
}
