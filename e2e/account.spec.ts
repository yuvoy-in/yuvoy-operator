import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * O3 — whether an operator can trade, and the screens that say so when
 * something has gone wrong.
 *
 * Three of these tests cover states that had **never once been rendered**
 * before this change: `requireOperator()` described itself as throwing "to the
 * error boundary, which says what is actually true", and there was no error
 * boundary in the repository at all. The two extra mock identities exist for
 * exactly this reason — an unreachable screen is an untested screen.
 *
 * The claim they are really defending is the last one: **a server having a bad
 * minute must never render as "your business account has been suspended".**
 */

/*
  Headings are asserted by role, not by text. Next mirrors the page's heading
  into its own `role="alert"` route announcer, so `getByText` on an h1 resolves
  to two elements on every navigation.
*/
const DEV_CODE = "424242";
const OWNER = "+919000000101";
/** Signs in fine; the business account is on hold. */
const SUSPENDED = "+919000000109";
/** `GET /me` answers 500. Not an account state. */
const FAILING = "+919000000108";
/** Signed up, verified nothing. `bookable: false`, both blockers theirs. */
const PROSPECT = "+919000000105";
/** Everything sent; it is in Yuvoy's queue. `waitingOn: yuvoy`. */
const AWAITING = "+919000000106";
/**
 * LIVE and selling, with the logo and registered address outstanding.
 *
 * The state that could not exist before yuvoy-api#139 and is now the common
 * one — `bookable: true` with a non-empty `blocking`.
 */
const LIVE_OUTSTANDING = "+919000000115";
/**
 * `GET /me` answers 200 with no `account` block at all.
 *
 * The same identity `reels.spec.ts` uses for a dropped upload — deliberately.
 * Every mock identity that exists for another purpose gets no account block,
 * so "absent" is a shape the suite meets by accident as well as on purpose.
 * Read-only here, so it cannot race that spec's uploads.
 */
const NO_STANDING = "+919000000107";

