import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useReducer } from "react";
import { useTranslation } from "react-i18next";

import {
  acceptRuleSource,
  checkRuleSources,
  dismissPending,
  getRuleSources,
  isDismissed,
  ruleSourcesQueryKey,
  type SourceRow,
} from "../api/ruleSources";
import { formatNoticeTime } from "../app/formatters";
import { AdminOnly } from "../components/AdminOnly";
import { RequestError } from "../components/ApiErrors";
import { Button } from "../components/Button";
import { EmptyState } from "../components/EmptyState";
import { Notice } from "../components/Notice";
import { Page } from "../components/Page";
import { Panel } from "../components/Panel";
import { Eyebrow, Heading } from "../components/Typography";

function SourceCard({
  row,
  onDismiss,
  onAccept,
  acceptPending,
  acceptError,
}: {
  row: SourceRow;
  onDismiss: () => void;
  onAccept: () => void;
  acceptPending: boolean;
  acceptError: unknown;
}) {
  const { t } = useTranslation();
  const headingId = `rule-source-${row.source}`;
  const moreReferences = row.pending
    ? row.pending.summary.references_total -
      row.pending.summary.references.length
    : 0;

  return (
    <Panel as="section" aria-labelledby={headingId}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Heading size="card" id={headingId}>
          {t(`ruleSources.sources.${row.source}`)}
        </Heading>
        <span className="text-xs text-muted">
          {row.checked_at
            ? t("ruleSources.checkedAt", {
                date: formatNoticeTime(row.checked_at),
              })
            : t("ruleSources.neverChecked")}
        </span>
      </div>

      {row.title ? (
        <p className="mt-1 text-sm text-muted">{row.title}</p>
      ) : (
        <p className="mt-2 text-sm text-muted">
          {t("ruleSources.notIngested")}
        </p>
      )}

      {row.check?.status === "error" && (
        <Notice tone="danger" className="mt-3">
          {t("ruleSources.checkError", { detail: row.check.detail })}
        </Notice>
      )}

      {row.pending && !isDismissed(row) && (
        <Notice tone="warning" callout className="mt-4">
          <p className="font-semibold">
            {t("ruleSources.pendingTitle", {
              date: formatNoticeTime(row.pending.detected_at),
            })}
          </p>
          <p className="mt-2">
            {t("ruleSources.changes", {
              added: row.pending.summary.added,
              removed: row.pending.summary.removed,
              changed: row.pending.summary.changed,
            })}
          </p>
          {row.pending.summary.references.length > 0 && (
            <p className="mt-2">
              {t("ruleSources.references", {
                list: row.pending.summary.references.join(", "),
              })}{" "}
              {moreReferences > 0 &&
                t("ruleSources.referencesMore", { count: moreReferences })}
            </p>
          )}
          <div className="mt-4 flex flex-wrap gap-3">
            <Button
              variant="primary"
              disabled={acceptPending}
              onClick={onAccept}
            >
              {acceptPending
                ? t("ruleSources.accepting")
                : t("ruleSources.accept")}
            </Button>
            <Button
              variant="secondary"
              disabled={acceptPending}
              onClick={onDismiss}
            >
              {t("ruleSources.dismiss")}
            </Button>
          </div>
          <RequestError error={acceptError} />
        </Notice>
      )}
    </Panel>
  );
}

function RuleSourcesScreen() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  // Dismissing writes straight to storage (isDismissed reads it back on
  // every render); this has no state of its own to hold, only a reason to
  // render again once that write has happened.
  const [, dismissedSomething] = useReducer((tick: number) => tick + 1, 0);

  const sources = useQuery({
    queryKey: ruleSourcesQueryKey,
    queryFn: getRuleSources,
  });
  const check = useMutation({
    mutationFn: checkRuleSources,
    onSuccess: (rows) => queryClient.setQueryData(ruleSourcesQueryKey, rows),
  });
  const accept = useMutation({
    mutationFn: acceptRuleSource,
    onSuccess: (rows) => queryClient.setQueryData(ruleSourcesQueryKey, rows),
  });

  return (
    <Page>
      <Eyebrow size="sm">{t("ruleSources.eyebrow")}</Eyebrow>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-4">
        <Heading size="page">{t("ruleSources.title")}</Heading>
        <Button
          variant="secondary"
          disabled={check.isPending}
          onClick={() => check.mutate()}
        >
          {check.isPending
            ? t("ruleSources.checking")
            : t("ruleSources.checkNow")}
        </Button>
      </div>

      {check.isError && <RequestError error={check.error} />}

      {sources.isPending ? (
        <p role="status" className="mt-8 text-sm text-muted">
          {t("ruleSources.loading")}
        </p>
      ) : sources.isError ? (
        <div className="mt-8">
          <RequestError error={sources.error} />
        </div>
      ) : sources.data.length === 0 ? (
        <EmptyState className="mt-8">{t("ruleSources.noSeason")}</EmptyState>
      ) : (
        <div className="mt-8 space-y-6">
          {sources.data.map((row) => (
            <SourceCard
              key={row.source}
              row={row}
              onDismiss={() => {
                if (row.pending) {
                  dismissPending(row.source, row.pending.detected_at);
                  dismissedSomething();
                }
              }}
              onAccept={() => accept.mutate(row.source)}
              acceptPending={
                accept.isPending && accept.variables === row.source
              }
              acceptError={
                accept.variables === row.source ? accept.error : undefined
              }
            />
          ))}
        </div>
      )}
    </Page>
  );
}

export function RuleSourcesPage() {
  return <AdminOnly>{() => <RuleSourcesScreen />}</AdminOnly>;
}
