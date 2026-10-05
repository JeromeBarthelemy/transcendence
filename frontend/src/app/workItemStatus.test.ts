import { expect, it } from "vitest";

import { statusColors } from "./workItemStatus";

it("gives each status its own color, never the handover's amber or an error's red", () => {
  const colors = Object.values(statusColors);

  expect(new Set(colors).size).toBe(colors.length);
  for (const color of colors) {
    expect(color).not.toMatch(/warning|red|danger/);
  }
});
