# Yuvoy portal typography

> **v3.2, "Signature: three voices"**, owner-approved on 5 Oct 2026 (Direction 09 of the
> typography study in `yuvoy/typography-lab`, decision verbatim in its `APPROVALS.md`).
>
> The system is defined in `yuvoy-app/docs/typography-system.md`, which is canonical, as the
> tokens are. This file is how the portal applies it, and the policies only the portal needs.
> `pnpm tokens:check` diffs the portal's type tokens against the app's, and the four font files in
> `src/fonts/` are byte-identical to the app's.

## Three voices

| Voice     | In the portal                                                                                                                | Class                                            |
| --------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| The host  | the business's public words, on screen and in the fields that write them                                                     | `voice-host` (Gotu)                              |
| Yuvoy     | the portal itself: headlines, labels, buttons, explanations, states, and every stand-in we write when the host wrote nothing | `font-sans` (Anek), `font-display` for headlines |
| The board | the figure that leads a block: a departure's time, the day's counts, the boarding count, every lead figure on Money          | `font-board` (Anek, condensed)                   |

A string's voice is decided by who wrote it, not where it sits.

## Display font

`font-display` (Anek, width 87.5, weight 700, baked 4% large, registered at 400), always
`font-display tracking-display leading-display text-balance` with a size and never a weight
class. Screen titles are mostly `text-4xl`; long screens' sections `text-2xl`; the listing
builder's sub-sections (Add a clip, Add a photograph) `text-xl`.

A listing's own name is the host's headline: `voice-host leading-display text-balance` and a size,
on its page and in the builder. "Your listing", standing in for a draft with no name, is ours and
stays in `font-display`. A published listing's edit screen is headed "Edit" in display, with the
listing's name under it in the host's voice. "Join {business}" is one Yuvoy headline: a host's
string inside our sentence keeps the sentence's voice.

## Body font

Anek text (`font-sans`, the default; weights 400, 500, 700 from one variable file) for everything
the portal says. Gotu (`voice-host`, one weight, synthesis off) for the host's words.

## Utility font

`font-board` (Anek, width 75, weight 700, baked 12% large, registered at 400) for figures, always
`tabular-nums`, never tracked: inside a tracked headline it takes `tracking-normal`.

`font-mono` is machine text, never a voice: codes being typed (sign-in, sign-up, join), the join
link, phone numbers on team rows, the IFSC field and bank details shown as data. It is the one
place `uppercase` is allowed (an IFSC typed in either case), and it is never tracked except by
the code inputs' own `tracking-[0.4em]`, which spaces the digits of a code as it is typed.

## Font weights

400 for running text and meta, 500 (`font-medium`) for labels, field labels and the chips that
carried the label, 700 (`font-bold`) for buttons, titles, navigation and emphasis.
`font-semibold` is banned. No weight class beside `font-display`, `font-board` or `voice-host`.

## Type scale

| Role                | Classes                                                     | Size / line          |
| ------------------- | ----------------------------------------------------------- | -------------------- |
| Screen title        | `font-display … text-4xl` (some `text-3xl`)                 | 36 / 38.9, 30 / 32.4 |
| Section headline    | `font-display … text-2xl`                                   | 24 / 25.9            |
| Builder sub-section | `font-display … text-xl`                                    | 20 / 21.6            |
| Title               | `text-lg font-bold`, `text-base font-bold`                  | 18 / 28, 16 / 24     |
| Body                | `text-sm` or `text-base` with `leading-body`                | 14 / 21.7, 16 / 24.8 |
| Button              | `text-button font-bold`                                     | 15 / 20              |
| Label               | `label`                                                     | 13 / 18              |
| Field label         | `fieldLabelClass()`                                         | 14 / 20              |
| Meta, help          | `text-sm`, `text-xs`                                        | 14 / 20, 12 / 16     |
| Navigation          | `text-xs font-bold`; the phone bar 11px below 336px         | 12, 11               |
| Chip                | the chip's own `text-[11px]`                                | 11                   |
| Figure              | `font-board`, `text-2xl` to `text-7xl` (the boarding count) | 24 to 72             |

## Line heights

`leading-display` (1.08) with `text-balance` on every headline, Yuvoy's or the host's.
`leading-body` (1.55) with `text-pretty` on running text, at the size the screen already used: the
portal has no `text-body` step, so its sun mode can lift body a size like any other `text-sm`.
Figures sit at `leading-none`. `cn()` keeps a leading written before a size.

## Letter spacing

`tracking-display` (-0.005em) on headlines, `tracking-ref` (0.04em) on references, 0 everywhere
else. Tracked capitals are banned.

## Heading rules

- One `h1` per screen, as above. Titles (a card's, a row's, a panel's, a sheet's) are
  `font-bold text-balance`, or `voice-host text-balance` when they are the host's; a truncated
  title does not balance.
- A section inside a screen is headed by a `label`, or by a display `text-2xl` on the long money
  screens (Past payouts, What it paid, Trips on this statement, Payments received).

## Body rules

- Body (`leading-body text-pretty`): explanations, instructions, an empty list's sentence, a
  sentence saying a read failed and what still holds.
