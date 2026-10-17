import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  importRuleSource,
  ruleSourcesQueryKey,
  SOURCE_MAX_BYTES,
  type SourceImport,
  type SourceRow,
} from "../api/ruleSources";
import { glossaryQueryKey } from "../api/rules";
import { RequestError } from "./ApiErrors";
import { Button } from "./Button";
import { fieldClass, Label, Select, TextInput } from "./Field";
import { Notice, SuccessMessage } from "./Notice";
import { Panel } from "./Panel";
import { Heading } from "./Typography";

/** Explicit imports replace the searched copy, unlike automatic checks
 * which only propose a change. Existing sources therefore need consent. */
export function RuleSourceImport({
  rows,
  busy,
}: {
  rows: SourceRow[];
  busy: boolean;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const id = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<SourceRow["source"]>("game_manual");
  const [mode, setMode] = useState<"file" | "url">("file");
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [refusal, setRefusal] = useState<
    "source_file_type" | "source_file_size" | null
  >(null);
  const existing = rows.some(
    (row) => row.source === source && row.title !== null,
  );

  const mutation = useMutation({
    mutationKey: ruleSourcesQueryKey,
    mutationFn: importRuleSource,
    onSuccess: async (next) => {
      queryClient.setQueryData(ruleSourcesQueryKey, next);
      setTitle("");
      setUrl("");
      setConfirmed(false);
      if (fileInput.current) fileInput.current.value = "";
      await queryClient.invalidateQueries({ queryKey: glossaryQueryKey });
    },
  });

  function changed() {
    mutation.reset();
    setRefusal(null);
    setConfirmed(false);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || mutation.isPending || (existing && !confirmed)) return;
    const file = mode === "file" ? fileInput.current?.files?.[0] : undefined;
    if (mode === "file" && !file) return;
    if (file && !/\.html?$/i.test(file.name)) {
      setRefusal("source_file_type");
      return;
    }
    if (file && file.size > SOURCE_MAX_BYTES) {
      setRefusal("source_file_size");
      return;
    }
    setRefusal(null);
    const input: SourceImport = { source };
    if (title.trim()) input.title = title.trim();
    if (url.trim()) input.url = url.trim();
    if (file) input.file = file;
    mutation.mutate(input);
  }

  return (
    <Panel as="section" aria-labelledby={`${id}-heading`}>
      <Heading size="section" id={`${id}-heading`}>
        {t("ruleSources.importTitle")}
      </Heading>
      <p id={`${id}-help`} className="mt-2 text-sm text-muted">
        {t("ruleSources.importHelp")}
      </p>
      <form onSubmit={submit} className="mt-5" aria-describedby={`${id}-help`}>
        <fieldset disabled={busy || mutation.isPending} className="space-y-4">
          <Label className="block">
            {t("ruleSources.sourceLabel")}
            <Select
              value={source}
              onChange={(event) => {
                changed();
                setSource(event.target.value as SourceRow["source"]);
                setUrl("");
              }}
            >
              <option value="game_manual">
                {t("ruleSources.sources.game_manual")}
              </option>
              <option value="official_qa">
                {t("ruleSources.sources.official_qa")}
              </option>
            </Select>
          </Label>
          <Label className="block">
            {t("ruleSources.importMethod")}
            <Select
              value={mode}
              onChange={(event) => {
                changed();
                setMode(event.target.value as "file" | "url");
                setUrl("");
              }}
            >
              <option value="file">{t("ruleSources.fromFile")}</option>
              <option value="url">{t("ruleSources.fromUrl")}</option>
            </Select>
          </Label>
          <Label className="block">
            {t("ruleSources.documentTitle")}
            <TextInput
              value={title}
              maxLength={200}
              onChange={(event) => {
                changed();
                setTitle(event.target.value);
              }}
            />
          </Label>
          {mode === "file" && (
            <Label className="block">
              {t("ruleSources.fileLabel")}
              <input
                ref={fileInput}
                className={`${fieldClass()} mt-2`}
                type="file"
                accept=".htm,.html,text/html"
                required
                onChange={changed}
              />
            </Label>
          )}
          <Label className="block">
            {t(
              mode === "file"
                ? "ruleSources.optionalUrl"
                : "ruleSources.urlLabel",
            )}
            <TextInput
              type="url"
              value={url}
              maxLength={500}
              required={mode === "url"}
              onChange={(event) => {
                changed();
                setUrl(event.target.value);
              }}
              aria-describedby={`${id}-url-help`}
            />
          </Label>
          <p id={`${id}-url-help`} className="text-sm text-muted">
            {t("ruleSources.urlHelp")}
          </p>
          {existing && (
            <Notice tone="warning">
              <Label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-1"
                  required
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                {t("ruleSources.confirmReplace")}
              </Label>
            </Notice>
          )}
          <Button
            type="submit"
            variant="primary"
            disabled={existing && !confirmed}
          >
            {mutation.isPending
              ? t("ruleSources.importing")
              : t("ruleSources.import")}
          </Button>
        </fieldset>
        {refusal && (
          <p role="alert" className="mt-3 text-sm text-red-800">
            {t(`errors.${refusal}`)}
          </p>
        )}
        <RequestError error={mutation.error} />
        {mutation.isSuccess && (
          <SuccessMessage className="mt-3">
            {t("ruleSources.imported")}
          </SuccessMessage>
        )}
      </form>
    </Panel>
  );
}
