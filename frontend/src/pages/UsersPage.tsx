import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type SyntheticEvent, useId, useState } from "react";
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
import { useFormatters } from "../app/formatters";
import { foldText } from "../app/text";
import { AdminOnly } from "../components/AdminOnly";
import {
  FieldErrors,
  fieldIssues,
  RequestError,
} from "../components/ApiErrors";
import { Avatar } from "../components/Avatar";
import { Button } from "../components/Button";
import { Chip } from "../components/Chip";
import { EmptyState } from "../components/EmptyState";
import { FieldHint, Label, Select, TextInput } from "../components/Field";
import { IconLabel } from "../components/Icon";
import { ConfirmPanel, Notice, SuccessMessage } from "../components/Notice";
import { Page } from "../components/Page";
import { Panel } from "../components/Panel";
import { Eyebrow, Heading } from "../components/Typography";

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

function Badges({ user }: { user: ClubUser }) {
  const { t } = useTranslation();
  const status = userStatus(user);
  return (
    <span className="flex flex-wrap gap-1.5">
      <Chip size="xs">{t(`users.roles.${user.club_role}`)}</Chip>
      {user.is_club_admin && (
        <Chip size="xs" tone="ink">
          {t("users.admin")}
        </Chip>
      )}
      {status !== "active" && (
        <Chip size="xs" tone={status === "suspended" ? "warning" : "neutral"}>
          {t(`users.statuses.${status}`)}
        </Chip>
      )}
    </span>
  );
}

function UserList({ identity }: { identity: Identity }) {
  const { t } = useTranslation();
  const { nameCollator } = useFormatters();
  const location = useLocation();
  const deletedName = (location.state as { deleted?: string } | null)?.deleted;
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("present");
  const [role, setRole] = useState<RoleFilter>("all");
  const users = useQuery({ queryKey: usersQueryKey, queryFn: listUsers });

  const folded = foldText(search);
  const visible = (users.data ?? [])
    .filter(
      (user) =>
        matchesStatus(user, status) &&
        matchesRole(user, role) &&
        (!folded ||
          foldText(user.display_name).includes(folded) ||
          foldText(user.email).includes(folded)),
    )
    .sort((a, b) => nameCollator.compare(a.display_name, b.display_name));

  return (
    <Page>
      <Eyebrow size="sm">{t("admin.eyebrow")}</Eyebrow>
      <Heading size="page" className="mt-3">
        {t("users.title")}
      </Heading>

      {deletedName && (
        <SuccessMessage className="mt-4">
          {t("users.deleted", { name: deletedName })}
        </SuccessMessage>
      )}

      <div className="mt-8 grid gap-4 sm:grid-cols-[1fr_auto_auto]">
        <Label>
          <IconLabel icon="search">{t("users.search")}</IconLabel>
          <TextInput
            type="search"
            value={search}
            placeholder={t("users.searchPlaceholder")}
            onChange={(event) => setSearch(event.target.value)}
          />
        </Label>
        <Label>
          {t("users.filterStatus")}
          <Select
            value={status}
            onChange={(event) => setStatus(event.target.value as StatusFilter)}
          >
            {STATUS_FILTERS.map((filter) => (
              <option key={filter} value={filter}>
                {t(`users.statusFilters.${filter}`)}
              </option>
            ))}
          </Select>
        </Label>
        <Label>
          {t("users.filterRole")}
          <Select
            value={role}
            onChange={(event) => setRole(event.target.value as RoleFilter)}
          >
            {ROLE_FILTERS.map((filter) => (
              <option key={filter} value={filter}>
                {t(`users.roleFilters.${filter}`)}
              </option>
            ))}
          </Select>
        </Label>
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
            <Panel as="ul" padding="none" className="mt-3">
              {visible.map((user) => (
                <li key={user.id}>
                  <Link
                    to={`/users/${user.id}`}
                    className="flex flex-wrap items-center gap-3 px-4 py-3 no-underline hover:bg-mist focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-lagoon"
                  >
                    <Avatar person={user} size="list" />
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
            </Panel>
          ) : (
            <EmptyState className="mt-3">{t("users.noMatch")}</EmptyState>
          )}
        </section>
      )}
    </Page>
  );
}