- Meta keeps its size and Tailwind's line height: status lines, counts, a week, a date and a
  place, "owed to Yuvoy on 2 statements". The test is what a line is, not how long it is.
- Field hints, errors, success lines and `role="status"` lines keep their own style.

## Label rules

- `label`: sentence case, 13/18, weight 500, untracked; never beside a size or a weight class.
- Buttons: `text-button font-bold` at every size (the small button is `h-9 px-4`).
- Chips are not labels: the chip's own 11px, at `font-medium` where it carried the label before
  v3.2 (a member's roles, Verification's status pill).
- Field labels: the listing builder, the listings screen and the week picker use
  `fieldLabelClass()` (14px, weight 500); every other form uses `label` (13px, weight 500). Both
  are sentence case: yuvoy-operator#85 moved the builder off the shouted label, and v3.2 made the
  label itself sentence case, so 1px is all that is left between them. It is left as it was.

## Number rules

- **The board**: a departure's time inside its headline (Today, the calendar inspector, a booking,
  boarding), the day's counts, the boarding count, the call-off counts, the business's stats, and
  every lead figure on the Money tab, a payout, a commission statement and Cash.
- **Amounts** keep Anek's proportional figures where they are read once, and take `tabular-nums`
  where they stack in a column: statement rows, cash lists, the arithmetic rows under a payout and
  a statement. (The study drew portal prices proportional everywhere; columns of money are where
  tabular figures earn their place.)
- **References**: `tracking-ref slashed-zero tabular-nums` on booking references, statement
  references, UPI transaction ids, the bank reference (`Row reference`), the IFSC, the phone number
  read back on sign-in and sign-up ("For +91 …"), and a reference quoted inside a sentence on the
  pay panel.
- **The IFSC inside the account line** ("HDFC0001234 · account ending 4412") is set apart by
  `AccountLine` (`src/components/account/account-line.tsx`), only when the line opens with it, so
  the API's own summary for a shape this build does not know is never cut up. `accountOnFile`
  returns the `ifsc` it built the line from, or `null` for the API's summary.

## The host's voice in forms

A field takes `voice-host` when what is typed becomes the business's **public** words, so an
operator sees their words as travellers will:

- the listing's name, summary and description; the meeting point and landmark; what is included,
  what to bring and the safety notes; a question's text;
- the story ("About") and the business name at sign-up.

These stay in Anek:

- message composers, relay and call-off notes, cash notes and every other note: working fields,
  typed fast at a jetty. A sent message is shown in the host's voice in the conversation.
- a question's choices (the app draws them as native options) and the languages (the app sets them
  as its own text).

Read-backs follow the field: `DraftField.ownWords` (`src/lib/services/draft.ts`) marks which draft
values are the operator's own words, and the read-back sets only those in `voice-host`. On review,
the basics step's summary is the host's voice when it is their title.

Stand-ins are ours and stay in Anek: "A trip", "A departure", "Booking", "Departure", "Your
business" (`UNNAMED_BUSINESS`), "Your listing", "Not written yet", "Not on your page yet".

## Mobile rules

- The phone's five-tab bar sets its labels at 11px below 336px and 12px from there, so they fit at
  320px.
- Buttons never wrap (`whitespace-nowrap`); headlines balance.
- Inputs are 16px (`text-base`), which also stops iOS zooming into a field.
- **Sun mode** (`[data-sun="on"]`, the boarding screen read at arm's length in direct sunlight,
  `src/app/globals.css`) lifts `text-xs`, `text-sm` and `text-base` one step, bolds `.label` and
  deepens the muted ink. It leaves buttons (already bold at 15px), board figures and the host's
  words at their size, and its rules are unlayered so they outrank the utilities they lift.

## Desktop rules

The same classes at every width. The desktop rail sets its labels at 12px bold, and the business
name in the rail's identity is in the host's voice at `text-base`.

## Traveller usage

See `yuvoy-app/docs/typography-system.md`. What an operator types in a public field is what a
traveller reads in Gotu on the reel, the listing and the ticket.

## Font loading and performance

The portal ships the app's four files (126,516 bytes) through the same `src/lib/fonts.ts`: Anek
text `swap`, the display, board and Gotu cuts `optional`, all four preloaded on every route. Sun
mode loads nothing; it changes sizes and weights the files already carry. The strategy and why are
in the app's document.

## Accessibility considerations

- Sun mode is the portal's high-legibility setting for the one screen read in direct sunlight.
- No CSS case transforms: what a screen reader announces is what is written.
- `AccountLine` splits the line into a span and text only, so its text, and its accessible name
  inside the link, are unchanged.
- The palette and every contrast pairing are unchanged (`palette.test.ts`).

## How it is enforced

- `src/app/palette.test.ts`: the same type rules as the app's guard, run on every class string in
  the portal, each proved to fire.
- `src/components/ui/input.test.ts`: no textarea is drawn at the one-line field's 56px height.
- `src/lib/services/draft.test.ts`: which draft fields are the operator's own words.
- `src/components/account/account-line.test.tsx` and `src/lib/account/bank.test.ts`: the IFSC is
  set apart only when the line opens with it.
- `pnpm tokens:check`: the type tokens match the app's.
