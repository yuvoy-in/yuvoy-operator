import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Manage services — what a business sells, and the footage that sells it.
 *
 * yuvoy-operator#22. Before this an operator could sign in, read what was
 * outstanding on their account, and then do nothing about either: Reels lived
 * behind the Business door and the listings screen did not exist at all.
 *
 * The visible consequence was on the traveller side — `yuvoy.in` rendered two
 * real listings as BLACK CARDS, not because anything was broken there but
 * because no clip had ever been attached to one, and no operator had ever had
 * a screen that could attach it.
 */

const DEV_CODE = "424242";

async function signIn(page: Page, phone = "+919000000101") {
  await page.goto("/sign-in");
  await page.getByLabel("Your phone number").fill(phone);
  await page.getByRole("button", { name: "Send me a code" }).click();
  await page.getByLabel("Your code").fill(DEV_CODE);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/today");
}

/**
 * A listing's tile, by its title, wherever tiles are drawn.
 *
 * The accessible name of a tile is its title followed by its badge, so this
 * anchors at the start and stops at a word boundary: "Reef dive" must not also
 * match a "Reef dive 4kf2s" some other test created.
 */
function tile(page: Page, title: string) {
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return page.getByRole("link", { name: new RegExp(`^${escaped}(?![\\w])`) });
}

/** One listing, as the profile opens it — #58 item 4. */
async function openListing(page: Page, title: string) {
  await page.goto("/account");
  await tile(page, title).first().click();
  await page.waitForURL(/\/account\/listings\/[^/]+$/);
}

/** Its edit form: the profile, the listing, then Edit — #58 items 4 and 6. */
async function openEdit(page: Page, title: string) {
  await openListing(page, title);
  await page.getByRole("link", { name: "Edit", exact: true }).click();
  await page.waitForURL(/\/edit$/);
}

