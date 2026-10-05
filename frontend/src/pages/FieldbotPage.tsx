import { useMutation } from "@tanstack/react-query";
import {
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { Navigate } from "react-router-dom";

import type { Identity } from "../api/auth";
import {
  askRules,
  type Citation,
  QUESTION_MAX_LENGTH,
  type RuleAnswer,
} from "../api/rules";
import { useCurrentUser } from "../app/useCurrentUser";
import {
  FieldErrors,
  fieldIssues,
  RequestError,
} from "../components/ApiErrors";
import { Avatar } from "../components/Avatar";

/** Past this many characters, the box says how many are left. */
const COUNTER_FROM = QUESTION_MAX_LENGTH - 100;

interface Exchange {
  id: number;
  question: string;
  answer?: RuleAnswer;
  error?: unknown;
}

function Sphere({
  size,
  thinking = false,
}: {
  size: "lg" | "sm";
  thinking?: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      className={`fieldbot-sphere fieldbot-sphere-${size} block ${
        thinking ? "fieldbot-sphere-thinking" : ""
      }`}
    />
  );
}

function CitationCard({ citation }: { citation: Citation }) {
  const { t } = useTranslation();
  const binding = citation.authority === "binding";

  return (
    <li className="rounded-xl border border-primary/12 bg-mist p-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {citation.reference && (
          <span className="rounded-md bg-ink px-2 py-0.5 font-bold text-white">
            {citation.reference}
          </span>
        )}
        <span
          className={`rounded-full px-2 py-0.5 font-semibold ${
            binding ? "bg-tint text-primary" : "bg-mint-tint text-mint-deep"
          }`}
        >
          {t(`fieldbot.sources.${citation.source}`)} ·{" "}
          {t(`fieldbot.authorities.${citation.authority}`)}
        </span>
        <span className="text-muted">{citation.document_title}</span>
      </div>
      <p className="mt-2 text-sm leading-6 whitespace-pre-line text-body">
        {citation.text}
      </p>
    </li>
  );
}

function BotReply({ exchange }: { exchange: Exchange }) {
  const { t } = useTranslation();
  const { answer, error } = exchange;

  if (error) {
    return (
      <>
        <FieldErrors
          id={`fieldbot-error-${exchange.id}`}
          issues={fieldIssues(error, "question")}
        />
        <RequestError error={error} handledFields={["question"]} />
      </>
    );
  }
  if (!answer) {
    return (
      <p role="status" className="flex items-center gap-2 text-muted">
        {t("fieldbot.thinking")}
      </p>
    );
  }
  // The server only writes a sentence when it has nothing to cite.
  if (answer.citations.length === 0) {
    return <p className="leading-7 text-body">{answer.answer}</p>;
  }
  return (
    <>
      {answer.answer && <p className="leading-7 text-body">{answer.answer}</p>}
      <p className="text-sm text-muted">{t("fieldbot.citationsIntro")}</p>
      <ol aria-label={t("fieldbot.citations")} className="mt-3 space-y-3">
        {answer.citations.map((citation) => (
          <CitationCard key={citation.rank} citation={citation} />
        ))}
      </ol>
    </>
  );
}

