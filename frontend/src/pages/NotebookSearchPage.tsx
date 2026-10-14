import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { type ChangeEvent, type FormEvent, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, Navigate, useParams, useSearchParams } from "react-router-dom";

import {
  entryTypes,
  pageSizes,
  type SearchFilters,
  type SearchPage,
  type SearchResult,
  searchEntries,
  searchOrders,
  searchQuery,
} from "../api/search";
import { getWorkItems, type WorkItem, workItemSteps } from "../api/workItems";
import { useFormatters } from "../app/formatters";
import { useCurrentUser } from "../app/useCurrentUser";
import { FieldErrors, RequestError } from "../components/ApiErrors";
import { AvatarStack } from "../components/Avatar";
import { Button, ButtonLink } from "../components/Button";
import { Chip } from "../components/Chip";
import { EmptyState } from "../components/EmptyState";
import { Label, Select, TextInput } from "../components/Field";
import { Icon, IconLabel } from "../components/Icon";
import { Notice } from "../components/Notice";
import { Page } from "../components/Page";
import { Panel } from "../components/Panel";
import { Eyebrow, Heading } from "../components/Typography";

/** The filters a member sets in the form; sorting and paging sit with the
 * results, and are not cleared with them. */
const FILTER_KEYS = [
  "q",
  "work_item",
  "on_robot",
  "step",
  "participant",
  "since",
  "until",
  "type",
] as const;
type FilterKey = (typeof FILTER_KEYS)[number];
type Draft = Record<FilterKey, string>;

const DEFAULT_PAGE_SIZE = 20;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function oneOf<T extends string>(value: string | null, allowed: readonly T[]) {
  return allowed.find((item) => item === value);
}

function positive(value: string | null) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : undefined;
}

/** The URL is the search: a link, the back button and a reload all show the
 * same results. What it cannot mean is left out rather than sent. */
function readFilters(params: URLSearchParams): SearchFilters {
  const day = (key: string) => {
    const value = params.get(key);
    return value && DAY.test(value) ? value : undefined;
  };
  const onRobot = params.get("on_robot");
  const pageSize = positive(params.get("page_size"));
  return {
    q: params.get("q")?.trim() || undefined,
    work_item: positive(params.get("work_item")),
    on_robot:
      onRobot === "true" ? true : onRobot === "false" ? false : undefined,
    step: oneOf(params.get("step"), workItemSteps),
    participant: positive(params.get("participant")),
    since: day("since"),
    until: day("until"),
    type: oneOf(params.get("type"), entryTypes),
    order: oneOf(params.get("order"), searchOrders) ?? "newest",
    page: positive(params.get("page")) ?? 1,
    page_size: pageSizes.find((size) => size === pageSize) ?? DEFAULT_PAGE_SIZE,
  };
}

function draftOf(filters: SearchFilters): Draft {
  return Object.fromEntries(
    FILTER_KEYS.map((key) => [key, String(filters[key] ?? "")]),
  ) as Draft;
}

function attachmentCount(result: SearchResult) {
  const photos = result.attachments.filter((file) =>
    file.content_type.startsWith("image/"),
  ).length;
  return { photos, others: result.attachments.length - photos };
}

function ResultCard({
  result,
  teamSeasonId,
}: {
  result: SearchResult;
  teamSeasonId: number;
}) {
  const { t } = useTranslation();
  const { formatDay, nameFormatter } = useFormatters();
  // A decision's attendees were there, they did not do it: its author is.
  const people = result.type === "progress" ? result.participants : [];
  const { photos, others } = attachmentCount(result);

  return (
    <Panel as="article" padding="sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Link
          to={`/team-seasons/${teamSeasonId}/days/${result.day}`}
          className="text-sm font-semibold text-accent hover:underline"
        >
          {formatDay(result.day)}
        </Link>
        <Chip tone={result.type === "progress" ? "blue" : "neutral"}>
          {t(`search.types.${result.type}`)}
        </Chip>
        {result.work_item && (
          <Link
            to={`/work-items/${result.work_item.id}`}
            className="font-semibold text-ink hover:underline"
          >
            {result.work_item.title}
          </Link>
        )}
        {result.step && (
          <Chip tone="mint">{t(`teamHome.steps.${result.step}`)}</Chip>
        )}
      </div>
      {result.body && (
        <p className="mt-2 whitespace-pre-line text-ink">{result.body}</p>
      )}
      {result.handover && (
        <Notice tone="warning" callout className="mt-3">
          <p className="text-xs font-bold tracking-[0.12em] uppercase">
            {t("teamHome.handover")}
          </p>
          <p className="mt-1 text-sm whitespace-pre-line">{result.handover}</p>
        </Notice>
      )}
      <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
        {people.length > 0 ? (
          <span className="flex items-center gap-2">
            <AvatarStack people={people} />
            {nameFormatter.format(people.map((person) => person.display_name))}
          </span>
        ) : (
          <span>{t("search.by", { name: result.author })}</span>
        )}
        {photos > 0 && <span>{t("search.photos", { count: photos })}</span>}
        {others > 0 && <span>{t("search.files", { count: others })}</span>}
      </p>
    </Panel>
  );
}

