/* Part of the QA sweep. scripts/qa.mjs imports this file, in its place in
   the order, and prints the report (yuvoy-operator#178). */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { vendorProblems } from "../vendor-maplibre.mjs";
import { ROOT, problems, walk, files, code, rel } from "./context.mjs";

/* ------- 17. the API's words reach a screen without a long dash --------- */

/**
 * The copy rule (no em dash, en dash or horizontal bar in anything an operator
 * reads) cannot reach another team's database, so the API's own sentences are
 * stripped where they enter (`lib/format/dedash.ts`). The audit before release
 * (O10) found a dozen Server Actions handing `err.message` to the screen
 * untouched, and two handing back a success `note` the same way.
 *
 * Refusals are stripped in ONE place now: `apiError` builds every
 * `OperatorApiError` from an API envelope. So:
 *
 *   - `new OperatorApiError(` appears only in `lib/api/errors.ts` and, for the
 *     non-envelope fallback whose words are ours, `lib/api/server-client.ts`;
 *   - nothing reads `body.error.message` except `lib/api/errors.ts`;
 *   - no action returns an API `note` raw (`note: data.note`): it goes through
 *     `dedash`, `dedashText` or `sentence` on the way out.
 */
{
  const BUILDS_ERRORS = new Set([
    join("src", "lib", "api", "errors.ts"),
    join("src", "lib", "api", "server-client.ts"),
  ]);
  for (const f of files) {
    if (/\.test\.tsx?$/.test(f)) continue;
    const s = code(f);
    if (/new OperatorApiError\(/.test(s) && !BUILDS_ERRORS.has(rel(f))) {
      problems.push(
        `${rel(f)}: builds an OperatorApiError itself. Use apiError() in ` +
          `lib/api/errors.ts, which strips the API's long dashes (O10).`,
      );
    }
    if (
      /body\.error\.message/.test(s) &&
      rel(f) !== join("src", "lib", "api", "errors.ts")
    ) {
      problems.push(
        `${rel(f)}: reads the API's refusal text directly. Go through ` +
          `apiError() so it reaches the screen without a long dash (O10).`,
      );
    }
    if (/\bnote:\s*data\.note\s*[,}\n)]/.test(s)) {
      problems.push(
        `${rel(f)}: returns the API's note raw. Pass it through dedash, ` +
          `dedashText or sentence: its long dashes reach the screen (O10).`,
      );
    }
  }
}

/* ------------------------------------------------------ vendored map -- */

/*
  MapLibre's worker, committed under public/vendor/maplibre (yuvoy-operator
  #113). It has to be the worker the installed maplibre-gl ships: a stale copy
  talks to a newer main thread and the map breaks in production with nothing
  failing here. See scripts/vendor-maplibre.mjs.
*/
for (const p of vendorProblems()) problems.push(p);

/* ------- a field changed before the page hydrated reaches its state ----- */

/*
  A form the server draws is on screen for seconds before its script on a
  slow link, and React keeps what was typed, ticked or picked in that time
  without telling the component, whose state still holds what the server
  drew. The stability pass's stress run found it on sign-in (6 Oct 2026): ten
  digits over a disabled "Send me a code". `useChangedBeforeHydration` (in
  src/components/ui) hands those changes over.

  So a field whose changes feed state (an `onChange`) sits in a component
  that calls it, or in one the server never draws: opened by a tap, or a
  later step of a flow. Those are listed with the reason, so a new one is a
  decision rather than an accident, and a listed one that starts calling it
  comes off the list.

  A textarea is worse off: React writes the server's text back over what was
  typed into it as it hydrates, before any of this can look, so a rewritten
  About went back to the old words. Every textarea is the `Textarea` in
  src/components/ui, which keeps what was typed; a bare one is refused.
*/
{
  const DRAWN_AFTER_A_TAP = new Map([
    ["src/app/bookings/cash-collect.tsx", "the amount opens with Took less"],
    ["src/app/calendar/departure-form.tsx", "opened by Add departures"],
    [
      "src/app/check-in/check-in-screen.tsx",
      "the server draws Reading the link; the code box comes after the fragment is read",
    ],
    [
      "src/app/join/[token]/join-token-form.tsx",
      "the code step, after the number is sent",
    ],
    ["src/app/team/access-controls.tsx", "opened by Change role"],
    ["src/app/today/(root)/message-card.tsx", "the reply box opens on Reply"],
    ["src/app/today/[slotId]/relay-panel.tsx", "opened by a tap"],
    [
      "src/app/today/listing/[id]/departure-row.tsx",
      "opened by Manage on a departure",
    ],
    ["src/components/media/attach-form.tsx", "inside a reel's sheet"],
    ["src/components/media/rights-form.tsx", "the step after an upload"],
    ["src/components/requests/request-card.tsx", "the reasons open on Decline"],
  ]);

  /**
   * The open tag starting at `<`, brace-aware: a prop routinely holds a bare
   * `>` (every arrow function does), which a `[^>]*` pattern stops at.
   */
  const openTag = (src, from) => {
    let depth = 0;
    for (let i = from; i < src.length; i++) {
      const c = src[i];
      if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === '"' || c === "'" || c === "`") {
        const quote = c;
        i++;
        while (i < src.length && src[i] !== quote) {
          if (src[i] === "\\") i++;
          i++;
        }
      } else if (c === ">" && depth === 0) {
        return src.slice(from, i + 1);
      }
    }
    return src.slice(from);
  };

  for (const f of files) {
    if (!f.endsWith(".tsx") || /\.test\.tsx$/.test(f)) continue;
    const s = code(f);
    const r = rel(f);
    if (r !== "src/components/ui/textarea.tsx" && /<textarea\b/.test(s)) {
      problems.push(
        `${r}: a bare <textarea>. React writes the server's text back over ` +
          `what was typed into one before the page hydrated. Use Textarea ` +
          `from src/components/ui/textarea.tsx.`,
      );
    }
    const fields = [...s.matchAll(/<(input|textarea|Textarea|select)\b/g)]
      .map((m) => openTag(s, m.index))
      .filter((tag) => /\sonChange=/.test(tag))
      .filter((tag) => !/\stype="(hidden|file)"/.test(tag));
    if (fields.length === 0) continue;
    const hands = /\buseChangedBeforeHydration\(/.test(s);
    if (hands && DRAWN_AFTER_A_TAP.has(r)) {
      problems.push(
        `${r}: calls useChangedBeforeHydration and is still listed as drawn ` +
          `after a tap. Take it off DRAWN_AFTER_A_TAP.`,
      );
    } else if (!hands && !DRAWN_AFTER_A_TAP.has(r)) {
      const named = fields
        .map((tag) => /\sid=(?:"([^"]+)"|\{([^}]+)\})/.exec(tag))
        .map((m) => (m ? (m[1] ?? m[2]) : "a field"));
      problems.push(
        `${r}: ${named.join(", ")} feed state, and a change made before the ` +
          `page hydrated would be kept on screen and lost to the state. Call ` +
          `useChangedBeforeHydration, or, if the server never draws it, add ` +
          `it to DRAWN_AFTER_A_TAP with why.`,
      );
    }
  }
  for (const r of DRAWN_AFTER_A_TAP.keys()) {
    if (!existsSync(join(ROOT, r))) {
      problems.push(`qa.mjs: DRAWN_AFTER_A_TAP lists ${r}, which is gone`);
    }
  }
}

