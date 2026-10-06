import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";

import type { Identity } from "../api/auth";
import {
  closeWorkItem,
  createWorkItemNote,
  deleteWorkItem,
  getWorkItem,
  leaveTodaysProgress,
  type ProgressChanges,
  tickWorkItem,
  updateProgress,
  uploadAttachment,
  type WorkItemDetail,
  type WorkItemEntry,
  type WorkItemStep,
  workItemSteps,
} from "../api/workItems";
import { nameFormatter } from "../app/formatters";
import { useCurrentUser } from "../app/useCurrentUser";
import { statusColors } from "../app/workItemStatus";
import { fieldIssues, RequestError } from "../components/ApiErrors";
import { AvatarStack } from "../components/Avatar";

const dateFormatter = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "long",
});
const dateTimeFormatter = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "long",
  timeStyle: "short",
});
function teamLabel(identity: Identity, teamSeasonId: number) {
  const teamSeason = identity.team_seasons.find(
    (candidate) => candidate.id === teamSeasonId,
  );
  return teamSeason
    ? `${teamSeason.team.number} · ${teamSeason.team.name}`
    : null;
}

function useInvalidateWorkItem(item: WorkItemDetail) {
  const queryClient = useQueryClient();
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["work-items", item.id] }),
      // This team-season prefix refreshes the work-item list, day summaries,
      // and activity analytics after a progress tick or edit.
      queryClient.invalidateQueries({
        queryKey: ["team-seasons", item.team_season],
      }),
    ]);
  };
}

