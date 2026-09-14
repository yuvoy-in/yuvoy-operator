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

test("Listings is a stop on the bar, and both its pages light it", async ({
  page,
}) => {
  await signIn(page);

  for (const route of ["/services/activities", "/services/reels"]) {
    await page.goto(route);
    const nav = page.getByRole("navigation", { name: /Primary/i }).first();
    const current = nav.getByRole("link", { name: "Listings" });
    await expect(current).toHaveAttribute("aria-current", "page");

    /*
      And exactly one stop is current. Two lit pills would make
      `aria-current="page"` a lie, which is what happened while `/reels` was
      still in the Business prefix list.
    */
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
  }
});

test("neither half is a focused screen, so nothing sends you out of the section", async ({
  page,
}) => {
  /*
    Reels was focused while it lived behind the Business door — a back disc and
    no tab bar. The two lists are now halves of one job an operator moves
    between constantly, so both are roots.
  */
  await signIn(page);
  await page.goto("/services/reels");
  await expect(
    page.getByRole("link", { name: /Back to your business/i }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("navigation", { name: /Primary/i }).first(),
  ).toBeVisible();
});

test("the old /reels URL still works", async ({ page }) => {
  // Operators have it in a browser history and on a printed onboarding note.
  await signIn(page);
  await page.goto("/reels");
  await page.waitForURL("**/services/reels");
  await expect(
    page.getByRole("heading", { level: 1, name: "Photos & reels" }),
  ).toBeVisible();
});

test("every listing says where it is, including the ones that are not selling", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/services/activities");

  const live = page.locator("li").filter({ hasText: "Reef dive" });
  await expect(live.getByText("Live", { exact: true })).toBeVisible();

  const draft = page.locator("li").filter({ hasText: "Island boat day" });
  await expect(draft.getByText("Draft", { exact: true })).toBeVisible();
  await expect(draft.getByText(/sent to nobody/i)).toBeVisible();

  /*
    The state the contract calls out, because "the obvious assumption is the
    opposite": an edit under review does NOT take a live listing off sale, and
    travellers who already booked keep the price and terms they booked on.
  */
  const editing = page.locator("li").filter({ hasText: "Sunset cruise" });
  await expect(
    editing.getByText(/still on sale on the old terms/i),
  ).toBeVisible();

  // Why we came back, from the contract's closed set rather than paraphrased.
  const rejected = page.locator("li").filter({ hasText: "Night fishing" });
  await expect(
    rejected.getByText(/could not find the meeting point/i),
  ).toBeVisible();
  await expect(rejected.getByText(/Which jetty gate/)).toBeVisible();
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
  await page.goto("/services/activities");
  const draft = page.locator("li").filter({ hasText: "Island boat day" });
  await expect(draft.getByText("a price")).toBeVisible();
  await expect(
    draft.getByText(/missing before we can approve it/),
  ).toBeVisible();
});

test("nothing on this screen ever says a listing was saved and is selling", async ({
  page,
}) => {
  /*
    The claim that costs a season. "An operator who submits and sees 'Saved'
    will assume they are selling, and will ring us on the day nobody books."
  */
  await signIn(page);
  await page.goto("/services/activities");
  const text = (await page.locator("body").innerText()).toLowerCase();
  expect(text).not.toContain("saved ✓");
  expect(text).not.toContain("published successfully");
  // An edit being read is named for what it is — in review — never "saved".
  expect(text).toContain("in review");
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
  await page.goto("/services/activities");

  await page.getByRole("button", { name: "Add a listing" }).click();
  await page.getByLabel("What is it called").fill(title);
  await page
    .getByLabel("What kind of thing it is")
    .selectOption("nature_wildlife");
  await page.getByLabel("Where it runs").selectOption("andaman/havelock");
  await page.getByLabel("Price", { exact: true }).fill("2200");
  // A price has to state its basis now — yuvoy-operator#30 §1.
  await page.getByRole("radio", { name: /For the group/ }).check();
  await page.getByRole("button", { name: "Save as a draft" }).click();

  // A draft, and the screen says what that is NOT.
  await expect(page.getByText(`${title} is a draft`)).toBeVisible();
  await expect(page.getByText(/reaches nobody yet/)).toBeVisible();

  const row = page.locator("li").filter({ hasText: title });
  await expect(row.getByText("Draft", { exact: true })).toBeVisible();
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
  await page.goto("/services/activities");
  await page.getByRole("button", { name: "Add a listing" }).click();

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
  await page.goto("/services/activities");

  const live = page.locator("li").filter({ hasText: who });
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
  await page.goto("/services/activities");
  const blank = page.locator("li").filter({ hasText: "Sunset cruise" });
  await expect(blank.getByText(/on sale with nothing to show/i)).toBeVisible();
  await expect(
    blank.getByRole("link", { name: "Photos & reels" }),
  ).toBeVisible();

  await page.goto("/services/reels");
  await expect(page.getByText(/not on any listing/i).first()).toBeVisible();
});

