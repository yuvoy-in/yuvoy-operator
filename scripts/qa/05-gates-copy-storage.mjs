/* Part of the QA sweep. scripts/qa.mjs imports this file, in its place in
   the order, and prints the report (yuvoy-operator#178). */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { gateJustification } from "./04-owner-gates.mjs";
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

/* -------- 11c. the sign-in screen never claims a send, or a phone ------- */

/**
 * Copy on `/sign-in` that says a code was sent, or that it went to a phone.
 *
 * There are two ways a sign-in code reaches an operator: the email address on
 * the account, where every requested code goes since yuvoy-api 67e3213 while
 * there is no WhatsApp sender, and a Yuvoy staff member issuing one out of band
 * when there is no email or no phone (`yuvoy-api#59`). The session they produce
 * is deliberately indistinguishable (`POST /auth/session` never learns which
 * way the code came), and the agreed copy is true of both, **unconditionally**.
 *
 * Unconditional is the load-bearing half. A screen that says "we sent you a
 * code" only when it believes it did is a screen that has been told about one
 * code, and `POST /auth/otp` answers identically for a number we know and one
 * we do not, so it never is. What the screens DO say is where codes go, as a
 * rule true of every request, beside the button that makes one
 * (yuvoy-operator#91). So this refuses the two things that are not true:
 *
 *   - **A send asserted.** "We sent", "sent to": a claim about one code.
 *   - **A phone as the channel.** WhatsApp, SMS, a text, "messaging your
 *     phone". None of them delivers a code today. The last one is the defect
 *     #91 was raised for: "It takes you straight to the code without messaging
 *     your phone" passed this rule while telling every operator the other
 *     button messages their phone. Relax the phone half the day a phone sender
 *     exists, in the same change that says so on the screen.
 *
 * "Send me a code" is fine and is not matched — that is a request the operator
 * makes, not a claim about what happened. So is "We have not messaged you",
 * said only on the path where nothing was sent.
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
    /\bwe (sent|send|have sent|messaged|texted)\b|\bWhatsApp\b|\bSMS\b|\btext message\b|\bsent to\b|\bmessag(?:e|es|ed|ing) (?:your|their) phone\b|\bcodes? (?:to|on) (?:your|their) phone\b/i;

  for (const f of signIn) {
    const src = code(f);
    const hit = banned.exec(src);
    if (hit) {
      problems.push(
        `${rel(f)}: says "${hit[0]}" on the sign-in screen. A requested code ` +
          `goes to the email address on the account, a person at Yuvoy can ` +
          `issue one out of band, and this screen is never told which one an ` +
          `operator is holding, so its copy must be true of both, ` +
          `unconditionally, and must not promise a phone. See ` +
          `yuvoy-operator#91 and yuvoy-api#59.`,
      );
    }
  }
}

/* ------ 11d. access screens never promise a message nobody can carry ----- */

