import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { z } from "zod";

import { logIn } from "../api/auth";
import { currentUserQueryKey, useCurrentUser } from "../app/useCurrentUser";
import {
  FieldErrors,
  fieldIssues,
  RequestError,
} from "../components/ApiErrors";
import { AuthPageFrame } from "../components/AuthPageFrame";

function usernameFromLocation(state: unknown): string {
  if (
    typeof state === "object" &&
    state !== null &&
    "username" in state &&
    typeof state.username === "string"
  ) {
    return state.username;
  }
  return "";
}

export function LoginPage() {
  const { t } = useTranslation();
  const currentUser = useCurrentUser();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const schema = useMemo(
    () =>
      z.object({
        username: z
          .string()
          .trim()
          .min(1, { message: t("validation.required") }),
        password: z.string().min(1, { message: t("validation.required") }),
      }),
    [t],
  );
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(schema),
    defaultValues: {
      username: usernameFromLocation(location.state),
      password: "",
    },
  });
  const login = useMutation({
    mutationFn: logIn,
    onSuccess: (identity) => {
      queryClient.setQueryData(currentUserQueryKey, identity);
      navigate("/", { replace: true });
    },
  });
  const usernameIssues = fieldIssues(login.error, "username");
  const passwordIssues = fieldIssues(login.error, "password");
  const pageCopy = {
    eyebrow: t("login.eyebrow"),
    title: t("login.title"),
    description: t("login.description"),
  };

  if (currentUser.data) {
    return <Navigate to="/" replace />;
  }
  if (currentUser.isPending) {
    return (
      <AuthPageFrame {...pageCopy}>
        <p role="status" className="text-sm text-[#506784]">
          {t("auth.checkingSession")}
        </p>
      </AuthPageFrame>
    );
  }

  return (
    <AuthPageFrame {...pageCopy}>
      <form
        noValidate
        onChange={() => {
          if (login.isError) login.reset();
        }}
        onSubmit={handleSubmit(async (values) => {
          login.reset();
          try {
            await login.mutateAsync(values);
          } catch {
            // The mutation exposes the refusal beside the relevant field.
          }
        })}
        className="space-y-5"
      >
        <div>
          <label htmlFor="login-username" className="form-label">
            {t("login.username")}
          </label>
          <input
            id="login-username"
            type="text"
            autoComplete="username"
            className="form-input"
            aria-invalid={Boolean(errors.username || usernameIssues.length)}
            aria-describedby="login-username-error"
            {...register("username")}
          />
          <FieldErrors
            id="login-username-error"
            message={errors.username?.message}
            issues={usernameIssues}
          />
        </div>

        <div>
          <label htmlFor="login-password" className="form-label">
            {t("login.password")}
          </label>
          <input
            id="login-password"
            type="password"
            autoComplete="current-password"
            className="form-input"
            aria-invalid={Boolean(errors.password || passwordIssues.length)}
            aria-describedby="login-password-error"
            {...register("password")}
          />
          <FieldErrors
            id="login-password-error"
            message={errors.password?.message}
            issues={passwordIssues}
          />
        </div>

        <RequestError
          error={login.error}
          handledFields={["username", "password"]}
        />
        <button
          type="submit"
          className="form-submit"
          disabled={login.isPending}
        >
          {login.isPending ? t("login.submitting") : t("login.submit")}
        </button>
      </form>

      <p className="mt-6 text-sm leading-6 text-[#506784]">
        {t("login.noAccount")}{" "}
        <Link to="/signup" className="form-link">
          {t("auth.signup")}
        </Link>
      </p>
      <p className="mt-3 text-sm leading-6 text-[#506784]">
        {t("login.forgotPassword")}
      </p>
    </AuthPageFrame>
  );
}