/** Signs in without asserting where it lands — that is the thing under test. */
async function signIn(page: Page, phone: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Your phone number").fill(phone);
  await page.getByRole("button", { name: "Send me a code" }).click();
  await page.getByLabel("Your code").fill(DEV_CODE);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("an active account says so, and gets out of the way", async ({ page }) => {
  await signIn(page, OWNER);
  await page.waitForURL("**/today");
  await page.goto("/account");

  /*
    The heading is the BUSINESS — yuvoy-operator#33 §3 — and the status is
    said once, on the screen that holds the list it describes. "Your account is
    live" as an `h1` with a LIVE chip beside it was the same thing twice, and
    worse, that heading was derived from `bookable` while an operator can be
    LIVE and not sellable since migration 0053.
  */
  await expect(
    /*
      `displayName`, not `legalName` — yuvoy-operator#58 item 2. The profile is
      headed by what travellers see; the registered name is a detail on the
      Business details screen.
    */
    page.getByRole("heading", { name: "Reef Divers Havelock" }),
  ).toBeVisible();

  /*
    The status, the documents and what is outstanding came off the profile in
    #58 item 10 and are on Verification together. The profile keeps the name,
    the logo, the three numbers and what the business sells.
  */
  await page.goto("/account/verification");
  await expect(page.getByText("Your account is live")).toBeVisible();
  await expect(page.getByRole("link", { name: "Go to today" })).toBeVisible();

  /*
    The documents are on the screen now — `AccountStanding.credentials`
    (yuvoy-api#63, PR #83). A LIVE account still gets this section, because it
    is where the expiry lives and a lapse mid-season takes the listing down.
  */
  await expect(
    page.getByRole("heading", { name: "Your documents" }),
  ).toBeVisible();
  await expect(page.getByText("Directorate registration")).toBeVisible();

  /*
    The one warning this portal raises on its own, and it is arithmetic on a
    published date rather than a guess: a VERIFIED insurance certificate
    twenty-one days from expiry is not a green tick.
  */
  await expect(page.getByText("Expires in 21 days")).toBeVisible();

  /*
    And said as the loss of sales it is — yuvoy-operator#46, verbatim:
    "{Document} expires {date}. Listings that need it come down that day."
  */
  await expect(
    page.getByText(
      /^Insurance expires \d{1,2} [A-Z][a-z]+ \d{4}\. Listings that need it come down that day\.$/,
    ),
  ).toBeVisible();

  /*
    With the way to renew it, because twenty-one days is inside the window in
    which `POST /credentials` accepts a renewal. The registration, 400 days
    out, offers nothing: the API would refuse a new copy of it.
  */
  const replace = page.getByRole("link", { name: "Replace it" });
  /*
    Three now, not one. The insurance twenty-one days out, plus the two PENDING
    documents #46 added to this fixture so the file controls have something to
    act on — a pending document is one `POST /credentials` will take a fresh
    copy of, so it offers the same link.

    The property this asserts is unchanged and is the one that matters: the
    registration 400 days out offers NOTHING, because the API would refuse a
    renewal of it.
  */
  await expect(replace).toHaveCount(3);
  await expect(replace.first()).toHaveAttribute("href", "/profile#documents");
  await expect(
    page.locator("li").filter({ hasText: "Directorate registration" }).first(),
  ).not.toContainText("Replace it");

  // The sentence that said no document could be sent here at all is gone —
  // false since `POST /credentials`, and contradicted by the Replace above.
  await expect(
    page.getByText(/You cannot send or replace a document here yet/),
  ).toHaveCount(0);
});

test("the profile's three numbers are numbers, and say what they count", async ({
  page,
}) => {
  /*
    yuvoy-operator#86 s9: "The header says 3 listings; the grid below shows
    six. 'No reviews yet' sits where a number belongs." The first number counts
    what a traveller can buy now, and the grid shows every listing, so it is
    labelled for what it counts. Reviews is a number over its word, like the
    other two.
  */
  await signIn(page, OWNER);
  await page.waitForURL("**/today");
  await page.goto("/account");

  const stat = (term: string) =>
    page.locator(`dl > div:has(> dt:text-is("${term}")) > dd`);
  await expect(stat("Live")).toHaveText(/^\d+$/);
  await expect(stat("Trips run")).toHaveText("128");
  await expect(stat("Reviews")).toHaveText("0");
  await expect(page.locator("dt", { hasText: /^Listings$/ })).toHaveCount(0);
  await expect(page.getByText("No reviews yet")).toHaveCount(0);
});

test("the profile names what is waiting, and each opens where it is fixed", async ({
  page,
}) => {
  /*
    yuvoy-operator#86 s9: "'2 things waiting on you' does not say what they
    are ... Name the two things in the strip." The count still opens the list
    that explains them; each thing opens the screen that fixes it.
  */
  await signIn(page, LIVE_OUTSTANDING);
  await page.waitForURL("**/today");
  await page.goto("/account");

  await expect(
    page.getByRole("link", { name: /3 things waiting on you/ }),
  ).toHaveAttribute("href", "/account/verification");
  await expect(
    page.getByRole("link", { name: "Complete your details" }),
  ).toHaveAttribute("href", "/profile");
  await expect(
    page.getByRole("link", { name: "Add your logo" }),
  ).toHaveAttribute("href", "/logo");
  // A sentence this build cannot read a document out of is the API's own.
  await expect(
    page.getByRole("link", {
      name: "We have no equipment inspection on file.",
    }),
  ).toHaveAttribute("href", "/profile#documents");

  await page.getByRole("link", { name: "Add your logo" }).click();
  await page.waitForURL("**/logo");
});

test("a signed-up account that cannot sell is never told it is live", async ({
  page,
}) => {
  /*
    The defect this change fixes, as a test.

    /account said "your account is live" to anybody whose `GET /me` returned
    200. After self-signup (D-029) a PROSPECT is the most common operator
    there is — real account, real session, cannot sell a thing — and that
    sentence was a lie to every one of them.
  */
  /*
    Wait for the sign-in redirect to land before navigating. `signIn` does not
    wait — where it lands is the thing under test elsewhere in this file — so a
    `goto` fired immediately is overtaken by the redirect and asserts against
    /today. Cost six failures to find.
  */
  await signIn(page, PROSPECT);
  await page.waitForURL("**/today");
  await page.goto("/account/verification");

  /*
    The heading is the BUSINESS, not the state — yuvoy-operator#33 §3. The
    status is still said, once, in the line under it, so these assert the
    sentence rather than the heading it used to be.
  */
  await expect(page.getByText("You cannot be booked yet")).toBeVisible();
  await expect(page.getByText("Your account is live")).toHaveCount(0);

  // `state` is displayed, never branched on: it is a bare string in the
  // contract and PROSPECT is not even among the schema's own examples.
  await expect(page.getByText("Prospect")).toBeVisible();

  /*
    `waitingOn` gets its own heading. "'Pending' because we are slow and
    'pending' because they have sent nothing read identically, and an operator
    who cannot tell which has no choice but to ring somebody."
  */
  await expect(
    page.getByRole("heading", { name: "Waiting on you" }),
  ).toBeVisible();
  await expect(
    page.getByText("We still need your tourism department registration"),
  ).toBeVisible();
  await expect(
    page.getByText("We still need your insurance certificate"),
  ).toBeVisible();
  await expect(page.getByText("2 things are waiting on you")).toBeVisible();

  /*
    EVERY BLOCKER HAS A WAY OUT — yuvoy-operator#33.

    This asserted "There is no upload on this screen yet", which was true when
    written and had stopped being: `/profile` sends business details and
    documents, and `/logo` sends the logo. So the check is inverted — the
    blockers now carry the screen that resolves them, and the sentence that
    said they did not must not come back.
  */
  await expect(
    page.getByText(/There is no upload on this screen yet/),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Send us the document" }).first(),
  ).toBeVisible();
});

test("an account waiting on Yuvoy is told not to chase it", async ({
  page,
}) => {
  /*
    Wait for the sign-in redirect to land before navigating. `signIn` does not
    wait — where it lands is the thing under test elsewhere in this file — so a
    `goto` fired immediately is overtaken by the redirect and asserts against
    /today. Cost six failures to find.
  */
  await signIn(page, AWAITING);
  await page.waitForURL("**/today");
  await page.goto("/account/verification");

  await expect(page.getByText("You cannot be booked yet")).toBeVisible();
  await expect(page.getByRole("heading", { name: "With Yuvoy" })).toBeVisible();
  await expect(
    page.getByText("Everything is in. A person at Yuvoy is checking it."),
  ).toBeVisible();
  await expect(page.getByText(/Nothing for you to do/)).toBeVisible();

  /*
    And it must NOT tell somebody who cannot sell that nothing is outstanding
    — that reads as a fault in us and produces the phone call O3 exists to
    prevent.
  */
  await expect(page.getByText(/nothing is outstanding/i)).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Waiting on you" }),
  ).toHaveCount(0);
});

