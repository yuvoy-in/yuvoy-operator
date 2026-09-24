import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * What the business is paid — yuvoy-operator#47.
 *
 * ## What this replaces
 *
 * A month picker over `GET /earnings`. The owner removed it on 14 September,
 * and the reason is that a calendar month was never the unit money moves in: a
 * payout is a Monday-to-Sunday week, and a booking belongs to the week its TRIP
 * happened in. So the old screen's total was a number no transfer ever matched,
 * and every assertion about it went with it.
 *
 * ## The two assertions that matter most
 *
 * A figure that is NOT earned must never appear inside a total. The pipeline is
 * card bookings still to run, and an operator who reads it as earned believes we
 * owe them money for trips that have not happened.
 *
 * And a payout that has not been sent must not offer a statement, because the
 * endpoint answers `409` and the download would always fail.
 */

const DEV_CODE = "424242";
const MANAGER = "+919000000101";
const STAFF = "+919000000103";

async function signIn(page: Page, phone = MANAGER) {
  await page.goto("/sign-in");
  await page.getByLabel("Your phone number").fill(phone);
  await page.getByRole("button", { name: "Send me a code" }).click();
  await page.getByLabel("Your code").fill(DEV_CODE);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/today");
}

test("Money opens on the money, with nobody's name above it", async ({
  page,
}) => {
  /*
    Money is a tab of its own (yuvoy-operator#96), and its one title is the
    heading. The signed-in person's name used to sit above the figures, which
    on a shared phone reads as one staff member's earnings (op#87 t3), and an
    eyebrow over the heading said the same thing twice (op#80 t2).
  */
  await signIn(page);
  await page.goto("/earnings");
  await expect(
    page.getByRole("heading", { level: 1, name: "Money" }),
  ).toBeVisible();
  const main = await page.locator("main").innerText();
  expect(main).not.toContain("Priya Raut");
  expect(main).not.toMatch(/the money/i);
});

test("the next settlement shows the week and the arithmetic", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/earnings");

  /*
    "An operator asking 'why is this ₹200 less than I expected' should be able
    to answer it here rather than by messaging us." A headline with the workings
    hidden answers a different question.
  */
  await expect(page.getByText("Mon 7 Sep to Sun 13 Sep")).toBeVisible();
  /*
    Scoped to the region. Two different weeks legitimately show two different
    nets, and an unscoped match would break the moment a past week happened to
    pay the same amount, which is exactly what the first fixture did.
  */
  const nextWeek = page.getByRole("region", { name: "Next payout" });
  await expect(nextWeek.getByText("₹40,150")).toBeVisible();
  await expect(nextWeek.getByText("₹54,000")).toBeVisible();
  await expect(nextWeek.getByText("₹8,100")).toBeVisible();

  /*
    "Yuvoy's share", the words the Cash screen already uses (op#87 s15). "Our"
    is ambiguous on a screen where "you" is the operator.
  */
  await expect(nextWeek.getByText("Yuvoy's share")).toBeVisible();
  await expect(page.getByText(/our commission/i)).toHaveCount(0);

  /*
    The correction is drawn because the fixture HAS one. A settlement whose
    adjustment is zero never shows this row, which is the point of item 1's
    "only when they are not 0".
  */
  await expect(nextWeek.getByText("Corrections")).toBeVisible();

  // Both hedges. Without them this reads as a promise of a date.
  await expect(page.getByText(/at the earliest/)).toBeVisible();
  await expect(page.getByText(/can still change/)).toBeVisible();
});

test("what is booked and not run is never inside a total", async ({ page }) => {
  /*
    The rule this screen exists to hold. The contract: the pipeline "is
    **never** part of anything earned".

    Asserted structurally rather than by reading a number: the pipeline's figure
    has to be in its own region with its own sentence, and the next
    settlement's block must not contain it.
  */
  await signIn(page);
  await page.goto("/earnings");

  await expect(page.getByText("Booked, not run yet")).toBeVisible();
  await expect(
    page.getByText("Not earned until the trip is marked."),
  ).toBeVisible();

  /*
    Addressed as a REGION, not by guessing at a div. The first draft used
    `locator("section,div").filter(...).first()`, which resolved to an ancestor
    containing the whole page and so could never fail. The panels carry
    `aria-labelledby` now, which makes the structural claim checkable and is the
    reason a screen reader can tell the four blocks apart at all.
  */
  const next = page.getByRole("region", { name: "Next payout" });
  const booked = page.getByRole("region", { name: "Booked, not run yet" });

  // ₹30,600 is the pipeline's net. It belongs in its own region and nowhere
  // near the one that says what we owe.
  await expect(booked.getByText("₹30,600")).toBeVisible();
  await expect(next.getByText("₹30,600")).toHaveCount(0);
});

