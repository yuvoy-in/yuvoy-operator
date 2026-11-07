import { test, expect } from "@playwright/test";
import { OWNER, PROSPECT, signIn } from "./account-kit";

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
    The + says what it adds (yuvoy-operator#109). It read "Add" to a screen
    reader and nothing at all on screen; it now shows the word, and its name
    starts with that word and says what is behind it. Still a 44px target.
  */
  const add = page.getByRole("button", { name: "Add a listing or a reel" });
  await expect(add).toHaveText("Add");
  expect((await add.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  await add.click();
  const choices = page.getByRole("dialog", { name: "Add a listing or a reel" });
  await expect(
    choices.getByRole("button", { name: "Add a listing" }),
  ).toBeVisible();
  /*
    The choices open below the button and leave it reachable: they used to
    cover it, and Settings, on a phone, so a second tap could not land and
    nothing else closed them. Escape closes them too.
  */
  await add.click();
  await expect(choices).toBeHidden();
  await add.click();
  await page.keyboard.press("Escape");
  await expect(choices).toBeHidden();
  await expect(add).toBeFocused();

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

test("listings come first, each with its state, and a draft says what is missing", async ({
  page,
}) => {
  /*
    Operator A, approved 3 Oct 2026: "Listings come first, each with its
    state, and a draft says in words what is still missing." The page
    travellers read, and the ways to edit and share it, follow the listings.

    Only fixtures nothing writes to: `exp_boat` (four blockers), `exp_night`
    (sent back) and the snorkel trip (live, with dates to sell at any hour).
    Not the try-dive: its one departure has always left, so its tile says
    "No dates in 30 days", correctly, until another suite adds some.
  */
  await signIn(page, OWNER);
  await page.waitForURL("**/today");
  await page.goto("/account");

  const tile = (title: string) =>
    page.getByRole("link", { name: new RegExp(`^${title},`) });

  const draft = tile("Island boat day");
  await expect(draft).toContainText("Draft");
  await expect(draft).toContainText(
    "Still missing: a short summary, what kind of activity it is, a price, whether that price is per person or for the group",
  );
  // Named in real words, title first: no run-on "DraftIsland boat day".
  await expect(draft).toHaveAccessibleName(
    "Island boat day, Draft, Still missing: a short summary, what kind of activity it is, a price, whether that price is per person or for the group",
  );

  const sentBack = tile("Night fishing");
  await expect(sentBack).toContainText("Sent back");
  await expect(sentBack).toContainText(
    "A traveller could not find the meeting point from this.",
  );

  const live = tile("Snorkel trip to Elephant Beach");
  await expect(live).toContainText("Live");
  await expect(live).toContainText("₹3,200 per person");

  // Listings first: the grid sits above the page travellers read.
  const yourPage = page.getByRole("heading", { name: "Your page" });
  await expect(yourPage).toBeVisible();
  const tileBox = await draft.boundingBox();
  const pageBox = await yourPage.boundingBox();
  expect(tileBox!.y, "the listings sit above Your page").toBeLessThan(
    pageBox!.y,
  );
  await expect(page.getByRole("link", { name: "Edit profile" })).toBeVisible();
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

  /*
    yuvoy-operator#88 s13: "The biggest, darkest button on a screen about
    outstanding paperwork is 'Go to today' ... Make the first outstanding item
    the primary action." The first thing waiting has the forest fill; Go to
    today is a plain link.
  */
  await expect(
    page.getByRole("link", { name: "Complete your details" }),
  ).toHaveClass(/bg-forest/);
  await expect(
    page.getByRole("link", { name: "Add your logo" }),
  ).not.toHaveClass(/bg-forest/);
  await expect(page.getByRole("link", { name: "Go to today" })).not.toHaveClass(
    /bg-forest/,
  );
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