/* ------------------------------------------------ nothing to message -- */

/*
  "Message us" in anything an operator reads (yuvoy-operator#117 item 3). The
  portal has no message channel to Yuvoy: support is a phone call, and the
  support WhatsApp is not set in production. Six screens still said it, each
  a promise of a conversation nobody could start. Say the number instead
  (`SUPPORT_PHONE` in src/lib/site/contact.ts). Comments are stripped first,
  so the reason can still be written down; when a message channel exists,
  delete this check.
*/
for (const f of files) {
  if (/\.test\.tsx?$/.test(f)) continue;
  if (/\bmessage us\b/i.test(code(f))) {
    problems.push(
      `${rel(f)}: says "message us", and there is no message channel to us. ` +
        `Give the support number (SUPPORT_PHONE) or a link to Help.`,
    );
  }
}

/* ------------ an accessibility check waits out the motion ------------- */

/*
  axe reads colours as they are drawn at that instant, so a check that runs
  while a sheet fades in reads its text at a fraction of its contrast. The
  cancel form failed on and off that way, a different colour on every attempt
  of the same text (yuvoy-operator#160). `expectAccessible` in e2e/axe.ts
  waits the page's motion out before it reads, so axe is imported there and
  nowhere else in e2e/: a spec that builds its own check skips the wait.
*/
const AXE_CHECK = join("e2e", "axe.ts");
for (const f of walk(join(ROOT, "e2e"))) {
  if (!/\.[cm]?[jt]sx?$/.test(f) || rel(f) === AXE_CHECK) continue;
  if (/["'](?:@axe-core\/playwright|axe-core)(?:\/[^"']*)?["']/.test(code(f))) {
    problems.push(
      `${rel(f)}: runs axe itself, so it can read a screen mid-fade. ` +
        `Use expectAccessible from ${AXE_CHECK}, which waits the motion out.`,
    );
  }
}

/* ------------- the e2e server's mock media host is its own ------------ */

/*
  The mock media host listened on 3201 whatever else did, and shrugged when
  it could not. On a machine where another process held that port, every
  upload the e2e server minted went to that process, and four upload walks
  failed at four unrelated-looking lines, blocking every push from it
  (yuvoy-operator#163). The run now takes a free port, and `MOCK_TUS_STRICT`
  stops the e2e server when it still cannot have it. Both come from
  `mockMediaHostEnv` in playwright.config.ts; without the flag a lost port is
  silent again, and nothing else would notice it had gone.
*/
const PW_CONFIG = join(ROOT, "playwright.config.ts");
if (existsSync(PW_CONFIG)) {
  const config = code(PW_CONFIG);
  if (
    !/MOCK_TUS_STRICT:\s*"1"/.test(config) ||
    !/\.\.\.mockMediaHostEnv\(\)/.test(config)
  ) {
    problems.push(
      `playwright.config.ts: the e2e web server must take its env from ` +
        `mockMediaHostEnv(), with MOCK_TUS_STRICT: "1". Without it, a mock ` +
        `media host that lost its port fails the upload walks with no word ` +
        `about the port (yuvoy-operator#163).`,
    );
  }
}
