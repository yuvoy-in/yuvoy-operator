#!/usr/bin/env node
/**
 * Static QA sweep for the operator portal.
 *
 * Ported from yuvoy-app, minus the checks about a video feed and plus four
 * that only matter here. The four new ones all guard the same thing from
 * different sides: **the session token must never become reachable from a
 * browser**, and the portal must never grow the generic API surface that
 * `/operator/v1`'s CORS refusal exists to remove.
 *
 * None of these fail a build. All of them are how the architecture quietly
 * stops being the architecture.
 */
import { readdirSync, statSync, readFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");
const APP = join(SRC, "app");

const problems = [];
const notes = [];

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((n) => {
    const full = join(dir, n);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const files = walk(SRC).filter(
  (f) => /\.tsx?$/.test(f) && !f.endsWith(".gen.ts"),
);
const code = (f) =>
  readFileSync(f, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
const rel = (f) => relative(ROOT, f);

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
}

/* ======================================================================== */
/*  The four that are specific to this repo. Each guards the same thing.     */
/* ======================================================================== */

/* --------------------- 5. there is no generic API proxy ------------------ */

/**
 * A route handler under `src/app`.
 *
 * `/operator/v1` refuses CORS on purpose — yuvoy-api skips CORS for
 * `/operator/`, `/admin/`, `/hooks/` and `/ops/` because "an admin API that
 * answers CORS is an admin API any page on the internet can attempt to call
 * with the user's cookies."
 *
 * A `route.ts` that forwards to it with the session attached hands that
 * surface straight back, on our own origin, where SameSite does not help and
 * every path is reachable with one fetch. The portal is built as server
 * renders and Server Actions precisely so this file does not exist, and an
 * innocent-looking `/api/manifest` is how that gets undone in one commit.
 *
 * If a route handler is ever genuinely needed — a webhook, a health check —
 * add it here by name with the reason. There is no allowlist entry today.
 */
const ALLOWED_ROUTE_HANDLERS = new Set();

for (const f of walk(APP)) {
  // `.js` too: the guard matched only TypeScript, and a route.js is a route.
  if (!/[/\\]route\.[jt]sx?$/.test(f)) continue;
  if (ALLOWED_ROUTE_HANDLERS.has(rel(f))) continue;
  problems.push(
    `${rel(f)}: a route handler. This portal has no browser-callable API by ` +
      `design — reads are server renders, writes are Server Actions. If this ` +
      `one is genuinely needed, add it to ALLOWED_ROUTE_HANDLERS in ` +
      `scripts/qa.mjs with the reason.`,
  );
}

/*
  The two other doors to the same surface: the pages router's API directory,
  and a middleware that writes a response body. Neither exists today; both
  used to be invisible to this check.
*/
for (const f of walk(join(SRC, "pages", "api"))) {
  problems.push(
    `${rel(f)}: a pages-router API route. Same objection as a route handler — ` +
      `this portal has no browser-callable API by design.`,
  );
}
for (const f of [join(SRC, "middleware.ts"), join(ROOT, "middleware.ts")]) {
  if (!existsSync(f)) continue;
  const s = code(f);
  if (/NextResponse\.json\(|new Response\(/.test(s)) {
    problems.push(
      `${rel(f)}: middleware that writes a response body is a route handler ` +
        `by another name. It may redirect or rewrite; it may not answer.`,
    );
  }
}

/* ------------------- 6. the session never enters the client graph -------- */

/**
 * A `"use client"` module that reaches the API client or the session.
 *
 * `import "server-only"` already fails the BUILD if this happens, so this
 * check is the earlier and more legible half: it names the import chain rather
 * than producing a bundler error three layers down, and it runs in a second
 * rather than a minute.
 */
const SERVER_ONLY = [
  /^@\/lib\/api\/server-client$/,
  /^@\/lib\/auth\/session$/,
  /^@\/lib\/auth\/session-writes$/,
  /^@\/lib\/day\/manifest$/,
  /^@\/lib\/team\/fetch$/,
  /^server-only$/,
  /^next\/headers$/,
];

function resolveImport(fromFile, spec) {
  let base;
  if (spec.startsWith("@/")) base = join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = join(fromFile, "..", spec);
  else return null;
  for (const ext of [".ts", ".tsx", "/index.ts", "/index.tsx", ""]) {
    const candidate = base + ext;
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function importsOf(file) {
  const s = code(file);
  const specs = [];
  for (const m of s.matchAll(/from\s+["']([^"']+)["']/g)) specs.push(m[1]);
  for (const m of s.matchAll(/import\s*\(\s*["']([^"']+)["']\s*\)/g))
    specs.push(m[1]);
  return specs;
}

/** A `"use server"` module is a server boundary — a client may import it. */
const isServerAction = (f) =>
  /^\s*["']use server["']/m.test(readFileSync(f, "utf8"));

const clientRoots = files.filter(
  (f) =>
    /^\s*["']use client["']/m.test(readFileSync(f, "utf8")) &&
    !/\.test\.tsx?$/.test(f),
);

const visited = new Map();
for (const root of clientRoots) {
  const queue = [[root, [rel(root)]]];
  while (queue.length) {
    const [file, trail] = queue.shift();
    if (visited.has(file)) continue;
    visited.set(file, trail);

    for (const spec of importsOf(file)) {
      if (SERVER_ONLY.some((re) => re.test(spec))) {
        problems.push(
          `client graph reaches server-only "${spec}"\n      via ${trail.join(" → ")}\n` +
            `      The session token must never be reachable from a browser.`,
        );
        continue;
      }
      const next = resolveImport(file, spec);
      // A Server Action is the boundary, not a leak: crossing it is an RPC.
      if (next && !visited.has(next) && !isServerAction(next)) {
        queue.push([next, [...trail, rel(next)]]);
      }
    }
  }
}

/* ------------ 6b. a cookie is written only in the action phase ----------- */

/**
 * Next allows `cookies().set()` inside a Server Action or Route Handler and
 * nowhere else. A write that a rendering Server Component can reach throws —
 * and because the throw pre-empts whatever `redirect()` sits beside it, the
 * person lands on the error boundary still holding the cookie that sent them
 * there. That was a live defect: `requireOperator()` cleared a dead session
 * during render, so a removed staff member's phone looped on "That did not
 * load" for as long as the thirty-day cookie lived. An e2e now loads a page
 * with a dead cookie and expects the sign-in form; this is the static half.
 *
 * Two rules make it structural rather than remembered:
 *
 *   - `next/headers` is importable only by the two session modules, so cookie
 *     access cannot quietly spread to a page or a helper.
 *   - `session-writes` — the one module that mutates — is importable only
 *     from `"use server"` modules, which ARE the action phase. It must never
 *     be `"use server"` itself: that would publish "set any cookie" as an
 *     endpoint.
 */
const HEADERS_IMPORTERS = new Map([
  [
    join("src", "lib", "auth", "session.ts"),
    "Reads the session cookie and asks /me what it is worth. Never writes.",
  ],
  [
    join("src", "lib", "auth", "session-writes.ts"),
    "The only module that writes a cookie, importable only from actions.",
  ],
]);

for (const [path, reason] of HEADERS_IMPORTERS) {
  if (!reason || reason.length < 40) {
    problems.push(
      `scripts/qa.mjs: HEADERS_IMPORTERS entry "${path}" has no real reason.`,
    );
  }
  if (!existsSync(join(ROOT, path))) {
    problems.push(
      `scripts/qa.mjs: HEADERS_IMPORTERS names "${path}", which does not exist`,
    );
  }
}

const WRITES_MODULE = join("src", "lib", "auth", "session-writes.ts");

for (const f of files) {
  if (/\.test\.tsx?$/.test(f)) continue;
  const specs = importsOf(f);

  if (specs.includes("next/headers") && !HEADERS_IMPORTERS.has(rel(f))) {
    problems.push(
      `${rel(f)}: imports next/headers. Cookie access lives in ` +
        `src/lib/auth/session.ts (read) and session-writes.ts (write) only — ` +
        `a write reachable from render throws and strands the operator.`,
    );
  }

  if (specs.some((spec) => /^@\/lib\/auth\/session-writes$/.test(spec))) {
    if (!isServerAction(f)) {
      problems.push(
        `${rel(f)}: imports session-writes from a module that is not ` +
          `"use server". A cookie can only be written in the action phase; ` +
          `from render it throws before any redirect beside it runs.`,
      );
    }
  }
}

if (isServerAction(join(ROOT, WRITES_MODULE))) {
  problems.push(
    `${WRITES_MODULE}: is "use server". That publishes writeSessionToken() ` +
      `as a POST endpoint anybody can call to set a cookie. Remove it.`,
  );
}

/* ------------------ 7. every Server Action authorises itself ------------- */

/**
 * A `"use server"` export that never asks who is calling.
 *
 * A Server Action is a public POST endpoint with a generated name. Next
 * checks the origin; it does not check that the caller may do the thing. In a
 * portal where the tenant boundary is the whole security model, an action that
 * forgets `requireOperator()` is one that acts on whatever id it was handed.
 *
 * The sign-in actions are the deliberate exception — there is no session yet,
 * which is the point of them.
 */
const UNAUTHENTICATED_ACTIONS = new Map([
  [
    join("src", "app", "sign-in", "actions.ts"),
    "O2. There is no session yet — producing one is the point.",
  ],
  [
    join("src", "app", "join", "actions.ts"),
    "O5. `POST /team/accept` carries `security: []`: accepting an invitation " +
      "is what somebody does before they have an account. The invite code is " +
      "the authorisation — hashed, attempt-limited, seven-day expiry — and no " +
      "session is minted, so there is nothing here for requireOperator() to " +
      "check.",
  ],
  [
    join("src", "app", "join", "[token]", "actions.ts"),
    "O5, the link half. `GET /join/{token}`, `POST /join/{token}/code` and " +
      "`POST /join/{token}/accept` all carry `security: []` — the person " +
      "opening the link has no account, which is the entire point of it. No " +
      "session is minted either; they sign in afterwards through the ordinary " +
      "flow, so one code path still creates every operator session. The " +
      "invitation is the authorisation, and the link grants nothing without a " +
      "number that was already invited.",
  ],
  [
    join("src", "app", "signup", "actions.ts"),
    "O1. `POST /auth/signup` is public and unauthenticated: creating the " +
      "account IS the point, and there is no session to check. Since " +
      "yuvoy-operator#20 this module also finishes the sign-in — signup, otp " +
      "and session are one flow with no bounce to /sign-in — so it DOES mint " +
      "a session, and all three calls are unauthenticated for the same " +
      "reason. One code path still creates every operator session: both doors " +
      "call `exchangeCode` in @/lib/auth/code and write the cookie with the " +
      "same `writeSessionToken`. Rate limiting is the server's (429), not a " +
      "gate this client can apply.",
  ],
]);

/*
  A Map rather than a Set so an exemption cannot be added without writing down
  why. Both entries today are the same shape — a code is the authorisation and
  there is no session to check — and a third that is not should be hard to add
  quietly.
*/
for (const [path, reason] of UNAUTHENTICATED_ACTIONS) {
  if (!reason || reason.length < 40) {
    problems.push(
      `scripts/qa.mjs: UNAUTHENTICATED_ACTIONS entry "${path}" has no real ` +
        `reason. An action with no authorisation check needs one written down.`,
    );
  }
  if (!existsSync(join(ROOT, path))) {
    // A stale exemption is worse than none: it silently covers whatever is
    // written at that path next.
    problems.push(
      `scripts/qa.mjs: UNAUTHENTICATED_ACTIONS names "${path}", which does not exist`,
    );
  }
}

/*
  Per EXPORTED ACTION, not per module. The first version credited a whole
  file with one `requireOperator()` call, so a second action added to an
  already-passing module could skip the check undetected. Every exported
  async function in a "use server" module is a public endpoint of its own.
*/
for (const f of files) {
  if (!isServerAction(f)) continue;
  if (UNAUTHENTICATED_ACTIONS.has(rel(f))) continue;
  const s = code(f);
  const exports = [...s.matchAll(/^export\s+async\s+function\s+(\w+)\s*\(/gm)];
  if (exports.length === 0 && !/requireOperator\(/.test(s)) {
    problems.push(
      `${rel(f)}: a Server Action module that never calls requireOperator(). ` +
        `An action is a public POST endpoint — Next checks the origin, not ` +
        `who is asking.`,
    );
    continue;
  }
  exports.forEach((m, i) => {
    const start = m.index;
    const end = i + 1 < exports.length ? exports[i + 1].index : s.length;
    const body = s.slice(start, end);
    if (!/requireOperator\(/.test(body)) {
      problems.push(
        `${rel(f)}: exported action \`${m[1]}\` never calls requireOperator(). ` +
          `Each export is its own public POST endpoint — one check elsewhere ` +
          `in the file covers nothing here.`,
      );
    }
  });
}

/* ------------------- 8. no traveller phone number, anywhere -------------- */

/**
 * O12, as a check rather than a promise.
 *
 * "No traveller phone numbers appear anywhere in the operator portal. Not on
 * the manifest, not on a booking, not in an export." `OperatorBooking.contact`
 * carries the name and only the name — `whatsapp` was there and was removed
 * deliberately, because an operator with the number can take next season's
 * booking directly and cut us out.
 *
 * The API does not return one today. This is what stops a well-meaning commit
 * from displaying one the day it does.
 */
const PHONE_FIELDS = "whatsapp|phone|mobile|msisdn";
const TRAVELLER_RECEIVERS = "contact|party|booking|traveller";
/*
  Three shapes of the same read, and a domain rule. The first version caught
  `party.phone` and nothing else: `party["phone"]`, `const { phone } = party`
  and any aliased receiver slipped through. Bracket and destructured reads
  are matched now; and inside the manifest domain — the day screens and the
  day library, where the only numbers in scope are travellers' — ANY phone
  field read on ANY receiver is refused, alias or not.
*/
const PHONE_READS = [
  new RegExp(`\\b(?:${TRAVELLER_RECEIVERS})\\??\\.(${PHONE_FIELDS})\\b`, "gi"),
  new RegExp(
    `\\b(?:${TRAVELLER_RECEIVERS})\\??\\.?\\[\\s*["'](${PHONE_FIELDS})["']\\s*\\]`,
    "gi",
  ),
  new RegExp(
    `\\{[^}]*\\b(${PHONE_FIELDS})\\b[^}]*\\}\\s*=\\s*(?:${TRAVELLER_RECEIVERS})\\b`,
    "gi",
  ),
];
const MANIFEST_DOMAIN = /[/\\](app[/\\]today|lib[/\\]day)[/\\]/;
const ANY_PHONE_READ = new RegExp(
  `(?:\\.(${PHONE_FIELDS})\\b|\\[\\s*["'](${PHONE_FIELDS})["']\\s*\\])`,
  "gi",
);

for (const f of files) {
  if (/\.test\.tsx?$/.test(f)) continue;
  const s = code(f);
  const seen = new Set();
  for (const re of PHONE_READS) {
    for (const m of s.matchAll(re)) seen.add(m[0]);
  }
  if (MANIFEST_DOMAIN.test(f)) {
    for (const m of s.matchAll(ANY_PHONE_READ)) seen.add(m[0]);
  }
  for (const read of seen) {
    problems.push(
      `${rel(f)}: reads "${read}" — a traveller's number never appears in ` +
        `this portal (O12). Use \`reference\` to identify, the relay to reach.`,
    );
  }
}

/* ---------------- 9. environment values are validated, not trusted ------- */

/**
 * A raw `process.env.OPERATOR_API_URL` read outside its one owner.
 *
 * Written from a failure that happened next door rather than here.
 * `yuvoy-app` took `NEXT_PUBLIC_SITE_URL` on trust and three production
 * deploys died at module evaluation, while the local build stayed green the
 * whole time — the variable is unset locally, so the fallback literal was what
 * ran. A dashboard value is the one input a repo cannot test, so the code that
 * reads it gets read instead.
 *
 * `lib/api/server-client.ts` resolves it once: empty string, surrounding
 * quotes, a trailing slash and a non-http scheme each get a defined answer.
 */

for (const f of [...files, ...walk(join(ROOT, "mocks"))]) {
  if (!/\.tsx?$/.test(f)) continue;
  if (/lib[/\\]api[/\\](server-client|base-url\.test)\.ts$/.test(f)) continue;
  if (/process\.env\.OPERATOR_API_URL/.test(code(f))) {
    problems.push(
      `${rel(f)}: reads OPERATOR_API_URL raw — import apiBaseUrl() from ` +
        `@/lib/api/server-client, which validates and normalises it. A second ` +
        `copy of the fallback is how a mock ends up registered against a base ` +
        `URL that intercepts nothing.`,
    );
  }
}

/* ------------------ 10. every page is force-dynamic ---------------------- */

/**
 * A page that forgot `export const dynamic = "force-dynamic"`.
 *
 * Two separate things depend on this being true of every page, and both are
 * silent when it stops being:
 *
 *   - **Freshness.** Every screen here is the live answer to a question asked
 *     on a jetty — who is on the boat, who can get into the account, how many
 *     seats are left. A prerendered one shows the deploy day's answer, and the
 *     failure mode is a manifest that disagrees with the boat.
 *   - **`OPERATOR_API_URL`.** It is safe to mark Sensitive in Vercel *only*
 *     because it is read at request time. A page that prerenders is a page
 *     that can read it during the build and get `[SENSITIVE]` back — which is
 *     precisely what killed yuvoy-app's first three production deploys, while
 *     the local build stayed green throughout.
 *
 * Static generation is opt-out in Next, so this is an absence rather than a
 * mistake, and a code review cannot see an absence.
 */
/**
 * The one exemption, and it revokes itself.
 *
 * A page that reads nothing has nothing to go stale and no environment value
 * to read at build time, so prerendering it is correct rather than tolerated.
 * The exemption is conditional on that still being true: the moment the file
 * imports anything from `@/lib` it is fetching, and the check comes back.
 */
const MAY_PRERENDER = new Map([
  [
    join("src", "app", "page.tsx"),
    '`redirect("/today")` is its whole body — it reads nothing and renders nothing.',
  ],
]);

for (const f of walk(APP)) {
  if (!/[/\\]page\.tsx$/.test(f)) continue;
  if (MAY_PRERENDER.has(rel(f))) {
    if (/from\s+["']@\/lib\//.test(code(f))) {
      problems.push(
        `${rel(f)}: exempted from force-dynamic on the grounds that it reads ` +
          `nothing, but it now imports from @/lib. Add ` +
          `\`export const dynamic = "force-dynamic"\` or drop the exemption.`,
      );
    }
    continue;
  }
  if (!/export\s+const\s+dynamic\s*=\s*["']force-dynamic["']/.test(code(f))) {
    problems.push(
      `${rel(f)}: no \`export const dynamic = "force-dynamic"\`. Every page ` +
        `in this portal is request-rendered — for freshness, and because ` +
        `OPERATOR_API_URL is only safe to mark Sensitive if nothing reads it ` +
        `at build time.`,
    );
  }
}

/* ------- 11. an OWNER-only endpoint is never gated on `canManage` -------- */

/**
 * `canManage` is **OWNER or MANAGER**. Four endpoints are OWNER *only*.
 *
 * The two sets are one word apart and the mistake is invisible: gate the team
 * screen on `canManage` and a manager gets an invite form that 403s — having
 * first been taught that they are allowed to hand out access to somebody
 * else's business. Same for the bank change, where the whole design is that
 * one stolen login cannot redirect a season's takings.
 *
 * The OWNER-only list is read from the contract rather than written here, so
 * it stays true when the contract moves. `pnpm contract:check` guarantees this
 * file is the pinned document byte for byte.
 */
/**
 * Two role gates, read out of the contract rather than written down here.
 *
 *   - **OWNER only** — a 403 whose description names OWNER. Four endpoints:
 *     both team writes, the bank change, and the brake.
 *   - **OWNER or MANAGER** (`canManage`) — an operation that says "Requires
 *     OWNER or MANAGER", or "OWNER or MANAGER only", or whose 403 says
 *     "STAFF cannot …".
 *
 * The third phrasing was added when `POST /slots` landed saying "OWNER or
 * MANAGER only." and this parser recognised none of it — so the one new write
 * on the capacity screen was the one endpoint whose role gate nothing checked.
 * A check that matches on prose grows a phrase every time the prose does, and
 * the alternative — a list written here — is a list that goes stale silently.
 *
 * `pnpm contract:check` guarantees this file is the pinned document byte for
 * byte, so parsing it is safe and it stays true when the contract moves.
 */
const OWNER_ONLY = [];
const OWNER_OR_ADMIN = [];
const NEEDS_MANAGE = [];
{
  const lines = readFileSync(
    join(ROOT, "contracts", "operator-openapi.yaml"),
    "utf8",
  ).split("\n");

  let path = null;
  let method = null;
  let opStart = -1;

  /** Everything indented under the current operation. */
  const operationBlock = (from) => {
    let block = "";
    for (let j = from + 1; j < lines.length; j++) {
      if (/^ {4}[a-z]+:\s*$/.test(lines[j])) break;
      if (/^ {2}\/\S*:\s*$/.test(lines[j])) break;
      if (/^ {2}[a-z]+:\s*$/.test(lines[j])) break;
      block += "\n" + lines[j];
    }
    return block;
  };

  const finish = () => {
    if (opStart < 0 || !path || !method) return;
    const block = operationBlock(opStart);
    const upper = method.toUpperCase();

    /*
      Three buckets, not two — and the third exists because the second was
      silently wrong.

      This used to read "a 403 naming OWNER means OWNER only". On 6 September
      the contract widened five endpoints from "OWNER or MANAGER" to "OWNER,
      ADMIN or MANAGER" and four from OWNER-only to "OWNER or ADMIN", and this
      parse quietly re-bucketed all nine: `NEEDS_MANAGE` dropped from seven
      entries to three, and the OWNER-or-ADMIN endpoints landed in OWNER_ONLY.

      Nothing failed loudly. The check went on running against a picture of the
      contract that was two changes out of date, which is the failure mode a
      contract-derived check exists to avoid — so the wording is now matched
      precisely rather than by whether OWNER appears anywhere near a 403.
    */
    const four03 = block.match(
      /\n {8}"403":[\s\S]*?(?=\n {8}"\d{3}":|\n {4}[a-z]+:|$)/,
    );
    const refusal = four03 ? four03[0] : "";

    if (/OWNER or ADMIN/.test(refusal) || /OWNER or ADMIN only/.test(block)) {
      OWNER_OR_ADMIN.push({ method: upper, path });
    } else if (refusal && /\bOWNER\b/.test(refusal)) {
      OWNER_ONLY.push({ method: upper, path });
    } else if (
      /Requires OWNER, ADMIN or MANAGER/.test(block) ||
      /OWNER, ADMIN or MANAGER only/.test(block) ||
      /Requires OWNER or MANAGER/.test(block) ||
      /OWNER or MANAGER only/.test(block) ||
      /STAFF cannot/.test(block)
    ) {
      NEEDS_MANAGE.push({ method: upper, path });
    }
    opStart = -1;
  };

  for (let i = 0; i < lines.length; i++) {
    const p = lines[i].match(/^ {2}(\/\S*):\s*$/);
    if (p) {
      finish();
      path = p[1];
      method = null;
      continue;
    }
    const m = lines[i].match(/^ {4}(get|post|put|patch|delete):\s*$/);
    if (m) {
      finish();
      method = m[1];
      opStart = i;
      continue;
    }
  }
  finish();

  /*
    THE EXEMPTION THAT CLOSED ITSELF — yuvoy-operator#44.

    `POST /experiences/{id}/pause` and `/resume` were gated in the API's
    routes.go and silent in their prose, so this parse filed them under no role
    and `/services` switching from `withdraw` to `pause` read as a route gating
    on a role nobody asked for. A `PROSE_GAPS` map carried both, with the
    reason.

    yuvoy-api#167 wrote the roles down: pause now ends "OWNER, ADMIN or MANAGER
    only.", which this parse already recognises, and resume names them in its
    403. Both entries were removed only after checking that this file still
    passes without them — a stale exemption is worse than none, because it
    quietly covers whatever is written at that path next.
  */
}

/*
  Each bucket is expected to be non-empty AND to have at least as many entries
  as the contract had when this was last checked. A parse that silently finds
  fewer is the failure this section exists to prevent, and "greater than zero"
  did not catch it: NEEDS_MANAGE fell from seven to three and stayed green.
*/
/*
  A snapshot of the contract at yuvoy-api@d40ae3b, deliberately updated by hand
  when it moves — never widened to make a run green.

  Bumping one of these DOWN means a permission was relaxed, and that is the
  moment to re-read `src/lib/team/roles.ts`: every description in it is a
  promise to an owner about who can see their margins, and the last relaxation
  made one of them false for four days.

    OWNER_ONLY     POST /change-requests/bank
    OWNER_OR_ADMIN POST /change-requests/{id}/cancel, POST /team,
                   PUT /team/{id}/role, POST /team/{id}/hold,
                   POST /team/{id}/restore, DELETE /team/{id}
    NEEDS_MANAGE   accept, decline, call-off, POST /slots, PATCH /slots/{id},
                   POST /blackouts, GET /earnings
*/
const FLOORS = { OWNER_ONLY: 1, OWNER_OR_ADMIN: 6, NEEDS_MANAGE: 7 };
for (const [name, bucket] of Object.entries({
  OWNER_ONLY,
  OWNER_OR_ADMIN,
  NEEDS_MANAGE,
})) {
  if (bucket.length < FLOORS[name]) {
    problems.push(
      `scripts/qa.mjs: the contract parse found ${bucket.length} ${name} ` +
        `endpoints and expected at least ${FLOORS[name]}. Either the contract ` +
        `relaxed a permission — in which case every role description in ` +
        `src/lib/team/roles.ts is now a claim to re-check — or this parse ` +
        `stopped matching its own wording. Both are silent otherwise.`,
    );
  }
}

if (OWNER_ONLY.length === 0 || NEEDS_MANAGE.length === 0) {
  /*
    A check that silently verified nothing would pass forever while saying
    nothing true — the same failure the contract drift checker avoids by
    reading its path from PINNED rather than assuming it.
  */
  problems.push(
    `scripts/qa.mjs: the contract parse found ${OWNER_ONLY.length} OWNER-only ` +
      `and ${NEEDS_MANAGE.length} manager-only endpoints. One of those is ` +
      `zero, so this check is now asserting nothing.`,
  );
}

/**
 * Every module a page can reach, following imports through Server Actions.
 *
 * Attribution is what makes these checks useful: `/earnings` does not call
 * `GET /earnings` itself — `lib/money/fetch.ts` does — so a per-file check
 * would demand a role gate inside a fetch helper, which is the one place it
 * does not belong. Walking forward from the page puts the requirement where
 * the decision is made.
 *
 * Granularity is per MODULE, not per symbol: a page importing one function
 * from a file is credited with every endpoint that file calls. That is why a
 * gate on `"OWNER"` satisfies the `canManage` requirement below — it is
 * strictly stronger — rather than the two being checked independently.
 */
function reachableFrom(entry) {
  const seen = new Set();
  const queue = [entry];
  while (queue.length) {
    const file = queue.shift();
    if (!file || seen.has(file)) continue;
    seen.add(file);
    for (const spec of importsOf(file)) {
      const next = resolveImport(file, spec);
      if (next && !seen.has(next)) queue.push(next);
    }
  }
  return [...seen];
}

/** The route family a file belongs to — `src/app/payouts`, not one file. */
function segmentOf(file) {
  const r = relative(APP, file);
  if (r.startsWith("..")) return file;
  const first = r.split(/[/\\]/)[0];
  /*
    The root page is its own segment, not the whole app tree. Returning APP
    here made `src/app` a "route" containing every file under it, so any use of
    `canManage` anywhere in the portal counted as the root redirect gating on a
    role — a false positive that would have had to be silenced with an
    exemption rather than fixed.
  */
  return first.endsWith(".tsx") ? file : join(APP, first);
}

const pages = walk(APP).filter((f) => /[/\\]page\.tsx$/.test(f));

/** segment → what it gates on, and what could possibly justify it. */
const gateJustification = new Map();

for (const page of pages) {
  const graph = reachableFrom(page);
  const source = graph.map(code).join("\n");
  const segment = segmentOf(page);
  const segmentFiles = files.filter(
    (f) =>
      f === segment ||
      f.startsWith(segment + "/") ||
      f.startsWith(segment + "\\"),
  );
  const segmentSource = segmentFiles.map(code).join("\n");

  const gatesOnOwner = /"OWNER"|'OWNER'/.test(segmentSource);
  const gatesOnManage = /\bcanManage\b/.test(segmentSource);
  /*
    An OWNER-or-ADMIN gate may be spelled here or borrowed from the one place
    that states the rule. `canManageAccess` is that place — it is the shared
    "OWNER or ADMIN" predicate — so a segment calling it is gated, and the
    literal is not required to be re-typed into every route that needs it.
  */
  const gatesOnAdmin = /"ADMIN"|'ADMIN'|\bcanManageAccess\b/.test(
    segmentSource,
  );

  /*
    Whitespace-tolerant, and that is not cosmetic.

    This used to be `source.includes(\`${method}("${path}"\`)`, which requires
    the method and the path to sit on ONE line — and prettier wraps exactly
    those calls once the path is long enough:

        await operatorApi(token).POST(
          "/experiences/{id}/withdraw",

    A wrapped call was therefore invisible to this check, in both directions.
    The harmless direction is what surfaced it (a correctly gated route accused
    of inventing a permission); the dangerous one is silent, because a route
    reaching a gated endpoint on a wrapped line would pass the check below
    WITHOUT gating at all, and a staff login would meet a 403 it cannot act on.

    Found on 8 Sep 2026 building yuvoy-operator#30 §6.
  */
  const reaches = (method, path) =>
    new RegExp(
      `${method}\\(\\s*["'\`]${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'\`]`,
    ).test(source);

  const ownerCalls = OWNER_ONLY.filter(({ method, path }) =>
    reaches(method, path),
  ).map(({ method, path }) => `${method} ${path}`);

  const manageCalls = NEEDS_MANAGE.filter(({ method, path }) =>
    reaches(method, path),
  ).map(({ method, path }) => `${method} ${path}`);

  const adminCalls = OWNER_OR_ADMIN.filter(({ method, path }) =>
    reaches(method, path),
  ).map(({ method, path }) => `${method} ${path}`);

  if (ownerCalls.length) {
    if (gatesOnManage) {
      problems.push(
        `${rel(segment)}: decides on \`canManage\` while reaching ` +
          `${ownerCalls.join(", ")}, which the contract marks OWNER only. ` +
          `\`canManage\` is OWNER **or** MANAGER — gate on ` +
          `\`roles.includes("OWNER")\`.`,
      );
    }
    if (!gatesOnOwner) {
      problems.push(
        `${rel(segment)}: reaches ${ownerCalls.join(", ")} (OWNER only in the ` +
          `contract) but nothing in this route checks for the OWNER role. The ` +
          `server refuses it with a 403 the operator has to read after the fact.`,
      );
    }
  }

  /*
    OWNER **or** ADMIN. A separate bucket from OWNER_ONLY since 6 September,
    because four team endpoints and the bank-change brake widened to admit an
    admin — and a route that gates them on OWNER alone hides from an admin
    exactly the screen the role exists for. Wrong in the direction that
    matters: telling somebody they may not do what the server would allow.
  */
  if (adminCalls.length && !gatesOnOwner && !gatesOnAdmin) {
    problems.push(
      `${rel(segment)}: reaches ${adminCalls.join(", ")} (OWNER or ADMIN in ` +
        `the contract) but nothing in this route decides on either role. ` +
        `Gate on \`canManageAccess(me.roles)\`.`,
    );
  }
  if (adminCalls.length && gatesOnOwner && !gatesOnAdmin) {
    problems.push(
      `${rel(segment)}: gates ${adminCalls.join(", ")} on OWNER alone, but the ` +
        `contract allows OWNER or ADMIN. An admin exists for an owner who is ` +
        `off the island; hiding this from them is the wrong direction to be ` +
        `wrong in.`,
    );
  }

  /*
    The other direction, and it caught a real one.

    A first draft of `/reels` gated uploading on `canManage`. Nothing in the
    contract asks for that — `POST /media/upload-intents` declares 401 and 409
    and no 403 — so the screen was inventing a permission the server does not
    have, in the direction that matters most: telling a skipper they may not do
    something they may. The person who filmed the dive is exactly the person
    who should be able to send it.

    A gate is allowed if the route reaches a gated endpoint itself, OR if it
    links to a route that does — `/today` gates the earnings and payout links
    on `canManage` and calls nothing gated of its own, which is correct.
  */
  /*
    ACCUMULATED across every page in the segment, not overwritten by the last
    one — and the asymmetry is the reason.

    The gate is detected segment-wide (`segmentSource`, every file under the
    segment) while the calls are detected per page (`source`, that page's
    import graph). A segment with two pages where only one reaches a gated
    endpoint therefore looked ungated-but-gating the moment the other page was
    processed last: `/services` has `activities` calling a gated endpoint and
    `reels` calling none, and whichever ran second decided the answer.

    So `own` and `links` are unioned. Found on 8 Sep 2026, when adding the
    listing withdraw (yuvoy-operator#30 §6) made `/services` reach its first
    gated endpoint and the check blamed the sibling page.
  */
  const prior = gateJustification.get(segment);
  gateJustification.set(segment, {
    gates:
      gatesOnManage || gatesOnOwner || gatesOnAdmin || prior?.gates || false,
    own:
      manageCalls.length + ownerCalls.length + adminCalls.length > 0 ||
      prior?.own ||
      false,
    links: [
      ...(prior?.links ?? []),
      ...[...code(page).matchAll(/href=\{?["'`](\/[^"'`}\s]*)["'`]/g)].map(
        (m) => m[1].split("?")[0].split("#")[0],
      ),
    ],
  });

  if (manageCalls.length && !gatesOnManage && !gatesOnOwner) {
    problems.push(
      `${rel(segment)}: reaches ${manageCalls.join(", ")} (OWNER or MANAGER in ` +
        `the contract) but nothing in this route checks \`canManage\`. A staff ` +
        `login meets a 403 it cannot act on — and if the read itself is ` +
        `refused, an error boundary saying "try again" about a refusal that ` +
        `will never succeed.`,
    );
  }
}

/* --------- 11b. a role gate the contract never asked for ---------------- */

const gatedSegments = new Set(
  [...gateJustification].filter(([, v]) => v.own).map(([seg]) => seg),
);

for (const [segment, info] of gateJustification) {
  if (!info.gates || info.own) continue;

  // A route may gate on a role purely to stop offering links to routes that
  // need it — which is what the day screen does, and is correct.
  const justifiedByLink = info.links.some((href) =>
    [...gatedSegments].some(
      (seg) => rel(seg) === join("src", "app", href.replace(/^\//, "")),
    ),
  );
  if (justifiedByLink) continue;

  problems.push(
    `${rel(segment)}: gates on a role, but reaches no endpoint the contract ` +
      `restricts and links to no route that does. That is a permission this ` +
      `build invented — and telling somebody they may not do something the ` +
      `server would allow is the wrong direction to be wrong in.`,
  );
}

/* ---------- 11c. the sign-in screen never names the channel -------------- */

/**
 * Copy on `/sign-in` that says a code was sent, or by what.
 *
 * There are two ways a sign-in code reaches an operator: WhatsApp, and a
 * Yuvoy staff member issuing one out of band when a phone is gone or a
 * message has not arrived (`yuvoy-api#59`). The session they produce is
 * deliberately indistinguishable — `POST /auth/session` never learns which
 * channel the code came from — and the agreed copy is true of both,
 * **unconditionally**.
 *
 * Unconditional is the load-bearing half. A screen that says "we messaged you"
 * only when it believes it did is a screen that has been told the channel, and
 * not being told is the design. So the rule is not "branch correctly", it is
 * "do not have the branch": nothing here asserts a send, and nothing names a
 * carrier.
 *
 * "Send me a code" is fine and is not matched — that is a request the operator
 * makes, not a claim about what happened.
 */
{
  /*
    `/signup` is held to the same rule. It sends nothing itself, but its
    success copy is one careless edit away from "check your WhatsApp" — and
    the channel a code arrives by is exactly what neither door is told.
  */
  const signIn = [
    ...walk(join(APP, "sign-in")),
    ...walk(join(APP, "signup")),
  ].filter((f) => /\.tsx?$/.test(f));
  const banned =
    /\bwe (sent|send|have sent|messaged|texted)\b|\bWhatsApp\b|\bSMS\b|\btext message\b|\bsent to\b/i;

  for (const f of signIn) {
    const src = code(f);
    const hit = banned.exec(src);
    if (hit) {
      problems.push(
        `${rel(f)}: says "${hit[0]}" on the sign-in screen. A code may arrive ` +
          `by WhatsApp or be issued by Yuvoy out of band, and this screen is ` +
          `never told which — so its copy must be true of both, ` +
          `unconditionally. See yuvoy-api#59.`,
      );
    }
  }
}

/* -------------- 12. the failure screens exist at all --------------------- */

/**
 * `error.tsx`, `global-error.tsx` and `not-found.tsx`.
 *
 * Written from a defect rather than a principle. `requireOperator()` described
 * itself as throwing "to the error boundary, which says what is actually
 * true", and **there was no error boundary** — so every failure this portal
 * could not handle rendered Next's default page, to somebody on a jetty at
 * 0.5 Mbps where a dropped connection is the common path rather than the
 * exception. Nothing failed; a file was missing, which is the same class of
 * absence as a page that forgot `dynamic` or a route with no Open Graph.
 *
 * A boundary is opt-in in Next and its absence is silent by design: the
 * fallback is a working page that says nothing. That is exactly what a code
 * review cannot see.
 */
for (const required of ["error.tsx", "global-error.tsx", "not-found.tsx"]) {
  if (!existsSync(join(APP, required))) {
    problems.push(
      `src/app/${required} is missing. Without it Next renders its own ` +
        `default screen — no retry, no way back, and nothing true said to ` +
        `somebody on one bar of signal.`,
    );
  }
}

/* ------- 13. the one localStorage exception stays one, and stays safe ---- */

/**
 * `src/lib/media/slot-store.ts` is the only file in `src/` allowed to touch
 * `localStorage`, and it is allowed to keep exactly one thing there.
 *
 * ## Why the exception exists
 *
 * yuvoy-api#66 §3 made an upload survive a browser restart: asking for the
 * intent again returns the upload in flight. The page it comes back to has no
 * memory of whose bytes are behind that URL, and resuming a different clip
 * into them is a corrupt reel — one file's head, another's tail — carrying a
 * signed rights attestation, sent to a human reviewer. So the browser
 * remembers which file it put in: a name, a size, a modification time.
 *
 * ## Why it needs a check rather than a comment
 *
 * The eslint ban is switched off for that file, and a switched-off rule is an
 * invitation. Two things can go wrong and neither shows up in review:
 *
 * 1. **The exception spreads.** Somebody adds a second file to the eslint
 *    `files` list because they need "just one flag". The ban stops meaning
 *    anything and nothing announces it.
 * 2. **The credential goes in.** The contract is explicit that `uploadUrl` is
 *    "a credential for writing video into our account … do not persist it
 *    client-side either", and the shortest path to a working reload — for
 *    somebody who has not read `slot.ts` — is to store the URL. It would work.
 *    It is the one thing that must not.
 *
 * Both are caught here by reading the eslint config and the store itself,
 * because the failure is a file's CONTENT, which no type and no test sees.
 */
const STORE = join(SRC, "lib/media/slot-store.ts");
const ALLOWED_LOCALSTORAGE = new Set([
  "src/lib/media/slot-store.ts",
  "src/lib/media/slot-store.test.ts",
  "e2e/reels.spec.ts",
]);

for (const f of files) {
  if (!/\blocalStorage\b/.test(code(f))) continue;
  if (ALLOWED_LOCALSTORAGE.has(rel(f))) continue;
  problems.push(
    `${rel(f)}: uses localStorage. It is banned in this portal — the session ` +
      `is an httpOnly cookie precisely so nothing worth stealing is anywhere ` +
      `a script can read. The single exception is src/lib/media/slot-store.ts.`,
  );
}

const eslintConfigPath = join(ROOT, "eslint.config.mjs");
if (existsSync(eslintConfigPath)) {
  const cfg = readFileSync(eslintConfigPath, "utf8");
  const exempted = [...cfg.matchAll(/"((?:src|e2e)\/[^"]*?)"/g)]
    .map((m) => m[1])
    .filter((f) => cfg.slice(cfg.indexOf("no-restricted-syntax")).includes(f));
  for (const f of exempted) {
    if (!ALLOWED_LOCALSTORAGE.has(f)) {
      problems.push(
        `eslint.config.mjs exempts ${f} from the localStorage ban, and ` +
          `scripts/qa.mjs does not know about it. Widening that exception is ` +
          `a decision, not an edit — add it here with its reason, or take it ` +
          `out of the eslint config.`,
      );
    }
  }
}

if (existsSync(STORE)) {
  const store = code(STORE);
  /*
    The credential check. Anything that looks like it is reaching for the
    upload URL — the field itself, or an http string — fails, because the one
    unrecoverable mistake here is storing something the contract says must
    never leave memory.
  */
  for (const [pattern, what] of [
    [/\buploadUrl\b/, "the upload URL"],
    [/https?:\/\//, "an absolute URL"],
    [/\burl\b\s*:/, "a `url` field"],
  ]) {
    if (pattern.test(store)) {
      problems.push(
        `src/lib/media/slot-store.ts mentions ${what}. It may persist a file ` +
          `IDENTITY and nothing else: "\`uploadUrl\` … is a credential for ` +
          `writing video into our account … do not persist it client-side ` +
          `either". Since yuvoy-api#66 §3 the API hands the URL back on ` +
          `request, so there is nothing to gain by keeping one.`,
      );
    }
  }
}

/* --------------- 13b. the proxy annotates, and decides nothing ----------- */

/**
 * `src/proxy.ts` (Next 16's replacement for `middleware.ts`) exists for one
 * reason: a Server Component cannot read
 * its own pathname, and `requireOperator()` needs it to build the `?next=` on
 * the sign-in redirect (yuvoy-operator#18).
 *
 * It must never grow into an auth check. `requireOperator()` says why:
 * this layer can only see that a cookie EXISTS, and a cookie whose session was
 * revoked an hour ago exists exactly as hard as a good one. A gate here would
 * look like security while being a redirect somebody holds a dead session
 * past — and it is the most attractive place in the repository to put one,
 * because it runs before everything.
 *
 * So the file is held to what it is: no session cookie, no API client, no
 * cookie writes, no redirects.
 */
{
  const mw = join(SRC, "proxy.ts");
  if (existsSync(mw)) {
    const src = code(mw);
    const banned = [
      [/SESSION_COOKIE|yvo_session/, "reads the session cookie"],
      [/session-writes|cookies\(\)\s*\.set|\.cookies\.set/, "writes a cookie"],
      [/operatorApi|server-client/, "calls the operator API"],
      [/NextResponse\.redirect|NextResponse\.rewrite/, "redirects or rewrites"],
      [/requireOperator|sessionState/, "makes a session decision"],
    ];
    for (const [pattern, what] of banned) {
      if (pattern.test(src)) {
        problems.push(
          `src/proxy.ts ${what}. It annotates the request with its own ` +
            `path and nothing else — middleware can only see that a cookie ` +
            `exists, and a revoked session leaves a cookie exactly as real ` +
            `as a live one. The decision belongs in requireOperator().`,
        );
      }
    }
  }
}

/* ------------ 14. no literal control characters in source ---------------- */

/**
 * A NUL, a DEL or a stray escape byte pasted into a source file.
 *
 * Written from a defect. `safeReturnPath` guards against response splitting by
 * refusing control characters, and its regex was written by pasting the actual
 * bytes in: `/[<NUL>-<US><DEL>-<APC>]/`. It worked, which is exactly why it
 * needed catching — the file rendered as `/[-]/` in a review, in a diff and in
 * a terminal, and nothing anywhere objected. eslint's `no-control-regex` is
 * not enabled in this config and would not have seen literal bytes in any
 * case, since it inspects escape sequences.
 *
 * Tab, newline and carriage return are the only ones a source file has any
 * business containing.
 */
for (const f of [...files, join(ROOT, "scripts", "qa.mjs")]) {
  const raw = readFileSync(f, "utf8");
  const hit = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.exec(raw);
  if (hit) {
    const line = raw.slice(0, hit.index).split("\n").length;
    problems.push(
      `${rel(f)}:${line}: contains a literal control character ` +
        `(U+${hit[0].codePointAt(0).toString(16).padStart(4, "0").toUpperCase()}). ` +
        `Write it as an escape — a byte that renders as nothing is a byte ` +
        `nobody reviews.`,
    );
  }
}

/**
 * `bookable` IS NOT A PROXY FOR "THERE IS SOMETHING OUTSTANDING" — op#38.
 *
 * `/account` rendered the outstanding list behind `standing && !standing
 * .bookable`. That was correct against the old API, where `bookable` went
 * false for ANY outstanding item, so `!bookable` really did mean "there is
 * something to show". yuvoy-api#139 narrowed `bookable` to things that
 * actually stop a sale — an operator LIVE with three listings selling was
 * being told "you cannot be booked yet" over a missing logo, which stops
 * somebody promoting a business travellers are already buying from — and the
 * proxy silently inverted. The portal stopped asking anybody for their logo
 * or their registered address, with every test green.
 *
 * The contract now says it in the field description, and this enforces it:
 * "a client that hides this list on `bookable` will now hide it exactly when
 * it is most useful. **Gate the list on `blocking` being non-empty instead.**"
 *
 * Narrow on purpose. It fires only where a negated `bookable` decides whether
 * a region mentioning `blocking` or `<Outstanding` renders at all — reading
 * `bookable` for the headline, the chip and the "Go to today" link is right
 * and stays untouched.
 */
for (const f of files) {
  if (/\.test\.tsx?$/.test(f)) continue;
  const s = code(f);
  for (const m of s.matchAll(/\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\?/g)) {
    const gate = m[1];
    if (!/!\s*[\w$.?]*\bbookable\b/.test(gate)) continue;

    // What the gate decides to render: from the `?` to the end of the
    // brace-balanced expression container it sits in.
    const open = s.lastIndexOf("{", m.index);
    let depth = 0;
    let end = s.length;
    for (let i = open; i < s.length; i++) {
      if (s[i] === "{") depth++;
      else if (s[i] === "}" && --depth === 0) {
        end = i;
        break;
      }
    }
    /*
      Only where the gate decides whether the ROWS THEMSELVES render. The day
      screen reads `blocking` behind `!bookable` too, and is right to: that
      banner is a "you cannot sell yet" warning, whose whole subject is
      `bookable`, and an operator who CAN sell must never be shown a warning
      about selling. Reading the list to count it is not rendering it.
    */
    const body = s.slice(m.index + m[0].length, end);
    if (!/<Outstanding\b|\bblocking\b[\s\S]{0,60}\.map\(/.test(body)) continue;

    problems.push(
      `${rel(f)}: the outstanding list is gated on a negated \`bookable\`. ` +
        `Since yuvoy-api#139 that field is false only when something STOPS A ` +
        `SALE, so a live operator who still owes us a logo or a registered ` +
        `address renders nothing — the list disappears exactly when it is ` +
        `most useful. The contract says it: gate on \`blocking\` being ` +
        `non-empty instead, and use \`gates\` to say which rows cost money.`,
    );
  }
}

/**
 * TWO MOCK IDENTITIES MUST NOT SHARE A PHONE NUMBER.
 *
 * `sessionUser` resolves an identity by phone with `.find()`, so a duplicate
 * does not collide loudly — it silently hands one fixture identity's session
 * to whichever row is declared first. Adding an account-standing identity on
 * a number Second Skipper already held broke the upload-CONTENTION test in a
 * different spec file, with nothing wrong in either the test or the screen it
 * was testing (yuvoy-operator#38).
 *
 * The fixtures are the one place in this repo where a copy-pasted constant
 * reroutes a whole test identity, and the symptom always surfaces somewhere
 * else. Cheap to check, and it costs an hour to find by hand.
 */
{
  const fixtures = join(ROOT, "mocks", "fixtures.ts");
  if (existsSync(fixtures)) {
    const s = readFileSync(fixtures, "utf8");
    const seen = new Map();
    for (const m of s.matchAll(/phone:\s*"(\+\d{6,15})"/g)) {
      const line = s.slice(0, m.index).split("\n").length;
      const at = seen.get(m[1]);
      if (at) {
        problems.push(
          `mocks/fixtures.ts: two identities share the phone ${m[1]} ` +
            `(lines ${at} and ${line}). \`sessionUser\` resolves by phone ` +
            `with \`.find()\`, so the second identity is unreachable and its ` +
            `session silently becomes the first — the failure surfaces in ` +
            `whatever spec used the shadowed one.`,
        );
      } else {
        seen.set(m[1], line);
      }
    }
  }
}

/**
 * A PUBLISH BLOCKER MUST BE CLEARABLE ON THE EDIT FORM — yuvoy-operator#39.
 *
 * `activityType` became mandatory with the taxonomy and shipped on the CREATE
 * form only. A listing written before it could therefore never acquire one:
 * the operator edits something ordinary, submit succeeds (the API marks the
 * field `SubmitDeferred` precisely because this portal had no picker), they
 * wait, and approval refuses naming a field that is not on their screen. All
 * three older production listings sat in that state.
 *
 * `BLOCKER_LABELS` is the list of fields that stop publication, in the wire
 * spelling `publishBlockers` uses. Every one of them that the create form can
 * set must be settable on the edit form too — otherwise the row can name a
 * blocker it gives the operator no way to clear, which is the worst version
 * of this screen: a demand with no control.
 *
 * `category` and `destination` are deliberately create-only. Changing what a
 * listing fundamentally IS, or where it runs, deserves more than an inline
 * edit, and the API treats both as identity rather than content.
 */
{
  const listings = join(SRC, "lib/services/listings.ts");
  const createForm = join(APP, "services/activities/new-listing-form.tsx");
  const editForm = join(APP, "services/activities/listing-row.tsx");

  /* Blocker keys that are deliberately not editable, and why. */
  const CREATE_ONLY = new Set(["category", "destination"]);
  /* Wire spelling → the form control's name, where they differ. */
  const CONTROL_NAME = { unitPricePaise: "unitPrice" };

  if ([listings, createForm, editForm].every((f) => existsSync(f))) {
    const block = /BLOCKER_LABELS[^{]*\{([\s\S]*?)\n\};/.exec(code(listings));
    const names = (f) =>
      new Set([...code(f).matchAll(/name="([\w-]+)"/g)].map((m) => m[1]));
    if (block) {
      const onCreate = names(createForm);
      const onEdit = names(editForm);
      for (const m of block[1].matchAll(/^\s*(\w+):/gm)) {
        const key = m[1];
        if (CREATE_ONLY.has(key)) continue;
        const control = CONTROL_NAME[key] ?? key;
        if (onCreate.has(control) && !onEdit.has(control)) {
          problems.push(
            `src/app/services/activities/listing-row.tsx: \`${key}\` blocks ` +
              `publication and is settable on the create form (as ` +
              `\`${control}\`) but not on the edit form. A listing that ` +
              `predates the field can then never clear it: the row names the ` +
              `blocker, submit succeeds because the API defers it, and ` +
              `approval refuses days later about a control the operator does ` +
              `not have. Add it to the edit form, or to CREATE_ONLY in ` +
              `scripts/qa.mjs with the reason it is identity rather than ` +
              `content.`,
          );
        }
      }
    }
  }
}

/* ------ 15. the story's photographs use the story's own upload slot ------ */

/**
 * `/logo/upload-intents` called from anywhere but the logo.
 *
 * Story photographs minted through the logo's intent, on the issue's original
 * instruction to "upload the bytes through the existing image upload intent".
 * It was corrected on yuvoy-operator#41: that slot is OWNER and MANAGER only,
 * because a logo is the business's mark, while the story is editable by every
 * operator role. So a STAFF member could write their story, choose a
 * photograph, and be refused a 403 after picking the file.
 *
 * `POST /story/photos/upload-intents` is the open one.
 *
 * A test cannot catch a revert of this cheaply: the mock's role gate proves
 * the two endpoints differ, and the Server Action's own test would need a
 * session. The mistake is one string in one file, so it is checked as one
 * string in one file — which also fails in the diff, where somebody can still
 * see why.
 */

{
  const LOGO_INTENT = "/logo/upload-intents";
  for (const f of files) {
    if (!code(f).includes(LOGO_INTENT)) continue;
    // The logo's own screen is the one caller that should have it.
    if (/src[/\\]app[/\\]logo[/\\]/.test(f)) continue;
    /*
      And a test may NAME it, which is not calling it. `mock-roles.test.ts`
      drives this endpoint as a staff member precisely to prove it is gated —
      the assertion that gives the rest of this check its meaning. A guard that
      refused the test proving the rule is a guard nobody can satisfy.
    */
    if (/\.test\.tsx?$/.test(f)) continue;

    problems.push(
      `${rel(f)}: calls ${LOGO_INTENT}, which is OWNER and MANAGER only ` +
        `because a logo is the business's mark. A story photograph must use ` +
        `POST /story/photos/upload-intents, which is open to every operator ` +
        `role — the same set that may edit the story. Using the logo's slot ` +
        `let a staff member write their story and then be refused a 403 ` +
        `after choosing a file (yuvoy-operator#41).`,
    );
  }
}

/* ---- 16. a zod schema field the safeParse object never supplies --------- */

/**
 * A field declared on a schema, spread into a request body, and never read off
 * the form.
 *
 * yuvoy-operator#60, and it was live on operators.yuvoy.in. `createListing`
 * declared `screenerKey` on its schema and spread it into
 * `POST /experiences`, and the object handed to `safeParse` listed eight other
 * fields and not that one. So `parsed.data.screenerKey` was permanently
 * `undefined`, the key was never sent, and every listing created through the
 * form was saved with no screener whatever the operator picked. A listing with
 * a screener refuses a party that declares a condition before a seat is held,
 * so the failure was a safety gate silently switched off.
 *
 * Nothing caught it. It typechecks, because an optional field being absent is
 * exactly what the type allows. It lints. The e2e asserted the picker rendered
 * and stopped there, and it could not have gone further: this portal writes
 * through Server Actions, so the request never reaches a browser for Playwright
 * to read.
 *
 * The rule: every top-level key of a `z.object({...})` must appear as a key in
 * the object literal passed to that schema's `safeParse`/`parse`. Only literals
 * are compared; `schema.safeParse(values)` with a variable is skipped, because
 * nothing here can say what `values` holds.
 *
 * Blocks are matched by counting brackets while skipping string literals, not
 * by a regex. A regex was tried first and was wrong: `[^}]*` stops at the `}`
 * inside `.transform(() => undefined)` and at any brace inside a string.
 */
{
  /** The balanced block starting at the opening bracket at `open`. */
  const blockAt = (src, open) => {
    const pairs = { "{": "}", "(": ")", "[": "]" };
    const want = pairs[src[open]];
    if (!want) return null;
    let depth = 0;
    let quote = null;
    for (let i = open; i < src.length; i++) {
      const c = src[i];
      if (quote) {
        if (c === "\\") i++;
        else if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") {
        quote = c;
        continue;
      }
      if (c === "{" || c === "(" || c === "[") depth++;
      else if (c === "}" || c === ")" || c === "]") {
        depth--;
        if (depth === 0) return src.slice(open + 1, i);
      }
    }
    return null;
  };

  /** Top-level `key:` names inside one object body. */
  const topKeys = (body) => {
    const out = [];
    let depth = 0;
    let quote = null;
    let token = "";
    for (let i = 0; i < body.length; i++) {
      const c = body[i];
      if (quote) {
        if (c === "\\") i++;
        else if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") {
        quote = c;
        token = "";
        continue;
      }
      if (c === "{" || c === "(" || c === "[") {
        depth++;
        token = "";
        continue;
      }
      if (c === "}" || c === ")" || c === "]") {
        depth--;
        token = "";
        continue;
      }
      if (depth !== 0) continue;
      if (c === ":") {
        const name = token.trim();
        if (/^[A-Za-z_$][\w$]*$/.test(name)) out.push(name);
        token = "";
        continue;
      }
      if (c === "," || c === "\n") {
        token = "";
        continue;
      }
      token += c;
    }
    return out;
  };

  for (const f of files) {
    if (/\.test\.tsx?$/.test(f)) continue;
    const s = code(f);

    // Every `const NAME = z.object({` in this module, and its declared keys.
    const declared = new Map();
    for (const m of s.matchAll(/\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*z\s*\.object\s*\(/g)) {
      const open = s.indexOf("{", m.index + m[0].length - 1);
      if (open < 0) continue;
      const body = blockAt(s, open);
      if (body === null) continue;
      declared.set(m[1], topKeys(body));
    }
    if (declared.size === 0) continue;

    for (const m of s.matchAll(/\b([A-Za-z_$][\w$]*)\s*\.\s*(safeParse|parse)\s*\(/g)) {
      const keys = declared.get(m[1]);
      if (!keys || keys.length === 0) continue;

      // The argument must be an object LITERAL to be comparable.
      let i = m.index + m[0].length;
      while (i < s.length && /\s/.test(s[i])) i++;
      if (s[i] !== "{") continue;
      const body = blockAt(s, i);
      if (body === null) continue;

      const supplied = new Set(topKeys(body));
      const missing = keys.filter((k) => !supplied.has(k));
      if (missing.length === 0) continue;

      problems.push(
        `${rel(f)}: ${m[1]} declares ${missing.map((k) => `\`${k}\``).join(", ")} ` +
          `but the object passed to ${m[1]}.${m[2]}() never supplies ` +
          `${missing.length === 1 ? "it" : "them"}. An optional field missing ` +
          `from the parsed object is permanently undefined, so anything the ` +
          `request body spreads from it is never sent, and it typechecks. ` +
          `This is yuvoy-operator#60: the waiver an operator picked was ` +
          `dropped on the floor and every new listing was saved with no ` +
          `screener.`,
      );
    }
  }
}

/* --------------------------------------------------------------- report -- */

console.log(`\nroutes: ${[...routes].sort().join("  ")}\n`);
if (notes.length) {
  console.log("notes");
  for (const n of notes) console.log(`  · ${n}`);
  console.log("");
}
if (problems.length) {
  console.error(`✗ ${problems.length} QA problem(s)\n`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error("");
  process.exit(1);
}
console.log("✓ QA sweep clean\n");
