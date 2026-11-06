/* Part of the QA sweep. scripts/qa.mjs imports this file, in its place in
   the order, and prints the report (yuvoy-operator#178). */
import { relative } from "node:path";
import { APP, problems, notes, walk, files, code, rel } from "./context.mjs";

/* ---------------------------------------------- 1. routes that exist ----- */

const routes = new Set(["/"]);
for (const f of walk(APP)) {
  if (!/[/\\]page\.tsx$/.test(f)) continue;
  const r =
    "/" +
    relative(APP, f)
      .replace(/[/\\]page\.tsx$/, "")
      .replace(/^page\.tsx$/, "")
      .replace(/\\/g, "/");
  routes.add(r === "/" ? "/" : r.replace(/\/\(.*?\)/g, ""));
}

function routeMatches(href) {
  const path = href.split("?")[0].split("#")[0];
  if (path === "" || path.startsWith("http") || path.startsWith("mailto"))
    return true;
  if (routes.has(path)) return true;
  for (const r of routes) {
    if (!r.includes("[")) continue;
    const re = new RegExp(
      "^" +
        r.replace(/\[\.\.\..+?\]/g, ".+").replace(/\[.+?\]/g, "[^/]+") +
        "$",
    );
    if (re.test(path)) return true;
  }
  return false;
}

