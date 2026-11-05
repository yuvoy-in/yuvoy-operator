/* Part of the QA sweep. scripts/qa.mjs imports this file, in its place in
   the order, and prints the report (yuvoy-operator#178). */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ROOT, SRC, problems, files, code, rel } from "./context.mjs";

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
  /*
    THE BUILDER, not a create form. `new-listing-form.tsx` was one screen and is
    gone (yuvoy-operator#58 item 7); the fields it asked for are spread across
    the builder's steps, so the set to compare is their union. Repointed rather
    than dropped: the guard is gated on `existsSync`, so leaving it aimed at a
    deleted file would have made it pass by never running.
  */
  const builderSteps = [
    join(SRC, "app/account/listings/steps/basics.tsx"),
    join(SRC, "app/account/listings/steps/selling.tsx"),
    join(SRC, "app/account/listings/steps/location.tsx"),
  ];
  const editForm = join(SRC, "components/listings/listing-row.tsx");

  /* Blocker keys that are deliberately not editable, and why. */
  const CREATE_ONLY = new Set(["category", "destination"]);
  /* Wire spelling → the form control's name, where they differ. */
  const CONTROL_NAME = { unitPricePaise: "unitPrice" };

  if ([listings, editForm, ...builderSteps].every((f) => existsSync(f))) {
    const block = /BLOCKER_LABELS[^{]*\{([\s\S]*?)\n\};/.exec(code(listings));
    const names = (f) =>
      new Set([...code(f).matchAll(/name="([\w-]+)"/g)].map((m) => m[1]));
    if (block) {
      const onCreate = new Set(builderSteps.flatMap((f) => [...names(f)]));
      const onEdit = names(editForm);
      for (const m of block[1].matchAll(/^\s*(\w+):/gm)) {
        const key = m[1];
        if (CREATE_ONLY.has(key)) continue;
        const control = CONTROL_NAME[key] ?? key;
        if (onCreate.has(control) && !onEdit.has(control)) {
          problems.push(
            `src/components/listings/listing-row.tsx: \`${key}\` blocks ` +
              `publication and is settable in the builder (as ` +
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
