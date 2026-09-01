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
const UNAUTHENTICATED_ACTIONS = new Set([
  join("src", "app", "sign-in", "actions.ts"),
]);

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
