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

|         | Screen                                   | State                                                                  |
| ------- | ---------------------------------------- | ---------------------------------------------------------------------- |
| **O2**  | Operator signs in — phone, code, session | **Built**                                                              |
| **O3**  | Getting approved                         | **Half built** — the contract cannot answer the other half, below      |
| **O4**  | Payout details                           | **Built**                                                              |
| **O5**  | Team access, and accepting an invitation | **Built**                                                              |
| **O9**  | Seat requests and capacity               | **Built**                                                              |
| **O10** | The day, and today's manifest            | **Built**                                                              |
| **O11** | Earnings                                 | **Built**                                                              |
| **O8**  | Upload a reel                            | **Built** — minus what the contract cannot serve, below                |
| O6, O7  | Profile, listings                        | Not started — **both are contract-blocked**                            |
| O1      | Operator signs up                        | **Closed** — `yuvoy.in/operators` already does it; sign-in links to it |

O10 first because the brief says so: _"If you build one screen well, build the
manifest."_ It is the screen an operator opens at 6am. O9 second because it is the one
with a clock: a traveller is waiting on the other end of every row, and a request that
expires unanswered is a traveller told no by a timer.

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
- **The relay is how an operator reaches a traveller**, because there is no phone number
  (O12). They pick a structured intent and supply one fact — the only operator-written
  value that reaches a phone. `note` is the trap and gets the loudest line on the panel:
  it goes on the traveller's booking page and is **never sent to a phone**.
- **The character rule on a detail is real.** No links, no line breaks — not for
  injection safety (values are parameterised throughout) but because a template variable
  holding a URL renders as something nobody approved and the provider may reject the
  whole message. Indic combining marks are allowed: an operator naming a meeting point
  in Tamil is not an edge case.
- **A relay says how many people it reached.** "Sent" is not an outcome anybody can
  check, and a relay that reached nobody looks identical to one that reached eleven.
- **Calling off is confirmed by typing the departure's own id**, not a checkbox — "one
  mis-tap on a wet phone away from cancelling a full boat", and the only action in the
  portal that cannot be undone. It shows back what it did: bookings cancelled, guests
  affected, rupees refunded, holds released.

### What O9 does, and the rules baked into it

- **The server's order is not ours to change.** Requests arrive sorted by how soon each
  expires, not by when they arrived, because the queue's job is to stop requests dying.
  Re-sorting by experience or party size undoes the one thing it is for.
- **`minutesToAnswer` comes from the server and is never re-derived.** Two clients
  computing "37 minutes left" from a timestamp disagree by however far apart their clocks
  are, and this is a number an operator decides on.
- **The ceiling disables the button rather than explaining a 409.** `seatsGrantable` sits
  beside the decision, because "accept with no sense of what is left is a decision made
  blind".
- **Accepting is one tap; declining is two and asks why.** A decline is cheap for the
  operator and final for the traveller — that asymmetry earns a confirming step. The
  reason is the contract's closed set, and the traveller reads a sentence derived from it
  that always says nothing was charged.
- **Accepting does not revalidate the queue.** It would re-render the list, unmount the
  row and take the confirmation with it — so the operator would tap Accept, watch the row
  vanish, and never learn the traveller still has to pay. That is the exact
  misunderstanding the screen exists to prevent, produced by the cache call meant to keep
  it fresh. Declining does revalidate: there is no post-state to show.
- **STAFF see the queue and are told they cannot answer it**, up front. The contract
  refuses the write, not the read, and finding that out after choosing a reason is worse.

### What O11 does

- **It shows the arithmetic, not a headline.** Gross, minus commission, minus refunds,
  equals net. An operator asking "why is this ₹200 less than I expected" needs to see
  which line disagrees.
- **It checks its own sum.** If gross − commission − refunds ≠ net, it says so and tells
  the operator not to reconcile against it. A reconciliation screen that cannot reconcile
  is worse than no screen.