function Conversation({ identity }: { identity: Identity }) {
  const { t } = useTranslation();
  const inputId = useId();
  const [draft, setDraft] = useState("");
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const nextId = useRef(1);

  const ask = useMutation({
    mutationFn: ({ question }: { id: number; question: string }) =>
      askRules(question),
    onSuccess: (answer, { id }) =>
      setExchanges((all) =>
        all.map((each) => (each.id === id ? { ...each, answer } : each)),
      ),
    onError: (error, { id }) =>
      setExchanges((all) =>
        all.map((each) => (each.id === id ? { ...each, error } : each)),
      ),
  });

  const last = exchanges.at(-1);
  // Each new question, and then its reply, scrolls into view — down to the
  // bottom of the page, not to the end of the conversation: the sticky form
  // would sit on top of the end of the answer, and the footer stay out of
  // sight. At the bottom, the form is back in its own place under the log.
  useEffect(() => {
    if (last) {
      window.scrollTo({
        top: document.documentElement.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [last]);

  const question = draft.trim();
  const canSend = question.length > 0 && !ask.isPending;

  function send(event?: FormEvent) {
    event?.preventDefault();
    if (!canSend) {
      return;
    }
    const id = nextId.current++;
    setExchanges((all) => [...all, { id, question }]);
    setDraft("");
    ask.mutate({ id, question });
  }

  function sendOnEnter(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Shift+Enter breaks the line; Enter mid-composition (an accent being
    // typed, say) belongs to the input method, not to the form.
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      send();
    }
  }

  const started = exchanges.length > 0;

  return (
    <main
      className={`mx-auto flex w-full max-w-3xl flex-1 flex-col px-5 pb-6 sm:px-8 ${
        started ? "pt-8" : "justify-center py-10"
      }`}
    >
      <div className="flex flex-col items-center">
        <Sphere size="lg" thinking={ask.isPending} />
      </div>
      {/* Hidden rather than removed once the conversation starts: the page
          keeps its heading for whoever navigates by them. */}
      <h1
        className={
          started
            ? "sr-only"
            : "brand-title mt-8 text-center text-2xl tracking-[-0.03em] text-ink sm:text-3xl"
        }
      >
        {t("fieldbot.title")}
      </h1>

      {started && (
        <ol
          role="log"
          aria-label={t("fieldbot.conversation")}
          className="mt-8 flex-1 space-y-6"
        >
          {exchanges.map((exchange) => (
            <li key={exchange.id} className="space-y-6">
              <div className="flex flex-row-reverse items-start gap-3">
                <Avatar person={identity} />
                <div className="flex max-w-[85%] min-w-0 flex-col items-end">
                  <span className="text-xs font-semibold text-muted">
                    {identity.display_name}
                  </span>
                  <p className="mt-1 rounded-2xl rounded-tr-sm bg-primary px-4 py-2.5 leading-7 whitespace-pre-line text-white [overflow-wrap:anywhere]">
                    {exchange.question}
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Sphere
                  size="sm"
                  thinking={!exchange.answer && !exchange.error}
                />
                <div className="flex max-w-[85%] min-w-0 flex-col">
                  <span className="text-xs font-semibold text-muted">
                    {t("fieldbot.botName")}
                  </span>
                  <div className="mt-1 rounded-2xl rounded-tl-sm border border-primary/12 bg-white px-4 py-3 shadow-sm">
                    <BotReply exchange={exchange} />
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}

      <form
        onSubmit={send}
        className={`sticky bottom-4 ${started ? "mt-8" : "mt-6"}`}
      >
        <div className="fieldbot-input flex items-end gap-2 rounded-3xl py-2 pr-2 pl-5">
          <label htmlFor={inputId} className="sr-only">
            {t("fieldbot.label")}
          </label>
          <textarea
            id={inputId}
            rows={1}
            maxLength={QUESTION_MAX_LENGTH}
            value={draft}
            placeholder={t("fieldbot.placeholder")}
            aria-describedby={started ? undefined : `${inputId}-hint`}
            className="field-sizing-content max-h-40 min-h-10 min-w-0 flex-1 resize-none [overflow-wrap:anywhere] bg-transparent py-2 leading-6 text-body outline-none placeholder:text-faint"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={sendOnEnter}
          />
          {draft.length >= COUNTER_FROM && (
            <span className="shrink-0 self-center text-xs whitespace-nowrap text-muted">
              {t("fieldbot.counter", {
                count: draft.length,
                max: QUESTION_MAX_LENGTH,
              })}
            </span>
          )}
          <button
            type="submit"
            aria-label={t("fieldbot.send")}
            disabled={!canSend}
            className="grid size-10 shrink-0 place-items-center rounded-full bg-linear-135 from-primary to-lagoon text-white shadow-md transition hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lagoon disabled:cursor-not-allowed disabled:opacity-40"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="size-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          </button>
        </div>
        {/* Only before the first question: under a sticky box, it would sit
            on top of the messages scrolling past. */}
        {!started && (
          <p
            id={`${inputId}-hint`}
            className="mt-2 px-5 text-center text-xs text-muted"
          >
            {t("fieldbot.hint")}
          </p>
        )}
      </form>
    </main>
  );
}

export function FieldbotPage() {
  const { t } = useTranslation();
  const currentUser = useCurrentUser();

  if (currentUser.isPending) {
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-14 sm:px-8">
        <p role="status" className="text-sm text-muted">
          {t("auth.checkingSession")}
        </p>
      </main>
    );
  }
  if (currentUser.isError) {
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-14 sm:px-8">
        <RequestError error={currentUser.error} />
      </main>
    );
  }
  if (!currentUser.data) {
    return <Navigate to="/login" replace />;
  }
  return <Conversation identity={currentUser.data} />;
}
