import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";

import { Button, ButtonLink, buttonClass } from "./Button";
import {
  FieldHint,
  fieldClass,
  Label,
  Select,
  TextArea,
  TextInput,
} from "./Field";
import { Panel } from "./Panel";
import { Eyebrow, Heading } from "./Typography";

afterEach(cleanup);

it.each(["default", "auth"] as const)(
  "keeps native input props, refs, labels and keyboard focus for %s fields",
  async (variant) => {
    const user = userEvent.setup();
    const inputRef = createRef<HTMLInputElement>();
    const changed = vi.fn();
    const blurred = vi.fn();
    render(
      <>
        <Label htmlFor="username" variant={variant}>
          Username
        </Label>
        <TextInput
          ref={inputRef}
          variant={variant}
          id="username"
          name="username"
          autoComplete="username"
          aria-invalid
          aria-describedby="username-hint"
          maxLength={80}
          onChange={changed}
          onBlur={blurred}
        />
        <FieldHint variant={variant} id="username-hint">
          Use your display name.
        </FieldHint>
        <Button>Next</Button>
      </>,
    );

    const input = screen.getByRole("textbox", {
      name: "Username",
    }) as HTMLInputElement;
    expect(inputRef.current).toBe(input);
    expect(input.name).toBe("username");
    expect(input.autocomplete).toBe("username");
    expect(input.maxLength).toBe(80);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(
      document.getElementById(input.getAttribute("aria-describedby") ?? "")
        ?.textContent,
    ).toBe("Use your display name.");
    expect(input.hasAttribute("variant")).toBe(false);
    expect(input.classList.contains("text-base")).toBe(true);
    expect(input.classList.contains("mt-2")).toBe(true);

    await user.tab();
    expect(document.activeElement).toBe(input);
    await user.type(input, "Lina");
    expect(input.value).toBe("Lina");
    expect(changed).toHaveBeenCalledTimes(4);
    await user.tab();
    expect(blurred).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Next" }),
    );
  },
);

it("preserves auth field geometry and error/focus styles without changing compact defaults", () => {
  expect(fieldClass()).toContain("px-3 py-2");
  expect(fieldClass()).toContain("focus-visible:outline-offset-1");
  expect(fieldClass("warning")).toContain("bg-warning-wash");
  expect(fieldClass("danger")).toContain("border-red-800/25");
  const auth = fieldClass("default", "auth");
  expect(auth).toContain("px-[0.9rem] py-3");
  expect(auth).toContain("border-line");
  expect(auth).toContain("focus-visible:ring-azure/18");
  expect(auth).toContain("aria-invalid:focus-visible:border-danger");
  expect(auth).not.toContain("border-primary/20");
});

it("uses one margin/min-height utility when callers request a layout override", () => {
  render(
    <>
      <TextInput aria-label="Title" className="mt-0" />
      <TextArea aria-label="Body" className="mt-0 min-h-48" />
      <Select aria-label="Step" className="mt-0" defaultValue="test">
        <option value="test">Test</option>
      </Select>
      <FieldHint className="mt-0">Hint</FieldHint>
    </>,
  );
  for (const name of ["Title", "Body", "Step"]) {
    expect(screen.getByLabelText(name).classList.contains("mt-0")).toBe(true);
    expect(screen.getByLabelText(name).classList.contains("mt-2")).toBe(false);
  }
  expect(screen.getByLabelText("Body").classList.contains("min-h-24")).toBe(
    false,
  );
  expect(screen.getByText("Hint").classList.contains("mt-0")).toBe(true);
  expect(screen.getByText("Hint").classList.contains("mt-1")).toBe(false);
});

it("does not turn an ordinary action inside a form into a submit", async () => {
  const user = userEvent.setup();
  const submitted = vi.fn((event) => event.preventDefault());
  const clicked = vi.fn();
  render(
    <form onSubmit={submitted}>
      <Button onClick={clicked}>Cancel</Button>
    </form>,
  );
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(clicked).toHaveBeenCalledOnce();
  expect(submitted).not.toHaveBeenCalled();
  expect((screen.getByRole("button") as HTMLButtonElement).type).toBe("button");
});