- **A figure that can still move says so**, loudly. `provisional` and `open` both mean the
  number is not final, and nobody should plan against one that is not.
- **A bank change in flight is shown as a payout hold**, above the number, because it
  changes what the number means: owed, and not moving.
- **The per-booking gap is stated rather than hidden.** `GET /earnings` returns totals
  only and `OperatorBooking` carries no money fields, so "why is _this_ booking less"
  cannot be answered yet. Raised on `yuvoy-api` rather than worked around.

### What O8 does, and the two things it cannot

The four steps all exist in the contract and all four are here: upload intent →
resumable upload → confirm → rights attestation.

- **Nothing is uploaded before it has been checked locally.** The uplink is
  0.5–3 Mbps. A 180 MB clip is twenty minutes of somebody's morning, and finding
  out afterwards that it was filmed sideways is not a validation message. Size,
  length and shape are read from the file in the browser first — and the limits
  come off the **intent**, never hardcoded, so the server stays the authority.
- **A browser that cannot decode the file does not block the upload.** A phone's
  HEVC clip is something one browser reads and another does not, and Cloudflare
  handles both. It warns, says the checks did not run, and lets it go.
- **The refusals that need no server run before one is asked for.** An upload
  intent is a single per-operator slot the API will not duplicate and gives no
  way to hand back, so asking for one to discover that somebody picked a photo
  locks them out of the upload they meant to do. A first version did exactly
  that.
- **A dropped connection is a pause, not a failure.** `HEAD` first, resume from
  the server's offset, never from ours — a client that assumed its own would
  write good bytes into the wrong part of the file. Exercised against a real tus
  endpoint with a real destroyed socket, not described in a comment.
- **The rights statement is hashed in the browser, from the exact string
  rendered.** `statementSha256` is "the hash of the statement as it was rendered
  to the operator", and a hash computed anywhere else is a hash of what somebody
  _believes_ was rendered. A unit test pins the digest, so editing the wording
  fails loudly instead of silently turning every prior attestation into a claim
  about words nobody saw.
- **Consent has no default.** Two radios, neither preselected, and an
  unanswered form is refused rather than sent as a quiet `false`. "Consent of
  the people filmed is the one thing a moderator cannot check by watching."
- **Attesting is not publishing, and the screen says so twice.** Operators
  reasonably assume it is the last step.

**What it cannot do, and why the screen says so out loud:**

1. **There is no `GET /media`**, so nothing can list what has been uploaded,
   what is processing, what a reviewer approved or what is live.
2. **Publishing is therefore undriveable.** `POST /media/{id}/publish` needs a
   media id and an experience id, and there is no way to enumerate either.
   **Taking a clip down is reachable for the clip just sent** — that id is in
   hand for as long as the page is open, and the wrong file noticed immediately
   is the case that actually happens. Once the page unmounts the id is gone
   with it, and the screen says so rather than leaving it to be found out.
3. **Resumption is scoped to the page session** — and that is the contract, not
   a shortcut. The upload URL may not be persisted client-side, is never stored
   server-side, and a fresh intent is refused while one is open. After a reload
   there is no URL to resume to and no way to ask for it again. So the screen
   says "keep this tab open" rather than implying a durability it does not have.

All three are raised on `yuvoy-api` rather than faked.

### What each role is offered, and where the refusal is said

`canManage` is OWNER **or** MANAGER, and the contract names exactly which
endpoints need it: capacity, closed dates, earnings, listing edits, calling off
a departure, and answering a seat request. Four screens branch on it, and until
`yuvoy-operator#14` **none of those branches had ever been rendered** — the mock
knew one identity, so the `!canManage` half of each was written from the
contract and shipped unexercised.

One rule decides all of them, the one the capacity ceiling states: **the refusal
is knowable from what is already on screen, so it is said there** — not fetched,
and not discovered after a tap on one bar of signal.

