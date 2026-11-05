/* Part of the QA sweep. scripts/qa.mjs imports this file, in its place in
   the order, and prints the report (yuvoy-operator#178). */
import { join } from "node:path";
import { ROOT, APP, problems, walk, files, code, rel } from "./context.mjs";

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
