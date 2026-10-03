import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

/**
 * The bar every screen is held to: WCAG 2.2 AA, the tags every
 * accessibility test in this suite already passes by hand.
 */
export const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/**
 * No violations on the page as it stands now.
 *
 * For a state a test has opened (a confirm, a sheet, a held answer): the
 * redesign's QA pass audits each one where a test already reaches it, so an
 * open state is checked by the same walk that proves it works. `what` names
 * the state in a failure.
 */
export async function expectAccessible(page: Page, what: string) {
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(results.violations, what).toEqual([]);
}
