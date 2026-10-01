import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type ChangeEvent, useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Navigate } from "react-router-dom";

import {
  AVATAR_ACCEPT,
  type AvatarRefusal,
  checkAvatar,
  deleteAvatar,
  type Identity,
  uploadAvatar,
} from "../api/auth";
import { currentUserQueryKey, useCurrentUser } from "../app/useCurrentUser";
import {
  FieldErrors,
  fieldIssues,
  RequestError,
} from "../components/ApiErrors";
import { Avatar, photoChanged } from "../components/Avatar";

const primaryButtonClass =
  "rounded-xl bg-[#0078dd] px-4 py-2 text-sm font-semibold text-white hover:bg-[#004fc5] disabled:opacity-50";
const secondaryButtonClass =
  "rounded-xl border border-[#004fc5]/20 px-4 py-2 text-sm font-semibold text-[#041894] hover:bg-[#eaf5ff] disabled:opacity-50";
const dangerButtonClass =
  "rounded-xl border border-red-800/25 px-4 py-2 text-sm font-semibold text-red-800 hover:bg-red-50 disabled:opacity-50";

const sizeFormatter = new Intl.NumberFormat("fr-FR", {
  maximumFractionDigits: 1,
});

function formatSize(bytes: number): string {
  return `${sizeFormatter.format(bytes / (1024 * 1024))} Mo`;
}

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
    <section
      aria-labelledby="photo-title"
      className="mt-8 rounded-3xl border border-[#004fc5]/12 bg-white p-5 shadow-sm sm:p-7"
    >
      <h2 id="photo-title" className="brand-title text-2xl text-[#041894]">
        {t("profile.photo")}
      </h2>

      <div className="mt-5 flex flex-col items-center gap-6 sm:flex-row sm:items-start">
        <figure className="flex flex-col items-center gap-2">
          {preview && canPreview ? (
            <img
              src={preview}
              alt={t("profile.previewAlt")}
              className="size-32 rounded-full bg-[#eaf5ff] object-cover ring-4 ring-[#00c2d0]/40"
              onError={() => setUnpreviewable(preview)}
            />
          ) : preview ? (
            <span
              role="img"
              aria-label={t("profile.noPreviewAlt")}
              className="grid size-32 place-items-center rounded-full bg-[#eaf5ff] text-2xl font-bold text-[#0078dd] ring-4 ring-[#00c2d0]/40"
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
          <figcaption className="max-w-48 text-center text-xs text-[#506784]">
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
              <p className="text-sm text-[#13294b]">
                <span className="font-semibold">{file.name}</span>
                {" · "}
                {formatSize(file.size)}
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  type="button"
                  className={primaryButtonClass}
                  disabled={busy}
                  onClick={() => upload.mutate(file)}
                >
                  {upload.isPending ? t("profile.sending") : t("profile.send")}
                </button>
                <button
                  type="button"
                  className={secondaryButtonClass}
                  disabled={busy}
                  onClick={cancel}
                >
                  {t("profile.cancel")}
                </button>
              </div>
              {upload.isPending && (
                <div className="mt-4">
                  <progress
                    aria-label={t("profile.progressLabel")}
                    max={100}
                    value={percent}
                    className="h-2 w-full overflow-hidden rounded-full accent-[#0078dd]"
                  />
                  <p role="status" className="mt-1 text-xs text-[#506784]">
                    {percent < 100
                      ? t("profile.progress", { percent })
                      : t("profile.processing")}
                  </p>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="flex flex-wrap gap-3">
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
                  className={`${primaryButtonClass} cursor-pointer peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[#00c2d0]`}
                >
                  {identity.avatar ? t("profile.change") : t("profile.choose")}
                </label>
                {identity.avatar && (
                  <button
                    type="button"
                    className={dangerButtonClass}
                    disabled={busy}
                    onClick={() => {
                      setRefusal(null);
                      setDone(null);
                      upload.reset();
                      remove.mutate();
                    }}
                  >
                    {remove.isPending
                      ? t("profile.removing")
                      : t("profile.remove")}
                  </button>
                )}
              </div>
              <p id={`${inputId}-hint`} className="mt-3 text-xs text-[#506784]">
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
            <p role="status" className="mt-4 text-sm text-[#0a7a4b]">
              {t(done === "uploaded" ? "profile.uploaded" : "profile.removed")}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

export function ProfilePage() {
  const { t } = useTranslation();
  const currentUser = useCurrentUser();

  if (currentUser.isPending) {
    return (
      <main className="mx-auto w-full max-w-2xl flex-1 px-5 py-14 sm:px-8">
        <p role="status" className="text-sm text-[#506784]">
          {t("auth.checkingSession")}
        </p>
      </main>
    );
  }
  if (currentUser.isError) {
    return (
      <main className="mx-auto w-full max-w-2xl flex-1 px-5 py-14 sm:px-8">
        <RequestError error={currentUser.error} />
      </main>
    );
  }
  if (!currentUser.data) {
    return <Navigate to="/login" replace />;
  }
  const identity = currentUser.data;

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-5 py-10 sm:px-8 sm:py-14">
      <p className="text-sm font-bold tracking-[0.14em] text-[#0078dd] uppercase">
        {t("profile.eyebrow")}
      </p>
      <h1 className="brand-title mt-3 text-3xl tracking-[-0.035em] text-[#041894] sm:text-4xl">
        {identity.display_name}
      </h1>
      <p className="mt-2 text-[#506784]">
        {t(`teams.roles.${identity.club_role}`)}
        {identity.is_club_admin && ` · ${t("profile.clubAdmin")}`}
      </p>
      <PhotoForm identity={identity} />
    </main>
  );
}