- **`/today`** offers a staff phone the day and the seats, and not earnings,
  payouts or team. "The crew phone goes out on the boat and gets left on a
  bench."
- **`/requests`** shows staff the queue — a request nobody sees is a request
  that expires — and **disables Accept and Decline**. A banner and a working
  button disagree, and the one that gets believed is the button.
- **`/capacity`** shows the numbers and refuses the changes.
- **`/earnings` now refuses before the request rather than after it.** It used
  to call `GET /earnings` regardless; the 403 threw, landed on the error
  boundary, and said "That did not load — try again". False, and unactionable:
  nothing had gone wrong and retrying would never work.

`pnpm qa` reads both role gates out of the contract and fails a route that
reaches a gated endpoint without checking for the role.

### What O3 can say, and what the contract will not let it

O3 asks for the states between signing up and taking bookings, and for the
operator to see **exactly what is outstanding — a missing credential, an
unverified document — rather than a generic "pending"**. That is the right
screen and it is the one that stops the "why am I not live yet" phone call.

**The pinned contract cannot answer it.** `GET /me` returns `id`, `name`,
`roles`, `operatorId` and `canManage`, and nothing else in the operator
document carries an account state, an approval stage, a credential or an
expiry. The only account-level signal that exists anywhere is a
`403 account_not_active` — "suspended or offboarded".

So `/account` says the one true thing the API publishes, **states the gap out
loud** rather than leaving a blank page to be read as "everything is approved",
and invents nothing. A checklist reading "waiting on your dive licence" would
be plausible, would look like the prototype, and would be a sentence an
operator plans a season around. Raised on `yuvoy-api` instead.

- **A suspension is not a sign-out.** "The person is fine, the business
  relationship is not", so the session survives, the screen talks about the
  account rather than about them, and it does not guess between suspended and
  offboarded — one code covers both.
- **It does not call `requireOperator()`.** That helper redirects here on
  `account_not_active`; calling it from this page would redirect to this page,
  forever.
- **A 500 is not an account state.** A dropped connection is the common path at
  0.5 Mbps, and rendering it as "your business account has been suspended"
  would send an operator to cancel a season over a timeout. Branch on `code`,
  never on the bare status.

### The failure screens, and the absence that produced them

`error.tsx`, `global-error.tsx` and `not-found.tsx` **did not exist** until O3.
`requireOperator()` described itself as throwing "to the error boundary, which
says what is actually true" — into nothing. Every failure this portal could not
handle rendered Next's default page, to somebody on a jetty at 0.5 Mbps where a
dropped connection is the common path rather than the exception.

That plan could not have worked even with a boundary in place: **in production
Next strips a thrown error's message and code before a boundary sees it**,
leaving an opaque `digest`. A boundary can only ever say "something went
wrong". So `account_not_active` is now handled where it is _known_ — in
`requireOperator()` — and `error.tsx` says the one honest thing, offers the
retry that is usually the answer, and warns anybody who was mid-action to check
whether their tap landed before repeating it. The digest stays in the server
logs, not in sunlight.

`pnpm qa` fails a build with any of the three missing.

### What O5 does, and the two claims underneath it

- **An invitation is not a person.** `GET /team` returns "active people and
  unaccepted invitations, in one list", and on a pending row **`id` is the
  invitation, not a user**. They are rendered as two lists: a code sitting on
  somebody's phone grants nothing, has no "last seen" worth reading, and is
  _revoked_ rather than removed.
- **Removing somebody ends their access now**, and the screen says so in those
  words. "Marking a user removed while leaving a 14-day session alive is the
  difference between 'we removed them' and 'we removed them a fortnight from
  now', and the reason somebody is removed in a hurry is usually that the
  fortnight matters."
- **Removing does not revalidate.** Third time this rule has decided a screen:
  re-rendering the list makes the row vanish and takes the confirmation with
  it, so the operator learns nothing about _when_ access ended. The row becomes
  its own confirmation. Inviting **does** revalidate — the pending row it
  produces says more than a message could, and the form does not unmount.