test("cash is summarised apart, with the way to every trip behind it", async ({
  page,
}) => {
  /*
    Cash held and owed, as a summary with a door to Cash (op#96). The traveller
    pays the operator, so none of it passes through a payout, and it is in no
    figure above it.
  */
  await signIn(page);
  await page.goto("/earnings");

  const cash = page.getByRole("region", { name: "Cash", exact: true });
  /*
    What they took, first, as the Cash screen leads: ₹27,000 recorded on
    completed trips plus ₹15,000 taken for trips still to run.
  */
  await expect(cash).toContainText("₹42,000");
  await expect(cash).toContainText("recorded as taken from travellers");
  await expect(cash).toContainText("Yuvoy's share, owed now");
  await expect(cash).toContainText("₹4,500");
  await expect(cash).toContainText("Cash trips still to run");
  await expect(cash).toContainText("3 · ₹27,000");

  /*
    Trips that ran with no cash recorded are the one thing here that needs
    doing, and in none of the figures: they used to be counted as still to run
    (op#96, yuvoy-api#221).
  */
  const unrecorded = cash.getByRole("link", {
    name: /1 past cash trip has no payment recorded/,
  });
  await expect(unrecorded).toContainText("₹4,500 in fares");
  await expect(unrecorded).toHaveAttribute("href", "/cash#unrecorded");

  await cash.getByRole("link", { name: "Cash you've collected" }).click();
  await page.waitForURL("**/cash");
});

test("the season names its start, not a month", async ({ page }) => {
  await signIn(page);
  await page.goto("/earnings");
  // One line, under past payouts, where the season's panel of sums was.
  await expect(page.getByText("Since 1 April 2026")).toBeVisible();
  await expect(page.getByText(/sent in 18 payouts/)).toBeVisible();
  // And the month picker is gone.
  await expect(page.getByRole("link", { name: "Last month" })).toHaveCount(0);
});

test("past settlements name the three states, and a negative week shows it", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/earnings");

  const list = page.getByRole("link", { name: /to / });
  await expect(list.first()).toBeVisible();

  /*
    Three states, three different promises, and only one of them means money has
    moved. "Paid" rather than "Settled" is the one an operator acts on.
  */
  await expect(page.getByText("Paid ·", { exact: false })).toBeVisible();
  await expect(page.getByText("Approved ·", { exact: false })).toBeVisible();
  await expect(page.getByText("Locked ·", { exact: false })).toBeVisible();

  /*
    A correction larger than what a week pays makes the net below zero, and the
    contract says that week is not paid until we agree how to recover it. A
    screen rendering an absolute value would be telling somebody they are owed
    money we intend to take back.
  */
  await expect(page.getByText("-₹2,175")).toBeVisible();
});

test("a sent payout has a statement; one that is not has none", async ({
  page,
}) => {
  await signIn(page);

  // Sent: the button is there.
  await page.goto("/earnings/stl_sent");
  await expect(
    page.getByRole("button", { name: "Download statement" }),
  ).toBeVisible();
  // And the bank's reference, which only exists once the transfer was told.
  await expect(page.getByText("UTR2026090812345")).toBeVisible();

  /*
    One title, the week; its state is the line under it rather than an
    eyebrow above it (op#80 t2), saying when it was paid. The commission is
    Yuvoy's share here too, and the way back is to Money.
  */
  await expect(page.getByText("Paid on 8 September 2026")).toBeVisible();
  await expect(page.getByText("Yuvoy's share").first()).toBeVisible();
  await expect(page.getByText(/our commission/i)).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Back to Money" }),
  ).toHaveAttribute("href", "/earnings");

  /*
    Approved but not sent: no button. The endpoint answers `409 not_settled`, so
    offering it would be a download that always fails.
  */
  await page.goto("/earnings/stl_approved");
  await expect(page.getByText("Approved, waiting to be sent")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Download statement" }),
  ).toHaveCount(0);
  await expect(page.getByText("UTR2026090812345")).toHaveCount(0);
});

test("the statement downloads, and its bytes are the ones we verified", async ({
  page,
}) => {
  /*
    The whole point of `X-Payout-Sha256`: operator and platform "can each show
    we hold the same file". The Server Action refuses a body whose digest
    disagrees, so a file arriving at all is a file that matched.
  */
  await signIn(page);
  await page.goto("/earnings/stl_sent");

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download statement" }).click();
  const file = await download;

  expect(file.suggestedFilename()).toBe(
    "yuvoy-statement-2026-08-31-to-2026-09-06.csv",
  );
});

