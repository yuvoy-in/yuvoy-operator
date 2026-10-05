import { test, expect } from "@playwright/test";
import { expectAccessible } from "./axe";

/**
 * The accessibility check itself (`e2e/axe.ts`).
 *
 * axe reads colours as they are drawn at that instant. Text still fading in
 * after a tap reads at a fraction of its contrast, and on 5 Oct 2026 that
 * failed a release gate: boarding's Aboard row measured 1.57:1 mid-fade, then
 * passed on the retry. So the check waits for the motion on the page first.
 */
test("an accessibility check waits for the motion on the page to finish", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  /*
    A fade like the portal's, held faint for most of a second so the check
    cannot outrun it by luck: without the wait, axe reads the heading at
    0.15 opacity and fails it on contrast.
  */
  await page.evaluate(() => {
    document
      .querySelector("h1")
      ?.animate(
        [{ opacity: 0.15 }, { opacity: 0.15, offset: 0.9 }, { opacity: 1 }],
        { duration: 1_200 },
      );
  });
  await expectAccessible(page, "sign-in, its heading still fading in");
});
