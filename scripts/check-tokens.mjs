#!/usr/bin/env node
/**
 * The design tokens in this repo, against yuvoy-app's.
 *
 * D-101 makes `yuvoy-app` canonical and forbids syncing back. It also names
 * this repo — the third consumer — as the point where hand-copying stops
 * being viable and `yuvoy-kit` should be extracted. Until it is, this check
 * is what keeps the copy honest.
 *
 * It compares the `@theme` block only. The utility layer legitimately differs
 * (this portal has no video feed and the traveller app has no dock target);
 * the TOKENS may not, because the design system's founding rule is that every
 * color, font, radius and tracking value maps to one — and three unsynced
 * copies break that structurally rather than stylistically.
 *
 * A missing sibling checkout is a WARNING, not a failure: CI clones one repo,
 * and a check that cannot run must not become a check that always passes
 * silently OR one that blocks a build for an unrelated reason.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const HERE = join(process.cwd(), "src/app/globals.css");
const CANONICAL = join(process.cwd(), "../yuvoy-app/src/app/globals.css");

/** The `@theme { … }` block, with comments and blank lines removed. */
function themeBlock(css, label) {
  const start = css.indexOf("@theme {");
  if (start === -1) throw new Error(`${label}: no @theme block`);

  let depth = 0;
  let i = css.indexOf("{", start);
  const from = i;
  for (; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) break;
  }

  return css
    .slice(from + 1, i)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

if (!existsSync(CANONICAL)) {
  console.warn(
    `\n⚠ token check skipped: ${CANONICAL} not found.\n` +
      `  yuvoy-app is not checked out beside this repo, so the copy was not\n` +
      `  verified this run. Expected in local development, not in CI.\n`,
  );
  process.exit(0);
}

const mine = themeBlock(readFileSync(HERE, "utf8"), "yuvoy-operator");
const theirs = themeBlock(readFileSync(CANONICAL, "utf8"), "yuvoy-app");

const only = (a, b) => a.filter((l) => !b.includes(l));
const extra = only(mine, theirs);
const missing = only(theirs, mine);

if (extra.length || missing.length) {
  console.error(
    `\n✗ design tokens diverge from yuvoy-app (canonical, D-101)\n`,
  );
  for (const l of missing) console.error(`  − missing here:  ${l}`);
  for (const l of extra) console.error(`  + only here:     ${l}`);
  console.error(
    `\n  yuvoy-app is canonical and there is no sync back. Copy the token\n` +
      `  across, or extract yuvoy-kit and delete this check.\n`,
  );
  process.exit(1);
}

console.log(`\n✓ ${mine.length} design tokens match yuvoy-app\n`);
