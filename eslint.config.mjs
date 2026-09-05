import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated from contracts/openapi.yaml. Never hand-edited, never linted.
    "src/lib/api/schema.gen.ts",
    ".claude/**",
    /*
      Test and tooling output. Every one of these is gitignored, regenerated
      and never read as source.

      This is not tidiness. Playwright only copies its trace-viewer bundle
      into playwright-report/ when a test FAILS, so the first failing e2e run
      dropped ~500 KB of minified vendor JS into the lint path and `pnpm lint`
      then failed with 264 errors in code nobody wrote — which reads as the
      change having broken the lint, long after the actual test was fixed.
    */
    "playwright-report/**",
    "test-results/**",
    "blob-report/**",
    "playwright/.cache/**",
    ".lighthouseci/**",
    ".memsearch/**",
  ]),
  {
    rules: {
      /*
        The two rules that exist because getting them wrong costs money or
        puts somebody on the wrong boat. Both are documented in
        docs/ERROR_MAP.md and Part 7 of the plan.
      */
      "no-restricted-syntax": [
        "error",
        {
          // A slot time rendered in the device's timezone is a missed boat.
          // Slots carry localDate / localStartTime already formatted for the
          // market; those are the only correct source.
          selector:
            "CallExpression[callee.property.name='toLocaleTimeString'], CallExpression[callee.property.name='toLocaleDateString'], CallExpression[callee.property.name='toLocaleString']",
          message:
            "Never format a slot time with toLocale*. Use slot.localDate / slot.localStartTime, or formatMarketTime() from @/lib/format/time.",
        },
        {
          /*
            localStorage is synchronous and the first place an XSS payload
            looks. This portal keeps nothing there that is worth stealing —
            the session is an httpOnly cookie the browser cannot read — and
            the ban exists so that stays true by construction rather than by
            everyone remembering.

            The message this rule inherited from yuvoy-app pointed at
            `@/lib/booking/token-store`, which does not exist here: there are
            no booking tokens in the operator portal. Corrected rather than
            left, because a rule that cites a module nobody can open is a rule
            people route around instead of reading.
          */
          selector:
            "MemberExpression[object.name='localStorage'], MemberExpression[object.object.name='window'][object.property.name='localStorage']",
          message:
            "Do not use localStorage. Nothing in this portal is worth putting somewhere synchronous and XSS-readable — the session is an httpOnly cookie. The one exception is src/lib/media/slot-store.ts; see its header, and scripts/qa.mjs, which keeps that exception from spreading.",
        },
      ],
    },
  },
  {
    /*
      The one exception, and it is narrow on purpose.

      `slot-store.ts` remembers WHICH FILE went into an upload slot — a name, a
      size and a modification time, for a file already on this device. It is
      not a credential and there is nothing in it an XSS payload could not read
      more directly off the file input.

      It is here because yuvoy-api#66 §3 made an upload survive a browser
      restart, and the page it comes back to has to be able to tell "carry on
      with your clip" from "that is somebody else's upload". Getting that wrong
      is a corrupt reel with a signed rights attestation on it — see
      `src/lib/media/slot.ts`. `sessionStorage` cannot do the job, because the
      tab dying is the case; IndexedDB could, at the cost of an async store for
      three scalars, and would be no less readable by the XSS this rule is
      about.

      What must NEVER go in it is the upload URL, which IS a credential: "do
      not persist it client-side either". That is not left to this comment —
      `scripts/qa.mjs` asserts both that this list has not grown and that
      nothing URL-shaped is written.
    */
    files: [
      "src/lib/media/slot-store.ts",
      "src/lib/media/slot-store.test.ts",
      "e2e/reels.spec.ts",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.property.name='toLocaleTimeString'], CallExpression[callee.property.name='toLocaleDateString'], CallExpression[callee.property.name='toLocaleString']",
          message:
            "Never format a slot time with toLocale*. Use slot.localDate / slot.localStartTime, or formatMarketTime() from @/lib/format/time.",
        },
      ],
    },
  },
]);

export default eslintConfig;
