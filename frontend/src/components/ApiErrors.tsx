import { useTranslation } from "react-i18next";

import { type ApiIssue, ApiRequestError } from "../api/client";
import fr from "../locales/fr.json";

function hasTranslation(code: string): code is keyof typeof fr.errors {
  return Object.hasOwn(fr.errors, code);
}

export function fieldIssues(error: unknown, field: string): ApiIssue[] {
  return error instanceof ApiRequestError ? error.forField(field) : [];
}

export function FieldErrors({
  id,
  message,
  issues = [],
}: {
  id: string;
  message?: string;
  issues?: ApiIssue[];
}) {
  const { t } = useTranslation();
  if (!message && issues.length === 0) {
    return null;
  }
  const uniqueIssues = new Map(
    issues.map((issue) => [`${issue.code}:${issue.message}`, issue]),
  );

  return (
    <div id={id} role="alert" className="mt-2 space-y-1 text-sm text-red-800">
      {message && <p>{message}</p>}
      {[...uniqueIssues].map(([key, issue]) => (
        <p key={key}>
          {t(
            hasTranslation(issue.code)
              ? (`errors.${issue.code}` as const)
              : "errors.unknown",
          )}
        </p>
      ))}
    </div>
  );
}

export function RequestError({
  error,
  handledFields = [],
}: {
  error: unknown;
  handledFields?: readonly string[];
}) {
  const { t } = useTranslation();
  if (!error) {
    return null;
  }

  if (error instanceof ApiRequestError) {
    const general = [
      ...error.forField("non_field_errors"),
      ...error.forField("detail"),
    ];
    if (general.length > 0) {
      return <FieldErrors id="request-error" issues={general} />;
    }
    // Known fields are shown below their inputs. A new server field must not
    // make the refusal disappear just because this form has no input for it.
    const fields = Object.keys(error.issues);
    if (
      fields.length > 0 &&
      fields.every((field) => handledFields.includes(field))
    ) {
      return null;
    }
  }

  return (
    <p role="alert" className="mt-4 text-sm text-red-800">
      {t(error instanceof TypeError ? "errors.network" : "errors.unknown")}
    </p>
  );
}
