/**
 * The one place a colour literal may exist outside the `@theme` block.
 *
 * `viewport.themeColor` is consumed by the browser before any CSS is parsed,
 * so it cannot reference a custom property — it has to be a literal. It lives
 * here, alone, and `palette.test.ts` asserts it equals `--color-forest`.
 */
export const THEME_COLOR = "#16362e";
