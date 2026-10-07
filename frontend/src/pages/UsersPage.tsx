import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";

import type { Identity } from "../api/auth";
import {
  type ClubUser,
  deleteUser,
  getUser,
  listUsers,
  type UserChanges,
  updateUser,
} from "../api/users";
import { AdminOnly } from "../components/AdminOnly";
import {
  FieldErrors,
  fieldIssues,
  RequestError,
} from "../components/ApiErrors";
import { IconLabel } from "../components/Icon";

const usersQueryKey = ["users", "list"] as const;
const userQueryKey = (userId: number) => ["users", "detail", userId] as const;

type StatusFilter = "present" | "active" | "suspended" | "anonymized" | "all";
type RoleFilter = "all" | "student" | "mentor" | "admin";
const STATUS_FILTERS: StatusFilter[] = [
  "present",
  "active",
  "suspended",
  "anonymized",
  "all",
];
const ROLE_FILTERS: RoleFilter[] = ["all", "student", "mentor", "admin"];

const nameCollator = new Intl.Collator("fr-FR", { sensitivity: "base" });

const inputClass =
  "mt-2 block w-full rounded-xl border border-primary/20 bg-white px-3 py-2 font-normal text-body";
const primaryButtonClass =
  "rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-primary disabled:opacity-50";
const secondaryButtonClass =
  "rounded-xl border border-primary/20 px-4 py-2 text-sm font-semibold text-ink hover:bg-tint disabled:opacity-50";

/** Case- and accent-blind, so « elo » finds Élodie. */
function fold(text: string) {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("fr-FR");
}

function userStatus(user: ClubUser): "active" | "suspended" | "anonymized" {
  if (user.is_anonymized) return "anonymized";
  return user.is_active ? "active" : "suspended";
}

function matchesStatus(user: ClubUser, filter: StatusFilter) {
  const status = userStatus(user);
  if (filter === "all") return true;
  if (filter === "present") return status !== "anonymized";
  return status === filter;
}

function matchesRole(user: ClubUser, filter: RoleFilter) {
  if (filter === "all") return true;
  if (filter === "admin") return user.is_club_admin;
  return user.club_role === filter;
}

function isSelf(user: ClubUser, identity: Identity) {
  // Display names are unique (club/models.py), and /me/ carries no id.
  return user.display_name === identity.display_name;
}

