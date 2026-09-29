import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, Navigate, useParams } from "react-router-dom";

import type { Identity } from "../api/auth";
import {
  createWorkItemNote,
  getWorkItem,
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
import { RequestError } from "../components/ApiErrors";

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
    <form className="mt-6 border-t border-[#004fc5]/10 pt-5" onSubmit={submit}>
      <label
        htmlFor={`attachment-file-${entryId}`}
        className="text-sm font-semibold text-[#041894]"
      >
        {t("workItem.addAttachment")}
      </label>
      <p className="mt-1 text-xs leading-5 text-[#506784]">
        {t("workItem.attachmentHint")}
      </p>
      <input
        ref={fileInput}
        id={`attachment-file-${entryId}`}
        type="file"
        className="mt-3 block w-full text-sm text-[#506784] file:mr-3 file:rounded-lg file:border-0 file:bg-[#eaf5ff] file:px-3 file:py-2 file:font-semibold file:text-[#004fc5]"
        accept=".jpg,.jpeg,.png,.webp,.heic,.mp4,.mov,.webm,.pdf,.step,.stp,.stl"
        onChange={(event) => setFile(event.target.files?.[0] ?? null)}
      />

      <fieldset className="mt-4">
        <legend className="text-sm font-semibold text-[#041894]">
          {t("workItem.peopleRecognisable")}
        </legend>
        <div className="mt-2 flex gap-5 text-sm text-[#13294b]">
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
          <label className="text-xs text-[#506784]" htmlFor="upload-progress">
            {t("workItem.uploading", { progress: uploadProgress })}
          </label>
          <progress
            id="upload-progress"
            className="mt-1 block w-full accent-[#0078dd]"
            max={100}
            value={uploadProgress}
          />
        </div>
      )}
      {upload.isSuccess && (
        <p role="status" className="mt-3 text-sm font-semibold text-[#167448]">
          {t("workItem.attachmentSaved")}
        </p>
      )}
      {upload.isError && <RequestError error={upload.error} />}

      <button
        type="submit"
        className="mt-4 rounded-xl border border-[#004fc5]/25 px-4 py-2 text-sm font-semibold text-[#041894] disabled:opacity-50"
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
  const invalidateWorkItem = useInvalidateWorkItem(item);
  const [body, setBody] = useState(entry.body);
  const [handover, setHandover] = useState(entry.handover);
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    mutationFn: () => updateProgress(entry.id, { body, handover }),
    onSuccess: async () => {
      setSaved(true);
      await invalidateWorkItem();
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved(false);
    save.mutate();
  }

  return (
    <div className="mt-6 border-t border-[#004fc5]/10 pt-5">
      <form onSubmit={submit}>
        <label
          htmlFor={`progress-body-${entry.id}`}
          className="text-sm font-semibold text-[#041894]"
        >
          {t("workItem.doneToday")}
        </label>
        <textarea
          id={`progress-body-${entry.id}`}
          className="mt-2 min-h-28 w-full rounded-xl border border-[#004fc5]/20 px-3 py-2 text-[#13294b]"
          value={body}
          placeholder={t("workItem.doneTodayPlaceholder")}
          onChange={(event) => {
            setBody(event.target.value);
            setSaved(false);
          }}
        />

        <label
          htmlFor={`progress-handover-${entry.id}`}
          className="mt-5 block text-sm font-semibold text-[#041894]"
        >
          {t("workItem.nextTime")}
        </label>
        <textarea
          id={`progress-handover-${entry.id}`}
          className="mt-2 min-h-24 w-full rounded-xl border border-[#d59600]/35 bg-[#fffdf5] px-3 py-2 text-[#13294b]"
          value={handover}
          placeholder={t("workItem.nextTimePlaceholder")}
          onChange={(event) => {
            setHandover(event.target.value);
            setSaved(false);
          }}
        />

        {save.isError && <RequestError error={save.error} />}
        {saved && (
          <p
            role="status"
            className="mt-3 text-sm font-semibold text-[#167448]"
          >
            {t("workItem.progressSaved")}
          </p>
        )}
        <div className="mt-4 flex justify-end">
          <button
            type="submit"
            className="rounded-xl bg-[#0078dd] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            disabled={save.isPending}
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
  const progress = item.current_progress;
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
      className="rounded-3xl border border-[#004fc5]/12 bg-white p-5 shadow-sm sm:p-7"
    >
      <p className="text-xs font-bold tracking-[0.14em] text-[#0078dd] uppercase">
        {t("workItem.today")}
      </p>
      <h2 id="today-title" className="brand-title mt-1 text-2xl text-[#041894]">
        {progress ? t("workItem.todayProgress") : t("workItem.noProgressToday")}
      </h2>

      {item.on_robot && (
        <div className="mt-5 flex flex-col gap-3 rounded-2xl bg-[#f4f8ff] p-4 sm:flex-row sm:items-end">
          <label className="flex-1 text-sm font-semibold text-[#041894]">
            {t("workItem.currentStep")}
            <select
              className="mt-2 block w-full rounded-xl border border-[#004fc5]/20 bg-white px-3 py-2 font-normal"
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
            className="rounded-xl bg-[#041894] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            disabled={
              tick.isPending ||
              (progress !== null && selectedStep === progress.step)
            }
            onClick={() => tick.mutate(selectedStep)}
          >
            {progress ? t("workItem.changeStep") : t("workItem.startStep")}
          </button>
        </div>
      )}

      {progress ? (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-[#041894]">
              {t("workItem.participants")}
            </p>
            <p className="mt-1 text-sm text-[#506784]">
              {participants || t("workItem.noParticipants")}
            </p>
          </div>
          {!item.current_user_participates && (
            <button
              type="button"
              className="rounded-xl border border-[#004fc5]/25 px-4 py-2 text-sm font-semibold text-[#041894] disabled:opacity-50"
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
            className="mt-5 rounded-xl bg-[#041894] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            disabled={tick.isPending}
            onClick={() => tick.mutate(undefined)}
          >
            {t("workItem.startToday")}
          </button>
        )
      )}

      {tick.isError && <RequestError error={tick.error} />}
      {canEdit && (
        <ProgressEditor key={progress.id} item={item} entry={progress} />
      )}
      {progress && !canEdit && (
        <p className="mt-6 rounded-xl bg-[#fff7dc] p-4 text-sm text-[#634c12]">
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
    <li className="relative border-l-2 border-[#00c2d0]/35 pb-8 pl-6 last:pb-0">
      <span className="absolute top-1 -left-[7px] size-3 rounded-full bg-[#0078dd] ring-4 ring-[#eaf8ff]" />
      <article>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-xs font-bold tracking-[0.12em] text-[#0078dd] uppercase">
              {t(`workItem.entryTypes.${entry.type}`)}
              {entry.step ? ` · ${t(`teamHome.steps.${entry.step}`)}` : ""}
            </p>
            <p className="mt-1 text-xs text-[#506784]">
              {t("workItem.entryMeta", {
                author: entry.author,
                date: dateTimeFormatter.format(new Date(entry.occurred_at)),
              })}
            </p>
          </div>
          {participantNames && (
            <span className="rounded-full bg-[#eaf5ff] px-3 py-1 text-xs text-[#004fc5]">
              {participantNames}
            </span>
          )}
        </div>

        {entry.body && (
          <p className="mt-4 whitespace-pre-wrap leading-7 text-[#13294b]">
            {entry.body}
          </p>
        )}
        {entry.handover && (
          <div className="mt-4 border-l-4 border-[#d59600] bg-[#fff7dc] p-3 text-sm text-[#634c12]">
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
                className="overflow-hidden rounded-xl border border-[#004fc5]/12 bg-[#f8fbff]"
              >
                {attachment.content_type.startsWith("image/") && (
                  <img
                    className="h-40 w-full object-cover"
                    src={attachment.url}
                    alt={attachment.name}
                  />
                )}
                <a
                  className="block p-3 text-sm font-semibold text-[#004fc5] hover:underline"
                  href={attachment.url}
                >
                  {attachment.name}
                </a>
                <p className="px-3 pb-3 text-xs text-[#506784]">
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
      className="rounded-3xl border border-[#004fc5]/12 bg-white p-5 shadow-sm sm:p-7"
    >
      <h2
        id="work-item-note-title"
        className="brand-title text-2xl text-[#041894]"
      >
        {t("workItem.addNote")}
      </h2>
      <p className="mt-2 text-sm leading-6 text-[#506784]">
        {t("workItem.noteHint")}
      </p>
      <form className="mt-4" onSubmit={submit}>
        <label
          htmlFor={`work-item-note-${item.id}`}
          className="text-sm font-semibold text-[#041894]"
        >
          {t("workItem.noteLabel")}
        </label>
        <textarea
          id={`work-item-note-${item.id}`}
          className="mt-2 min-h-24 w-full rounded-xl border border-[#004fc5]/20 px-3 py-2 text-[#13294b]"
          value={body}
          placeholder={t("workItem.notePlaceholder")}
          onChange={(event) => {
            setBody(event.target.value);
            setSaved(false);
          }}
        />
        {note.isError && <RequestError error={note.error} />}
        {saved && (
          <p
            role="status"
            className="mt-3 text-sm font-semibold text-[#167448]"
          >
            {t("workItem.noteSaved")}
          </p>
        )}
        <div className="mt-4 flex justify-end">
          <button
            type="submit"
            className="rounded-xl border border-[#004fc5]/25 px-4 py-2 text-sm font-semibold text-[#041894] disabled:opacity-50"
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

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-10 sm:px-8 sm:py-14">
      <Link
        to="/"
        className="text-sm font-semibold text-[#004fc5] hover:underline"
      >
        ← {t("workItem.back")}
      </Link>

      <header className="mt-7 flex flex-col justify-between gap-5 border-b border-[#004fc5]/10 pb-7 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-bold tracking-[0.14em] text-[#0078dd] uppercase">
            {item.on_robot ? t("teamHome.robot") : t("teamHome.offRobot")}
            {team ? ` · ${team}` : ""}
          </p>
          <h1 className="brand-title mt-2 text-4xl tracking-[-0.04em] text-[#041894] sm:text-5xl">
            {item.title}
          </h1>
          <p className="mt-3 text-sm text-[#506784]">
            {item.opened_at
              ? t("workItem.openedOn", {
                  date: dateFormatter.format(new Date(item.opened_at)),
                })
              : t("workItem.notOpened")}
            <span aria-hidden="true"> · </span>
            {t("workItem.progressCount", { count: progressCount })}
          </p>
        </div>
        <span className="self-start rounded-full bg-[#eaf5ff] px-3 py-1 text-sm font-semibold text-[#0078dd] sm:self-auto">
          {t(`teamHome.statuses.${item.status}`)}
        </span>
      </header>

      {item.handover && (
        <section className="mt-8 border-l-4 border-[#d59600] bg-[#fff7dc] p-5 text-[#634c12]">
          <h2 className="text-xs font-bold tracking-[0.14em] uppercase">
            {t("workItem.handover")}
          </h2>
          <p className="mt-2 whitespace-pre-wrap leading-7">
            {item.handover.body}
          </p>
          <p className="mt-2 text-xs text-[#7a6221]">
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
          <p className="text-xs font-bold tracking-[0.14em] text-[#0078dd] uppercase">
            {t("workItem.fromStart")}
          </p>
          <h2
            id="history-title"
            className="brand-title mt-1 text-3xl text-[#041894]"
          >
            {t("workItem.history")}
          </h2>
          {item.thread.length > 0 ? (
            <ol className="mt-6">
              {item.thread.map((entry) => (
                <HistoryEntry key={entry.id} entry={entry} />
              ))}
            </ol>
          ) : (
            <p className="mt-5 rounded-2xl border border-dashed border-[#004fc5]/20 p-5 text-sm text-[#506784]">
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
        <p role="status" className="text-sm text-[#506784]">
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
        <p role="status" className="text-sm text-[#506784]">
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