function FiltersForm({
  filters,
  workItems,
  people,
  onApply,
}: {
  filters: SearchFilters;
  workItems: WorkItem[];
  people: SearchPage["people"];
  onApply: (draft: Draft) => void;
}) {
  const { t } = useTranslation();
  const periodErrorId = useId();
  const [draft, setDraft] = useState(() => draftOf(filters));
  const reversed = Boolean(
    draft.since && draft.until && draft.since > draft.until,
  );

  function set(key: FilterKey) {
    return (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setDraft((current) => ({ ...current, [key]: event.target.value }));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!reversed) onApply(draft);
  }

  const robot = workItems.filter((item) => item.on_robot);
  const offRobot = workItems.filter((item) => !item.on_robot);

  return (
    <Panel
      as="form"
      role="search"
      aria-label={t("search.filters")}
      padding="md"
      className="mt-8"
      onSubmit={submit}
    >
      <Label className="block">
        {t("search.text")}
        <TextInput
          type="search"
          value={draft.q}
          maxLength={200}
          placeholder={t("search.textPlaceholder")}
          onChange={set("q")}
        />
      </Label>

      <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        <Label className="block">
          {t("search.workItem")}
          <Select value={draft.work_item} onChange={set("work_item")}>
            <option value="">{t("search.any")}</option>
            {robot.length > 0 && (
              <optgroup label={t("teamHome.robot")}>
                {robot.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </optgroup>
            )}
            {offRobot.length > 0 && (
              <optgroup label={t("teamHome.offRobot")}>
                {offRobot.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </optgroup>
            )}
          </Select>
        </Label>
        <Label className="block">
          {t("search.side")}
          <Select value={draft.on_robot} onChange={set("on_robot")}>
            <option value="">{t("search.any")}</option>
            <option value="true">{t("teamHome.robot")}</option>
            <option value="false">{t("teamHome.offRobot")}</option>
          </Select>
        </Label>
        <Label className="block">
          {t("search.step")}
          <Select value={draft.step} onChange={set("step")}>
            <option value="">{t("search.any")}</option>
            {workItemSteps.map((step) => (
              <option key={step} value={step}>
                {t(`teamHome.steps.${step}`)}
              </option>
            ))}
          </Select>
        </Label>
        <Label className="block">
          {t("search.participant")}
          <Select value={draft.participant} onChange={set("participant")}>
            <option value="">{t("search.anyone")}</option>
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.display_name}
              </option>
            ))}
          </Select>
        </Label>
        <Label className="block">
          {t("search.type")}
          <Select value={draft.type} onChange={set("type")}>
            <option value="">{t("search.any")}</option>
            {entryTypes.map((type) => (
              <option key={type} value={type}>
                {t(`search.types.${type}`)}
              </option>
            ))}
          </Select>
        </Label>
        <fieldset className="grid grid-cols-2 gap-3">
          <legend className="sr-only">{t("search.period")}</legend>
          <Label className="block">
            {t("search.since")}
            <TextInput
              type="date"
              min="2000-01-01"
              max="2099-12-31"
              value={draft.since}
              aria-invalid={reversed || undefined}
              aria-describedby={reversed ? periodErrorId : undefined}
              onChange={set("since")}
            />
          </Label>
          <Label className="block">
            {t("search.until")}
            <TextInput
              type="date"
              min="2000-01-01"
              max="2099-12-31"
              value={draft.until}
              aria-invalid={reversed || undefined}
              aria-describedby={reversed ? periodErrorId : undefined}
              onChange={set("until")}
            />
          </Label>
        </fieldset>
      </div>
      {reversed && (
        <FieldErrors id={periodErrorId} message={t("search.periodReversed")} />
      )}

      <div className="mt-6 flex flex-wrap gap-3">
        <Button type="submit" variant="primary" disabled={reversed}>
          <IconLabel icon="search" before>
            {t("search.submit")}
          </IconLabel>
        </Button>
      </div>
    </Panel>
  );
}

