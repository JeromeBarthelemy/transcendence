import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import "../i18n";
import { STATUS_TONES, StatusChip } from "./Chip";

afterEach(cleanup);

it("gives each status its own tone, never the handover's amber or an error's red", () => {
  const tones = Object.values(STATUS_TONES);

  expect(new Set(tones).size).toBe(tones.length);
  for (const tone of tones) {
    expect(tone).not.toMatch(/warning|red|danger/);
  }
});

it("names the status, unless told what to say while it changes", () => {
  render(
    <>
      <StatusChip status="done" />
      <StatusChip status="open">Clôture…</StatusChip>
    </>,
  );

  expect(screen.getByText("Terminé")).toBeTruthy();
  expect(screen.getByText("Clôture…")).toBeTruthy();
});