test("a settlement explains why its rows do not add up to its total", async ({
  page,
}) => {
  /*
    The contract's own trap: "`adjustmentsPaise` is on the settlement and on no
    line", so the rows' nets differ from the total by exactly that amount. An
    operator adding them up and finding a gap is the most likely reason somebody
    messages us about this screen.
  */
  await signIn(page);
  await page.goto("/earnings/stl_sent");

  await expect(page.getByText("Correction", { exact: true })).toBeVisible();
  await expect(page.getByText(/has no row of its own/)).toBeVisible();

  // The lines themselves, with a cancelled booking's commission of zero.
  await expect(page.getByText("YV-7KJ2MQ")).toBeVisible();
  await expect(page.getByText("YV-9PL4XR")).toBeVisible();
});

test("a settlement that is not this business's is not found", async ({
  page,
}) => {
  await signIn(page);
  const res = await page.goto("/earnings/stl_somebody_else");
  expect(res?.status()).toBe(404);
});

test("the latest statement downloads from the tab itself", async ({ page }) => {
  /*
    Statements are one of the things Money holds (op#96). The newest payout
    that was sent offers its statement here; one locked or approved above it
    has none, and would only ever answer 409.
  */
  await signIn(page);
  await page.goto("/earnings");

  const latest = page.getByRole("region", { name: "Latest statement" });
  await expect(latest).toContainText("Mon 31 Aug to Sun 6 Sep");

  const download = page.waitForEvent("download");
  await latest.getByRole("button", { name: "Download statement" }).click();
  expect((await download).suggestedFilename()).toBe(
    "yuvoy-statement-2026-08-31-to-2026-09-06.csv",
  );
});

test("the bank details are the last door on the tab", async ({ page }) => {
  /*
    Bank details are one of the things Money holds (op#96): the account on
    file is said on its door, as the Payout details screen says it.
  */
  await signIn(page);
  await page.goto("/earnings");
  const door = page.getByRole("link", { name: /^Payout details/ }).last();
  await expect(door).toContainText("HDFC0001234 · account ending 4412");
  await door.click();
  await page.waitForURL("**/payouts");
});

test("the one idea that is not obvious is a tap from its answer", async ({
  page,
}) => {
  /*
    The explanation came off the screen and into Help (op#80 t4); the link
    lands on its answer, open, because the fragment names it.
  */
  await signIn(page);
  await page.goto("/earnings");
  await page.getByRole("link", { name: "How a payout is worked out" }).click();
  await page.waitForURL(/\/account\/help\?from=%2Fearnings#how-payouts-work$/);

  const answer = page.locator("#how-payouts-work");
  await expect(answer).toHaveAttribute("open", "");
  // And back goes where the link was, not to Settings (the audit, M12).
  await expect(
    page.getByRole("link", { name: "Back to money" }),
  ).toHaveAttribute("href", "/earnings");
  await expect(
    answer.getByText(/A payout week runs Monday to Sunday/),
  ).toBeVisible();
});

test("a staff login is told who can see it, rather than meeting a failure", async ({
  page,
}) => {
  /*
    Every settlement endpoint answers 403 to a staff login. Making the call
    anyway put the throw on the error boundary, which says "try again": false,
    and unactionable. An ADMIN can do everything a MANAGER can, so the sentence
    names all three (op#48 item 3).
  */
  await signIn(page, STAFF);
  await page.goto("/earnings");

  await expect(
    page.getByText(
      "Only owners, admins and managers can see what the business is paid",
    ),
  ).toBeVisible();
  await expect(page.getByText(/did not load/)).toHaveCount(0);
});

test("no figure is described by a column value", async ({ page }) => {
  await signIn(page);
  await page.goto("/earnings");
  await expect(page.getByRole("heading", { name: "Money" })).toBeVisible();

  const body = (await page.locator("body").innerText()).toLowerCase();
  for (const token of ["netpaise", "adjustmentspaise", "paid_pending_ops"]) {
    expect(body, `"${token}" is a field name, not a word`).not.toContain(token);
  }
});

test("/earnings has no accessibility violations", async ({ page }) => {
  await signIn(page);
  await page.goto("/earnings");
  await expect(page.getByRole("heading", { name: "Money" })).toBeVisible();

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});

test("a settlement page has no accessibility violations", async ({ page }) => {
  await signIn(page);
  await page.goto("/earnings/stl_sent");
  await expect(page.getByRole("heading", { name: /to / })).toBeVisible();

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});