for (const f of files) {
  const s = code(f);
  for (const m of s.matchAll(/href=\{?["'`](\/[^"'`}\s]*)["'`]/g)) {
    if (!routeMatches(m[1])) {
      problems.push(`${rel(f)}: links to "${m[1]}" — no such route`);
    }
  }
  for (const m of s.matchAll(/href=\{`(\/[a-z-]+)\//gi)) {
    if (![...routes].some((r) => r.startsWith(m[1]))) {
      problems.push(`${rel(f)}: links under "${m[1]}/" — no route beneath it`);
    }
  }
  for (const m of s.matchAll(/redirect\(\s*["'`](\/[^"'`]*)["'`]/g)) {
    if (!routeMatches(m[1])) {
      problems.push(`${rel(f)}: redirects to "${m[1]}" — no such route`);
    }
  }
}

/* ------------------------------------------------- 2. debug leftovers ---- */

for (const f of files) {
  const s = code(f);
  if (/console\.(log|debug|table)\(/.test(s)) {
    problems.push(`${rel(f)}: console.log left in`);
  }
  if (/\.only\(/.test(s)) {
    problems.push(`${rel(f)}: a focused test (.only) would skip the rest`);
  }
  if (/\bdebugger\b/.test(s)) problems.push(`${rel(f)}: debugger statement`);
  if (/TODO|FIXME|XXX/.test(s)) notes.push(`${rel(f)}: carries a TODO/FIXME`);
}

/* ------------------------------------------------- 3. a11y basics -------- */

for (const f of files) {
  if (/\.test\.tsx?$/.test(f)) continue;
  const s = code(f);
  for (const m of s.matchAll(/<input\b[^>]*>/g)) {
    const tag = m[0];
    if (/type="(hidden|radio|checkbox)"/.test(tag)) continue;
    if (!/(aria-label|aria-labelledby|\bid=)/.test(tag)) {
      problems.push(`${rel(f)}: <input> with no id or aria-label`);
    }
  }
}

/* --------------------------------------- 4. time and money discipline ---- */

for (const f of files) {
  if (/\.test\.tsx?$/.test(f) || /lib[/\\]format[/\\]/.test(f)) continue;
  const s = code(f);
  if (/toLocaleTimeString|toLocaleDateString/.test(s)) {
    problems.push(
      `${rel(f)}: toLocale* on a date — use @/lib/format/market-time. ` +
        `A 7am dive shown as 1:30am is a missed boat.`,
    );
  }
  if (/amountMinor\s*\/\s*100/.test(s)) {
    problems.push(`${rel(f)}: divides paise by hand`);
  }
  /*
    An amount read by deleting everything but digits and dots
    (yuvoy-operator#144). It keeps every dot, so "Rs. 1500" read as ".1500"
    and a listing was saved at 15 paise, "1500-2000" read as 15002000, and
    "1.005" passed for a price. A typed amount goes through a parser that
    refuses what it cannot read.
  */
  if (/\[\^(?:\\d|0-9)\.\]|\[\^\.(?:\\d|0-9)\]/.test(s)) {
    problems.push(
      `${rel(f)}: reads an amount by deleting everything but digits and ` +
        `dots, which saved "Rs. 1500" as 15 paise (yuvoy-operator#144). ` +
        `Use priceToPaise from @/lib/money/price.`,
    );
  }
}

/* ------------------------------------ 4b. every request has a deadline --- */

/*
  A request with no deadline held its screen or its button for the platform's
  five minutes whenever the API went quiet (production readiness, 6 Oct 2026).
  So every request goes through `fetchWithin` (lib/api/deadline), which also
  keeps the abort working under Next's patched fetch. The one exception is an
  upload to a presigned URL: an upload is silent while it sends, so a deadline
  on silence would cut a slow one off.
*/
for (const f of files) {
  if (/\.test\.tsx?$/.test(f) || /lib[/\\]api[/\\]deadline\.ts$/.test(f))
    continue;
  const s = code(f);
  for (const m of s.matchAll(/(^|[^\w.$])fetch\(\s*([^,)]*)/gm)) {
    if (/\buploadUrl$/.test(m[2].trim())) continue;
    problems.push(
      `${rel(f)}: calls fetch() directly; use fetchWithin (lib/api/deadline) ` +
        `so it has a deadline. Only an upload to a presigned URL is exempt.`,
    );
    break;
  }
}

/* --------------------------- 4c. the chrome's reads are asked once ------ */

/*
  The root layout reads `/me`, `/profile` and `/requests` under every signed-in
  screen. Next does not memoise a read that carries a signal, and a read with
  a deadline always does, so a page that asked one of them itself paid for a
  second request (production readiness, 6 Oct 2026). Each is asked only by its
  `cache`d reader, which hands every caller in the render the layout's answer.
*/
const CHROME_READS = {
  "/me": /lib[/\\]auth[/\\]session\.ts$/,
  "/profile": /lib[/\\]profile[/\\]read\.ts$/,
  "/requests": /lib[/\\]day[/\\]requests\.ts$/,
};
for (const f of files) {
  if (/\.test\.tsx?$/.test(f)) continue;
  const s = code(f);
  for (const [path, reader] of Object.entries(CHROME_READS)) {
    if (reader.test(f)) continue;
    if (new RegExp(`\\.GET\\(\\s*["'\`]${path}["'\`]`).test(s)) {
      problems.push(
        `${rel(f)}: reads ${path} itself; ask its cached reader, so the ` +
          `layout's answer is shared rather than requested again.`,
      );
    }
  }
}

/* ------------------- 4d. no refresh is asked for with no signal --------- */

/*
  A refresh that cannot be fetched is not an error on the screen: Next falls
  back to loading the page, and with no signal that is the browser's "no
  internet" page in place of the portal. Every refresh the portal asks for on
  its own (after an answer, on closing a sheet) checks for a signal first, on
  the same line. A Refresh or Try again the operator taps is theirs to ask
  for, and the schedule checks inside itself (production readiness, 6 Oct
  2026).
*/
for (const f of files) {
  if (/\.test\.tsx?$/.test(f) || /refresh-schedule\.ts$/.test(f)) continue;
  const lines = code(f).split("\n");
  for (const line of lines) {
    if (!/\brouter\.refresh\(\)/.test(line)) continue;
    if (/navigator\.onLine/.test(line)) continue;
    if (/onClick=\{\(\) => router\.refresh\(\)\}/.test(line)) continue;
    problems.push(
      `${rel(f)}: router.refresh() with no signal check; with none, Next ` +
        `loads the page and the browser shows its "no internet" page. ` +
        `Write \`if (navigator.onLine) router.refresh();\`.`,
    );
    break;
  }
}

export { routes };