function Avatar({ user, size = "size-9" }: { user: ClubUser; size?: string }) {
  if (user.avatar) {
    return (
      <img
        src={user.avatar}
        alt=""
        className={`${size} rounded-full object-cover`}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={`${size} grid shrink-0 place-items-center rounded-full bg-tint text-sm font-bold text-accent`}
    >
      {user.display_name.charAt(0).toUpperCase()}
    </span>
  );
}

function Badges({ user }: { user: ClubUser }) {
  const { t } = useTranslation();
  const status = userStatus(user);
  return (
    <span className="flex flex-wrap gap-1.5">
      <span className="rounded-full bg-tint px-2.5 py-0.5 text-xs font-semibold text-accent">
        {t(`users.roles.${user.club_role}`)}
      </span>
      {user.is_club_admin && (
        <span className="rounded-full bg-ink px-2.5 py-0.5 text-xs font-semibold text-white">
          {t("users.admin")}
        </span>
      )}
      {status !== "active" && (
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
            status === "suspended"
              ? "bg-warning-tint text-warning-ink"
              : "bg-fog text-muted"
          }`}
        >
          {t(`users.statuses.${status}`)}
        </span>
      )}
    </span>
  );
}

function UserList({ identity }: { identity: Identity }) {
  const { t } = useTranslation();
  const location = useLocation();
  const deletedName = (location.state as { deleted?: string } | null)?.deleted;
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("present");
  const [role, setRole] = useState<RoleFilter>("all");
  const users = useQuery({ queryKey: usersQueryKey, queryFn: listUsers });

  const folded = fold(search.trim());
  const visible = (users.data ?? [])
    .filter(
      (user) =>
        matchesStatus(user, status) &&
        matchesRole(user, role) &&
        (!folded ||
          fold(user.display_name).includes(folded) ||
          fold(user.email).includes(folded)),
    )
    .sort((a, b) => nameCollator.compare(a.display_name, b.display_name));

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-5 py-10 sm:px-8 sm:py-14">
      <p className="text-sm font-bold tracking-[0.14em] text-accent uppercase">
        {t("admin.eyebrow")}
      </p>
      <h1 className="brand-title mt-3 text-3xl tracking-[-0.035em] text-ink sm:text-4xl">
        {t("users.title")}
      </h1>

      {deletedName && (
        <p role="status" className="mt-4 text-sm font-semibold text-success">
          {t("users.deleted", { name: deletedName })}
        </p>
      )}

      <div className="mt-8 grid gap-4 sm:grid-cols-[1fr_auto_auto]">
        <label className="text-sm font-semibold text-ink">
          <IconLabel icon="search">{t("users.search")}</IconLabel>
          <input
            type="search"
            className={inputClass}
            value={search}
            placeholder={t("users.searchPlaceholder")}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <label className="text-sm font-semibold text-ink">
          {t("users.filterStatus")}
          <select
            className={inputClass}
            value={status}
            onChange={(event) => setStatus(event.target.value as StatusFilter)}
          >
            {STATUS_FILTERS.map((filter) => (
              <option key={filter} value={filter}>
                {t(`users.statusFilters.${filter}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-semibold text-ink">
          {t("users.filterRole")}
          <select
            className={inputClass}
            value={role}
            onChange={(event) => setRole(event.target.value as RoleFilter)}
          >
            {ROLE_FILTERS.map((filter) => (
              <option key={filter} value={filter}>
                {t(`users.roleFilters.${filter}`)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {users.isPending ? (
        <p role="status" className="mt-8 text-sm text-muted">
          {t("users.loading")}
        </p>
      ) : users.isError ? (
        <RequestError error={users.error} />
      ) : (
        <section aria-labelledby="user-list-count" className="mt-8">
          <h2 id="user-list-count" className="text-sm text-muted">
            {t("users.count", { count: visible.length })}
          </h2>
          {visible.length > 0 ? (
            <ul className="mt-3 divide-y divide-primary/10 overflow-hidden rounded-2xl border border-primary/12 bg-white shadow-sm">
              {visible.map((user) => (
                <li key={user.id}>
                  <Link
                    to={`/users/${user.id}`}
                    className="flex flex-wrap items-center gap-3 px-4 py-3 no-underline hover:bg-mist focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-lagoon"
                  >
                    <Avatar user={user} />
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold text-ink">
                        {user.display_name}
                        {isSelf(user, identity) && (
                          <span className="font-normal text-muted">
                            {" "}
                            {t("users.you")}
                          </span>
                        )}
                      </span>
                      <span className="block truncate text-sm text-muted">
                        {user.email}
                      </span>
                    </span>
                    <Badges user={user} />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 rounded-2xl border border-dashed border-primary/20 p-5 text-sm text-muted">
              {t("users.noMatch")}
            </p>
          )}
        </section>
      )}
    </main>
  );
}

function RoleForm({ user, locked }: { user: ClubUser; locked: boolean }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const adminHintId = useId();
  const activeHintId = useId();
  const [clubRole, setClubRole] = useState(user.club_role);
  const [isClubAdmin, setIsClubAdmin] = useState(user.is_club_admin);
  const [isActive, setIsActive] = useState(user.is_active);
  const [saved, setSaved] = useState(false);

  const changes: UserChanges = {};
  if (clubRole !== user.club_role) changes.club_role = clubRole;
  if (isClubAdmin !== user.is_club_admin) changes.is_club_admin = isClubAdmin;
  if (isActive !== user.is_active) changes.is_active = isActive;
  const isDirty = Object.keys(changes).length > 0;

  const save = useMutation({
    mutationFn: () => updateUser(user.id, changes),
    onSuccess: async (updated) => {
      queryClient.setQueryData(userQueryKey(user.id), updated);
      setSaved(true);
      await queryClient.invalidateQueries({ queryKey: usersQueryKey });
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved(false);
    save.mutate();
  }

  function chooseRole(role: ClubUser["club_role"]) {
    setClubRole(role);
    setSaved(false);
    // An administrator is a mentor who also administrates.
    if (role === "student") setIsClubAdmin(false);
  }

  return (
    <form
      aria-labelledby="role-form-title"
      className="mt-8 rounded-2xl border border-primary/12 bg-white p-5 shadow-sm"
      onSubmit={submit}
    >
      <h2
        id="role-form-title"
        className="text-xs font-bold tracking-[0.14em] text-accent uppercase"
      >
        {t("users.rightsTitle")}
      </h2>
      <fieldset disabled={locked || save.isPending} className="mt-4 space-y-5">
        <fieldset>
          <legend className="text-sm font-semibold text-ink">
            {t("users.role")}
          </legend>
          <div className="mt-2 flex flex-wrap gap-4">
            {(["student", "mentor"] as const).map((role) => (
              <label
                key={role}
                className="flex items-center gap-2 text-sm text-body"
              >
                <input
                  type="radio"
                  name="club_role"
                  value={role}
                  checked={clubRole === role}
                  onChange={() => chooseRole(role)}
                />
                {t(`users.roles.${role}`)}
              </label>
            ))}
          </div>
        </fieldset>

        <div>
          <label className="flex items-center gap-2 text-sm font-semibold text-ink">
            <input
              type="checkbox"
              checked={isClubAdmin}
              disabled={clubRole !== "mentor"}
              aria-describedby={adminHintId}
              onChange={(event) => {
                setIsClubAdmin(event.target.checked);
                setSaved(false);
              }}
            />
            {t("users.isClubAdmin")}
          </label>
          <p id={adminHintId} className="mt-1 ml-6 text-xs text-muted">
            {t("users.isClubAdminHint")}
          </p>
          <FieldErrors
            id={`${adminHintId}-errors`}
            issues={fieldIssues(save.error, "is_club_admin")}
          />
        </div>

        <div>
          <label className="flex items-center gap-2 text-sm font-semibold text-ink">
            <input
              type="checkbox"
              checked={isActive}
              aria-describedby={activeHintId}
              onChange={(event) => {
                setIsActive(event.target.checked);
                setSaved(false);
              }}
            />
            {t("users.isActive")}
          </label>
          <p id={activeHintId} className="mt-1 ml-6 text-xs text-muted">
            {t("users.isActiveHint")}
          </p>
        </div>
      </fieldset>

      {save.isError && (
        <RequestError error={save.error} handledFields={["is_club_admin"]} />
      )}
      {saved && !isDirty && (
        <p role="status" className="mt-4 text-sm font-semibold text-success">
          {t("users.saved")}
        </p>
      )}

      {!locked && (
        <div className="mt-5 flex justify-end gap-3">
          <button
            type="button"
            className={secondaryButtonClass}
            disabled={!isDirty || save.isPending}
            onClick={() => {
              setClubRole(user.club_role);
              setIsClubAdmin(user.is_club_admin);
              setIsActive(user.is_active);
              save.reset();
            }}
          >
            {t("users.reset")}
          </button>
          <button
            type="submit"
            className={primaryButtonClass}
            disabled={!isDirty || save.isPending}
          >
            {save.isPending ? t("users.saving") : t("users.save")}
          </button>
        </div>
      )}
    </form>
  );
}

function DeleteSection({ user }: { user: ClubUser }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [isConfirming, setIsConfirming] = useState(false);
  const remove = useMutation({
    mutationFn: () => deleteUser(user.id),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["users"] }),
        // Their name disappears from every roster too.
        queryClient.invalidateQueries({ queryKey: ["teams"] }),
      ]);
      navigate("/users", { state: { deleted: user.display_name } });
    },
  });

  return (
    <section
      aria-labelledby="delete-user-title"
      className="mt-8 rounded-2xl border border-red-800/20 bg-white p-5 shadow-sm"
    >
      <h2
        id="delete-user-title"
        className="text-xs font-bold tracking-[0.14em] text-red-800 uppercase"
      >
        {t("users.deleteTitle")}
      </h2>
      <p className="mt-3 text-sm leading-6 text-muted">
        {t("users.deleteExplanation")}
      </p>
      {isConfirming ? (
        <div
          role="alertdialog"
          aria-labelledby="delete-user-confirm"
          className="mt-4 rounded-xl border border-red-800/20 bg-red-50 p-4"
        >
          <p id="delete-user-confirm" className="text-sm text-red-900">
            {t("users.deleteConfirm", { name: user.display_name })}
          </p>
          <div className="mt-3 flex justify-end gap-3">
            <button
              type="button"
              className={secondaryButtonClass}
              disabled={remove.isPending}
              onClick={() => {
                setIsConfirming(false);
                remove.reset();
              }}
            >
              {t("users.cancel")}
            </button>
            <button
              type="button"
              className="rounded-xl bg-red-800 px-4 py-2 text-sm font-semibold text-white hover:bg-red-900 disabled:opacity-50"
              disabled={remove.isPending}
              onClick={() => remove.mutate()}
            >
              <IconLabel icon="xmark">
                {remove.isPending
                  ? t("users.deleting")
                  : t("users.confirmDelete")}
              </IconLabel>
            </button>
          </div>
          {remove.isError && <RequestError error={remove.error} />}
        </div>
      ) : (
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            className="rounded-xl border border-red-800/25 px-4 py-2 text-sm font-semibold text-red-800 hover:bg-red-50"
            onClick={() => setIsConfirming(true)}
          >
            <IconLabel icon="xmark">{t("users.delete")}</IconLabel>
          </button>
        </div>
      )}
    </section>
  );
}

function UserDetail({ identity }: { identity: Identity }) {
  const { t } = useTranslation();
  const userId = Number(useParams().userId);
  const user = useQuery({
    queryKey: userQueryKey(userId),
    queryFn: () => getUser(userId),
    enabled: Number.isInteger(userId),
  });

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-10 sm:px-8 sm:py-14">
      <Link
        to="/users"
        className="text-sm font-semibold text-accent hover:underline"
      >
        {t("users.backToList")}
      </Link>

      {!Number.isInteger(userId) ? (
        <p role="alert" className="mt-6 text-sm text-red-800">
          {t("errors.not_found")}
        </p>
      ) : user.isPending ? (
        <p role="status" className="mt-6 text-sm text-muted">
          {t("users.loadingOne")}
        </p>
      ) : user.isError ? (
        <RequestError error={user.error} />
      ) : (
        <>
          <div className="mt-6 flex flex-wrap items-center gap-4">
            <Avatar user={user.data} size="size-16" />
            <div className="min-w-0 flex-1">
              <h1 className="brand-title text-3xl tracking-[-0.035em] text-ink">
                {user.data.display_name}
              </h1>
              <p className="mt-1 truncate text-sm text-muted">
                {user.data.email}
              </p>
            </div>
            <Badges user={user.data} />
          </div>

          {isSelf(user.data, identity) && (
            <p className="mt-6 rounded-xl bg-mist px-4 py-3 text-sm text-body">
              {t("users.selfNotice")}
            </p>
          )}
          {user.data.is_anonymized && (
            <p className="mt-6 rounded-xl bg-fog px-4 py-3 text-sm text-body">
              {t("users.anonymizedNotice")}
            </p>
          )}

          <RoleForm
            key={user.data.id}
            user={user.data}
            locked={isSelf(user.data, identity) || user.data.is_anonymized}
          />
          {!isSelf(user.data, identity) && !user.data.is_anonymized && (
            <DeleteSection user={user.data} />
          )}
        </>
      )}
    </main>
  );
}

export function UsersPage() {
  return (
    <AdminOnly>{(identity) => <UserList identity={identity} />}</AdminOnly>
  );
}

export function UserDetailPage() {
  return (
    <AdminOnly>{(identity) => <UserDetail identity={identity} />}</AdminOnly>
  );
}
