import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

/**
 * The bar every screen is held to: WCAG 2.2 AA. Cash and the commission
 * statements were held to 2.0 AA only until yuvoy-operator#160 brought every
 * check through here.
 */
export const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/**
 * The longest animation a check waits out.
 *
 * The portal's motion is 200ms or less, plus a 1.2s mark on a card that
 * arrives. Anything longer is progress (Undo's five-second drain) or endless
 * (a spinner): a check that waited for those would outlive the very state it
 * is checking.
 */
const MOTION_MAX_MS = 1_500;

/**
 * Until the page's motion has finished.
 *
 * axe reads colours as they are drawn at that instant, so text still fading
 * in after a tap reads at a fraction of its contrast. Boarding's Aboard row,
 * mid-fade, measured 1.57:1 on 5 Oct 2026 and failed a release gate on that
 * alone (`axe.spec.ts` holds this).
 */
async function motionSettled(page: Page) {
  await page.waitForFunction(
    (longest) =>
      document.getAnimations().every((animation) => {
        if (animation.playState !== "running") return true;
        const end = animation.effect?.getComputedTiming().endTime;
        return typeof end !== "number" || end > longest;
      }),
    MOTION_MAX_MS,
    { timeout: 5_000 },
  );
}

/**
 * No violations on the page as it stands once its motion has finished.
 *
 * The one way this suite runs axe, for a whole screen and for a state a test
 * has opened (a confirm, a sheet, a held answer) alike. A spec that built its
 * own check read the cancel form mid-fade and failed on and off
 * (yuvoy-operator#160), so `pnpm qa` refuses an axe import anywhere else in
 * e2e/. `what` names the screen or state in a failure.
 */
export async function expectAccessible(page: Page, what: string) {
  await motionSettled(page);
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(results.violations, what).toEqual([]);
}