- **OWNER, not `canManage`.** `canManage` is OWNER _or_ MANAGER and gates
  capacity, closed dates, earnings and listing edits. Both team writes are 403
  "OWNER only". The two are one word apart, so `pnpm qa` now reads the
  OWNER-only endpoints out of the contract and fails a route that calls one
  while deciding on `canManage`.
- **There is no Owner to invite, and the form says why.** "The owner is the
  person whose bank account this is, and that is not a thing one login should
  be able to hand to a phone number."
- **`cannot_invite` is one message, and stays one.** A number already belonging
  to any operator is refused identically to every other failure, "so this
  endpoint cannot be used to find out which businesses are on Yuvoy". A client
  that guessed between the causes would rebuild the oracle the server refuses
  to be — so this one does not guess, and the mock does not either.
- **Accepting is a different door.** `POST /team/accept` is unauthenticated by
  design and **mints no session**: `/join` says so plainly and sends them to
  sign in, because a screen that implied otherwise leaves somebody tapping a
  portal that keeps asking them to sign in.
- **The list cannot show a phone number.** `TeamMember` carries none, so a
  pending row is a name with nothing to check a typo against — and an invitation
  sent to a wrong number is one a stranger can accept. The invite confirmation
  echoes what was typed, and the gap is raised on `yuvoy-api` rather than
  papered over.

### Capacity, and the three refusals that matter

- **Seats cannot go below what is already sold.** Not "should not" — the database refuses
  it, because the alternative is a traveller with a paid booking and no seat, discovered
  at a jetty at six in the morning. Reducing to _exactly_ what is sold **is** allowed: it
  closes the departure without stranding anyone, and the UI names that number rather than
  only refusing. The input deliberately does not carry `min={sold}`: native validation
  would block the submit with a browser tooltip, and the operator would never see the
  reason.
- **Closing dates is not cancelling people.** It stops new sales and reports what is still
  owed — including holds that predate the closure and can still complete. "An operator who
  assumes closing the calendar cancelled the bookings will simply not turn up", so the
  owed count leads the result whenever it is non-zero.
- **An oversell is never a success.** A counter sale is a _report_, not a request, and is
  recorded even when it is bad news — refusing it would not un-sell the seats. When the
  response carries `oversold`, the screen renders the incident: how many people paid for a
  seat that no longer exists, which bookings, and the incident id. **This is the one
  screen in the portal where a green tick would be actively harmful.**

## Run it

```bash
pnpm install
pnpm dev                 # http://localhost:3200, everything mocked
                         # a mock tus endpoint also starts on :3201 — O8's
                         # bytes go browser → provider, which MSW cannot
                         # intercept, so the mock provider is a real origin
```

**Sign in as whichever role you want to see.** The mock resolves the session
token against the team fixture rather than a constant, so the number decides who
you are — which is the only way a portal about three levels of access can be
exercised at all. The code is `424242` for everybody.

| Number          | Who         | Role    |
| --------------- | ----------- | ------- |
| `+919000000101` | Priya Raut  | OWNER   |
| `+919000000102` | Dev Kapoor  | MANAGER |
| `+919000000103` | Arun Biswas | STAFF   |

Two more identities exist only to make two screens reachable at all. Neither is
on the team and neither appears anywhere in the UI:

| Number          | What happens                                                     |
| --------------- | ---------------------------------------------------------------- |
| `+919000000109` | Signs in; the business account is on hold → `/account` says so   |
| `+919000000108` | `GET /me` answers 500 → the error boundary, **not** a suspension |
| `+919000000107` | Their upload drops once, mid-chunk, so the resume path runs      |

A number nobody on the account owns gets the same 401 as a wrong code — the same
rule `POST /auth/otp` follows, and the reason it does not tell you which numbers
exist. Removing somebody ends their session for free, because the lookup simply
stops finding them.

