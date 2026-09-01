# yuvoy-operator

The portal an operator uses to run their business on Yuvoy — `operators.yuvoy.in`.

Different user, different device, different mood from the traveller app. The person
using this is **standing on a jetty at 6am, on a phone, in bright sun, possibly with
wet hands, on one bar of signal.** Everything here works in that context or it does
not work.

---

## The architecture, and why it is not negotiable

**`/operator/v1` refuses CORS by design.** `yuvoy-api` applies CORS to the public API
only and skips it for `/operator/`, `/admin/`, `/hooks/` and `/ops/`, with the
reasoning written into the server: operator surfaces are _"reached by their own apps
through a same-origin server proxy … an admin API that answers CORS is an admin API
any page on the internet can attempt to call with the user's cookies."_

So a browser preflight from this origin is **designed to fail**. This portal is built
to fit that rather than to defeat it:

|                    | How                                                                  |
| ------------------ | -------------------------------------------------------------------- |
| **Reads**          | Server components. The data is in the HTML on first paint.           |
| **Writes**         | Server Actions. One action, one thing, authorised server-side.       |
| **The session**    | An opaque token in an **httpOnly** cookie. JavaScript never sees it. |
| **The API client** | `src/lib/api/server-client.ts`, `import "server-only"`.              |
| **A proxy route**  | **There is none, and `pnpm qa` fails one being added.**              |

That last row is the load-bearing one. A generic `/api/operator/[...path]` with the
session attached hands the browser back exactly the surface the CORS refusal removed,
on our own origin, where SameSite does not help. The absence of that file _is_ the
security model.

What it buys: an XSS on this origin cannot steal a session it cannot read. That is a
materially better posture than the traveller app gets, and the reason there is no
client-side data layer in this repo at all.

## The rule underneath every screen (O12)

**No traveller phone number appears anywhere in this portal.** Not on the manifest,
not on a booking, not in an export. `OperatorBooking.contact` carries the name and
only the name — `whatsapp` was there and was removed deliberately.

A traveller gives us a number so we can tell them about their booking, not so it can
be added to an operator's contacts. To **identify** somebody at the jetty, use
`reference`. To **reach** them, use the relay.

`pnpm qa` fails a component that reads `.phone`, `.whatsapp`, `.mobile` or `.msisdn`
off a party or a booking. The API does not return one today; this is what stops a
well-meaning commit from showing one the day it does.

## Built so far

|                | Screen                                                                        | State       |
| -------------- | ----------------------------------------------------------------------------- | ----------- |
| **O2**         | Operator signs in — phone, code, session                                      | **Built**   |
| **O10**        | The day, and today's manifest                                                 | **Built**   |
| O1, O3–O9, O11 | Signup, approval, payouts, team, profile, listings, reels, capacity, earnings | Not started |

O10 first because the brief says so: _"If you build one screen well, build the
manifest."_ It is the screen an operator opens at 6am.

### What O10 does, and the rules baked into it

- **Live holds are shown, and shown differently.** A party mid-checkout at 08:40 may
  walk up at 08:55, and a manifest that omits them sends the operator into an argument
  they cannot win. They have no `bookingId`, so they have no attendance buttons.
- **`arrived` is idempotent.** A second tap on a wet phone is not an error somebody has
  to read while eleven people wait.
- **Terminal outcomes appear only after the departure has set off.** The API refuses
  them before then (`409 departure_has_not_started`); offering a button that will be
  refused is how an operator learns to distrust the screen.
- **Totals come from the server**, computed there so three clients cannot disagree
  about them on a dock. `seatsSold` and `seatsSoldOffline` answer different questions
  and are never added together into one number.
- **404 and 403 are one case.** A row belonging to another operator answers 404, never
  403, because a 403 confirms the row exists. The client does not distinguish them
  either.
- **Every target is 56px**, not the traveller app's 44px. A wet fingertip spreads.

## Run it

```bash
pnpm install
pnpm dev                 # http://localhost:3200, everything mocked
```

Sign in with any phone number in E.164 (`+919000000101`). The mocked
`POST /auth/otp` returns a `devCode` — the real API does too, outside production —
and the sign-in screen shows it in a mocked build. The code is `424242`.

Three departures are fixtured for _today_, not for a fixed date: one that has already
left (so the terminal outcomes are reachable), one that has not, and one called off.

## Verify

```bash
pnpm verify          # the pre-push gate — all nine steps below, in order
pnpm qa              # the static sweep on its own
pnpm tokens:check    # design tokens against yuvoy-app (canonical)
pnpm test:e2e        # 28 e2e tests, incl. axe on every route
```

```
typecheck · lint · format · qa · tokens · test · contract:check · build · e2e
```

**`pnpm qa` guards four things the compiler cannot**, and all four are ways the
architecture above quietly stops being the architecture:

1. **A route handler under `src/app`** — see the proxy note. There is no allowlist
   entry today.
2. **The client graph reaching the API client or the session.** `server-only` fails the
   build too; this names the import chain instead of erroring three layers down.
3. **A Server Action that never calls `requireOperator()`.** An action is a public POST
   endpoint with a generated name — Next checks the origin, not who is asking.
4. **A traveller phone number** anywhere (O12, above).

Each was verified by breaking it on purpose and watching the check fail.

## The contract

`contracts/operator-openapi.yaml` is a **byte-exact mirror** of `yuvoy-api`, pinned by
commit SHA in `contracts/PINNED` — the **operator** document, which is a different file
from the traveller API's `contracts/openapi.yaml`. The path is read from `PINNED`
rather than assumed, because a drift check that silently verified the wrong document
would pass forever while saying nothing true.

Pinned to the same commit `yuvoy-app` is pinned to, so the two frontends cannot be
reasoning about different versions of the same backend.

When it moves: re-pull, `pnpm codegen`, commit both.

## Design tokens

Copied from `yuvoy-app`, which is canonical (D-101). **This repo is the third
consumer, and D-101 names exactly this moment as when `yuvoy-kit` should be
extracted.** It has not been — that is a recorded debt, not an oversight.

`pnpm tokens:check` diffs the `@theme` block against `../yuvoy-app` byte for byte and
fails on any divergence. It warns rather than fails when that checkout is absent, so
CI does not block on a repo it did not clone.

## Deployment

Its own Vercel project on its own origin (D-102). `main` deploys; nothing else does.
Needs `VERCEL_TOKEN`, `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` as repo secrets, and
`OPERATOR_API_URL` in the Vercel project.

`OPERATOR_API_URL` is deliberately **not** `NEXT_PUBLIC_`: nothing here talks to the
API from a browser, so the value has no business being inlined into client JavaScript,
and keeping it server-only means a leaked bundle does not name the admin origin.

## Blocked

**Operator sign-in in production needs the Meta WhatsApp account** — that is how the
code is delivered. The flow is built and exercised end to end against mocks; it cannot
be exercised against the real API until the account exists. That is a commercial
dependency tracked on `yuvoy-api#52`, not a frontend one.