/** Where a listing is RUN, from Home — #56. Pause and resume live here. */
async function openHub(page: Page, title: string) {
  await page.goto("/today");
  await tile(page, title).first().click();
  await page.waitForURL(/\/today\/listing\//);
}

/**
 * Step 1 of the builder, filled in and saved. Returns the draft's id.
 *
 * `/account/listings/new` is the builder's first step since #58 item 7, and the
 * one-screen create form it replaced is deleted. Everything that used to fill
 * that form in one go now fills Basics and walks on.
 */
async function startDraft(page: Page, title: string, category = "adventure") {
  await page.goto("/account/listings/new");
  await page.getByLabel("Name", { exact: true }).fill(title);
  await page.getByLabel("Category", { exact: true }).selectOption(category);
  await page.getByLabel("Where it runs").selectOption("andaman/havelock");
  await page.getByRole("button", { name: "Next" }).click();
  await page.waitForURL(/\/account\/listings\/[^/]+\/edit\?step=selling/);
  return /\/listings\/([^/]+)\/edit/.exec(page.url())?.[1] ?? "";
}

/**
 * The one row the edit screen draws.
 *
 * Scoped to `main`, because on the desktop project the primary nav is a rail of
 * list items and `getByRole("listitem").first()` matches "Home" in it. That is
 * the shape of bug that passes on one project and fails on the other, which is
 * the worst way for a check to be wrong.
 */
function row(page: Page) {
  return page.getByRole("main").getByRole("listitem").first();
}

test("the two old section URLs land where their content went", async ({
  page,
}) => {
  /*
    D-036, yuvoy-operator#56 and #58. The tab had two pages under it and pointed
    at the first, so the footage was a stop nobody found. Every listing is on
    Home now, the library is a tab of the business profile, and both old URLs
    are redirects: operators have them in a browser history and on a printed
    onboarding note, and a dead link is how somebody decides the portal is
    broken.
  */
  await signIn(page);

  await page.goto("/services/activities");
  await page.waitForURL("**/today");

  await page.goto("/services/reels");
  await page.waitForURL(/\/account\?tab=reels/);
  await expect(page.getByRole("link", { name: "Reels" })).toHaveAttribute(
    "aria-current",
    "page",
  );
});

test("the old /reels URL still works", async ({ page }) => {
  // Two redirects deep: `/reels` to `/services/reels` to the Reels tab.
  await signIn(page);
  await page.goto("/reels");
  await page.waitForURL(/\/account\?tab=reels/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Reef Divers Havelock" }),
  ).toBeVisible();
});

test("every listing says where it is, including the ones that are not selling", async ({
  page,
}) => {
  await signIn(page);

  await openEdit(page, "Reef dive");
  await expect(row(page).getByText("Live", { exact: true })).toBeVisible();

  /*
    A DRAFT opens the builder, not the row: a draft is built and a published
    listing is amended, and #58 item 7 made them two screens. Its state is on
    the listing screen, which is where an operator meets it.
  */
  await openListing(page, "Island boat day");
  await expect(page.getByText("Draft", { exact: true })).toBeVisible();
  /*
    What is outstanding is marked on the fields themselves now (#85 s10) and
    counted on the send button, which stays put rather than waiting for the
    listing to be finished before it appears.
  */
  await expect(
    page.getByRole("button", {
      name: /^Send for review \(\d+ things? missing\)$/,
    }),
  ).toBeDisabled();

  /*
    An edit under review does NOT take a live listing off sale, and the badge
    is the whole of what #58 item 4 says such a listing shows: "the badge only",
    and no buttons. So the claim is read from the label, and from the absence of
    anything to press — there is nothing an operator can usefully do while
    somebody is reading their change.
  */
  await openListing(page, "Sunset cruise");
  await expect(page.getByText("Live · edit in review")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Edit", exact: true }),
  ).toHaveCount(0);

  // Why we came back, from the contract's closed set rather than paraphrased.
  await openListing(page, "Night fishing");
  await expect(
    page.getByText(/could not find the meeting point/i),
  ).toBeVisible();
  await expect(page.getByText(/Which jetty gate/)).toBeVisible();
});

test("a listing with no price says so while it is being written", async ({
  page,
}) => {
  /*
    "A listing without `unitPricePaise` can be saved but cannot be approved …
    an operator should learn that while writing it rather than after waiting
    for a review."

    The sentence changed with yuvoy-operator#30 §3 and the CLAIM did not: the
    price used to be the only thing this row could name, derived from
    `sellable`. `publishBlockers` names it alongside everything else that is
    outstanding, so the row still says the price is missing — it just no longer
    pretends that is the whole list.
  */
  await signIn(page);

  /*
    On the listing, which reads a draft back as it stands and marks each
    missing field in place (#85 s10). The price is marked on its own row, and
    that row is the way to the step that answers it.
  */
  await openListing(page, "Island boat day");
  const costs = page.getByRole("region", { name: "What it costs" });
  const priceRow = costs.getByRole("listitem").filter({ hasText: /^Price/ });
  await expect(priceRow).toContainText("Still needed");
  await expect(priceRow.getByRole("link")).toHaveAttribute(
    "href",
    /\/edit\?step=selling$/,
  );

  // What it DOES say is on the screen too, which the old sentence never was.
  await expect(
    page.getByRole("region", { name: "What it says" }),
  ).toContainText("Island boat day");

  /*
    And in the builder, where it can be answered: the step holding the price is
    marked, and Review says the same thing in full.
  */
  await openEdit(page, "Island boat day");
  await expect(page.getByRole("navigation", { name: "Steps" })).toBeVisible();
  await page.goto(`${page.url().split("?")[0]}?step=review`);
  await expect(page.getByText(/Still missing:.*a price/)).toBeVisible();
});

test("nothing on this screen ever says a listing was saved and is selling", async ({
  page,
}) => {
  /*
    The claim that costs a season. "An operator who submits and sees 'Saved'
    will assume they are selling, and will ring us on the day nobody books."
  */
  await signIn(page);
  await openEdit(page, "Reef dive");
  const edit = (await page.locator("body").innerText()).toLowerCase();
  expect(edit).not.toContain("saved ✓");
  expect(edit).not.toContain("published successfully");

  // An edit being read is named for what it is — in review — never "saved".
  await openListing(page, "Sunset cruise");
  const reading = (await page.locator("body").innerText()).toLowerCase();
  expect(reading).not.toContain("saved ✓");
  expect(reading).toContain("in review");
});

test("an operator writes a listing, and it lands as a draft", async ({
  page,
}, testInfo) => {
  /*
    Creating adds a row to state the Next server shares between projects, so a
    slug is per-project. Declared rather than hidden, the same call the
    call-off fixtures make.
  */
  const suffix = testInfo.project.name === "mobile" ? "a" : "b";
  const title = `Mangrove kayak ${suffix}`;

  await signIn(page);
  await startDraft(page, title, "nature_wildlife");

  // A price has to state its basis now — yuvoy-operator#30 §1.
  await page.getByLabel("Price").fill("2200");
  await page.getByRole("radio", { name: "For the group" }).check();
  await page.getByRole("button", { name: "Next" }).click();
  await page.waitForURL(/step=schedule/);

  // It is on the profile, badged for what it is, and reaching nobody.
  await openListing(page, title);
  await expect(page.getByText("Draft", { exact: true })).toBeVisible();
  // Read back as it stands, with what is left counted on the send (#85 s10).
  await expect(
    page.getByRole("region", { name: "What it says" }),
  ).toContainText(title);
  await expect(
    page.getByRole("region", { name: "What it costs" }),
  ).toContainText("For the group");
  await expect(
    page.getByRole("button", {
      name: /^Send for review \(\d+ things? missing\)$/,
    }),
  ).toBeDisabled();
});

test("another market's destination cannot be chosen at all", async ({
  page,
}) => {
  /*
    This test used to type `goa/palolem` into a text box and assert the API's
    own refusal came back. Both halves are gone, and the replacement is
    stronger: since yuvoy-api#113 the field is a picker fed by
    `GET /catalog/vocabulary`, which is "scoped to the operator's own market,
    taken from the session … destinations from another market are refused on
    create, so offering them would be offering a choice that cannot work."

    So a wrong-market destination is now unreachable from the interface rather
    than caught after the form was filled in. The action's 400 branch stays for
    the race it still covers — a destination that closes between the render and
    the submit — but nothing in the UI can reach it on purpose any more.
  */
  await signIn(page);
  await page.goto("/account/listings/new");

  const destination = page.getByLabel("Where it runs");
  const values = await destination
    .locator("option")
    .evaluateAll((nodes) =>
      nodes.map((n) => (n as HTMLOptionElement).value).filter(Boolean),
    );

  expect(values.length).toBeGreaterThan(0);
  for (const value of values) {
    expect(
      value,
      "every destination offered is in this operator's market",
    ).toMatch(/^andaman\//);
  }
});

test("sending a change on a live listing says it keeps selling", async ({
  page,
}, testInfo) => {
  /*
    Its own listing, one per project.

    A revision moves `status` in the shared Next server process, so submitting
    against a row another test asserts on would turn "Live" into "Live · edit
    in review" under whichever ran second — which is exactly what happened
    with `Reef dive`.
    Same call the call-off fixtures make on the day screen.
  */
  const who =
    testInfo.project.name === "mobile"
      ? "Lagoon snorkel (revision fixture A)"
      : "Lagoon snorkel (revision fixture B)";

  await signIn(page);
  await openEdit(page, who);

  const live = row(page);
  await live.getByRole("button", { name: "Propose a change" }).click();

  // Said before the tap, because "the obvious assumption is the opposite".
  await expect(live.getByText(/does not take it off sale/i)).toBeVisible();
  await expect(live.getByText(/keeps what they booked on/i)).toBeVisible();

  await live.getByLabel("Where to meet").fill("Beach 3 dive hut, gate 2");
  await live.getByRole("button", { name: "Send it to us" }).click();

  // Not "saved". With us, and still selling.
  await expect(page.getByText(/Your change is with us/)).toBeVisible();
});

test("the two screens answer the same question from both ends", async ({
  page,
}) => {
  /*
    "This listing has no video" and "this clip is attached to nothing" — both
    from ONE field, `listing` on a media item. The fixture has live listings
    with no clip attached and an approved clip on nothing, so both halves are
    real rather than asserted against an empty set.
  */
  await signIn(page);

  /*
    Scoped to a listing nothing else touches. `e2e/reels.spec.ts` attaches a
    clip to `exp_dive` on the mobile project, and the two projects share one
    Next server — so asserting "no video" against the whole page passed alone
    and failed in a full run, which is the worst way for a check to be wrong.
  */
  await openListing(page, "Blue lagoon (no footage fixture)");
  await expect(page.getByText("Nothing on it yet")).toBeVisible();

  await openEdit(page, "Blue lagoon (no footage fixture)");
  await expect(
    row(page).getByText(/on sale with nothing to show/i),
  ).toBeVisible();
  await expect(
    row(page).getByRole("link", { name: "Your reels" }),
  ).toBeVisible();

  // And from the footage's end: a clip approved and on no listing at all.
  await page.goto("/account?tab=reels");
  await expect(page.getByText("Not on a listing").first()).toBeVisible();
});

test("the two tabs of the profile are one tap apart, and say which is open", async ({
  page,
}) => {
  /*
    What the section switcher did, where it went. `SectionSwitch` counted two
    lists that were two pages; the profile draws the same two as tabs, and
    `aria-current` is the claim that used to be worth a test then and is worth
    one now.
  */
  await signIn(page);
  await page.goto("/account");

  const tabs = page.getByRole("navigation", { name: "What to show" });
  await expect(tabs.getByRole("link", { name: "Listings" })).toHaveAttribute(
    "aria-current",
    "page",
  );

  await tabs.getByRole("link", { name: "Reels" }).click();
  await page.waitForURL(/tab=reels/);
  await expect(tabs.getByRole("link", { name: "Reels" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  // Exactly one. Two lit pills make `aria-current="page"` a lie.
  await expect(tabs.locator('[aria-current="page"]')).toHaveCount(1);
});

test("the price says what the business receives, at its own rate", async ({
  page,
}) => {
  /*
    yuvoy-operator#44. The form asked for a price and never said what arrives.
    The rate was on no readable response until yuvoy-api#180, and hardcoding
    15% was refused on 11 September: a business on its own negotiated rate
    would have been shown a figure that was wrong about its own money.

    ₹4,500 at the fixture's 1500 bps is ₹675 to Yuvoy and ₹3,825 to them.
  */
  await signIn(page);
  // On the Selling step, which is where the price is asked for since #58.
  await startDraft(
    page,
    `Split check ${Math.random().toString(36).slice(2, 7)}`,
  );

  await expect(page.getByText(/You receive/)).toHaveCount(0);
  await page.getByLabel("Price").fill("4500");
  await expect(page.getByText(/You receive/)).toContainText("₹3,825");
  await expect(page.getByText(/You receive/)).toContainText("15%");

  // Nothing at all with no price: there is nothing to split.
  await page.getByLabel("Price").fill("");
  await expect(page.getByText(/You receive/)).toHaveCount(0);
});

test("a listing can be given a health check, from the API's own list", async ({
  page,
}) => {
  /*
    The waiver preview waited on a settable `screenerKey` (yuvoy-api#180). The
    keys come from the vocabulary rather than a list here: a screener is "added
    or retired on medical advice rather than by a release", so a hardcoded
    option would be refused with a 400 the day one changed.
  */
  await signIn(page);
  const id = await startDraft(
    page,
    `Waiver check ${Math.random().toString(36).slice(2, 7)}`,
  );
  // On Location and safety, which is where the waiver is asked for since #58.
  await page.goto(`/account/listings/${id}/edit?step=location`);

  const picker = page.getByLabel("Health check before booking");
  await expect(picker).toBeVisible();
  // "None" is the default, and a real choice: most listings need no waiver.
  await expect(picker).toHaveValue("");
  await expect(
    picker.getByRole("option", { name: "Diving health check (RSTC)" }),
  ).toHaveCount(1);
  // Said plainly, because it turns a party away before any seat is held.
  await expect(
    page.getByText(/turned away before any seat is held/),
  ).toBeVisible();
});

test("the waiver picked on the form is what the listing is saved with", async ({
  page,
}) => {
  /*
    yuvoy-operator#60, and it was live. `createListing` declared `screenerKey`
    on its schema and spread it into the request body, and the object handed to
    `safeParse` never supplied it, so the key was permanently `undefined` and
    every listing created here was saved with no screener whatever was picked.

    ## Why this does not assert the request body, which is what the issue asked

    It cannot, in this portal. `POST /experiences` is made by a Server Action
    inside the Next server, so no request crosses the browser for Playwright to
    intercept, and nothing renders a saved `screenerKey` back for the page to
    show. The issue's own test plan assumes a client-side SPA.

    What replaced it is stronger rather than weaker: `pnpm qa` check 16 fails
    ANY zod schema field the `safeParse` object does not supply, in any module,
    which is the defect class rather than this one instance. It was proven by
    reverting the fix and watching it go red, and this test covers the journey
    as far as a browser can see it: the picker carries the API's own keys, a
    save with one chosen goes through, and the listing lands.
  */
  /*
    "Deep reef", not "Reef dive {suffix}". Tiles are found by title now, and a
    created listing whose name begins with a fixture's name is a tile two tests
    can both match.
  */
  const suffix = Math.random().toString(36).slice(2, 7);
  const title = `Deep reef ${suffix}`;

  await signIn(page);
  const id = await startDraft(page, title);
  await page.goto(`/account/listings/${id}/edit?step=location`);

  await page.getByLabel("Where to meet").fill("Beach 3 dive hut");

  // The key is the API's, from the vocabulary, not a literal typed here.
  const picker = page.getByLabel("Health check before booking");
  await picker.selectOption("diving_rstc");
  await expect(picker).toHaveValue("diving_rstc");

  await page.getByRole("button", { name: "Next" }).click();
  await page.waitForURL(/step=questions/);

  /*
    And it comes BACK, which the one-screen create form could never show: the
    step is read from the draft, so a `screenerKey` that was dropped on the way
    out would be blank on the way in. That is the #60 defect, visible in a
    browser at last.
  */
  await page.goto(`/account/listings/${id}/edit?step=location`);
  await expect(page.getByLabel("Health check before booking")).toHaveValue(
    "diving_rstc",
  );
});

test("leaving the waiver at None saves a listing with no health check", async ({
  page,
}) => {
  /*
    The other half, and the reason the fix reads `""` rather than defaulting:
    "None" is a real answer that most listings give, and it must send no
    `screenerKey` key at all rather than an empty one.
  */
  const suffix = Math.random().toString(36).slice(2, 7);
  const title = `Sunset sail ${suffix}`;

  await signIn(page);
  const id = await startDraft(page, title, "nature_wildlife");
  await page.goto(`/account/listings/${id}/edit?step=location`);

  // Untouched, and that is the point: the default is None.
  await expect(page.getByLabel("Health check before booking")).toHaveValue("");

  await page.getByLabel("Where to meet").fill("Havelock jetty 1");
  await page.getByRole("button", { name: "Next" }).click();
  await page.waitForURL(/step=questions/);

  // Still None, rather than a key nobody chose.
  await page.goto(`/account/listings/${id}/edit?step=location`);
  await expect(page.getByLabel("Health check before booking")).toHaveValue("");
});

test("a first listing sent back says so, and says it is a draft again", async ({
  page,
}) => {
  /*
    yuvoy-api#180. Before `sentBack` existed such a listing sat in review and
    the operator had no way to learn why — `review.rejectionCode` covers a
    rejected EDIT to something already live, which is a different thing.
  */
  await signIn(page);

  /*
    On the listing screen, which leads with the reason — #58 item 4: a sent-back
    listing shows "Sent back: {reason}" and offers Edit and Send again. The
    profile tile carries the same word as its badge, so the two cannot disagree.
  */
  await page.goto("/account");
  await expect(tile(page, "Night fishing")).toContainText("Sent back");

  await openListing(page, "Night fishing");
  await expect(
    page.getByText(/could not find the meeting point/i),
  ).toBeVisible();
  await expect(page.getByText(/Which jetty gate/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Send again" })).toBeVisible();

  // ONE panel, not two. The listing carries a `review.rejectionCode` as well,
  // and two panels about one rejection read as two rejections.
  await expect(page.getByText(/Which jetty gate/)).toHaveCount(1);

  // And the edit form says the same thing, in the row's own words.
  await openEdit(page, "Night fishing");
  await expect(row(page).getByText(/It is a draft again/)).toBeVisible();
});

test("the edit screen has no accessibility violations", async ({ page }) => {
  await signIn(page);
  await openEdit(page, "Reef dive");
  await page.waitForLoadState("networkidle");

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();

  expect(results.violations).toEqual([]);
});

test("a clip can be taken down from the library, with a reason", async ({
  page,
}, testInfo) => {
  /*
    `POST /media/{id}/withdraw` has existed since O8 and could only be reached
    for the clip just uploaded, while its submission panel was on screen. That
    is the case that actually happens — the wrong file, noticed immediately —
    but it is not the endpoint yuvoy-operator#9 describes, and `GET /media` is
    what makes the rest reachable.

    Single-tenant: withdrawal moves state the two projects share, and there is
    one clip in the fixtures whose whole job is to stay attached to nothing.
  */
  test.skip(
    testInfo.project.name !== "mobile",
    "withdrawal consumes a clip — single-tenant by design, so it runs on the primary project only",
  );

  await signIn(page);

  /*
    From the listing's own grid — #58 item 4 — so the clip under test is the one
    attached to a listing nothing else asserts on. Taking down an ATTACHED clip
    is the half of this that matters: it empties the card a traveller is looking
    at, and the form has to name the listing before asking why.
  */
  await openListing(page, "Night fishing");
  await page
    .getByRole("region", { name: "Its reels and photographs" })
    .getByRole("button")
    .first()
    .click();

  const sheet = page.getByRole("dialog");
  await expect(sheet).toContainText("On Night fishing");
  await sheet.getByRole("button", { name: "Take it down" }).click();
  await expect(
    sheet.getByText("It is on Night fishing. That listing loses this video."),
  ).toBeVisible();

  // A reason, and the set is closed on purpose: two of the four are not about
  // the video at all, and those are the ones Yuvoy has to act on.
  await sheet.getByRole("radio", { name: /Somebody in it objected/ }).check();
  await sheet.getByRole("button", { name: "Take it down" }).click();

  /*
    The receipt stays on screen, which is the whole reason nothing here
    revalidates: a re-render would unmount the sheet before the operator read
    it. The half that has happened, and not the half that has not: "it comes off
    Yuvoy immediately, and the original is deleted at the video provider shortly
    afterwards by a job."
  */
  await expect(sheet.getByText(/off Yuvoy/i).first()).toBeVisible();
  await expect(
    sheet.getByText(/deleted at the video provider shortly/).first(),
  ).toBeVisible();
});

test("a reel that is the cover says so, and warns what demoting costs", async ({
  page,
}) => {
  /*
    yuvoy-operator#67, finishing what #58 item 6 parked. `OperatorMedia` carries
    `listing.role` since yuvoy-api#191, so the sheet no longer offers both
    buttons blindly: it says which one this reel is and offers only the move
    that changes something.

    The warning is the half that matters. "Sending `role: gallery` for a
    published hero takes the cover away, so the listing has no cover until
    another item is published as `hero`." An operator tidying a gallery should
    not find that out from the traveller app.

    Its own listing, because `med_published_fixture` is consumed by the takedown
    walk above and this would pass alone and fail in a full run.
  */
  await signIn(page);
  await openListing(page, "Coral wall (cover fixture)");

  const grid = page.getByRole("region", { name: "Its reels and photographs" });
  await grid.getByRole("button", { name: "Reel, Live" }).first().click();

  const sheet = page.getByRole("dialog");
  await expect(sheet.getByText(/This is the listing.s cover/)).toBeVisible();
  await expect(
    sheet.getByRole("button", { name: "Move to gallery" }),
  ).toBeVisible();
  // Not offered: it already IS the cover, and the API would change nothing.
  await expect(
    sheet.getByRole("button", { name: "Make it the cover" }),
  ).toHaveCount(0);
  await expect(
    sheet.getByText(/leaves this listing with no cover/),
  ).toBeVisible();
});

test("a reel in the gallery is offered the promotion and not the demotion", async ({
  page,
}) => {
  /*
    The other side of the same field. Read only: promoting would answer
    `hero_taken` while the cover fixture beside it is still the cover, which is
    the next test.
  */
  await signIn(page);
  await openListing(page, "Coral wall (cover fixture)");

  const grid = page.getByRole("region", { name: "Its reels and photographs" });
  await grid.getByRole("button", { name: "Reel, Live" }).nth(1).click();

  const sheet = page.getByRole("dialog");
  await expect(sheet.getByText("This is in the gallery.")).toBeVisible();
  await expect(
    sheet.getByRole("button", { name: "Make it the cover" }),
  ).toBeVisible();
  await expect(
    sheet.getByRole("button", { name: "Move to gallery" }),
  ).toHaveCount(0);
  /*
    And no warning, because moving a gallery item to the gallery is the no-op
    that is not drawn at all.
  */
  await expect(
    sheet.getByText(/leaves this listing with no cover/),
  ).toHaveCount(0);
});

test("promoting a second reel while one is already the cover is refused in the API's words", async ({
  page,
}, testInfo) => {
  /*
    `409 hero_taken`, and the sentence is the API's own since yuvoy-api#191: the
    way out is to publish the current cover as `gallery`, which demotes it.
    Ours used to say "choose Gallery, or move the current cover to the gallery
    first", which named the right act in words the API no longer uses.

    Single-tenant: a successful promotion would move the fixture's roles, and
    the two projects share one Next server.
  */
  test.skip(
    testInfo.project.name !== "mobile",
    "asserts against a shared pair of role fixtures",
  );

  await signIn(page);
  await openListing(page, "Coral wall (cover fixture)");

  const grid = page.getByRole("region", { name: "Its reels and photographs" });
  await grid.getByRole("button", { name: "Reel, Live" }).nth(1).click();

  const sheet = page.getByRole("dialog");
  await sheet.getByRole("button", { name: "Make it the cover" }).click();

  await expect(sheet.getByRole("alert")).toContainText(
    "This listing already has a cover. Make that one a gallery item first, then try again.",
  );
});

test("a reel already down is offered no way down again", async ({ page }) => {
  /*
    A button that answers 404 teaches an operator to distrust the screen.
    `situation` decides it and nothing else — `sheetActions` in
    `src/lib/services/reel-sheet.ts`, which is unit tested for all eleven
    values. What this proves is the wiring: the sheet a tile opens really is
    drawn from that decision.
  */
  await signIn(page);
  await page.goto("/account?tab=reels");

  const down = page.getByRole("button", { name: "Taken down" }).first();
  await expect(down).toBeVisible();
  await down.click();

  const sheet = page.getByRole("dialog");
  await expect(sheet.getByRole("button", { name: "Take it down" })).toHaveCount(
    0,
  );
});

test("an edit can change the fields that were only ever defaults", async ({
  page,
}) => {
  /*
    yuvoy-operator#30 §5. The contract names these as material — "price, safety
    notes, inclusions, requirements, duration or party size" — and every one of
    them was on the wire and settable nowhere, so every listing this portal
    created shipped as two hours and six people.

    Asserted on the READ side: the form has to arrive carrying what the listing
    already says, or an operator editing one field silently clears the rest.
    The arrays are the interesting half — they are arrays on the wire and one
    per line on the form, and that conversion is easy to get right in one
    direction only.
  */
  await signIn(page);
  await openEdit(page, "Reef dive");

  const row = page.getByRole("main").getByRole("listitem").first();
  await row.getByRole("button", { name: "Propose a change" }).click();

  await expect(row.getByLabel("How long", { exact: true })).toHaveValue("180");
  await expect(row.getByLabel("Most people per booking")).toHaveValue("6");
  await expect(row.getByLabel("What is included")).toHaveValue(
    "Mask and fins\nOne guided dive\nDrinking water",
  );
  await expect(
    row.getByLabel("What a traveller needs", { exact: true }),
  ).toHaveValue("Able to swim 50m\nNo diving within 24h of flying");
  await expect(row.getByLabel("Safety notes")).toHaveValue(
    "Two guides in the water on every dive.",
  );

  // And the basis it already has is shown as chosen, unlike on the create form
  // — showing it blank would read as "we lost your setting".
  await expect(row.getByRole("radio", { name: /Per person/ })).toBeChecked();
});

test("a draft names everything still missing, not just the price", async ({
  page,
}) => {
  /*
    yuvoy-operator#30 §3. The row could only say "No price yet", derived from
    `sellable` — true and incomplete, so an operator sent the listing for
    review and found out the rest from a rejection.

    `exp_boat` is the fixture with four blockers, including the subtle one:
    `pricingUnit` is NOT NULL, so its value cannot say whether anybody chose
    it, and an unstated basis blocks publication rather than printing a guessed
    phrase beside the price.
  */
  await signIn(page);

  /*
    On the listing screen, which leads with it for a draft (#58 item 4), and in
    the builder's Review, which says the same list beside the steps that own it.
  */
  await openListing(page, "Island boat day");
  const missing = page.getByText(/Still missing:/);
  await expect(missing).toContainText("a price");
  await expect(missing).toContainText("a short summary");
  await expect(missing).toContainText(
    "whether that price is per person or for the group",
  );
  // The wire spelling never reaches the operator.
  await expect(page.getByText("unitPricePaise")).toHaveCount(0);
});

test("the activity picker narrows to the chosen category", async ({ page }) => {
  /*
    yuvoy-operator#30 §2. The pair is enforced by a composite foreign key —
    `scuba` under `food_drink` is a 400 — so offering the wrong activities only
    moves the refusal to after the form is filled in.
  */
  await signIn(page);
  await page.goto("/account/listings/new");

  // Nothing before a category is chosen: an unfiltered list would let somebody
  // pick a pair the API refuses.
  await expect(page.getByLabel("Activity", { exact: true })).toBeHidden();

  await page
    .getByLabel("Category", { exact: true })
    .selectOption("nature_wildlife");
  const activity = page.getByLabel("Activity", { exact: true });
  await expect(activity).toBeVisible();
  await expect(
    activity.locator("option", { hasText: "Birdwatching" }),
  ).toHaveCount(1);
  await expect(activity.locator("option", { hasText: "Scuba" })).toHaveCount(0);

  // Switching category re-narrows rather than keeping a now-invalid pair.
  await page.getByLabel("Category", { exact: true }).selectOption("adventure");
  await expect(
    activity.locator("option", { hasText: "Scuba diving" }),
  ).toHaveCount(1);
  await expect(
    activity.locator("option", { hasText: "Birdwatching" }),
  ).toHaveCount(0);
});

test("a listing that predates the taxonomy can be given an activity type", async ({
  page,
}, testInfo) => {
  /*
    yuvoy-operator#39. The selector was on the create form and not the edit
    form, so a listing written before `activityType` became mandatory could
    never acquire one: the operator edits something ordinary, submit succeeds
    because the API marks the field `SubmitDeferred` for exactly this reason,
    and approval refuses days later naming a control that is not on their
    screen. All three older production listings sat in that state.
  */
  /*
    Its own listing, one per project. A revision moves `status` in the shared
    Next server process, so submitting against a row another test asserts on
    would turn "Live" into "Live · edit in review" under whichever ran second
    — the same trap the revision fixtures above exist for.
  */
  const who =
    testInfo.project.name === "mobile"
      ? "Mangrove drift (taxonomy fixture A)"
      : "Mangrove drift (taxonomy fixture B)";

  await signIn(page);
  await openEdit(page, who);

  const row = page.getByRole("main").getByRole("listitem").first();

  // The row names it as outstanding — that half already worked.
  await expect(row.getByText("what kind of activity it is")).toBeVisible();

  await row.getByRole("button", { name: "Propose a change" }).click();

  /*
    And now there is somewhere to answer it. Narrowed to the listing's OWN
    category (`nature_wildlife`), which is fixed after creation — offering
    `scuba` here would move the composite-key 400 to after the form is filled
    in, exactly as it would on the create form.
  */
  const activity = row.getByLabel("Activity", { exact: true });
  await expect(activity).toBeVisible();
  await expect(activity).toHaveValue("");
  await expect(
    activity.locator("option", { hasText: "Birdwatching" }),
  ).toHaveCount(1);
  await expect(activity.locator("option", { hasText: "Scuba" })).toHaveCount(0);

  // It says why it is being asked for, since this listing cannot be approved
  // without it — a demand with no reason is what the row used to be.
  await expect(
    row.getByText(/before this listing can be approved/i),
  ).toBeVisible();

  await activity.selectOption("birdwatching");
  await row.getByRole("button", { name: /Send it to us/i }).click();

  // No success toast, here as everywhere: the operator is told who has it now.
  await expect(row.getByText(/with us/i).first()).toBeVisible();
});

test("a listing's own name can be corrected", async ({ page }) => {
  /*
    Found by the publish-blocker check added for yuvoy-operator#39, not asked
    for by it: `submitRevision` has read `title` off this form since it was
    written and no form ever sent one, so an operator with a typo in their
    listing's name had to ring us and have somebody fix it from the admin
    console — the concierge path this portal exists to remove.
  */
  await signIn(page);
  await openEdit(page, "Reef dive");

  const row = page.getByRole("main").getByRole("listitem").first();
  await row.getByRole("button", { name: "Propose a change" }).click();

  /*
    Asserted on the READ side, and deliberately not submitted: the defect was
    that no control existed at all, and a submit here would move `status` on a
    row other tests assert is plainly on sale — the hazard documented on the
    revision fixtures. The send path is the same `submitRevision` the revision
    test already exercises.
  */
  const title = row.getByLabel("Name", { exact: true });
  await expect(title).toHaveValue("Reef dive");
  await expect(title).toBeEditable();
});

test("a listing can be paused and resumed, and pausing says what it did NOT do", async ({
  page,
}, testInfo) => {
  /*
    yuvoy-operator#30 §6, #44 — the operator's own switch, both ways. Only an
    admin could take a listing off sale, "so an operator whose boat was out of
    the water for a month had to ask somebody at Yuvoy"; and until D-032.4
    putting it back waited on a review — which this test used to assert, in
    "goes through review", and which is now false.

    The assertion that matters most is still the note. **Pausing cancels
    nothing and refunds nothing**: confirmed bookings stand and the operator
    still owes those travellers the trip. Somebody who assumes otherwise does
    not turn up — so the API's own sentence is rendered verbatim.

    Single-tenant: it mutates the shared listing, so it runs on one project.
  */
  test.skip(
    testInfo.project.name !== "mobile",
    "pauses a shared listing — single-tenant by design",
  );

  await signIn(page);
  /*
    On the hub, which is where #56 item 7 moved Pause and Resume: a listing is
    RUN from Home, and taking it off sale for a month is part of running it.
  */
  await openHub(page, "Sunrise paddle");

  const row = page.locator("body");
  /*
    Quiet, and with the rest of what pausing does one tap away rather than two
    paragraphs above the button (yuvoy-operator#85 s8, #80 t4).
  */
  await expect(
    row.getByRole("link", { name: "What pausing does" }),
  ).toHaveAttribute("href", "/account/help#pausing-a-listing");
  await row.getByRole("button", { name: "Pause", exact: true }).click();

  // Warned BEFORE the decision, too.
  await expect(
    row.getByText(/does not cancel the ones you have/i),
  ).toBeVisible();

  await row.getByRole("radio", { name: /Not running this/ }).check();

  // A wrong id is refused, and nothing changes.
  await row.getByLabel(/Type this listing/).fill("exp_wrong");
  await row.getByRole("button", { name: "Pause it" }).click();
  await expect(row.getByText(/does not match this listing/)).toBeVisible();

  await row.getByLabel(/Type this listing/).fill("exp_offsale");
  await row.getByRole("button", { name: "Pause it" }).click();

  await expect(row.getByText("Paused", { exact: true }).first()).toBeVisible();
  // The API's sentence, verbatim — the one that stops somebody not turning up.
  await expect(row.getByText(/are unchanged/)).toBeVisible();
  await expect(
    row.getByText(/upcoming departures have stopped being offered/),
  ).toBeVisible();
  /*
    The API's `next`, rendered VERBATIM again — yuvoy-operator#44.

    It was suppressed, and rightly: the sentence said "ask us to put it back ...
    we check it before travellers see it again", which D-032.4 had made false.
    yuvoy-api#167 rewrote it, so the server's words are printed. Asserted on
    the server's exact phrasing rather than a paraphrase, because a portal that
    quietly substituted its own would pass a looser check.

    The phrase moved once more and this assertion moved with it
    (yuvoy-operator#61). The old matcher, "Put it back on sale yourself
    whenever you are ready", is not what `withdrawnNext` says in
    `internal/handler/operator_listing_copy.go` and had not been for a while.
    It kept passing because the mock carried the same stale words, which is the
    whole defect: a test and a mock agreeing with each other and with nothing
    in production.
  */
  await expect(
    row.getByText(/Resume on the listing puts it back straight away/),
  ).toBeVisible();
  // And still nothing that sends the operator to wait for us.
  await expect(row.getByText(/we check it before travellers/i)).toHaveCount(0);

  // And back, with nothing to wait for.
  await row.getByRole("button", { name: "Resume", exact: true }).click();
  await row.getByRole("button", { name: "Yes, resume it" }).click();
  await expect(row.getByText("Resumed", { exact: true })).toBeVisible();
  /*
    The resume sentence is the server's too. It used to claim "travellers can
    book it now" unconditionally, which is false for a listing whose account
    cannot sell — the portal suppressed it for that, and yuvoy-api#167 made it
    conditional on what is true.
  */
  await expect(
    row.getByText("It is back on sale. Travellers can see it and book it now."),
  ).toBeVisible();
  await expect(row.getByText("Live", { exact: true })).toBeVisible();
});

test("a paused listing that is missing something says what, and stays paused", async ({
  page,
}) => {
  /*
    Resuming "is refused with 400 when something mandatory is missing, so you
    find out while the form is open rather than after putting something back
    that cannot sell". The refusal names the field in words rather than saying
    "something is missing". Nothing changes, so both projects may run it.
  */
  await signIn(page);
  await openHub(page, "Dusk paddle");

  await expect(page.getByText("Paused", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await page.getByRole("button", { name: "Yes, resume it" }).click();
  /*
    `.first()`, because the hub draws two alerts now: the refusal, and the
    listing's own "still missing" panel. Both are true and the refusal is the
    one this test is about.
  */
  await expect(page.getByRole("alert").first()).toContainText(
    "Still missing: where to meet",
  );

  await page.reload();
  await expect(page.getByText("Paused", { exact: true }).first()).toBeVisible();
});
