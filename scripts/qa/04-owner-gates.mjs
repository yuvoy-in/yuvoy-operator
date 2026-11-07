/* Part of the QA sweep. scripts/qa.mjs imports this file, in its place in
   the order, and prints the report (yuvoy-operator#178). */
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { importsOf, resolveImport } from "./02-session-boundary.mjs";
import { ROOT, APP, problems, walk, files, code, rel } from "./context.mjs";

/* ------- 11. an OWNER-only endpoint is never gated on `canManage` -------- */

/**
 * `canManage` is **OWNER, ADMIN or MANAGER**. Four endpoints are OWNER *only*.
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
 *   - **`canManage`** (OWNER, ADMIN or MANAGER) — an operation that says
 *     "Requires OWNER, ADMIN or MANAGER", or the older "Requires OWNER or
 *     MANAGER" and "OWNER or MANAGER only", or whose 403 says "STAFF
 *     cannot …". The older spellings are still matched on purpose: they are
 *     what the contract said, and a parser that forgot them would silently
 *     re-bucket an endpoint the day one reappeared.
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
/**
 * Segments that decide on `canManage` for who may READ the screen, while the
 * OWNER-only write on it is gated on OWNER (the OWNER check below still
 * applies to them). Each entry says why; one without a reason fails.
 */
const READ_GATED_ON_MANAGE = new Map([
  [
    join("src", "app", "payouts"),
    "Payout details is a Money screen, OWNER, ADMIN or MANAGER to read (#96, " +
      "the audit before release M9); raising a bank change is gated on OWNER " +
      "(isOwner) and stopping one on canManageAccess.",
  ],
]);
for (const [segment, reason] of READ_GATED_ON_MANAGE) {
  if (!reason || reason.trim().length < 20) {
    problems.push(
      `scripts/qa/04-owner-gates.mjs: READ_GATED_ON_MANAGE entry "${segment}" has no real reason.`,
    );
  }
}
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

  /*
    THE SAME GAP AGAIN, on 22 Sep 2026 (yuvoy-operator#89).

    The logo and the business details are OWNER, ADMIN or MANAGER in the API
    and silent in the contract's prose, so the logo screen refusing a staff
    login before the upload read as a permission this build invented. Each
    entry names where the rule is enforced. The contract fix is asked for on
    yuvoy-api#222.

    Unlike the first map, an entry the parse now finds by itself FAILS the
    run: the contract caught up, and the exemption is from then on only a
    cover for whatever is written at that path next.
  */
  /*
    Empty since 24 Sep 2026: yuvoy-api#222 (#238, ab8fd46) wrote the roles on
    all three down, "OWNER, ADMIN or MANAGER only.", and this run failed on
    each entry until it was removed, as built. Kept, empty, for the next gap.
  */
  const PROSE_GAPS = new Map(/** @type {[string, string][]} */ ([]));
  for (const [operation, reason] of PROSE_GAPS) {
    const [gapMethod, gapPath] = operation.split(" ");
    if (!reason || reason.length < 40) {
      problems.push(
        `scripts/qa/04-owner-gates.mjs: PROSE_GAPS entry "${operation}" has no real reason.`,
      );
    }
    if (!lines.includes(`  ${gapPath}:`)) {
      problems.push(
        `scripts/qa/04-owner-gates.mjs: PROSE_GAPS names ${operation}, which the contract no ` +
          `longer has. A stale entry covers whatever is written at that path next.`,
      );
      continue;
    }
    if (
      NEEDS_MANAGE.some((e) => e.method === gapMethod && e.path === gapPath)
    ) {
      problems.push(
        `scripts/qa/04-owner-gates.mjs: the contract now names the roles on ${operation}, so ` +
          `its PROSE_GAPS entry is stale. Remove it.`,
      );
      continue;
    }
    NEEDS_MANAGE.push({ method: gapMethod, path: gapPath });
  }
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
      `scripts/qa/04-owner-gates.mjs: the contract parse found ${bucket.length} ${name} ` +
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
    `scripts/qa/04-owner-gates.mjs: the contract parse found ${OWNER_ONLY.length} OWNER-only ` +
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
    if (gatesOnManage && !READ_GATED_ON_MANAGE.has(rel(segment))) {
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
      `${rel(segment)}: reaches ${manageCalls.join(", ")} (OWNER, ADMIN or ` +
        `MANAGER in ` +
        `the contract) but nothing in this route checks \`canManage\`. A staff ` +
        `login meets a 403 it cannot act on — and if the read itself is ` +
        `refused, an error boundary saying "try again" about a refusal that ` +
        `will never succeed.`,
    );
  }
}

export { gateJustification };