function AttachmentUploader({
  item,
  entryId,
}: {
  item: WorkItemDetail;
  entryId: number;
}) {
  const { t } = useTranslation();
  const invalidateWorkItem = useInvalidateWorkItem(item);
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [peopleAnswer, setPeopleAnswer] = useState<"" | "yes" | "no">("");
  const [uploadProgress, setUploadProgress] = useState(0);
  const upload = useMutation({
    mutationFn: () => {
      if (!file || !peopleAnswer) {
        throw new Error("The attachment form is incomplete");
      }
      return uploadAttachment(
        entryId,
        file,
        peopleAnswer === "yes",
        setUploadProgress,
      );
    },
    onSuccess: async () => {
      setFile(null);
      setPeopleAnswer("");
      if (fileInput.current) {
        fileInput.current.value = "";
      }
      await invalidateWorkItem();
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setUploadProgress(0);
    upload.mutate();
  }

  return (
    <form className="mt-6 border-t border-primary/10 pt-5" onSubmit={submit}>
      <label
        htmlFor={`attachment-file-${entryId}`}
        className="text-sm font-semibold text-ink"
      >
        {t("workItem.addAttachment")}
      </label>
      <p className="mt-1 text-xs leading-5 text-muted">
        {t("workItem.attachmentHint")}
      </p>
      <input
        ref={fileInput}
        id={`attachment-file-${entryId}`}
        type="file"
        className="mt-3 block w-full text-sm text-muted file:mr-3 file:rounded-lg file:border-0 file:bg-tint file:px-3 file:py-2 file:font-semibold file:text-primary"
        accept=".jpg,.jpeg,.png,.webp,.heic,.mp4,.mov,.webm,.pdf,.step,.stp,.stl"
        onChange={(event) => setFile(event.target.files?.[0] ?? null)}
      />

      <fieldset className="mt-4">
        <legend className="text-sm font-semibold text-ink">
          {t("workItem.peopleRecognisable")}
        </legend>
        <div className="mt-2 flex gap-5 text-sm text-body">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name={`people-recognisable-${entryId}`}
              value="yes"
              checked={peopleAnswer === "yes"}
              onChange={() => setPeopleAnswer("yes")}
            />
            {t("workItem.yes")}
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name={`people-recognisable-${entryId}`}
              value="no"
              checked={peopleAnswer === "no"}
              onChange={() => setPeopleAnswer("no")}
            />
            {t("workItem.no")}
          </label>
        </div>
      </fieldset>

      {upload.isPending && (
        <div className="mt-4">
          <label className="text-xs text-muted" htmlFor="upload-progress">
            {t("workItem.uploading", { progress: uploadProgress })}
          </label>
          <progress
            id="upload-progress"
            className="mt-1 block w-full accent-accent"
            max={100}
            value={uploadProgress}
          />
        </div>
      )}
      {upload.isSuccess && (
        <p role="status" className="mt-3 text-sm font-semibold text-success">
          {t("workItem.attachmentSaved")}
        </p>
      )}
      {upload.isError && <RequestError error={upload.error} />}

      <button
        type="submit"
        className="mt-4 rounded-xl border border-primary/25 px-4 py-2 text-sm font-semibold text-ink disabled:opacity-50"
        disabled={upload.isPending || !file || !peopleAnswer}
      >
        {t("workItem.upload")}
      </button>
    </form>
  );
}

function ProgressEditor({
  item,
  entry,
}: {
  item: WorkItemDetail;
  entry: WorkItemEntry;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const invalidateWorkItem = useInvalidateWorkItem(item);
  const [addition, setAddition] = useState("");
  const [handover, setHandover] = useState(entry.handover);
  // What the member is writing from. Not read from `entry` at save time: a
  // reload in the background would hand over a text they never saw.
  const [handoverWas, setHandoverWas] = useState(entry.handover);
  // The handover someone else saved meanwhile, once a save was refused.
  const [theirs, setTheirs] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const changes: ProgressChanges = {};
  if (addition.trim()) {
    changes.addition = addition.trim();
  }
  if (handover !== handoverWas) {
    changes.handover = handover;
    changes.handover_was = handoverWas;
  }
  const nothingToSave = Object.keys(changes).length === 0;

  const save = useMutation({
    mutationFn: () => updateProgress(entry.id, changes),
    onSuccess: async (savedEntry) => {
      setAddition("");
      setHandover(savedEntry.handover);
      setHandoverWas(savedEntry.handover);
      setTheirs(null);
      setSaved(true);
      await invalidateWorkItem();
    },
    onError: async (error) => {
      if (fieldIssues(error, "detail")[0]?.code !== "progress_changed") {
        return;
      }
      const fresh = await queryClient.fetchQuery({
        queryKey: ["work-items", item.id],
        queryFn: () => getWorkItem(item.id),
        // The cache is what the refusal says is out of date.
        staleTime: 0,
      });
      const current = fresh.thread.find((other) => other.id === entry.id);
      if (current) {
        setTheirs(current.handover);
        setHandoverWas(current.handover);
      }
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved(false);
    save.mutate();
  }

  return (
    <div className="mt-6 border-t border-primary/10 pt-5">
      <form onSubmit={submit}>
        <p className="mb-4 text-sm text-muted">{t("workItem.sharedHint")}</p>
        <p className="text-sm font-semibold text-ink">
          {t("workItem.doneToday")}
        </p>
        {entry.body ? (
          <p className="mt-2 whitespace-pre-wrap text-body">{entry.body}</p>
        ) : (
          <p className="mt-2 text-sm text-muted">{t("workItem.nothingYet")}</p>
        )}
        <label
          htmlFor={`progress-addition-${entry.id}`}
          className="mt-5 block text-sm font-semibold text-ink"
        >
          {t("workItem.addition")}
        </label>
        <textarea
          id={`progress-addition-${entry.id}`}
          className="mt-2 min-h-28 w-full rounded-xl border border-primary/20 px-3 py-2 text-body"
          value={addition}
          placeholder={t("workItem.additionPlaceholder")}
          onChange={(event) => {
            setAddition(event.target.value);
            setSaved(false);
          }}
        />

        <label
          htmlFor={`progress-handover-${entry.id}`}
          className="mt-5 block text-sm font-semibold text-ink"
        >
          {t("workItem.nextTime")}
        </label>
        <textarea
          id={`progress-handover-${entry.id}`}
          className="mt-2 min-h-24 w-full rounded-xl border border-warning/35 bg-warning-wash px-3 py-2 text-body"
          value={handover}
          placeholder={t("workItem.nextTimePlaceholder")}
          aria-describedby={
            theirs !== null
              ? `progress-handover-changed-${entry.id}`
              : undefined
          }
          onChange={(event) => {
            setHandover(event.target.value);
            setSaved(false);
          }}
        />
        {theirs !== null && (
          <div
            id={`progress-handover-changed-${entry.id}`}
            role="alert"
            className="mt-2 rounded-xl border border-warning/35 bg-warning-wash p-3 text-sm text-body"
          >
            <p className="font-semibold">{t("workItem.changedMeanwhile")}</p>
            <p className="mt-1 whitespace-pre-wrap">{theirs}</p>
            <p className="mt-1 text-muted">{t("workItem.mergeThenSave")}</p>
          </div>
        )}

        {save.isError && theirs === null && <RequestError error={save.error} />}
        {saved && (
          <p role="status" className="mt-3 text-sm font-semibold text-success">
            {t("workItem.progressSaved")}
          </p>
        )}
        <div className="mt-4 flex justify-end">
          <button
            type="submit"
            className="rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            disabled={save.isPending || nothingToSave}
          >
            {save.isPending ? t("workItem.saving") : t("workItem.save")}
          </button>
        </div>
      </form>

      <AttachmentUploader item={item} entryId={entry.id} />
    </div>
  );
}

function TodayPanel({
  item,
  identity,
}: {
  item: WorkItemDetail;
  identity: Identity;
}) {
  const { t } = useTranslation();
  const invalidateWorkItem = useInvalidateWorkItem(item);
  const [selectedStep, setSelectedStep] = useState<WorkItemStep>(
    item.current_progress?.step ?? item.current_step ?? workItemSteps[0],
  );
  const tick = useMutation({
    mutationFn: (step?: WorkItemStep) => tickWorkItem(item.id, step),
    onSuccess: async () => {
      await invalidateWorkItem();
    },
  });
  const [isConfirmingLeave, setIsConfirmingLeave] = useState(false);
  const leave = useMutation({
    mutationFn: () => leaveTodaysProgress(item.id),
    onSuccess: async () => {
      setIsConfirmingLeave(false);
      await invalidateWorkItem();
    },
  });
  const progress = item.current_progress;
  // The server deletes a progress its last participant leaves, unless it
  // holds a file: worth a confirmation only when something written goes.
  const leavingDeletesText =
    progress !== null &&
    progress.participants.length === 1 &&
    progress.attachments.length === 0 &&
    Boolean(progress.body || progress.handover);
  const selectedStepWasStarted = item.thread.some(
    (entry) => entry.type === "progress" && entry.step === selectedStep,
  );
  const canEdit =
    progress &&
    (item.current_user_participates || identity.club_role === "mentor");
  const participants = progress
    ? nameFormatter.format(
        progress.participants.map((participant) => participant.display_name),
      )
    : "";

  return (
    <section
      aria-labelledby="today-title"
      className="rounded-3xl border border-primary/12 bg-white p-5 shadow-sm sm:p-7"
    >
      <p className="text-xs font-bold tracking-[0.14em] text-accent uppercase">
        {t("workItem.today")}
      </p>
      <h2 id="today-title" className="brand-title mt-1 text-2xl text-ink">
        {progress ? t("workItem.todayProgress") : t("workItem.noProgressToday")}
      </h2>

      {item.on_robot && (
        <div className="mt-5 flex flex-col gap-3 rounded-2xl bg-mist p-4 sm:flex-row sm:items-end">
          <label className="flex-1 text-sm font-semibold text-ink">
            {t("workItem.currentStep")}
            <select
              className="mt-2 block w-full rounded-xl border border-primary/20 bg-white px-3 py-2 font-normal"
              value={selectedStep}
              onChange={(event) =>
                setSelectedStep(event.target.value as WorkItemStep)
              }
            >
              {workItemSteps.map((step) => (
                <option key={step} value={step}>
                  {t(`teamHome.steps.${step}`)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="rounded-xl bg-ink px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            disabled={
              tick.isPending ||
              (progress !== null && selectedStep === progress.step)
            }
            onClick={() => tick.mutate(selectedStep)}
          >
            {progress
              ? t("workItem.changeStep")
              : selectedStepWasStarted
                ? t("workItem.continueStep")
                : t("workItem.startStep")}
          </button>
        </div>
      )}

      {progress ? (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-ink">
              {t("workItem.participants")}
            </p>
            <p className="mt-1 flex items-center gap-2 text-sm text-muted">
              <AvatarStack people={progress.participants} />
              {participants || t("workItem.noParticipants")}
            </p>
          </div>
          {item.current_user_participates ? (
            <button
              type="button"
              className="rounded-xl border border-primary/25 px-4 py-2 text-sm font-semibold text-ink disabled:opacity-50"
              disabled={leave.isPending || isConfirmingLeave}
              onClick={() =>
                leavingDeletesText ? setIsConfirmingLeave(true) : leave.mutate()
              }
            >
              {t("workItem.leave")}
            </button>
          ) : (
            <button
              type="button"
              className="rounded-xl border border-primary/25 px-4 py-2 text-sm font-semibold text-ink disabled:opacity-50"
              disabled={tick.isPending}
              onClick={() => tick.mutate(undefined)}
            >
              {t("workItem.join")}
            </button>
          )}
        </div>
      ) : (
        !item.on_robot && (
          <button
            type="button"
            className="mt-5 rounded-xl bg-ink px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            disabled={tick.isPending}
            onClick={() => tick.mutate(undefined)}
          >
            {item.last_progress
              ? t("workItem.continueToday")
              : t("workItem.startToday")}
          </button>
        )
      )}

      {isConfirmingLeave && (
        <div className="mt-4 rounded-2xl border border-red-800/20 bg-red-50 p-4">
          <p className="text-sm text-red-900">{t("workItem.leaveDeletes")}</p>
          <div className="mt-3 flex flex-wrap gap-3">
            <button
              type="button"
              className="rounded-xl border border-primary/20 bg-white px-4 py-2 text-sm font-semibold text-ink disabled:opacity-50"
              disabled={leave.isPending}
              onClick={() => setIsConfirmingLeave(false)}
            >
              {t("workItem.cancel")}
            </button>
            <button
              type="button"
              className="rounded-xl bg-red-800 px-4 py-2 text-sm font-semibold text-white hover:bg-red-900 disabled:opacity-50"
              disabled={leave.isPending}
              onClick={() => leave.mutate()}
            >
              {t("workItem.confirmLeave")}
            </button>
          </div>
        </div>
      )}
      {tick.isError && <RequestError error={tick.error} />}
      {leave.isError && <RequestError error={leave.error} />}
      {canEdit && (
        <ProgressEditor key={progress.id} item={item} entry={progress} />
      )}
      {progress && !canEdit && (
        <p className="mt-6 rounded-xl bg-warning-tint p-4 text-sm text-warning-ink">
          {t("workItem.joinToWrite")}
        </p>
      )}
    </section>
  );
}

function HistoryEntry({ entry }: { entry: WorkItemEntry }) {
  const { t } = useTranslation();
  const participantNames = nameFormatter.format(
    entry.participants.map((participant) => participant.display_name),
  );

  return (
    <li className="relative border-l-2 border-lagoon/35 pb-8 pl-6 last:pb-0">
      <span className="absolute top-1 -left-[7px] size-3 rounded-full bg-accent ring-4 ring-tint" />
      <article>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-xs font-bold tracking-[0.12em] text-accent uppercase">
              {t(`workItem.entryTypes.${entry.type}`)}
              {entry.step ? ` · ${t(`teamHome.steps.${entry.step}`)}` : ""}
            </p>
            <p className="mt-1 text-xs text-muted">
              {t("workItem.entryMeta", {
                author: entry.author,
                date: dateTimeFormatter.format(new Date(entry.occurred_at)),
              })}
            </p>
          </div>
          {participantNames && (
            <span className="flex items-center gap-2 rounded-full bg-tint py-1 pr-3 pl-1 text-xs text-primary">
              <AvatarStack people={entry.participants} />
              {participantNames}
            </span>
          )}
        </div>

        {entry.body && (
          <p className="mt-4 whitespace-pre-wrap leading-7 text-body">
            {entry.body}
          </p>
        )}
        {entry.handover && (
          <div className="mt-4 border-l-4 border-warning bg-warning-tint p-3 text-sm text-warning-ink">
            <p className="font-bold">{t("workItem.nextTime")}</p>
            <p className="mt-1 whitespace-pre-wrap leading-6">
              {entry.handover}
            </p>
          </div>
        )}
        {entry.attachments.length > 0 && (
          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            {entry.attachments.map((attachment) => (
              <li
                key={attachment.id}
                className="overflow-hidden rounded-xl border border-primary/12 bg-mist"
              >
                {attachment.content_type.startsWith("image/") && (
                  <img
                    className="h-40 w-full object-cover"
                    src={attachment.url}
                    alt={attachment.name}
                  />
                )}
                <a
                  className="block p-3 text-sm font-semibold text-primary hover:underline"
                  href={attachment.url}
                >
                  {attachment.name}
                </a>
                <p className="px-3 pb-3 text-xs text-muted">
                  {t("workItem.uploadedBy", {
                    name: attachment.uploaded_by,
                  })}
                </p>
              </li>
            ))}
          </ul>
        )}
      </article>
    </li>
  );
}

function WorkItemNoteForm({ item }: { item: WorkItemDetail }) {
  const { t } = useTranslation();
  const invalidateWorkItem = useInvalidateWorkItem(item);
  const [body, setBody] = useState("");
  const [saved, setSaved] = useState(false);
  const note = useMutation({
    mutationFn: (noteBody: string) =>
      createWorkItemNote(item.team_season, item.id, noteBody),
    onSuccess: async () => {
      setBody("");
      setSaved(true);
      await invalidateWorkItem();
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const noteBody = body.trim();
    if (noteBody) {
      setSaved(false);
      note.mutate(noteBody);
    }
  }

  return (
    <section
      aria-labelledby="work-item-note-title"
      className="rounded-3xl border border-primary/12 bg-white p-5 shadow-sm sm:p-7"
    >
      <h2 id="work-item-note-title" className="brand-title text-2xl text-ink">
        {t("workItem.addNote")}
      </h2>
      <p className="mt-2 text-sm leading-6 text-muted">
        {t("workItem.noteHint")}
      </p>
      <form className="mt-4" onSubmit={submit}>
        <label
          htmlFor={`work-item-note-${item.id}`}
          className="text-sm font-semibold text-ink"
        >
          {t("workItem.noteLabel")}
        </label>
        <textarea
          id={`work-item-note-${item.id}`}
          className="mt-2 min-h-24 w-full rounded-xl border border-primary/20 px-3 py-2 text-body"
          value={body}
          placeholder={t("workItem.notePlaceholder")}
          onChange={(event) => {
            setBody(event.target.value);
            setSaved(false);
          }}
        />
        {note.isError && <RequestError error={note.error} />}
        {saved && (
          <p role="status" className="mt-3 text-sm font-semibold text-success">
            {t("workItem.noteSaved")}
          </p>
        )}
        <div className="mt-4 flex justify-end">
          <button
            type="submit"
            className="rounded-xl border border-primary/25 px-4 py-2 text-sm font-semibold text-ink disabled:opacity-50"
            disabled={note.isPending || !body.trim()}
          >
            {note.isPending ? t("workItem.noteSaving") : t("workItem.saveNote")}
          </button>
        </div>
      </form>
    </section>
  );
}

function WorkItemScreen({
  item,
  identity,
}: {
  item: WorkItemDetail;
  identity: Identity;
}) {
  const { t } = useTranslation();
  const progressCount = item.thread.filter(
    (entry) => entry.type === "progress",
  ).length;
  const team = teamLabel(identity, item.team_season);
  const invalidateWorkItem = useInvalidateWorkItem(item);
  const close = useMutation({
    mutationFn: (status: "done" | "dropped") => closeWorkItem(item.id, status),
    onSuccess: async () => {
      await invalidateWorkItem();
    },
  });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const remove = useMutation({
    mutationFn: () => deleteWorkItem(item.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["team-seasons", item.team_season, "work-items"],
      });
      navigate("/");
    },
  });

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-10 sm:px-8 sm:py-14">
      <Link
        to="/"
        className="text-sm font-semibold text-primary hover:underline"
      >
        ← {t("workItem.back")}
      </Link>

      <header className="mt-7 flex flex-col justify-between gap-5 border-b border-primary/10 pb-7 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-bold tracking-[0.14em] text-accent uppercase">
            {item.on_robot ? t("teamHome.robot") : t("teamHome.offRobot")}
            {team ? ` · ${team}` : ""}
          </p>
          <h1 className="brand-title mt-2 text-4xl tracking-[-0.04em] text-ink sm:text-5xl">
            {item.title}
          </h1>
          <p className="mt-3 text-sm text-muted">
            {t("workItem.openedOn", {
              date: dateFormatter.format(new Date(item.opened_at)),
            })}
            <span aria-hidden="true"> · </span>
            {t("workItem.progressCount", { count: progressCount })}
          </p>
        </div>
        <div className="flex items-center gap-3 self-start sm:self-auto">
          {item.thread.length === 0 && (
            <button
              type="button"
              className="rounded-full border border-red-800/25 px-3 py-1 text-sm font-semibold text-red-800 hover:bg-red-50"
              onClick={() => setIsConfirmingDelete(true)}
            >
              {t("workItem.delete")}
            </button>
          )}
          {item.status === "open" && (
            <>
              <button
                type="button"
                className="rounded-full border border-red-800/25 px-3 py-1 text-sm font-semibold text-red-800 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={close.isPending}
                onClick={() => close.mutate("dropped")}
              >
                {t("workItem.drop")}
              </button>
              {!item.on_robot && (
                <button
                  type="button"
                  className="rounded-full border border-success/30 px-3 py-1 text-sm font-semibold text-success hover:bg-success/10 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={close.isPending}
                  onClick={() => close.mutate("done")}
                >
                  {t("workItem.finish")}
                </button>
              )}
            </>
          )}
          <span
            className={`rounded-full px-3 py-1 text-sm font-semibold ${statusColors[item.status]}`}
          >
            {close.isPending
              ? t("workItem.closing")
              : t(`teamHome.statuses.${item.status}`)}
          </span>
        </div>
      </header>

      {close.isError && <RequestError error={close.error} />}
      {isConfirmingDelete && (
        <div className="mt-6 rounded-2xl border border-red-800/20 bg-red-50 p-5">
          <p className="text-sm text-red-900">{t("workItem.deleteConfirm")}</p>
          <div className="mt-4 flex gap-3">
            <button
              type="button"
              className="rounded-xl border border-primary/20 bg-white px-4 py-2 text-sm font-semibold text-ink disabled:opacity-50"
              disabled={remove.isPending}
              onClick={() => setIsConfirmingDelete(false)}
            >
              {t("workItem.cancel")}
            </button>
            <button
              type="button"
              className="rounded-xl bg-red-800 px-4 py-2 text-sm font-semibold text-white hover:bg-red-900 disabled:opacity-50"
              disabled={remove.isPending}
              onClick={() => remove.mutate()}
            >
              {t("workItem.confirmDelete")}
            </button>
          </div>
          {remove.isError && <RequestError error={remove.error} />}
        </div>
      )}

      {item.handover && (
        <section className="mt-8 border-l-4 border-warning bg-warning-tint p-5 text-warning-ink">
          <h2 className="text-xs font-bold tracking-[0.14em] uppercase">
            {t("workItem.handover")}
          </h2>
          <p className="mt-2 whitespace-pre-wrap leading-7">
            {item.handover.body}
          </p>
          <p className="mt-2 text-xs text-warning-muted">
            {t("workItem.entryMeta", {
              author: item.handover.author,
              date: dateTimeFormatter.format(
                new Date(item.handover.occurred_at),
              ),
            })}
          </p>
        </section>
      )}

      <div className="mt-8 grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
        <div className="space-y-6">
          <TodayPanel item={item} identity={identity} />
          <WorkItemNoteForm item={item} />
        </div>

        <section aria-labelledby="history-title">
          <p className="text-xs font-bold tracking-[0.14em] text-accent uppercase">
            {t("workItem.fromStart")}
          </p>
          <h2 id="history-title" className="brand-title mt-1 text-3xl text-ink">
            {t("workItem.history")}
          </h2>
          {item.thread.length > 0 ? (
            <ol className="mt-6">
              {item.thread.map((entry) => (
                <HistoryEntry key={entry.id} entry={entry} />
              ))}
            </ol>
          ) : (
            <p className="mt-5 rounded-2xl border border-dashed border-primary/20 p-5 text-sm text-muted">
              {t("workItem.emptyHistory")}
            </p>
          )}
        </section>
      </div>
    </main>
  );
}

export function WorkItemPage() {
  const { t } = useTranslation();
  const { workItemId } = useParams();
  const id = Number(workItemId);
  const validId = Number.isInteger(id) && id > 0;
  const currentUser = useCurrentUser();
  const workItem = useQuery({
    queryKey: ["work-items", id],
    queryFn: () => getWorkItem(id),
    enabled:
      validId && currentUser.data !== null && currentUser.data !== undefined,
  });

  if (currentUser.isPending) {
    return (
      <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-14 sm:px-8">
        <p role="status" className="text-sm text-muted">
          {t("auth.checkingSession")}
        </p>
      </main>
    );
  }
  if (currentUser.isError) {
    return <RequestError error={currentUser.error} />;
  }
  if (!currentUser.data) {
    return <Navigate to="/login" replace />;
  }
  if (!validId) {
    return (
      <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-14 sm:px-8">
        <p role="alert" className="text-sm text-red-800">
          {t("workItem.invalid")}
        </p>
      </main>
    );
  }
  if (workItem.isPending) {
    return (
      <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-14 sm:px-8">
        <p role="status" className="text-sm text-muted">
          {t("workItem.loading")}
        </p>
      </main>
    );
  }
  if (workItem.isError) {
    return (
      <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-14 sm:px-8">
        <RequestError error={workItem.error} />
      </main>
    );
  }

  return <WorkItemScreen item={workItem.data} identity={currentUser.data} />;
}
