import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  type ChangeEvent,
  type FormEvent,
  useEffect,
  useId,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { Navigate, useNavigate } from "react-router-dom";

import {
  AVATAR_ACCEPT,
  type AvatarRefusal,
  checkAvatar,
  deleteAccount,
  deleteAvatar,
  type Identity,
  requestDataExport,
  uploadAvatar,
} from "../api/auth";
import { ApiRequestError } from "../api/client";
import { useFormatters } from "../app/formatters";
import { currentUserQueryKey, useCurrentUser } from "../app/useCurrentUser";
import {
  FieldErrors,
  fieldIssues,
  RequestError,
} from "../components/ApiErrors";
import { Avatar, photoChanged } from "../components/Avatar";
import { Button, buttonClass } from "../components/Button";
import { Label, TextInput } from "../components/Field";
import { IconLabel } from "../components/Icon";
import { SuccessMessage } from "../components/Notice";
import { Page } from "../components/Page";
import { Panel } from "../components/Panel";
import { Eyebrow, Heading } from "../components/Typography";

/** A local address for the chosen file, released once it is no longer shown. */
function usePreview(file: File | null): string | null {
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  return preview;
}

function PhotoForm({ identity }: { identity: Identity }) {
  const { t } = useTranslation();
  const { formatFileSize } = useFormatters();
  const queryClient = useQueryClient();
  const inputId = useId();
  const [file, setFile] = useState<File | null>(null);
  const [refusal, setRefusal] = useState<AvatarRefusal | null>(null);
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState<"uploaded" | "removed" | null>(null);
  const preview = usePreview(file);
  // Most browsers cannot draw a HEIC photo; the server converts it anyway.
  const [unpreviewable, setUnpreviewable] = useState<string | null>(null);
  const canPreview = preview !== null && unpreviewable !== preview;

  // The face shows in the header and beside the name in every list of
  // members; each of those lists must learn the new address, or its absence.
  async function showEverywhere(next: Identity) {
    queryClient.setQueryData(currentUserQueryKey, next);
    photoChanged();
    await queryClient.invalidateQueries();
  }

  const upload = useMutation({
    mutationFn: (chosen: File) => uploadAvatar(chosen, setProgress),
    onMutate: () => setProgress(0),
    onSuccess: async (next) => {
      setFile(null);
      setDone("uploaded");
      await showEverywhere(next);
    },
  });
  const remove = useMutation({
    mutationFn: deleteAvatar,
    onSuccess: async () => {
      setDone("removed");
      await showEverywhere({ ...identity, avatar: null });
    },
  });
  const busy = upload.isPending || remove.isPending;

  function choose(event: ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0];
    // Cleared, so that choosing the same file again still counts as a choice.
    event.target.value = "";
    if (!chosen) {
      return;
    }
    upload.reset();
    remove.reset();
    setDone(null);
    const refused = checkAvatar(chosen);
    setRefusal(refused);
    setFile(refused ? null : chosen);
  }

  function cancel() {
    setFile(null);
    upload.reset();
  }

  const percent = Math.round(progress * 100);

  return (
    <Panel
      as="section"
      padding="lg"
      aria-labelledby="photo-title"
      className="mt-8"
    >
      <Heading size="section" id="photo-title">
        {t("profile.photo")}
      </Heading>

      <div className="mt-5 flex flex-col items-center gap-6 sm:flex-row sm:items-start">
        <figure className="flex flex-col items-center gap-2">
          {preview && canPreview ? (
            <img
              src={preview}
              alt={t("profile.previewAlt")}
              className="size-32 rounded-full bg-tint object-cover ring-4 ring-lagoon/40"
              onError={() => setUnpreviewable(preview)}
            />
          ) : preview ? (
            <span
              role="img"
              aria-label={t("profile.noPreviewAlt")}
              className="grid size-32 place-items-center rounded-full bg-tint text-2xl font-bold text-accent ring-4 ring-lagoon/40"
            >
              {file && /\.([^.]+)$/.exec(file.name)?.[1].toUpperCase()}
            </span>
          ) : (
            <Avatar
              person={identity}
              size="lg"
              alt={
                identity.avatar
                  ? t("profile.currentAlt")
                  : t("profile.placeholderAlt")
              }
            />
          )}
          <figcaption className="max-w-48 text-center text-xs text-muted">
            {preview
              ? canPreview
                ? t("profile.preview")
                : t("profile.noPreview")
              : identity.avatar
                ? t("profile.current")
                : t("profile.noPhoto")}
          </figcaption>
        </figure>

        <div className="w-full flex-1">
          {file ? (
            <>
              <p className="text-sm text-body">
                <span className="font-semibold">{file.name}</span>
                {" · "}
                {formatFileSize(file.size)}
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                <Button
                  variant="primary"
                  disabled={busy}
                  onClick={() => upload.mutate(file)}
                >
                  {upload.isPending ? t("profile.sending") : t("profile.send")}
                </Button>
                <Button disabled={busy} onClick={cancel}>
                  {t("profile.cancel")}
                </Button>
              </div>
              {upload.isPending && (
                <div className="mt-4">
                  <progress
                    aria-label={t("profile.progressLabel")}
                    max={100}
                    value={percent}
                    className="h-2 w-full overflow-hidden rounded-full accent-accent"
                  />
                  <p role="status" className="mt-1 text-xs text-muted">
                    {percent < 100
                      ? t("profile.progress", { percent })
                      : t("profile.processing")}
                  </p>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="flex flex-wrap justify-center gap-3 sm:justify-start">
                <input
                  id={inputId}
                  type="file"
                  accept={AVATAR_ACCEPT}
                  className="peer sr-only"
                  aria-describedby={`${inputId}-hint`}
                  disabled={busy}
                  onChange={choose}
                />
                <label
                  htmlFor={inputId}
                  className={`${buttonClass({ variant: "primary" })} cursor-pointer peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-lagoon`}
                >
                  {identity.avatar ? t("profile.change") : t("profile.choose")}
                </label>
                {identity.avatar && (
                  <Button
                    variant="danger"
                    disabled={busy}
                    onClick={() => {
                      setRefusal(null);
                      setDone(null);
                      upload.reset();
                      remove.mutate();
                    }}
                  >
                    <IconLabel icon="xmark">
                      {remove.isPending
                        ? t("profile.removing")
                        : t("profile.remove")}
                    </IconLabel>
                  </Button>
                )}
              </div>
              <p
                id={`${inputId}-hint`}
                className="mt-3 text-center text-xs text-muted sm:text-left"
              >
                {t("profile.hint")}
              </p>
            </>
          )}

          {refusal && (
            <p role="alert" className="mt-4 text-sm text-red-800">
              {t(`profile.${refusal}`)}
            </p>
          )}
          <FieldErrors
            id={`${inputId}-errors`}
            issues={fieldIssues(upload.error, "avatar")}
          />
          {upload.isError && (
            <RequestError error={upload.error} handledFields={["avatar"]} />
          )}
          {remove.isError && <RequestError error={remove.error} />}
          {done && (
            <SuccessMessage className="mt-4">
              {t(done === "uploaded" ? "profile.uploaded" : "profile.removed")}
            </SuccessMessage>
          )}
        </div>
      </div>
    </Panel>
  );
}

/** The member's rights over their own data (docs/modules.md §10): a copy by
 * e-mail, and erasure. Both confirmations go to the account's contact
 * address, which for a minor is their legal guardian's — the page cannot
 * say which, since the identity deliberately leaves minority out. */
function PersonalData() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const passwordId = useId();
  const [isConfirming, setIsConfirming] = useState(false);
  const [password, setPassword] = useState("");

  const exportData = useMutation({ mutationFn: requestDataExport });
  const erase = useMutation({
    mutationFn: deleteAccount,
    onSuccess: (sentTo) => {
      // The server has ended the session: nothing of the account may stay
      // on screen, nor in the cache for whoever uses this computer next.
      navigate("/", { replace: true, state: { accountDeleted: sentTo } });
      queryClient.removeQueries();
      queryClient.setQueryData(currentUserQueryKey, null);
    },
  });
  const wrongPassword =
    erase.error instanceof ApiRequestError &&
    erase.error
      .forField("detail")
      .some((issue) => issue.code === "wrong_password");

  function confirmDeletion(event: FormEvent) {
    event.preventDefault();
    if (password && !erase.isPending) {
      erase.mutate(password);
    }
  }

  function cancel() {
    setIsConfirming(false);
    setPassword("");
    erase.reset();
  }

  return (
    <Panel
      as="section"
      padding="lg"
      aria-labelledby="personal-data-title"
      className="mt-8"
    >
      <Heading size="section" id="personal-data-title">
        {t("personalData.title")}
      </Heading>
      <p className="mt-2 text-sm leading-6 text-muted">
        {t("personalData.intro")}
      </p>

      <div className="mt-6 flex flex-col gap-3 border-t border-primary/10 pt-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="font-semibold text-ink">
            {t("personalData.exportTitle")}
          </h3>
          <p className="mt-1 text-sm leading-6 text-muted">
            {t("personalData.exportDescription")}
          </p>
        </div>
        <Button
          variant="primary"
          className="shrink-0"
          disabled={exportData.isPending}
          onClick={() => exportData.mutate()}
        >
          {exportData.isPending
            ? t("personalData.exporting")
            : t("personalData.export")}
        </Button>
      </div>
      {exportData.isSuccess && (
        <SuccessMessage className="mt-3">
          {t("personalData.exported", { address: exportData.data })}
        </SuccessMessage>
      )}
      {exportData.isError && <RequestError error={exportData.error} />}

      <div className="mt-6 flex flex-col gap-3 border-t border-primary/10 pt-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="font-semibold text-ink">
            {t("personalData.deleteTitle")}
          </h3>
          <p className="mt-1 text-sm leading-6 text-muted">
            {t("personalData.deleteDescription")}
          </p>
        </div>
        {!isConfirming && (
          <Button
            variant="danger"
            className="shrink-0"
            onClick={() => setIsConfirming(true)}
          >
            <IconLabel icon="xmark">{t("personalData.delete")}</IconLabel>
          </Button>
        )}
      </div>

      {isConfirming && (
        <form
          onSubmit={confirmDeletion}
          className="mt-4 rounded-2xl border border-red-800/20 bg-red-50 p-4 sm:p-5"
        >
          <p className="text-sm font-semibold text-red-900">
            {t("personalData.deleteWarning")}
          </p>
          <Label className="mt-4 block" htmlFor={passwordId}>
            {t("personalData.password")}
          </Label>
          <TextInput
            tone="danger"
            id={passwordId}
            type="password"
            autoComplete="current-password"
            // Autofocus: the member just asked for this form; the password is the only thing left to do.
            autoFocus
            value={password}
            aria-invalid={wrongPassword}
            onChange={(event) => setPassword(event.target.value)}
          />
          <RequestError error={erase.error} />
          <div className="mt-4 flex flex-wrap gap-3">
            <Button
              variant="danger-solid"
              type="submit"
              disabled={!password || erase.isPending}
            >
              <IconLabel icon="xmark">
                {erase.isPending
                  ? t("personalData.deleting")
                  : t("personalData.confirmDelete")}
              </IconLabel>
            </Button>
            <Button disabled={erase.isPending} onClick={cancel}>
              {t("profile.cancel")}
            </Button>
          </div>
        </form>
      )}
    </Panel>
  );
}

export function ProfilePage() {
  const { t } = useTranslation();
  const currentUser = useCurrentUser();

  if (currentUser.isPending) {
    return (
      <Page width="2xl" message>
        <p role="status" className="text-sm text-muted">
          {t("auth.checkingSession")}
        </p>
      </Page>
    );
  }
  if (currentUser.isError) {
    return (
      <Page width="2xl" message>
        <RequestError error={currentUser.error} />
      </Page>
    );
  }
  if (!currentUser.data) {
    return <Navigate to="/login" replace />;
  }
  const identity = currentUser.data;

  return (
    <Page width="2xl">
      <Eyebrow size="sm">{t("profile.eyebrow")}</Eyebrow>
      <Heading size="page" className="mt-3">
        {identity.display_name}
      </Heading>
      <p className="mt-2 text-muted">
        {t(`teams.roles.${identity.club_role}`)}
        {identity.is_club_admin && ` · ${t("profile.clubAdmin")}`}
      </p>
      <PhotoForm identity={identity} />
      <PersonalData />
    </Page>
  );
}
