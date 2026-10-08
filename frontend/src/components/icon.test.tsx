import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { ICON_NAMES, Icon, IconLabel } from "./Icon";

afterEach(cleanup);

it("draws every icon file in the text's own colour, one em square", () => {
  const { container } = render(
    ICON_NAMES.map((name) => <Icon key={name} name={name} />),
  );

  const icons = container.querySelectorAll("svg");
  expect(icons).toHaveLength(ICON_NAMES.length);
  for (const icon of icons) {
    expect(icon.getAttribute("fill")).toBe("currentColor");
    expect(icon.getAttribute("viewBox")).toBe("0 0 640 640");
    expect(icon.getAttribute("class")).toContain("size-[1em]");
    expect(icon.querySelector("path")?.getAttribute("d")).toBeTruthy();
    // No colour of its own anywhere: a file's fill would beat the text's.
    expect(icon.querySelector("[fill]:not(svg)")).toBeNull();
  }
});

it("puts the icon after its label, and leaves it out of the accessible name", () => {
  render(
    <button type="button">
      <IconLabel icon="xmark">Retirer</IconLabel>
    </button>,
  );

  const button = screen.getByRole("button", { name: "Retirer" });
  const icon = button.querySelector("svg");
  expect(icon?.getAttribute("aria-hidden")).toBe("true");
  expect(icon?.getAttribute("data-icon")).toBe("xmark");
  expect(button.lastElementChild?.lastElementChild).toBe(icon);
});

it("puts the icon before its label when asked", () => {
  render(
    <a href="/fieldbot">
      <IconLabel icon="chat" before>
        Fieldbot
      </IconLabel>
    </a>,
  );

  const link = screen.getByRole("link", { name: "Fieldbot" });
  expect(link.firstElementChild?.firstElementChild?.tagName).toBe("svg");
});
