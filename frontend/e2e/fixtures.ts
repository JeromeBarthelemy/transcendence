import {
  type Browser,
  test as base,
  expect,
  type Page,
} from "@playwright/test";

// seed_demo's shared password.
export const PASSWORD = "rouage-demo-2026";

/** The members whose sessions auth.setup.ts opens once, for every browser:
 * signing in is throttled to ten attempts a minute per address. */
export type Member = "Lina" | "Tom" | "Paul";

export const sessionOf = (member: Member) => `e2e/.auth/${member}.json`;

/** "No warnings or errors about the Javascript code should appear in the
 * browser console" (the subject's general requirements): any warning, error
 * or uncaught exception fails the test, in every browser. A test expecting a
 * refused request allows the line the browser itself logs for it. */
export function watchConsole(page: Page, allowed: RegExp[] = []): string[] {
  const seen: string[] = [];
  page.on("console", (message) => {
    const type = message.type();
    if (type !== "error" && type !== "warning") {
      return;
    }
    const text = message.text();
    if (!allowed.some((pattern) => pattern.test(text))) {
      seen.push(`${type}: ${text}`);
    }
  });
  page.on("pageerror", (error) => seen.push(`uncaught: ${error.message}`));
  return seen;
}

type Fixtures = {
  allowConsole: RegExp[];
  pageAs: (member: Member) => Promise<Page>;
};

export const test = base.extend<Fixtures>({
  allowConsole: [[], { option: true }],
  page: async ({ page, allowConsole }, use) => {
    const seen = watchConsole(page, allowConsole);
    await use(page);
    expect(seen, "console").toEqual([]);
  },
  // A second member at the same time, for what one member sees of another.
  pageAs: async ({ browser }, use) => {
    const opened: { page: Page; seen: string[] }[] = [];
    await use(async (member) => {
      const page = await openAs(browser, member);
      opened.push({ page, seen: watchConsole(page) });
      return page;
    });
    for (const { page, seen } of opened) {
      await page.context().close();
      expect(seen, "console").toEqual([]);
    }
  },
});

async function openAs(browser: Browser, member: Member): Promise<Page> {
  const context = await browser.newContext({
    storageState: sessionOf(member),
  });
  return context.newPage();
}

/** Names this browser writes, so the three browsers, which share one
 * database, never collide. */
export function mine(name: string): string {
  return `${name} · ${test.info().project.name}`;
}

export { expect };
