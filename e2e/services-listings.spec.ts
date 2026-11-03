import { test, expect } from "@playwright/test";
import { signIn, openListing, openEdit, startDraft, row } from "./services-kit";

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

test("the two old section URLs land where their content went", async ({
  page,
}) => {
  /*
    D-036, yuvoy-operator#56 and #58. The tab had two pages under it and pointed
    at the first, so the footage was a stop nobody found. The listings are on
    the business profile since yuvoy-operator#96 took them off Home, the
    library is a tab of the same profile, and both old URLs are redirects:
    operators have them in a browser history and on a printed onboarding
    note, and a dead link is how somebody decides the portal is broken.
  */
  await signIn(page);

  await page.goto("/services/activities");
  await page.waitForURL(/\/account$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Reef Divers Havelock" }),
  ).toBeVisible();

  await page.goto("/services/reels");
  await page.waitForURL(/\/account\?tab=reels/);
  await expect(page.getByRole("link", { name: "Reels" })).toHaveAttribute(
    "aria-current",
    "page",
  );
});

test("the old /reels URL still works", async ({ page }) => {
  // One redirect, straight to the Reels tab of the business profile.
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
  // On the step, and on the field (#85 s10: "let Edit open on that field").
  await expect(priceRow.getByRole("link")).toHaveAttribute(
    "href",
    /\/edit\?step=selling&field=unitPricePaise$/,
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

test("a change to a live listing says which half is live and which is with us", async ({
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

  /*
    One field the operator owns and one we read (D-032.3). The meeting point
    is live the moment it is sent; the summary waits for us, and the listing
    keeps selling meanwhile. The row used to say "with us" to both.
  */
  await live.getByLabel("Where to meet").fill("Beach 3 dive hut, gate 2");
  // And a pin, which a live listing can only get here (yuvoy-operator#113).
  const pin = live.getByRole("group", { name: "Pin on the map" });
  await pin
    .getByRole("searchbox", {
      name: "Search for a place, or paste a maps link",
    })
    .fill("11.9695, 92.9631");
  await pin.getByRole("button", { name: /Put the pin at/ }).click();
  await live.getByLabel("One line about it").fill("Two tanks, one reef");
  await live.getByRole("button", { name: "Send it to us" }).click();

  const answer = live.getByRole("status").filter({ hasText: "Live now" });
  await expect(answer).toContainText(
    "The first list is live now. We read the second",
  );
  await expect(answer).toContainText("Live now: Where to meet, Pin on the map");
  await expect(answer).toContainText("With us: One line about it");
  await expect(answer).not.toContainText(/saved/i);
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