test("a live account is still asked for what is outstanding", async ({
  page,
}) => {
  /*
    THE LIST THAT DISAPPEARED — yuvoy-operator#38.

    This screen gated the whole outstanding list on `!bookable`, which was a
    reliable proxy for "there is something to show" only while `bookable` went
    false for ANY outstanding item. yuvoy-api#139 narrowed it to what actually
    stops a sale — right, because an operator with three listings selling was
    being told "you cannot be booked yet" over a missing logo — and this
    portal promptly stopped asking anybody for their logo or their registered
    address at all.

    Both halves are asserted, because the fix is both halves: the operator
    must be told they are open for business AND that we are still waiting.
  */
  await signIn(page, LIVE_OUTSTANDING);
  await page.waitForURL("**/today");
  await page.goto("/account/verification");

  // Open for business — the sentence yuvoy-api#139 exists to protect.
  await expect(page.getByText(/Your account is live/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Go to today" })).toBeVisible();
  await expect(page.getByText("You cannot be booked yet")).toHaveCount(0);

  /*
    AND still outstanding — the half that vanished. Three since #46, which added
    the `CREDENTIAL_MISSING` that explains this fixture's one unmet required
    document: "a document that is not satisfied always has a `CREDENTIAL_*`
    entry in `blocking` saying why."
  */
  await expect(page.getByText("3 things are still outstanding")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Waiting on you" }),
  ).toBeVisible();
  await expect(
    page.getByText("We still need your registered business name and address"),
  ).toBeVisible();
  await expect(page.getByText("We still need your logo")).toBeVisible();

  /*
    `gates: false` on both rows, so the screen says so rather than letting a
    logo sit in the same red panel as a lapsed licence. An operator who cannot
    tell the difference learns to ignore all of it.
  */
  await expect(page.getByText("Not stopping sales")).toHaveCount(3);
  await expect(page.getByText(/These are not blocking you/)).toBeVisible();

  // And each one still carries the way out of it — yuvoy-operator#33.
  await expect(
    page.getByRole("link", { name: "Complete your details" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Add your logo" })).toBeVisible();
});

test("an account block the API did not send is unknown, not approval", async ({
  page,
}) => {
  /*
    The contract's own instruction, as a test: "Absent means unknown — never
    'everything is fine'." An older deployment, a rollback or a partial
    response must not render as approval.
  */
  /*
    Wait for the sign-in redirect to land before navigating. `signIn` does not
    wait — where it lands is the thing under test elsewhere in this file — so a
    `goto` fired immediately is overtaken by the redirect and asserts against
    /today. Cost six failures to find.
  */
  await signIn(page, NO_STANDING);
  await page.waitForURL("**/today");
  await page.goto("/account/verification");

  /*
    The heading is the BUSINESS, not the state — yuvoy-operator#33 §3. The
    status is still said, once, in the line under it, so these assert the
    sentence rather than the heading it used to be.
  */
  await expect(
    page.getByText("We cannot tell you where you stand"),
  ).toBeVisible();
  await expect(page.getByText("Your account is live")).toHaveCount(0);
  await expect(
    page.getByText(/we should not tell you that nothing is/),
  ).toBeVisible();
});

test("Home explains an empty day the account is the reason for", async ({
  page,
}) => {
  /*
    Where the question is actually asked. A new operator signs in and lands
    here — `/` redirects to `/today` — and "Nothing running today" reads as "you
    have not added anything" rather than "you cannot sell yet".

    The strip is the first thing on Home since #56, above the requests, and it
    carries `headline(account).title` so it cannot disagree with the sentence
    the Business screen leads with.
  */
  await signIn(page, PROSPECT);
  await page.waitForURL("**/today");

  /*
    ONE line and a chevron since #56 item 3. It carried a second line saying
    "See what is outstanding", which is what a chevron already says: Home is
    four blocks an operator scans at six in the morning, and every extra line is
    one between them and the boat.
  */
  const banner = page.getByRole("link", { name: /You cannot be booked yet/ });
  await expect(banner).toBeVisible();

  await banner.click();
  await page.waitForURL("**/account/verification");
  await expect(
    page.getByRole("heading", { name: "Waiting on you" }),
  ).toBeVisible();
});

test("a live account gets no banner on the day screen", async ({ page }) => {
  // The banner is an exception, not decoration. An operator who can sell must
  // never see a warning about selling.
  await signIn(page, OWNER);
  await page.waitForURL("**/today");
  await expect(
    page.getByRole("link", { name: /You cannot be booked yet/ }),
  ).toHaveCount(0);
});

test("a suspended business signs in, and every screen says why", async ({
  page,
}) => {
  /*
    yuvoy-operator#50, and this test used to assert the opposite.

    A suspended business was refused `403 account_not_active` on every endpoint
    and bounced to /account from everywhere. The contract separated the two:
    "a suspended business is not refused here ... each signs in, and its writes
    answer `account_suspended` instead." `account_not_active` now means only an
    OFFBOARDED account, which cannot hold a session at all.

    The separation is not a nicety. A suspended operator still has departures
    that travellers have paid for, and those have to be run or called off. The
    old dead end stranded them.
  */
  await signIn(page, SUSPENDED);
  await page.waitForURL("**/today");

  // The banner is the API's three sentences, in order, on the first screen.
  const banner = page.getByRole("alert").filter({ hasText: "suspended" });
  await expect(banner).toBeVisible();
  await expect(banner).toContainText(
    "Your account has been suspended. Please reach out to admin for help.",
  );
  // What a person at Yuvoy wrote, shown as plain text.
  await expect(banner).toContainText("three complaints about missed pickups");
  // And the half that stops somebody assuming the season is over.
  await expect(banner).toContainText("run or stop the trips already booked");

  // On every screen, not one: it changes what every control on the page means.
  for (const path of ["/bookings", "/calendar", "/account"]) {
    await page.goto(path);
    await expect(
      page.getByRole("alert").filter({ hasText: "suspended" }).first(),
    ).toBeVisible();
  }
});

test("a suspended business keeps the writes the API still allows", async ({
  page,
}) => {
  /*
    The table in yuvoy-operator#50: everything can still be read, the trips
    already booked can still be run or stopped, and the team, a bank change and
    documents can still be dealt with. The principle underneath it is that a
    suspended business can always let a traveller GO and can never take one ON.
  */
  await signIn(page, SUSPENDED);
  await page.waitForURL("**/today");

  // Pause is not drawn. Putting a listing back on sale is taking travellers on.
  await page.goto("/services/activities");
  await expect(
    page.getByRole("button", { name: "Pause", exact: true }),
  ).toHaveCount(0);
  // Nor is a new listing, which is new inventory.
  await expect(
    page.getByRole("button", { name: /Add a listing|New listing/i }),
  ).toHaveCount(0);

  // Seats, closed dates and counter sales are all gone from the calendar.
  await page.goto("/calendar");
  await expect(
    page.getByRole("button", { name: /Add a departure|Close/i }),
  ).toHaveCount(0);

  /*
    The team is still manageable. Holding somebody is taking access AWAY, which
    a suspended business may always do; inviting is handing it out, which it
    may not.
  */
  await page.goto("/team");
  await expect(
    page.getByRole("button", { name: "Send the invitation" }),
  ).toHaveCount(0);

  // And the day still runs: the manifest and its attendance are untouched.
  await page.goto("/today");
  await expect(
    page.getByRole("alert").filter({ hasText: "suspended" }),
  ).toBeVisible();
});

test("a server having a bad minute is not an account state", async ({
  page,
}) => {
  await signIn(page, FAILING);

  /*
    The single most important line in this file. A 500 and a dropped
    connection are the common path on a jetty at 0.5 Mbps, and rendering
    either as "your business account has been suspended" would send an
    operator to cancel a season over a timeout.
  */
  await expect(
    page.getByRole("heading", { name: "That did not load" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Your account cannot take bookings" }),
  ).toHaveCount(0);

  // What a retry screen owes somebody who was mid-action.
  await expect(
    page.getByText(/check whether it took effect before doing it again/),
  ).toBeVisible();
});

test("a URL this portal does not have says so, and offers the way back", async ({
  page,
}) => {
  await signIn(page, OWNER);
  await page.waitForURL("**/today");

  await page.goto("/no-such-screen");
  await expect(
    page.getByRole("heading", { name: "There is nothing at that address" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Go to today" })).toBeVisible();
});

test("/account has no accessibility violations, on hold or not", async ({
  page,
}) => {
  await signIn(page, OWNER);
  await page.waitForURL("**/today");
  await page.goto("/account");
  await page.waitForLoadState("networkidle");

  const active = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(active.violations).toEqual([]);

  /*
    A suspended business lands on the day like anybody else since
    yuvoy-operator#50, so /account is navigated to rather than arrived at. The
    banner is on this screen too, and it is the new thing axe has to be happy
    about: an `alert` carrying three paragraphs, above everything.
  */
  await page.context().clearCookies();
  await signIn(page, SUSPENDED);
  await page.waitForURL("**/today");
  await page.goto("/account");
  await page.waitForLoadState("networkidle");
  await expect(
    page.getByRole("alert").filter({ hasText: "suspended" }).first(),
  ).toBeVisible();

  const held = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(held.violations).toEqual([]);
});
