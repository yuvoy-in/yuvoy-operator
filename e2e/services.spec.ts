import { test, expect } from "@playwright/test";
import { expectAccessible } from "./axe";
import {
  signIn,
  tile,
  openListing,
  openEdit,
  startDraft,
} from "./services-kit";

/*
  The meeting-point map's two outside hosts (yuvoy-operator#113), aborted:
  the live edit and the Location step show the pin control, and this suite
  must not load a third party's tiles. See e2e/builder.spec.ts.
*/
test.beforeEach(async ({ context }) => {
  await context.route(
    /^https:\/\/(tiles\.openfreemap\.org|photon\.komoot\.io)\//,
    (route) => route.abort(),
  );
});

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

  /*
    And Edit opens the draft's own steps, which is how a draft is changed ("change
    it with PATCH /experiences/{id} and send it with POST .../submit"), saying
    the same thing above them. It opened the revision form, which has no
    category, place or landmark to fix (the audit before release, O3).
  */
  await page.getByRole("link", { name: "Edit", exact: true }).click();
  await page.waitForURL(/\/edit/);
  await expect(page.getByText(/It is a draft again/)).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: /steps/i }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Propose a change" }),
  ).toHaveCount(0);
});

test("the edit screen has no accessibility violations", async ({ page }) => {
  await signIn(page);
  await openEdit(page, "Reef dive");
  await page.waitForLoadState("networkidle");

  await expectAccessible(page, "a listing's edit screen");
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