it("keeps explicit auth submissions and disables the action while pending", async () => {
  const user = userEvent.setup();
  const submitted = vi.fn((event) => event.preventDefault());
  const view = (pending: boolean) => (
    <form onSubmit={submitted}>
      <Button variant="auth" type="submit" disabled={pending}>
        Sign in
      </Button>
    </form>
  );
  const { rerender } = render(view(false));
  const button = screen.getByRole("button", {
    name: "Sign in",
  }) as HTMLButtonElement;
  expect(button.classList.contains("w-full")).toBe(true);
  expect(button.classList.contains("rounded-[999px]")).toBe(true);
  expect(button.classList.contains("leading-normal")).toBe(true);
  expect(button.classList.contains("font-bold")).toBe(true);
  expect(button.classList.contains("font-semibold")).toBe(false);
  expect(button.hasAttribute("variant")).toBe(false);
  await user.tab();
  expect(document.activeElement).toBe(button);
  await user.keyboard("{Enter}");
  expect(submitted).toHaveBeenCalledOnce();

  rerender(view(true));
  expect(button.disabled).toBe(true);
  await user.click(button);
  expect(submitted).toHaveBeenCalledOnce();
});

it("preserves button defaults and permits explicit size/shape choices", () => {
  const standard = buttonClass();
  expect(standard).toContain("rounded-xl");
  expect(standard).toContain("px-4 py-2");
  expect(standard).toContain("disabled:opacity-50");
  const auth = buttonClass({ variant: "auth", size: "sm", pill: false });
  expect(auth).toContain("rounded-xl");
  expect(auth).not.toContain("rounded-full");
  expect(auth).toContain("px-3 py-1.5");
  expect(auth).not.toContain("py-[0.85rem]");
});

it("keeps auth navigation a link and preserves its router state", async () => {
  const user = userEvent.setup();
  const router = createMemoryRouter([
    {
      path: "/",
      element: (
        <ButtonLink variant="auth" to="/login" state={{ username: "Marie" }}>
          Sign in
        </ButtonLink>
      ),
    },
    { path: "/login", element: <p>Login</p> },
  ]);
  render(<RouterProvider router={router} />);
  expect(screen.queryByRole("button")).toBeNull();
  const link = screen.getByRole("link", { name: "Sign in" });
  expect(link.getAttribute("href")).toBe("/login");
  expect(link.className.trim()).toBe(buttonClass({ variant: "auth" }));
  await user.click(link);
  expect(router.state.location.pathname).toBe("/login");
  expect(router.state.location.state).toEqual({ username: "Marie" });
});

it.each(["default", "auth"] as const)(
  "keeps %s panel semantics and its distinct surface",
  (variant) => {
    render(
      <Panel as="section" variant={variant} aria-labelledby="title">
        <Heading size="auth" id="title">
          Account
        </Heading>
      </Panel>,
    );
    const panel = screen.getByRole("region", { name: "Account" });
    expect(panel.tagName).toBe("SECTION");
    expect(panel.classList.contains(variant === "auth" ? "p-6" : "p-5")).toBe(
      true,
    );
    expect(
      panel.classList.contains(variant === "auth" ? "bg-white/90" : "bg-white"),
    ).toBe(true);
    expect(
      panel.classList.contains(variant === "auth" ? "bg-white" : "bg-white/90"),
    ).toBe(false);
    expect(panel.hasAttribute("variant")).toBe(false);
  },
);

it("keeps the heading level independent of its auth size and inherits handover colour", () => {
  render(
    <>
      <Heading size="auth" as="h2">
        Club
      </Heading>
      <Eyebrow tone="inherit" tracking="tight">
        Handover
      </Eyebrow>
    </>,
  );
  expect(screen.getByRole("heading", { level: 2, name: "Club" })).toBeTruthy();
  expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
  const eyebrow = screen.getByText("Handover");
  expect(eyebrow.classList.contains("tracking-[0.12em]")).toBe(true);
  expect(eyebrow.classList.contains("text-accent")).toBe(false);
  expect(eyebrow.hasAttribute("tracking")).toBe(false);
});
