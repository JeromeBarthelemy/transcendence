import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";

import type { Identity } from "../api/auth";
import {
  changeWorkItemStatus,
  createWorkItemNote,
  deleteWorkItem,
  getWorkItem,
  leaveTodaysProgress,
  type ProgressChanges,
  removeAttachment,
  tickWorkItem,
  updateProgress,
  uploadAttachment,
  type WorkItemDetail,
  type WorkItemEntry,
  type WorkItemStatus,
  type WorkItemStep,
  workItemSteps,
} from "../api/workItems";
import { fetchFreshEntry } from "../app/entries";
import { nameFormatter, teamLabel } from "../app/formatters";
import { useCurrentUser } from "../app/useCurrentUser";
import { fieldIssues, RequestError } from "../components/ApiErrors";
import { AvatarStack } from "../components/Avatar";
import { Button, TextButton } from "../components/Button";
import { StatusChip } from "../components/Chip";
import { EmptyState } from "../components/EmptyState";
import { EntryActions } from "../components/EntryActions";
import { Label, Select, TextArea } from "../components/Field";
import { IconLabel } from "../components/Icon";
import { ConfirmPanel, Notice, SuccessMessage } from "../components/Notice";
import { Page } from "../components/Page";
import { Panel } from "../components/Panel";
import { Eyebrow, Heading } from "../components/Typography";

const dateFormatter = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "long",
});
const dateTimeFormatter = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "long",
  timeStyle: "short",
});
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
      <Label htmlFor={`attachment-file-${entryId}`}>
        {t("workItem.addAttachment")}
      </Label>
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
            {t("workItem.uploading", {
              progress: Math.round(uploadProgress * 100),
            })}
          </label>
          <progress
            id="upload-progress"
            className="mt-1 block w-full accent-accent"
            max={1}
            value={uploadProgress}
          />
        </div>
      )}
      {upload.isSuccess && (
        <SuccessMessage className="mt-3">
          {t("workItem.attachmentSaved")}
        </SuccessMessage>
      )}
      {upload.isError && <RequestError error={upload.error} />}

      <Button
        className="mt-4"
        type="submit"
        disabled={upload.isPending || !file || !peopleAnswer}
      >
        {t("workItem.upload")}
      </Button>
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
  const [refreshError, setRefreshError] = useState<unknown>(null);
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
    onMutate: () => {
      setTheirs(null);
      setRefreshError(null);
    },
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
      try {
        const current = await fetchFreshEntry(
          queryClient,
          {
            queryKey: ["work-items", item.id],
            queryFn: () => getWorkItem(item.id),
          },
          (item) => item.thread,
          entry.id,
        );
        if (current) {
          setTheirs(current.handover);
          setHandoverWas(current.handover);
        }
      } catch (error) {
        setRefreshError(error);
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
        <Label className="mt-5 block" htmlFor={`progress-addition-${entry.id}`}>
          {t("workItem.addition")}
        </Label>
        <TextArea
          className="min-h-28"
          id={`progress-addition-${entry.id}`}
          value={addition}
          placeholder={t("workItem.additionPlaceholder")}
          onChange={(event) => {
            setAddition(event.target.value);
            setSaved(false);
          }}
        />

        <Label className="mt-5 block" htmlFor={`progress-handover-${entry.id}`}>
          {t("workItem.nextTime")}
        </Label>
        <TextArea
          tone="warning"
          className="min-h-24"
          id={`progress-handover-${entry.id}`}
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

        {save.isError && theirs === null && (
          <RequestError error={refreshError ?? save.error} />
        )}
        {saved && (
          <SuccessMessage className="mt-3">
            {t("workItem.progressSaved")}
          </SuccessMessage>
        )}
        <div className="mt-4 flex justify-end">
          <Button
            variant="primary"
            type="submit"
            disabled={save.isPending || nothingToSave}
          >
            {save.isPending ? t("workItem.saving") : t("workItem.save")}
          </Button>
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
  const liveStep =
    item.current_progress?.step ?? item.current_step ?? workItemSteps[0];
  // null means "follow the server"; only an explicit choice is held locally.
  const [stepChoice, setStepChoice] = useState<WorkItemStep | null>(null);
  const selectedStep = stepChoice ?? liveStep;
  const tick = useMutation({
    mutationFn: (step?: WorkItemStep) => tickWorkItem(item.id, step),
    onSuccess: async (_entry, submittedStep) => {
      await invalidateWorkItem();
      if (submittedStep !== undefined) {
        // Joining doesn't submit a step. Nor should an earlier save erase a
        // newer choice made while its request/refetch was still pending.
        setStepChoice((choice) => (choice === submittedStep ? null : choice));
      }
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
  const isClosed = item.status !== "open";
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
    <Panel as="section" padding="lg" aria-labelledby="today-title">
      <Eyebrow>{t("workItem.today")}</Eyebrow>
      <Heading size="section" className="mt-1" id="today-title">
        {progress ? t("workItem.todayProgress") : t("workItem.noProgressToday")}
      </Heading>

      {item.on_robot && !isClosed && (
        <div className="mt-5 flex flex-col gap-3 rounded-2xl bg-mist p-4 sm:flex-row sm:items-end">
          <Label className="flex-1">
            {t("workItem.currentStep")}
            <Select
              value={selectedStep}
              onChange={(event) => {
                const step = event.target.value as WorkItemStep;
                setStepChoice(step === liveStep ? null : step);
              }}
            >
              {workItemSteps.map((step) => (
                <option key={step} value={step}>
                  {t(`teamHome.steps.${step}`)}
                </option>
              ))}
            </Select>
          </Label>
          <Button
            variant="dark"
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
          </Button>
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
            <Button
              disabled={leave.isPending || isConfirmingLeave}
              onClick={() =>
                leavingDeletesText ? setIsConfirmingLeave(true) : leave.mutate()
              }
            >
              <IconLabel icon="xmark">{t("workItem.leave")}</IconLabel>
            </Button>
          ) : (
            !isClosed && (
              <Button
                disabled={tick.isPending}
                onClick={() => tick.mutate(undefined)}
              >
                {t("workItem.join")}
              </Button>
            )
          )}
        </div>
      ) : (
        !item.on_robot && (
          <Button
            variant="dark"
            className="mt-5"
            disabled={tick.isPending}
            onClick={() => tick.mutate(undefined)}
          >
            {item.last_progress
              ? t("workItem.continueToday")
              : t("workItem.startToday")}
          </Button>
        )
      )}

      {isConfirmingLeave && (
        <ConfirmPanel
          className="mt-4"
          message={t("workItem.leaveDeletes")}
          cancelLabel={t("workItem.cancel")}
          confirmLabel={t("workItem.confirmLeave")}
          pending={leave.isPending}
          onCancel={() => setIsConfirmingLeave(false)}
          onConfirm={() => leave.mutate()}
        />
      )}
      {tick.isError && <RequestError error={tick.error} />}
      {leave.isError && <RequestError error={leave.error} />}
      {canEdit && !isClosed && (
        <ProgressEditor key={progress.id} item={item} entry={progress} />
      )}
      {progress && !canEdit && !isClosed && (
        <Notice as="p" tone="warning" className="mt-6">
          {t("workItem.joinToWrite")}
        </Notice>
      )}
    </Panel>
  );
}

