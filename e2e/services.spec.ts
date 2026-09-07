import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Manage services — what a business sells, and the footage that sells it.
 *
 * yuvoy-operator#22. Before this an operator could sign in, read what was
 * outstanding on their account, and then do nothing about either: Reels lived
 * behind the Business door and Activities did not exist at all.
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

test("Services is a stop on the bar, and both its pages light it", async ({
  page,
}) => {
  await signIn(page);

  for (const route of ["/services/activities", "/services/reels"]) {
    await page.goto(route);
    const nav = page.getByRole("navigation", { name: /Primary/i }).first();
    const current = nav.getByRole("link", { name: "Services" });
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
  await expect(live.getByText("On sale", { exact: true })).toBeVisible();

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
  */
  await signIn(page);
  await page.goto("/services/activities");
  const draft = page.locator("li").filter({ hasText: "Island boat day" });
  await expect(
    draft.getByText(/No price yet, so we cannot approve it/),
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
  // The one place "on sale" appears is against a listing that IS on sale.
  expect(text).toContain("with us");
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

  await page.getByRole("button", { name: "Add an activity" }).click();
  await page.getByLabel("What is it called").fill(title);
  await page
    .getByLabel("What kind of thing it is")
    .selectOption("nature_wildlife");
  await page.getByLabel("Where it runs").selectOption("andaman/havelock");
  await page.getByLabel("Price per person").fill("2200");
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
  await page.getByRole("button", { name: "Add an activity" }).click();

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
    against a row another test asserts on would take "On sale" away from
    whichever ran second — which is exactly what happened with `Reef dive`.
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
    "This activity has no video" and "this clip is attached to nothing" — both
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
  await expect(page.getByText(/not on any activity/i).first()).toBeVisible();
});

test("the switcher counts both halves, including at zero", async ({ page }) => {
  await signIn(page);
  await page.goto("/services/activities");

  const section = page.getByRole("navigation", { name: "Manage services" });
  await expect(
    section.getByRole("link", { name: /Activities/ }),
  ).toHaveAttribute("aria-current", "page");
  await expect(
    section.getByRole("link", { name: /Photos & reels/ }),
  ).toBeVisible();

  await section.getByRole("link", { name: /Photos & reels/ }).click();
  await page.waitForURL("**/services/reels");
  await expect(
    section.getByRole("link", { name: /Photos & reels/ }),
  ).toHaveAttribute("aria-current", "page");
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
