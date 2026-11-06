/* Part of the QA sweep. scripts/qa.mjs imports this file, in its place in
   the order, and prints the report (yuvoy-operator#178). */
import { statSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  ROOT,
  SRC,
  APP,
  problems,
  walk,
  files,
  code,
  rel,
} from "./context.mjs";

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

/*
  Request headers, never a cookie (yuvoy-api#282 item 3). These read the
  incoming request's headers and take nothing else from next/headers, which
  is checked by name below: `headers()` is read only, so it cannot strand
  anybody the way a cookie write from render does, and `cookies` stays in the
  two modules above.
*/
const REQUEST_HEADER_READERS = new Map([
  [
    join("src", "lib", "api", "visitor.ts"),
    "Reads Vercel's x-real-ip so the API's per-IP limits count the person, not Vercel.",
  ],
  [
    join("src", "lib", "site", "visitor-platform.ts"),
    "Reads User-Agent so the claim page hands an iPhone or an Android phone to Yuvoy Host (yuvoy-operator#171).",
  ],
]);

for (const [name, entries] of [
  ["HEADERS_IMPORTERS", HEADERS_IMPORTERS],
  ["REQUEST_HEADER_READERS", REQUEST_HEADER_READERS],
]) {
  for (const [path, reason] of entries) {
    if (!reason || reason.length < 40) {
      problems.push(
        `scripts/qa.mjs: ${name} entry "${path}" has no real reason.`,
      );
    }
    if (!existsSync(join(ROOT, path))) {
      problems.push(
        `scripts/qa.mjs: ${name} names "${path}", which does not exist`,
      );
    }
  }
}

/**
 * The names a module takes from `next/headers`. A namespace, a default
 * import, a re-export or a dynamic import counts as `*`: anything at all.
 */
function namesFromNextHeaders(file) {
  const s = code(file);
  const names = [];
  for (const m of s.matchAll(
    /\b(import|export)\s+([^;]*?)\s*from\s*["']next\/headers["']/g,
  )) {
    const clause = m[2].replace(/^type\s+/, "");
    const named = /\{([^}]*)\}/.exec(clause);
    if (
      m[1] === "export" ||
      clause
        .replace(/\{[^}]*\}/, "")
        .replace(/,/g, "")
        .trim()
    ) {
      names.push("*");
    }
    if (named) {
      for (const part of named[1].split(",")) {
        const imported = part
          .trim()
          .replace(/^type\s+/, "")
          .split(/\s+as\s+/)[0];
        if (imported) names.push(imported);
      }
    }
  }
  if (/import\s*\(\s*["']next\/headers["']\s*\)/.test(s)) names.push("*");
  return names;
}

const WRITES_MODULE = join("src", "lib", "auth", "session-writes.ts");

for (const f of files) {
  if (/\.test\.tsx?$/.test(f)) continue;
  const specs = importsOf(f);

  if (specs.includes("next/headers") && !HEADERS_IMPORTERS.has(rel(f))) {
    const taken = namesFromNextHeaders(f);
    if (!REQUEST_HEADER_READERS.has(rel(f))) {
      problems.push(
        `${rel(f)}: imports next/headers. Cookie access lives in ` +
          `src/lib/auth/session.ts (read) and session-writes.ts (write) only — ` +
          `a write reachable from render throws and strands the operator.`,
      );
    } else if (taken.length === 0 || taken.some((n) => n !== "headers")) {
      problems.push(
        `${rel(f)}: takes ${taken.join(", ") || "something"} from ` +
          `next/headers. It may read request headers only; cookie access ` +
          `lives in src/lib/auth/session.ts (read) and session-writes.ts ` +
          `(write) only.`,
      );
    }
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

export { importsOf, resolveImport };
