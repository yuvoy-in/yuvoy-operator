/* Part of the QA sweep. scripts/qa.mjs imports this file, in its place in
   the order, and prints the report (yuvoy-operator#178). */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, problems, files, code, rel } from "./context.mjs";

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
    for (const m of s.matchAll(
      /\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*z\s*\.object\s*\(/g,
    )) {
      const open = s.indexOf("{", m.index + m[0].length - 1);
      if (open < 0) continue;
      const body = blockAt(s, open);
      if (body === null) continue;
      declared.set(m[1], topKeys(body));
    }
    if (declared.size === 0) continue;

    for (const m of s.matchAll(
      /\b([A-Za-z_$][\w$]*)\s*\.\s*(safeParse|parse)\s*\(/g,
    )) {
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

/* ------- a branched error code must be one the contract declares --------- */

/**
 * `err.code === "..."` against a code the pinned contract does not declare.
 *
 * This portal branches on error-code string literals and nothing checked any of
 * them (operator#64). `OperatorApiError.code` is a bare `string`, so there is no
 * mirror to go stale and nothing for the typechecker to narrow: a misspelled
 * literal is a branch that silently never runs, and the symptom is the generic
 * failure copy on a refusal that had a true sentence behind it.
 *
 * The sibling on the app side was worse, because there a mirror DID exist and
 * had fallen behind: three codes the API had started returning rendered as
 * "Something went wrong" with a retry that could never succeed (yuvoy-app#53).
 * Nothing here is wrong today. This is the guard that keeps it that way.
 *
 * ## One direction only, and that is the load-bearing part
 *
 * Contract to client is NOT checked. A code in the client that the contract no
 * longer declares is legitimate and sometimes required: the API stops
 * RETURNING a code long before the enum drops it, and this repo already keeps
 * such branches deliberately so exhaustive handling in a deployed client still
 * typechecks. Flagging those would train somebody to delete handling the portal
 * still needs.
 *
 * ## Why the enum and not the whole file
 *
 * The issue's own evidence grepped the contract for each code, which passes on
 * a code that appears only in PROSE. Several do. This parses the `enum:` under
 * the error envelope's `code`, so what is checked is a declaration.
 *
 * ## Two things the pattern has to exclude, both found while writing it
 *
 *   - **`typeof x === "string"`.** It matches `.code === "string"` in
 *     `errors.ts`'s own type guard, and `string` is not an error code.
 *   - **A field called `code` on something that is not an error.**
 *     `WITHDRAW_REASONS` entries carry one, and `people_in_it_objected` is a
 *     takedown reason from a different enum entirely. It lives in a test, which
 *     `files` already excludes, but the receiver is matched as `err.code` rather
 *     than any `.code` so that a future production use cannot be flagged as a
 *     bad error code.
 *
 * A whole-identifier match also matters: `-o` on `code === "…"` happily matches
 * the tail of `reasonCode === "…"`, which is how the issue's own list came to
 * carry a takedown reason among the error codes.
 */

{
  const contract = readFileSync(
    join(ROOT, "contracts/operator-openapi.yaml"),
    "utf8",
  );

  /*
    The enum under the error envelope's `code`. Anchored on the indentation the
    document uses for that property so a `code:` elsewhere cannot be picked up.
  */
  const anchor =
    "\n            code:\n              type: string\n              enum:\n";
  const at = contract.indexOf(anchor);

  if (at < 0) {
    problems.push(
      `contracts/operator-openapi.yaml: the error envelope's code enum was not ` +
        `found. The branched-code check cannot run, which means it is silently ` +
        `passing.`,
    );
  } else {
    const rest = contract.slice(at + 1);
    const end = rest.search(/\n {12}[a-z]/);
    const block = end < 0 ? rest : rest.slice(0, end);
    const declared = new Set(
      [...block.matchAll(/^\s+- ([a-z_]+)$/gm)].map((m) => m[1]),
    );

    if (declared.size < 20) {
      problems.push(
        `scripts/qa/07-schemas-and-errors.mjs: only ${declared.size} error codes parsed out of the ` +
          `contract. The enum has dozens, so the parse is broken and the ` +
          `branched-code check is passing over almost nothing.`,
      );
    }

    /*
      A CONTRACT GAP, not a client one (23 Sep 2026, yuvoy-api#226).

      `DELETE /slots/{id}/offline-sales/{saleId}` answers `409
      already_taken_back` when an entry was taken back once already. The code
      is named in that operation's prose and sent by the handler, and it is
      missing from the envelope's enum, which is all this check reads. The
      portal branches on it because the answer means "done, the seats are
      back", not "failed", and a retried tap whose first answer was lost must
      not be told it failed.

      Each entry names where the code is sent. The same rule as `PROSE_GAPS`:
      an entry the enum now declares FAILS the run, because from then on it
      only covers whatever is written under that name next.
    */
    /*
      Empty since 2 Oct 2026: yuvoy-api#240 (#243, 791892c) declared
      `already_taken_back` and `counter_sales_below_zero` in the enum, and this
      run failed on the entry until it was removed, as built. Kept, empty, for
      the next gap.
    */
    const UNDECLARED_CODES = new Map(/** @type {[string, string][]} */ ([]));
    for (const [gap, reason] of UNDECLARED_CODES) {
      if (!reason || reason.length < 40) {
        problems.push(
          `scripts/qa/07-schemas-and-errors.mjs: UNDECLARED_CODES entry "${gap}" has no real reason.`,
        );
      }
      if (declared.has(gap)) {
        problems.push(
          `scripts/qa/07-schemas-and-errors.mjs: the contract now declares "${gap}" in the error ` +
            `code enum, so its UNDECLARED_CODES entry is stale. Remove it.`,
        );
      }
    }

    for (const f of files) {
      if (/\.test\.tsx?$/.test(f)) continue;
      const s = code(f);
      /*
        `err.code`, with the whole identifier matched. Not any `.code`, and not
        a bare `code`: see the two exclusions above.
      */
      for (const m of s.matchAll(
        /(?<![A-Za-z0-9$_.])err\.code\s*===\s*"([a-z_]+)"/g,
      )) {
        if (!declared.has(m[1]) && !UNDECLARED_CODES.has(m[1])) {
          problems.push(
            `${rel(f)}: branches on error code "${m[1]}", which the pinned ` +
              `contract does not declare. A code the API never sends is a ` +
              `branch that never runs, and the traveller or operator gets the ` +
              `generic failure copy over a refusal that had a true sentence ` +
              `behind it (operator#64).`,
          );
        }
      }
    }
  }
}