test("the switcher counts both halves, including at zero", async ({ page }) => {
  await signIn(page);
  await page.goto("/services/activities");

  const section = page.getByRole("navigation", { name: "What you sell" });
  await expect(section.getByRole("link", { name: /Listings/ })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(
    section.getByRole("link", { name: /Photos & reels/ }),
  ).toBeVisible();

  await section.getByRole("link", { name: /Photos & reels/ }).click();
  await page.waitForURL("**/services/reels");
  await expect(
    section.getByRole("link", { name: /Photos & reels/ }),
  ).toHaveAttribute("aria-current", "page");
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
  await page.goto("/services/activities");
  await page
    .getByRole("button", { name: /Add a listing|New listing/i })
    .click();

  await expect(page.getByText(/You receive/)).toHaveCount(0);
  await page.getByLabel("Price", { exact: true }).fill("4500");
  await expect(page.getByText(/You receive/)).toContainText("₹3,825");
  await expect(page.getByText(/You receive/)).toContainText("15%");

  // Nothing at all with no price: there is nothing to split.
  await page.getByLabel("Price", { exact: true }).fill("");
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
  await page.goto("/services/activities");
  await page
    .getByRole("button", { name: /Add a listing|New listing/i })
    .click();

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
  const suffix = Math.random().toString(36).slice(2, 7);
  const title = `Reef dive ${suffix}`;

  await signIn(page);
  await page.goto("/services/activities");
  await page.getByRole("button", { name: "Add a listing" }).click();

  await page.getByLabel("What is it called").fill(title);
  await page.getByLabel("What kind of thing it is").selectOption("adventure");
  await page.getByLabel("Where it runs").selectOption("andaman/havelock");
  await page.getByLabel("Price", { exact: true }).fill("4500");
  await page.getByRole("radio", { name: /Per person/ }).check();

  // The key is the API's, from the vocabulary, not a literal typed here.
  const picker = page.getByLabel("Health check before booking");
  await picker.selectOption("diving_rstc");
  await expect(picker).toHaveValue("diving_rstc");

  await page.getByRole("button", { name: "Save as a draft" }).click();

  // Saved rather than refused. A key the API does not know answers 400 with
  // `details.screenerKey`, so a listing landing at all says the key was one it
  // accepted.
  await expect(page.getByText(`${title} is a draft`)).toBeVisible();
  const row = page.locator("li").filter({ hasText: title });
  await expect(row.getByText("Draft", { exact: true })).toBeVisible();
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
  await page.goto("/services/activities");
  await page.getByRole("button", { name: "Add a listing" }).click();

  await page.getByLabel("What is it called").fill(title);
  await page
    .getByLabel("What kind of thing it is")
    .selectOption("nature_wildlife");
  await page.getByLabel("Where it runs").selectOption("andaman/havelock");
  await page.getByLabel("Price", { exact: true }).fill("2200");
  await page.getByRole("radio", { name: /For the group/ }).check();

  // Untouched, and that is the point: the default is None.
  await expect(page.getByLabel("Health check before booking")).toHaveValue("");

  await page.getByRole("button", { name: "Save as a draft" }).click();
  await expect(page.getByText(`${title} is a draft`)).toBeVisible();
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
  await page.goto("/services/activities");

  const row = page.getByRole("listitem").filter({ hasText: "Night fishing" });
  await expect(row.getByText(/We sent this back to you/)).toBeVisible();
  await expect(row.getByText(/Which jetty gate/)).toBeVisible();
  await expect(row.getByText(/It is a draft again/)).toBeVisible();

  // ONE panel, not two. The row carries a `review.rejectionCode` as well, and
  // two panels about one rejection read as two rejections.
  await expect(row.getByText(/Which jetty gate/)).toHaveCount(1);
});

test("/services/activities has no accessibility violations", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/services/activities");
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
  await page.goto("/services/reels");

  /*
    The clip that is live on a listing — its own fixture, attached to a listing
    nothing else asserts on. Taking down an ATTACHED clip is the half of this
    that matters: it empties the card a traveller is looking at, and the form
    has to name the listing before asking why.
  */
  const clip = page.locator("li").filter({ hasText: "Listing: Night fishing" });
  await clip.getByRole("button", { name: "Take it down" }).click();
  await expect(
    clip.getByText("It is on Night fishing. That listing loses this video."),
  ).toBeVisible();

  // A reason, and the set is closed on purpose: two of the four are not about
  // the video at all, and those are the ones Yuvoy has to act on.
  await clip.getByRole("radio", { name: /Somebody in it objected/ }).check();
  await clip.getByRole("button", { name: "Take it down" }).click();

  /*
    The row itself, not a panel. Withdrawing revalidates — the list must stop
    showing a clip as live the moment it is not — and that re-render unmounts
    the form's own success state, so the sentence lives on the row instead.

    The half that has happened, and not the half that has not: "it comes off
    Yuvoy immediately, and the original is deleted at the video provider
    shortly afterwards by a job."
  */
  const gone = page.locator("li").filter({ hasText: "Taken down" });
  await expect(gone.getByText(/off Yuvoy/i).first()).toBeVisible();
  await expect(
    gone.getByText(/deleted at the video provider shortly/).first(),
  ).toBeVisible();
});