/**
 * Copy on the team, join and payout screens that says a message went to
 * somebody's phone.
 *
 * yuvoy-operator#91. There has never been a WhatsApp sender (yuvoy-api#68).
 * Since yuvoy-api 67e3213 a code or an invitation reaches a person only by
 * email, when we hold one, and the warnings that protect an account (a bank
 * change raised) are phone only by design and so reach nobody at all. The
 * screens said otherwise in eight places: "We message them a code", "A code on
 * somebody's phone", "Sent to" on a pending row, "The code we sent them", "we
 * will send you a fresh code", "We messaged the owner the moment it was
 * raised", "The owner is messaged immediately", and the payout step-up's "A
 * code goes to the owner's phone". Each told an owner something had been
 * delivered that had not, and the owner acted on it: waited, or did not pass
 * the link on.
 *
 * So these screens may say what an invitation IS and what the API says was
 * sent (`sent`, `note`), and may not assert a send on their own authority or
 * name a phone channel. Relax the phone half the day a phone sender exists,
 * in the same change that says so on the screen. `/sign-in` and `/signup` have
 * their own, stricter rule above (11c).
 */
{
  const surfaces = [
    ...walk(join(APP, "team")),
    ...walk(join(APP, "join")),
    ...walk(join(APP, "payouts")),
    join(SRC, "lib", "account", "bank.ts"),
    join(SRC, "lib", "account", "step-up.ts"),
  ].filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f));

  const promises = [
    /\bWhatsApp\b/i,
    /\bSMS\b/,
    /\btext message/i,
    /\bwe message\b/i,
    /(?<!not )\bmessaged (?:them|the owner|you)\b/i,
    /\bis messaged\b/i,
    /\b(?:code|digits) we sent\b/i,
    /\bwe(?:'ll| will) send you\b/i,
    /\bcode on (?:somebody|someone|their|your)\S*\s+phone\b/i,
    /\b(?:goes|go|went|sent) to (?:the owner|your|their)\S*\s+phone\b/i,
    /\bSent to\b/,
  ];

  for (const f of surfaces) {
    if (!existsSync(f)) continue;
    const src = code(f);
    for (const promise of promises) {
      const hit = promise.exec(src);
      if (hit) {
        problems.push(
          `${rel(f)}: says "${hit[0]}". Nothing reaches a phone today (there ` +
            `is no WhatsApp sender) and an invitation or code reaches anybody ` +
            `only by email, when we hold one. Say what the API reported ` +
            `(\`sent\`, \`note\`), never a send of our own. See ` +
            `yuvoy-operator#91.`,
        );
      }
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

/* ---- 13. the two localStorage exceptions stay two, and stay safe ------- */

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
 *
 * ## The second exception (owner ruling, 4 Oct 2026)
 *
 * `src/lib/site/offline-writes.ts` keeps the check-ins and cash an operator
 * records with no signal, so they survive the phone closing the app at the
 * jetty (operator experiment D). The owner chose that over losing them, on
 * the condition that it keeps opaque ids, amounts and times and nothing a
 * person could be found or signed in by. So its code may not declare a name,
 * a reference, a phone, an email, a token or a URL.
 */
const STORE = join(SRC, "lib/media/slot-store.ts");
const ALLOWED_LOCALSTORAGE = new Set([
  "src/lib/media/slot-store.ts",
  "src/lib/media/slot-store.test.ts",
  "src/lib/site/offline-writes.ts",
  "src/lib/site/offline-writes.test.ts",
  "e2e/reels.spec.ts",
  // Seeds one kept check-in so /check-in re-reads (yuvoy-operator#175).
  "e2e/check-in.spec.ts",
]);
const OFFLINE_WRITES = join(SRC, "lib/site/offline-writes.ts");

for (const f of files) {
  if (!/\blocalStorage\b/.test(code(f))) continue;
  if (ALLOWED_LOCALSTORAGE.has(rel(f))) continue;
  problems.push(
    `${rel(f)}: uses localStorage. It is banned in this portal — the session ` +
      `is an httpOnly cookie precisely so nothing worth stealing is anywhere ` +
      `a script can read. The exceptions are src/lib/media/slot-store.ts and ` +
      `src/lib/site/offline-writes.ts.`,
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
          `scripts/qa/05-gates-copy-storage.mjs does not know about it. Widening that exception is ` +
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

if (existsSync(OFFLINE_WRITES)) {
  const kept = code(OFFLINE_WRITES);
  for (const [pattern, what] of [
    // Fields, not words: the strip's own sentences say "this phone".
    [/\bname\s*[?]?:/, "a `name` field"],
    [/\breference\w*\s*[?]?:/i, "a `reference` field"],
    [/\bphone\w*\s*[?]?:/i, "a phone field"],
    [/\bemail\w*\s*[?]?:/i, "an email field"],
    [/\btoken\w*\s*[?]?:/i, "a token field"],
    [/https?:\/\//, "an absolute URL"],
  ]) {
    if (pattern.test(kept)) {
      problems.push(
        `src/lib/site/offline-writes.ts mentions ${what}. What it keeps on the ` +
          `phone is opaque ids, amounts and times and nothing else (owner ` +
          `ruling, 4 Oct 2026): the screens supply names, and nothing kept ` +
          `there may find or sign in a person.`,
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
