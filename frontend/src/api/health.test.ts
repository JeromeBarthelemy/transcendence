import { afterEach, expect, test, vi } from "vitest";

import { getHealth } from "./health";

function answer(body: unknown, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(Response.json(body, { status })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test("a healthy API is reported as such", async () => {
  answer({ status: "ok" });

  await expect(getHealth()).resolves.toEqual({ status: "ok" });
});

test("an answer of an unexpected shape is refused", async () => {
  answer({ status: "degraded" });

  await expect(getHealth()).rejects.toThrow("invalid response");
});

test("an error status is refused", async () => {
  answer({ status: "ok" }, 503);

  await expect(getHealth()).rejects.toThrow("503");
});
