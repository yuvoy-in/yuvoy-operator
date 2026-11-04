import { test, expect, type Page } from "@playwright/test";
import { expectAccessible } from "./axe";
import { signIn, openListing, openEdit, row } from "./services-kit";

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

/**
 * Where a listing is RUN (#56): its hub, where pause and resume live.
 *
 * Found from Business since yuvoy-operator#96 took the listing tiles off
 * Home: the tile opens the listing, and its id opens the hub. By the id rather
 * than by a link's words, so a reworded link on the listing screen cannot
 * take every walkthrough through here with it.
 */
async function openHub(page: Page, title: string) {
  await openListing(page, title);
  const id = /\/account\/listings\/([^/?#]+)/.exec(page.url())?.[1];
  if (!id) throw new Error(`no listing id in ${page.url()}`);
  await page.goto(`/today/listing/${id}`);
}

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
    On the listing screen, which reads a draft back as it stands (#85 s10):
    each gap is marked on its own row, where it belongs, rather than gathered
    into one sentence, and the send says how many there are.
  */
  await openListing(page, "Island boat day");
  const says = page.getByRole("region", { name: "What it says" });
  const costs = page.getByRole("region", { name: "What it costs" });
  await expect(
    costs.getByRole("listitem").filter({ hasText: /^Price/ }),
  ).toContainText("Still needed");
  await expect(
    says.getByRole("listitem").filter({ hasText: /^One line about it/ }),
  ).toContainText("Still needed");
  // The subtle one: a basis nobody stated is a gap, never a guessed phrase.
  const basis = costs
    .getByRole("listitem")
    .filter({ hasText: /^That price is/ });
  await expect(basis).toContainText("Still needed");
  await expect(basis).not.toContainText("Per person");
  await expect(
    page.getByRole("button", {
      name: /^Send for review \(\d+ things? missing\)$/,
    }),
  ).toBeDisabled();
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
  ).toHaveAttribute(
    "href",
    "/account/help?from=%2Ftoday%2Flisting%2Fexp_offsale#pausing-a-listing",
  );
  await row.getByRole("button", { name: "Pause", exact: true }).click();

  // Warned BEFORE the decision, too, in a question that names the listing
  // (a named confirm, owner ruling 3 Oct 2026; its id used to be typed back).
  await expect(
    row.getByText(/^Pause Sunrise paddle\? It stops new bookings\./),
  ).toBeVisible();
  await expect(
    row.getByText(/does not cancel the ones you have/i),
  ).toBeVisible();
  await expectAccessible(page, "the listing hub, its pause confirm open");

  await row.getByRole("radio", { name: /Not running this/ }).check();
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