`+919000000104` has an unaccepted invitation waiting: accept it at `/join` and
then sign in with it.

Three departures are fixtured for _today_, not for a fixed date: one that has already
left (so the terminal outcomes are reachable), one that has not, and one called off.

## Verify

```bash
pnpm verify          # the pre-push gate — all nine steps below, in order
pnpm qa              # the static sweep on its own
pnpm tokens:check    # design tokens against yuvoy-app (canonical)
pnpm test:e2e        # 138 e2e tests, incl. axe on every route
```

```
typecheck · lint · format · qa · tokens · test · contract:check · build · e2e
```

**`pnpm qa` guards eight things the compiler cannot**, and all eight are ways
the architecture above quietly stops being the architecture:

1. **A route handler under `src/app`** — see the proxy note. There is no allowlist
   entry today.
2. **The client graph reaching the API client or the session.** `server-only` fails the
   build too; this names the import chain instead of erroring three layers down.
3. **A Server Action that never calls `requireOperator()`.** An action is a public POST
   endpoint with a generated name — Next checks the origin, not who is asking.
4. **A traveller phone number** anywhere (O12, above).
5. **A page that is not `force-dynamic`.** Two things depend on it and both are
   silent when it stops being true: every screen here is a live answer, and
   `OPERATOR_API_URL` is only safe to mark Sensitive in Vercel because nothing
   reads it at build time. Static generation is opt-OUT in Next, so this is an
   absence rather than a mistake. One exemption — the root redirect, which
   reads nothing — and it revokes itself the moment that file imports `@/lib`.
6. **An OWNER-only endpoint gated on `canManage`.** The OWNER-only list is
   parsed out of `contracts/operator-openapi.yaml` rather than written down, so
   it stays true when the contract moves, and the check fails loudly if the
   parse ever finds nothing.
7. **A missing `error.tsx`, `global-error.tsx` or `not-found.tsx`.** Written
   from the defect above rather than from a principle. A boundary is opt-in in
   Next and its absence is silent by design — the fallback is a working page
   that says nothing true.
8. **A role gate the contract never asked for.** The other direction of check 6,
   and it caught one: `/reels` gated uploading on `canManage` when
   `POST /media/upload-intents` declares no 403 at all. Telling somebody they
   may not do something the server would allow is the wrong direction to be
   wrong in.

Checks 5 and 6 walk each page's whole import graph rather than one file, because
`/earnings` does not call `GET /earnings` itself — `lib/money/fetch.ts` does —
and a per-file rule would demand a role gate inside a fetch helper, which is the
one place it does not belong. Attribution is per module, not per symbol, which is
why a gate on `"OWNER"` satisfies the `canManage` requirement: it is strictly
stronger.

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

It is also **validated rather than trusted** — empty string, surrounding quotes, a
trailing slash and a non-http scheme each get a defined answer, and a bad value fails
by name with a description of its _shape_, because Vercel scrubs the value itself out
of logs. That code is here before it was needed here: `yuvoy-app` took
`NEXT_PUBLIC_SITE_URL` on trust and three production deploys died at module evaluation
while the local build stayed green, because the variable is unset locally and the
fallback literal was what ran. `pnpm qa` fails a raw read of it anywhere else.

Because it is server-only and read at **request** time — every page here is
`force-dynamic` — marking it Sensitive in Vercel is safe. A `NEXT_PUBLIC_` value is
not: the build must inline it, and Vercel substitutes a `[SENSITIVE]` placeholder
instead. That is exactly what broke `yuvoy-app`'s first three deploys.

## Blocked

**Operator sign-in in production needs the Meta WhatsApp account** — that is how the
code is delivered. The flow is built and exercised end to end against mocks; it cannot
be exercised against the real API until the account exists. That is a commercial
dependency tracked on `yuvoy-api#52`, not a frontend one.