function RoleForm({ user, locked }: { user: ClubUser; locked: boolean }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const adminHintId = useId();
  const activeHintId = useId();
  const displayNameId = useId();
  const contactEmailId = useId();
  const contactEmailHintId = useId();
  const [clubRole, setClubRole] = useState(user.club_role);
  const [isClubAdmin, setIsClubAdmin] = useState(user.is_club_admin);
  const [isActive, setIsActive] = useState(user.is_active);
  const [displayName, setDisplayName] = useState(user.display_name);
  const [contactEmail, setContactEmail] = useState(user.contact_email);
  const [saved, setSaved] = useState(false);

  const changes: UserChanges = {};
  if (clubRole !== user.club_role) changes.club_role = clubRole;
  if (isClubAdmin !== user.is_club_admin) changes.is_club_admin = isClubAdmin;
  if (isActive !== user.is_active) changes.is_active = isActive;
  if (displayName !== user.display_name) changes.display_name = displayName;
  if (contactEmail !== user.contact_email) changes.contact_email = contactEmail;
  const isDirty = Object.keys(changes).length > 0;

  const save = useMutation({
    mutationFn: () => updateUser(user.id, changes),
    onSuccess: async (updated) => {
      queryClient.setQueryData(userQueryKey(user.id), updated);
      setSaved(true);
      await queryClient.invalidateQueries({ queryKey: usersQueryKey });
    },
  });

  function submit(event: SyntheticEvent) {
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
    <Panel
      as="form"
      aria-labelledby="role-form-title"
      className="mt-8"
      onSubmit={submit}
    >
      <Eyebrow as="h2" id="role-form-title">
        {t("users.rightsTitle")}
      </Eyebrow>
      <fieldset disabled={locked || save.isPending} className="mt-4 space-y-5">
        <div>
          <Label htmlFor={displayNameId}>{t("users.displayName")}</Label>
          <TextInput
            id={displayNameId}
            value={displayName}
            onChange={(event) => {
              setDisplayName(event.target.value);
              setSaved(false);
            }}
          />
          <FieldErrors
            id={`${displayNameId}-errors`}
            issues={fieldIssues(save.error, "display_name")}
          />
        </div>

        <div>
          <Label htmlFor={contactEmailId}>{t("users.contactEmail")}</Label>
          <TextInput
            id={contactEmailId}
            type="email"
            aria-describedby={contactEmailHintId}
            value={contactEmail}
            onChange={(event) => {
              setContactEmail(event.target.value);
              setSaved(false);
            }}
          />
          <FieldHint id={contactEmailHintId}>
            {t("users.contactEmailHint")}
          </FieldHint>
          <FieldErrors
            id={`${contactEmailId}-errors`}
            issues={fieldIssues(save.error, "contact_email")}
          />
        </div>

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
          <Label className="flex items-center gap-2">
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
          </Label>
          <FieldHint id={adminHintId} className="ml-6">
            {t("users.isClubAdminHint")}
          </FieldHint>
          <FieldErrors
            id={`${adminHintId}-errors`}
            issues={fieldIssues(save.error, "is_club_admin")}
          />
        </div>

        <div>
          <Label className="flex items-center gap-2">
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
          </Label>
          <FieldHint id={activeHintId} className="ml-6">
            {t("users.isActiveHint")}
          </FieldHint>
        </div>
      </fieldset>

      {save.isError && (
        <RequestError
          error={save.error}
          handledFields={["is_club_admin", "display_name", "contact_email"]}
        />
      )}
      {saved && !isDirty && (
        <SuccessMessage className="mt-4">{t("users.saved")}</SuccessMessage>
      )}

      {!locked && (
        <div className="mt-5 flex justify-end gap-3">
          <Button
            disabled={!isDirty || save.isPending}
            onClick={() => {
              setClubRole(user.club_role);
              setIsClubAdmin(user.is_club_admin);
              setIsActive(user.is_active);
              setDisplayName(user.display_name);
              setContactEmail(user.contact_email);
              save.reset();
            }}
          >
            {t("users.reset")}
          </Button>
          <Button
            variant="primary"
            type="submit"
            disabled={!isDirty || save.isPending}
          >
            {save.isPending ? t("users.saving") : t("users.save")}
          </Button>
        </div>
      )}
    </Panel>
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
    <Panel
      as="section"
      danger
      aria-labelledby="delete-user-title"
      className="mt-8"
    >
      <Eyebrow tone="danger" as="h2" id="delete-user-title">
        {t("users.deleteTitle")}
      </Eyebrow>
      <p className="mt-3 text-sm leading-6 text-muted">
        {t("users.deleteExplanation")}
      </p>
      {isConfirming ? (
        <ConfirmPanel
          className="mt-4"
          message={t("users.deleteConfirm", { name: user.display_name })}
          cancelLabel={t("users.cancel")}
          confirmLabel={
            remove.isPending ? t("users.deleting") : t("users.confirmDelete")
          }
          pending={remove.isPending}
          error={remove.isError ? remove.error : undefined}
          onCancel={() => {
            setIsConfirming(false);
            remove.reset();
          }}
          onConfirm={() => remove.mutate()}
        />
      ) : (
        <div className="mt-4 flex justify-end">
          <Button variant="danger" onClick={() => setIsConfirming(true)}>
            <IconLabel icon="xmark">{t("users.delete")}</IconLabel>
          </Button>
        </div>
      )}
    </Panel>
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
    <Page width="3xl">
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
            <Avatar person={user.data} size="detail" />
            <div className="min-w-0 flex-1">
              <Heading size="page">{user.data.display_name}</Heading>
              <p className="mt-1 truncate text-sm text-muted">
                {user.data.email}
              </p>
            </div>
            <Badges user={user.data} />
          </div>

          {isSelf(user.data, identity) && (
            <Notice as="p" className="mt-6">
              {t("users.selfNotice")}
            </Notice>
          )}
          {user.data.is_anonymized && (
            <Notice as="p" tone="neutral" className="mt-6">
              {t("users.anonymizedNotice")}
            </Notice>
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
    </Page>
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