test("a clip nobody can act on is offered no way down", async ({ page }) => {
  // A button that answers 404 teaches an operator to distrust the screen.
  await signIn(page);
  await page.goto("/services/reels");
  const waiting = page
    .locator("li")
    .filter({ hasText: "A person at Yuvoy will watch it." })
    .first();
  await expect(waiting).toBeVisible();
  // Attested and waiting IS actionable — it is on Yuvoy. A failed upload is
  // not, and carries nothing to take down.
  const failed = page.locator("li").filter({ hasText: "Upload failed" });
  await expect(
    failed.getByRole("button", { name: "Take it down" }),
  ).toHaveCount(0);
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
  await page.goto("/services/activities");

  const row = page.locator("li").filter({ hasText: "Reef dive" });
  await row.getByRole("button", { name: "Propose a change" }).click();

  await expect(row.getByLabel("How long, in minutes")).toHaveValue("180");
  await expect(row.getByLabel("Most people per booking")).toHaveValue("6");
  await expect(row.getByLabel("What is included")).toHaveValue(
    "Mask and fins\nOne guided dive\nDrinking water",
  );
  await expect(
    row.getByLabel("What a traveller needs to bring or be able to do"),
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
  await page.goto("/services/activities");

  const row = page.locator("li").filter({ hasText: "Island boat day" });
  await expect(row.getByText(/things are missing/)).toBeVisible();
  await expect(row.getByText("a price")).toBeVisible();
  await expect(row.getByText("a short summary")).toBeVisible();
  await expect(
    row.getByText("whether that price is per person or for the group"),
  ).toBeVisible();
  // The wire spelling never reaches the operator.
  await expect(row.getByText("unitPricePaise")).toBeHidden();
});

test("the activity picker narrows to the chosen category", async ({ page }) => {
  /*
    yuvoy-operator#30 §2. The pair is enforced by a composite foreign key —
    `scuba` under `food_drink` is a 400 — so offering the wrong activities only
    moves the refusal to after the form is filled in.
  */
  await signIn(page);
  await page.goto("/services/activities");
  await page.getByRole("button", { name: "Add a listing" }).click();

  // Nothing before a category is chosen: an unfiltered list would let somebody
  // pick a pair the API refuses.
  await expect(page.getByLabel("What kind of activity")).toBeHidden();

  await page
    .getByLabel("What kind of thing it is")
    .selectOption("nature_wildlife");
  const activity = page.getByLabel("What kind of activity");
  await expect(activity).toBeVisible();
  await expect(
    activity.locator("option", { hasText: "Birdwatching" }),
  ).toHaveCount(1);
  await expect(activity.locator("option", { hasText: "Scuba" })).toHaveCount(0);

  // Switching category re-narrows rather than keeping a now-invalid pair.
  await page.getByLabel("What kind of thing it is").selectOption("adventure");
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
  await page.goto("/services/activities");

  const row = page.locator("li").filter({ hasText: who });

  // The row names it as outstanding — that half already worked.
  await expect(row.getByText("what kind of activity it is")).toBeVisible();

  await row.getByRole("button", { name: "Propose a change" }).click();

  /*
    And now there is somewhere to answer it. Narrowed to the listing's OWN
    category (`nature_wildlife`), which is fixed after creation — offering
    `scuba` here would move the composite-key 400 to after the form is filled
    in, exactly as it would on the create form.
  */
  const activity = row.getByLabel("What kind of activity");
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
  await page.goto("/services/activities");

  const row = page.locator("li").filter({ hasText: "Reef dive" });
  await row.getByRole("button", { name: "Propose a change" }).click();

  /*
    Asserted on the READ side, and deliberately not submitted: the defect was
    that no control existed at all, and a submit here would move `status` on a
    row other tests assert is plainly on sale — the hazard documented on the
    revision fixtures. The send path is the same `submitRevision` the revision
    test already exercises.
  */
  const title = row.getByLabel("What it is called");
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
  await page.goto("/services/activities");

  const row = page.locator("li").filter({ hasText: "Sunrise paddle" });
  await expect(row.getByText("Live", { exact: true })).toBeVisible();
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
  await page.goto("/services/activities");

  const row = page.locator("li").filter({ hasText: "Dusk paddle" });
  await expect(row.getByText("Paused", { exact: true })).toBeVisible();
  await row.getByRole("button", { name: "Resume", exact: true }).click();
  await row.getByRole("button", { name: "Yes, resume it" }).click();
  await expect(row.getByRole("alert")).toContainText(
    "Still missing: where to meet",
  );

  await page.reload();
  await expect(
    page
      .locator("li")
      .filter({ hasText: "Dusk paddle" })
      .getByText("Paused", { exact: true }),
  ).toBeVisible();
});