/** What is applied, one chip each: removing one is a click, and leaves the
 * others in place. */
function ActiveFilters({
  filters,
  workItems,
  people,
  onRemove,
  onClear,
}: {
  filters: SearchFilters;
  workItems: WorkItem[];
  people: SearchPage["people"];
  onRemove: (key: FilterKey) => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  const { formatDay } = useFormatters();
  const labels: Partial<Record<FilterKey, string>> = {
    q: filters.q && t("search.textChip", { text: filters.q }),
    work_item:
      filters.work_item !== undefined
        ? (workItems.find((item) => item.id === filters.work_item)?.title ??
          t("search.workItem"))
        : undefined,
    on_robot:
      filters.on_robot === undefined
        ? undefined
        : filters.on_robot
          ? t("teamHome.robot")
          : t("teamHome.offRobot"),
    step: filters.step && t(`teamHome.steps.${filters.step}`),
    participant:
      filters.participant !== undefined
        ? (people.find((person) => person.id === filters.participant)
            ?.display_name ?? t("search.participant"))
        : undefined,
    since:
      filters.since &&
      t("search.sinceChip", { date: formatDay(filters.since) }),
    until:
      filters.until &&
      t("search.untilChip", { date: formatDay(filters.until) }),
    type: filters.type && t(`search.types.${filters.type}`),
  };
  const active = FILTER_KEYS.filter((key) => labels[key]);
  if (active.length === 0) return null;

  return (
    <div className="mt-5 flex flex-wrap items-center gap-2">
      <span className="text-sm font-semibold text-ink">
        {t("search.active")}
      </span>
      {active.map((key) => (
        <button
          key={key}
          type="button"
          onClick={() => onRemove(key)}
          aria-label={t("search.remove", { filter: labels[key] })}
          className="inline-flex items-center gap-2 rounded-full bg-tint px-3 py-1 text-xs font-semibold text-primary hover:bg-primary/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lagoon"
        >
          {labels[key]}
          <Icon name="xmark" />
        </button>
      ))}
      <Button size="sm" onClick={onClear}>
        {t("search.clear")}
      </Button>
    </div>
  );
}

function Pagination({
  page,
  pages,
  linkTo,
}: {
  page: number;
  pages: number;
  linkTo: (page: number) => string;
}) {
  const { t } = useTranslation();
  if (pages <= 1) return null;
  return (
    <nav
      aria-label={t("search.pages")}
      className="mt-8 flex flex-wrap items-center justify-between gap-3"
    >
      {page > 1 ? (
        <ButtonLink to={linkTo(page - 1)}>← {t("search.previous")}</ButtonLink>
      ) : (
        <span />
      )}
      <span className="text-sm text-muted">
        {t("search.pageOf", { page, pages })}
      </span>
      {page < pages ? (
        <ButtonLink to={linkTo(page + 1)}>{t("search.next")} →</ButtonLink>
      ) : (
        <span />
      )}
    </nav>
  );
}

export function NotebookSearchPage() {
  const { t } = useTranslation();
  const params = useParams();
  const teamSeasonId = Number(params.teamSeasonId);
  const [searchParams, setSearchParams] = useSearchParams();
  const currentUser = useCurrentUser();
  const filters = readFilters(searchParams);
  const query = searchQuery(filters);
  const signedIn = Boolean(currentUser.data);
  const results = useQuery({
    queryKey: ["team-seasons", teamSeasonId, "search", query],
    queryFn: () => searchEntries(teamSeasonId, filters),
    enabled: signedIn,
    // The previous page stays on screen while the next one loads.
    placeholderData: keepPreviousData,
  });
  const workItems = useQuery({
    queryKey: ["team-seasons", teamSeasonId, "work-items"],
    queryFn: () => getWorkItems(teamSeasonId),
    enabled: signedIn,
  });

  if (currentUser.isPending) {
    return (
      <Page message>
        <p role="status" className="text-sm text-muted">
          {t("auth.checkingSession")}
        </p>
      </Page>
    );
  }
  if (currentUser.isError) {
    return (
      <Page message>
        <RequestError error={currentUser.error} />
      </Page>
    );
  }
  if (!currentUser.data) {
    return <Navigate to="/login" replace />;
  }

  const teamSeason = currentUser.data.team_seasons.find(
    (item) => item.id === teamSeasonId,
  );
  const people = results.data?.people ?? [];
  const items = workItems.data ?? [];

  /** Changing what is searched starts again from the first page. */
  function update(changes: Partial<Record<string, string>>, keepPage = false) {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      for (const [key, value] of Object.entries(changes)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      if (!keepPage) next.delete("page");
      return next;
    });
  }

  function linkTo(page: number) {
    return `?${searchQuery({ ...filters, page })}`;
  }

  const pages = results.data
    ? Math.max(1, Math.ceil(results.data.count / results.data.page_size))
    : 1;

  return (
    <Page width="6xl">
      <Link
        to={`/?team=${teamSeasonId}`}
        className="text-sm font-semibold text-primary hover:underline"
      >
        ← {t("search.back")}
      </Link>
      <header className="mt-7">
        {teamSeason && (
          <Eyebrow size="sm">
            <IconLabel icon="team" before>
              {`${teamSeason.team.number} · ${teamSeason.team.name}`}
            </IconLabel>
          </Eyebrow>
        )}
        <Heading size="page" className="mt-2">
          <IconLabel icon="search" before>
            {t("search.title")}
          </IconLabel>
        </Heading>
      </header>

      <FiltersForm
        // A filter removed or a link followed sets the form afresh.
        key={searchQuery({
          ...filters,
          order: undefined,
          page: undefined,
          page_size: undefined,
        })}
        filters={filters}
        workItems={items}
        people={people}
        onApply={(draft) => update(draft)}
      />

      <ActiveFilters
        filters={filters}
        workItems={items}
        people={people}
        onRemove={(key) => update({ [key]: "" })}
        onClear={() =>
          update(Object.fromEntries(FILTER_KEYS.map((key) => [key, ""])))
        }
      />

      <section aria-labelledby="search-results" className="mt-8">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <h2
            id="search-results"
            className="text-lg font-semibold text-ink"
            aria-live="polite"
          >
            {results.data
              ? t("search.count", { count: results.data.count })
              : t("search.loading")}
          </h2>
          <div className="flex flex-wrap gap-3">
            <Label>
              {t("search.order")}
              <Select
                className="sm:w-auto"
                value={filters.order}
                onChange={(event) => update({ order: event.target.value })}
              >
                {searchOrders.map((order) => (
                  <option key={order} value={order}>
                    {t(`search.orders.${order}`)}
                  </option>
                ))}
              </Select>
            </Label>
            <Label>
              {t("search.pageSize")}
              <Select
                className="sm:w-auto"
                value={filters.page_size}
                onChange={(event) => update({ page_size: event.target.value })}
              >
                {pageSizes.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </Select>
            </Label>
          </div>
        </div>

        {results.isError ? (
          <div className="mt-6">
            <RequestError error={results.error} />
          </div>
        ) : results.data && results.data.results.length === 0 ? (
          <EmptyState className="mt-6">
            {results.data.count > 0
              ? t("search.pastTheEnd")
              : t("search.empty")}
          </EmptyState>
        ) : (
          <ol
            className={`mt-6 space-y-4 ${results.isPlaceholderData ? "opacity-60" : ""}`}
            aria-busy={results.isFetching}
          >
            {results.data?.results.map((result) => (
              <li key={result.id}>
                <ResultCard result={result} teamSeasonId={teamSeasonId} />
              </li>
            ))}
          </ol>
        )}

        {results.data && (
          <Pagination page={results.data.page} pages={pages} linkTo={linkTo} />
        )}
      </section>
    </Page>
  );
}