function AttachmentRemoval({
  item,
  attachment,
}: {
  item: WorkItemDetail;
  attachment: WorkItemEntry["attachments"][number];
}) {
  const { t } = useTranslation();
  const invalidateWorkItem = useInvalidateWorkItem(item);
  const [isConfirming, setIsConfirming] = useState(false);
  const remove = useMutation({
    mutationFn: () => removeAttachment(attachment.id),
    onSuccess: invalidateWorkItem,
  });

  if (!isConfirming) {
    return (
      <TextButton
        danger
        aria-label={t("workItem.removeFile", { name: attachment.name })}
        className="px-3 pb-3 text-xs"
        onClick={() => setIsConfirming(true)}
      >
        <IconLabel icon="xmark">{t("entryActions.remove")}</IconLabel>
      </TextButton>
    );
  }
  return (
    <ConfirmPanel
      className="mx-3 mb-3"
      message={t("entryActions.removeFile")}
      cancelLabel={t("entryActions.cancel")}
      confirmLabel={t("entryActions.confirmRemove")}
      pending={remove.isPending}
      error={remove.isError ? remove.error : undefined}
      onCancel={() => setIsConfirming(false)}
      onConfirm={() => remove.mutate()}
    />
  );
}

function HistoryEntry({
  item,
  entry,
}: {
  item: WorkItemDetail;
  entry: WorkItemEntry;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const invalidateWorkItem = useInvalidateWorkItem(item);
  const participantNames = nameFormatter.format(
    entry.participants.map((participant) => participant.display_name),
  );

  async function currentBody() {
    const current = await fetchFreshEntry(
      queryClient,
      {
        queryKey: ["work-items", item.id],
        queryFn: () => getWorkItem(item.id),
      },
      (item) => item.thread,
      entry.id,
    );
    return current?.body ?? null;
  }

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

        <EntryActions
          entry={entry}
          onChanged={invalidateWorkItem}
          currentBody={currentBody}
        >
          {entry.body && (
            <p className="mt-4 whitespace-pre-wrap leading-7 text-body">
              {entry.body}
            </p>
          )}
        </EntryActions>
        {entry.handover && (
          <Notice tone="warning" callout className="mt-4">
            <p className="font-bold">{t("workItem.nextTime")}</p>
            <p className="mt-1 whitespace-pre-wrap leading-6">
              {entry.handover}
            </p>
          </Notice>
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
                {attachment.can_remove && (
                  <AttachmentRemoval item={item} attachment={attachment} />
                )}
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
    <Panel as="section" padding="lg" aria-labelledby="work-item-note-title">
      <Heading size="section" id="work-item-note-title">
        <IconLabel icon="pen-to-square">{t("workItem.addNote")}</IconLabel>
      </Heading>
      <p className="mt-2 text-sm leading-6 text-muted">
        {t("workItem.noteHint")}
      </p>
      <form className="mt-4" onSubmit={submit}>
        <Label htmlFor={`work-item-note-${item.id}`}>
          {t("workItem.noteLabel")}
        </Label>
        <TextArea
          className="min-h-24"
          id={`work-item-note-${item.id}`}
          value={body}
          placeholder={t("workItem.notePlaceholder")}
          onChange={(event) => {
            setBody(event.target.value);
            setSaved(false);
          }}
        />
        {note.isError && <RequestError error={note.error} />}
        {saved && (
          <SuccessMessage className="mt-3">
            {t("workItem.noteSaved")}
          </SuccessMessage>
        )}
        <div className="mt-4 flex justify-end">
          <Button type="submit" disabled={note.isPending || !body.trim()}>
            {note.isPending ? t("workItem.noteSaving") : t("workItem.saveNote")}
          </Button>
        </div>
      </form>
    </Panel>
  );
}

/** Closing or reopening, with why. Dropping requires a reason, since that
 * is what the notebook would otherwise lose; the form is the confirmation,
 * so nothing closes by a stray click. */
function StatusForm({
  status,
  isPending,
  onCancel,
  onConfirm,
}: {
  status: WorkItemStatus;
  isPending: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const { t } = useTranslation();
  const reasonId = useId();
  const [reason, setReason] = useState("");
  const required = status === "dropped";
  return (
    <Panel className="mt-6">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onConfirm(reason.trim());
        }}
      >
        <Label htmlFor={reasonId}>{t(`workItem.reasonFor.${status}`)}</Label>
        <TextArea
          id={reasonId}
          value={reason}
          required={required}
          onChange={(event) => setReason(event.target.value)}
        />
        <div className="mt-4 flex gap-3">
          <Button disabled={isPending} onClick={onCancel}>
            {t("workItem.cancel")}
          </Button>
          <Button
            type="submit"
            variant="dark"
            disabled={isPending || (required && !reason.trim())}
          >
            {t(`workItem.confirmStatus.${status}`)}
          </Button>
        </div>
      </form>
    </Panel>
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
  const teamSeason = identity.team_seasons.find(
    (candidate) => candidate.id === item.team_season,
  );
  const team = teamSeason ? teamLabel(teamSeason) : null;
  const invalidateWorkItem = useInvalidateWorkItem(item);
  // The status being changed, its form open until it is saved or cancelled.
  const [statusChange, setStatusChange] = useState<WorkItemStatus | null>(null);
  const close = useMutation({
    mutationFn: ({
      status,
      reason,
    }: {
      status: WorkItemStatus;
      reason: string;
    }) => changeWorkItemStatus(item.id, status, reason),
    onSuccess: async () => {
      setStatusChange(null);
      await invalidateWorkItem();
    },
  });
  const isClosed = item.status !== "open";
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const remove = useMutation({
    mutationFn: () => deleteWorkItem(item.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["team-seasons", item.team_season, "work-items"],
      });
      navigate(`/?team=${item.team_season}`);
    },
  });

  return (
    <Page width="6xl">
      <Link
        to={`/?team=${item.team_season}`}
        className="text-sm font-semibold text-primary hover:underline"
      >
        ← {t("workItem.back")}
      </Link>

      <header className="mt-7 flex flex-col justify-between gap-5 border-b border-primary/10 pb-7 sm:flex-row sm:items-end">
        <div>
          <Eyebrow size="sm">
            {item.on_robot ? t("teamHome.robot") : t("teamHome.offRobot")}
            {team && (
              <>
                {" · "}
                <IconLabel icon="team" before>
                  {team}
                </IconLabel>
              </>
            )}
          </Eyebrow>
          <Heading size="display" className="mt-2">
            {item.title}
          </Heading>
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
            <Button
              variant="danger"
              size="sm"
              pill
              onClick={() => setIsConfirmingDelete(true)}
            >
              <IconLabel icon="xmark">{t("workItem.delete")}</IconLabel>
            </Button>
          )}
          {isClosed ? (
            <Button
              size="sm"
              pill
              disabled={close.isPending}
              onClick={() => setStatusChange("open")}
            >
              {t("workItem.reopen")}
            </Button>
          ) : (
            <>
              <Button
                variant="danger"
                size="sm"
                pill
                disabled={close.isPending}
                onClick={() => setStatusChange("dropped")}
              >
                {t("workItem.drop")}
              </Button>
              {!item.on_robot && (
                <Button
                  variant="success"
                  size="sm"
                  pill
                  disabled={close.isPending}
                  onClick={() => setStatusChange("done")}
                >
                  {t("workItem.finish")}
                </Button>
              )}
            </>
          )}
          <StatusChip status={item.status} size="md">
            {close.isPending ? t("workItem.closing") : undefined}
          </StatusChip>
        </div>
      </header>

      {statusChange && (
        <StatusForm
          // Another status is another question: its reason starts empty.
          key={statusChange}
          status={statusChange}
          isPending={close.isPending}
          onCancel={() => setStatusChange(null)}
          onConfirm={(reason) => close.mutate({ status: statusChange, reason })}
        />
      )}
      {close.isError && <RequestError error={close.error} />}
      {isClosed && (
        <Notice as="p" className="mt-6 font-semibold">
          {item.closed_at
            ? t(
                item.status === "done"
                  ? "workItem.closedDone"
                  : "workItem.closedDropped",
                { date: dateFormatter.format(new Date(item.closed_at)) },
              )
            : t(
                item.status === "done"
                  ? "workItem.closedDoneUndated"
                  : "workItem.closedDroppedUndated",
              )}
        </Notice>
      )}
      {isConfirmingDelete && (
        <ConfirmPanel
          className="mt-6"
          message={t("workItem.deleteConfirm")}
          cancelLabel={t("workItem.cancel")}
          confirmLabel={t("workItem.confirmDelete")}
          pending={remove.isPending}
          error={remove.isError ? remove.error : undefined}
          onCancel={() => setIsConfirmingDelete(false)}
          onConfirm={() => remove.mutate()}
        />
      )}

      {item.handover && (
        <Notice
          as="section"
          tone="warning"
          callout
          padding="lg"
          textSize="inherit"
          className="mt-8"
        >
          <Eyebrow tone="inherit" as="h2">
            {t("workItem.handover")}
          </Eyebrow>
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
        </Notice>
      )}

      <div className="mt-8 grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
        {/* Closed, nothing moves it forward until it is reopened: its
            history can still be put right, and today's tick undone. */}
        {(!isClosed || item.current_progress) && (
          <div className="space-y-6">
            <TodayPanel key={item.id} item={item} identity={identity} />
            {!isClosed && <WorkItemNoteForm item={item} />}
          </div>
        )}

        <section aria-labelledby="history-title">
          <Eyebrow>{t("workItem.fromStart")}</Eyebrow>
          <Heading size="large" className="mt-1" id="history-title">
            <IconLabel icon="scroll">{t("workItem.history")}</IconLabel>
          </Heading>
          {item.thread.length > 0 ? (
            <ol className="mt-6">
              {item.thread.map((entry) => (
                <HistoryEntry key={entry.id} item={item} entry={entry} />
              ))}
            </ol>
          ) : (
            <EmptyState className="mt-5">
              {t("workItem.emptyHistory")}
            </EmptyState>
          )}
        </section>
      </div>
    </Page>
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
      <Page width="6xl" message>
        <p role="status" className="text-sm text-muted">
          {t("auth.checkingSession")}
        </p>
      </Page>
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
      <Page width="6xl" message>
        <p role="alert" className="text-sm text-red-800">
          {t("workItem.invalid")}
        </p>
      </Page>
    );
  }
  if (workItem.isPending) {
    return (
      <Page width="6xl" message>
        <p role="status" className="text-sm text-muted">
          {t("workItem.loading")}
        </p>
      </Page>
    );
  }
  if (workItem.isError) {
    return (
      <Page width="6xl" message>
        <RequestError error={workItem.error} />
      </Page>
    );
  }

  return <WorkItemScreen item={workItem.data} identity={currentUser.data} />;
}
