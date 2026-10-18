import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { useMemo } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Link, Navigate } from "react-router-dom";
import { z } from "zod";

import { type SignUpInput, signUp } from "../api/auth";
import { useCurrentUser } from "../app/useCurrentUser";
import { useTranslatedValidation } from "../app/useTranslatedValidation";
import {
  FieldErrors,
  fieldIssues,
  RequestError,
} from "../components/ApiErrors";
import { AuthPageFrame } from "../components/AuthPageFrame";
import { Button, ButtonLink } from "../components/Button";
import { FieldHint, Label, TextInput } from "../components/Field";

export function SignUpPage() {
  const { t } = useTranslation();
  const currentUser = useCurrentUser();
  const schema = useMemo(
    () =>
      z
        .object({
          first_name: z
            .string()
            .trim()
            .min(1, { message: t("validation.required") })
            .max(80, { message: t("validation.tooLong") }),
          last_name: z
            .string()
            .trim()
            .min(1, { message: t("validation.required") })
            .max(80, { message: t("validation.tooLong") }),
          birth_date: z
            .string()
            .min(1, { message: t("validation.required") })
            .refine((value) => z.iso.date().safeParse(value).success, {
              message: t("validation.date"),
            }),
          display_name: z
            .string()
            .trim()
            .min(1, { message: t("validation.required") })
            .max(80, { message: t("validation.tooLong") })
            .refine((value) => !value.includes("@"), {
              message: t("errors.display_name_has_at_sign"),
            }),
          email: z
            .string()
            .trim()
            .max(254, { message: t("validation.tooLong") })
            .refine(
              (value) => value === "" || z.email().safeParse(value).success,
              {
                message: t("validation.email"),
              },
            ),
          password: z
            .string()
            .min(8, { message: t("errors.password_too_short") }),
          password_confirmation: z
            .string()
            .min(1, { message: t("validation.required") }),
        })
        .refine((values) => values.password === values.password_confirmation, {
          path: ["password_confirmation"],
          message: t("validation.passwordMismatch"),
        }),
    [t],
  );
  const {
    register,
    handleSubmit,
    trigger,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(schema),
    defaultValues: {
      first_name: "",
      last_name: "",
      birth_date: "",
      display_name: "",
      email: "",
      password: "",
      password_confirmation: "",
    },
  });
  useTranslatedValidation(Object.keys(errors).length > 0, trigger);
  const signup = useMutation({ mutationFn: signUp });
  const firstNameIssues = fieldIssues(signup.error, "first_name");
  const lastNameIssues = fieldIssues(signup.error, "last_name");
  const birthDateIssues = fieldIssues(signup.error, "birth_date");
  const displayNameIssues = fieldIssues(signup.error, "display_name");
  const emailIssues = fieldIssues(signup.error, "email");
  const passwordIssues = fieldIssues(signup.error, "password");
  const pageCopy = {
    eyebrow: t("signup.eyebrow"),
    title: t("signup.title"),
    description: t("signup.description"),
  };

  if (currentUser.data) {
    return <Navigate to="/" replace />;
  }
  if (currentUser.isPending) {
    return (
      <AuthPageFrame {...pageCopy}>
        <p role="status" className="text-sm text-muted">
          {t("auth.checkingSession")}
        </p>
      </AuthPageFrame>
    );
  }

  if (signup.data) {
    return (
      <AuthPageFrame
        eyebrow={t("signup.successEyebrow")}
        title={t("signup.successTitle")}
        description={t("signup.successDescription", {
          name: signup.data.display_name,
        })}
      >
        {signup.variables?.email && (
          <p className="rounded-2xl border border-azure/20 bg-tint p-5 text-sm leading-6 text-muted">
            {t("signup.emailLoginHelp", { email: signup.data.email })}
          </p>
        )}
        <ButtonLink
          to="/login"
          state={{ username: signup.data.display_name }}
          variant="auth"
          className="mt-7"
        >
          {t("auth.login")}
        </ButtonLink>
      </AuthPageFrame>
    );
  }

  return (
    <AuthPageFrame {...pageCopy}>
      <form
        noValidate
        onChange={() => {
          if (signup.isError) signup.reset();
        }}
        onSubmit={handleSubmit(async (values) => {
          signup.reset();
          const input: SignUpInput = {
            first_name: values.first_name,
            last_name: values.last_name,
            birth_date: values.birth_date,
            display_name: values.display_name,
            email: values.email,
            password: values.password,
          };
          try {
            await signup.mutateAsync(input);
          } catch {
            // The mutation exposes the refusal beside the relevant field.
          }
        })}
        className="space-y-5"
      >
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <Label htmlFor="signup-first-name" variant="auth">
              {t("signup.firstName")}
            </Label>
            <TextInput
              id="signup-first-name"
              type="text"
              autoComplete="given-name"
              maxLength={80}
              variant="auth"
              aria-invalid={Boolean(
                errors.first_name || firstNameIssues.length,
              )}
              aria-describedby="signup-first-name-error"
              {...register("first_name")}
            />
            <FieldErrors
              id="signup-first-name-error"
              message={errors.first_name?.message}
              issues={firstNameIssues}
            />
          </div>
          <div>
            <Label htmlFor="signup-last-name" variant="auth">
              {t("signup.lastName")}
            </Label>
            <TextInput
              id="signup-last-name"
              type="text"
              autoComplete="family-name"
              maxLength={80}
              variant="auth"
              aria-invalid={Boolean(errors.last_name || lastNameIssues.length)}
              aria-describedby="signup-last-name-error"
              {...register("last_name")}
            />
            <FieldErrors
              id="signup-last-name-error"
              message={errors.last_name?.message}
              issues={lastNameIssues}
            />
          </div>
        </div>

        <div>
          <Label htmlFor="signup-birth-date" variant="auth">
            {t("signup.birthDate")}
          </Label>
          <TextInput
            id="signup-birth-date"
            type="date"
            autoComplete="bday"
            variant="auth"
            aria-invalid={Boolean(errors.birth_date || birthDateIssues.length)}
            aria-describedby="signup-birth-date-error"
            {...register("birth_date")}
          />
          <FieldErrors
            id="signup-birth-date-error"
            message={errors.birth_date?.message}
            issues={birthDateIssues}
          />
        </div>

        <div>
          <Label htmlFor="signup-display-name" variant="auth">
            {t("signup.displayName")}
          </Label>
          <TextInput
            id="signup-display-name"
            type="text"
            autoComplete="nickname"
            maxLength={80}
            variant="auth"
            aria-invalid={Boolean(
              errors.display_name || displayNameIssues.length,
            )}
            aria-describedby="signup-display-name-hint signup-display-name-error"
            {...register("display_name")}
          />
          <FieldHint variant="auth" id="signup-display-name-hint">
            {t("signup.displayNameHint")}
          </FieldHint>
          <FieldErrors
            id="signup-display-name-error"
            message={errors.display_name?.message}
            issues={displayNameIssues}
          />
        </div>

        <div>
          <Label htmlFor="signup-email" variant="auth">
            {t("signup.email")}
          </Label>
          <TextInput
            id="signup-email"
            type="email"
            autoComplete="email"
            maxLength={254}
            variant="auth"
            aria-invalid={Boolean(errors.email || emailIssues.length)}
            aria-describedby="signup-email-hint signup-email-error"
            {...register("email")}
          />
          <FieldHint variant="auth" id="signup-email-hint">
            {t("signup.emailHint")}
          </FieldHint>
          <FieldErrors
            id="signup-email-error"
            message={errors.email?.message}
            issues={emailIssues}
          />
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <Label htmlFor="signup-password" variant="auth">
              {t("signup.password")}
            </Label>
            <TextInput
              id="signup-password"
              type="password"
              autoComplete="new-password"
              variant="auth"
              aria-invalid={Boolean(errors.password || passwordIssues.length)}
              aria-describedby="signup-password-hint signup-password-error"
              {...register("password")}
            />
            <FieldHint variant="auth" id="signup-password-hint">
              {t("signup.passwordHint")}
            </FieldHint>
            <FieldErrors
              id="signup-password-error"
              message={errors.password?.message}
              issues={passwordIssues}
            />
          </div>
          <div>
            <Label htmlFor="signup-password-confirmation" variant="auth">
              {t("signup.passwordConfirmation")}
            </Label>
            <TextInput
              id="signup-password-confirmation"
              type="password"
              autoComplete="new-password"
              variant="auth"
              aria-invalid={Boolean(errors.password_confirmation)}
              aria-describedby="signup-password-confirmation-error"
              {...register("password_confirmation")}
            />
            <FieldErrors
              id="signup-password-confirmation-error"
              message={errors.password_confirmation?.message}
            />
          </div>
        </div>

        <RequestError
          error={signup.error}
          handledFields={[
            "first_name",
            "last_name",
            "birth_date",
            "display_name",
            "email",
            "password",
          ]}
        />
        <Button type="submit" variant="auth" disabled={signup.isPending}>
          {signup.isPending ? t("signup.submitting") : t("signup.submit")}
        </Button>
      </form>

      <p className="mt-6 text-sm leading-6 text-muted">
        {t("signup.alreadyMember")}{" "}
        <Link to="/login" className="form-link">
          {t("auth.login")}
        </Link>
      </p>
    </AuthPageFrame>
  );
}
