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
  if (!/[/\\]route\.tsx?$/.test(f)) continue;
  if (ALLOWED_ROUTE_HANDLERS.has(rel(f))) continue;
  problems.push(
    `${rel(f)}: a route handler. This portal has no browser-callable API by ` +
      `design — reads are server renders, writes are Server Actions. If this ` +
      `one is genuinely needed, add it to ALLOWED_ROUTE_HANDLERS in ` +
      `scripts/qa.mjs with the reason.`,
  );
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

for (const f of files) {
  if (!isServerAction(f)) continue;
  if (UNAUTHENTICATED_ACTIONS.has(rel(f))) continue;
  const s = code(f);
  if (!/requireOperator\(/.test(s)) {
    problems.push(
      `${rel(f)}: a Server Action module that never calls requireOperator(). ` +
        `An action is a public POST endpoint — Next checks the origin, not ` +
        `who is asking.`,
    );
  }
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
for (const f of files) {
  if (/\.test\.tsx?$/.test(f)) continue;
  const s = code(f);
  for (const m of s.matchAll(
    /\b(?:contact|party|booking|traveller)\??\.(whatsapp|phone|mobile|msisdn)\b/gi,
  )) {
    problems.push(
      `${rel(f)}: reads "${m[0]}" — a traveller's number never appears in ` +
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
const OWNER_ONLY = [];
{
  const lines = readFileSync(
    join(ROOT, "contracts", "operator-openapi.yaml"),
    "utf8",
  ).split("\n");

  let path = null;
  let method = null;
  for (let i = 0; i < lines.length; i++) {
    const p = lines[i].match(/^ {2}(\/\S*):\s*$/);
    if (p) {
      path = p[1];
      method = null;
      continue;
    }
    const m = lines[i].match(/^ {4}(get|post|put|patch|delete):\s*$/);
    if (m) {
      method = m[1];
      continue;
    }
    if (!/^ {8}"403":/.test(lines[i]) || !path || !method) continue;

    // Collect the 403's own description block, stopping at the next status,
    // the next method or the next path.
    let block = lines[i];
    for (let j = i + 1; j < lines.length; j++) {
      if (/^ {8}"\d{3}":/.test(lines[j])) break;
      if (/^ {4}[a-z]+:\s*$/.test(lines[j])) break;
      if (/^ {2}\/\S*:\s*$/.test(lines[j])) break;
      block += "\n" + lines[j];
    }
    // The contract writes role names in capitals. A 403 that names OWNER is a
    // 403 a MANAGER also receives.
    if (/\bOWNER\b/.test(block)) {
      OWNER_ONLY.push({ method: method.toUpperCase(), path });
    }
  }
}

if (OWNER_ONLY.length === 0) {
  /*
    A check that silently verified nothing would pass forever while saying
    nothing true — the same failure the contract drift checker avoids by
    reading its path from PINNED rather than assuming it.
  */
  problems.push(
    `scripts/qa.mjs: found no OWNER-only endpoints in the contract. The ` +
      `parse has broken, and this check is now asserting nothing.`,
  );
}

/** The route family a file belongs to — `src/app/payouts`, not one file. */
function segmentOf(file) {
  const r = relative(APP, file);
  if (r.startsWith("..")) return file;
  const first = r.split(/[/\\]/)[0];
  return first.endsWith(".tsx") ? APP : join(APP, first);
}

const ownerSegments = new Map();
for (const f of files) {
  const s = code(f);
  for (const { method, path } of OWNER_ONLY) {
    if (!s.includes(`${method}("${path}"`)) continue;
    const seg = segmentOf(f);
    if (!ownerSegments.has(seg)) ownerSegments.set(seg, []);
    ownerSegments.get(seg).push(`${method} ${path}`);
  }
}

for (const [seg, endpoints] of ownerSegments) {
  const inSegment = files.filter(
    (f) => f === seg || f.startsWith(seg + "/") || f.startsWith(seg + "\\"),
  );
  const named = endpoints.join(", ");

  for (const f of inSegment) {
    if (/\bcanManage\b/.test(code(f))) {
      problems.push(
        `${rel(f)}: uses \`canManage\` in a route that calls ${named}, which ` +
          `the contract marks OWNER only. \`canManage\` is OWNER **or** ` +
          `MANAGER — gate on \`roles.includes("OWNER")\`.`,
      );
    }
  }

  if (!inSegment.some((f) => /"OWNER"|'OWNER'/.test(code(f)))) {
    problems.push(
      `${rel(seg)}: calls ${named} (OWNER only in the contract) but nothing ` +
        `in this route checks for the OWNER role. The server will refuse it ` +
        `with a 403 the operator has to read after the fact.`,
    );
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
