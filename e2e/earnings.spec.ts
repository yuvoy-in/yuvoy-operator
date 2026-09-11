import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * O11 — what the operator is owed, and why it is that number.
 *
 * Read-only, so the assertions are about what the screen SAYS rather than what
 * it does. The two that matter: an operator must not plan against a figure
 * that can still move, and must know when a bank change is holding the money.
 */

const DEV_CODE = "424242";

async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Your phone number").fill("+919000000101");
  await page.getByRole("button", { name: "Send me a code" }).click();
  await page.getByLabel("Your code").fill(DEV_CODE);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/today");
}

test("the business door links to earnings", async ({ page }) => {
  await signIn(page);
  await page.goto("/account");
  await page.getByRole("link", { name: /^Earnings/ }).click();
  await page.waitForURL("**/earnings");
  await expect(page.getByRole("heading", { name: "Earnings" })).toBeVisible();
});

test("the arithmetic is shown, not just the total", async ({ page }) => {
  await signIn(page);
  await page.goto("/earnings");

  /*
    "An operator asking 'why is this ₹200 less than I expected' should be able
    to answer it here rather than by messaging us." A headline with the
    workings hidden answers a different question.
  */
  // Scoped to the month's totals: every booking below repeats these labels.
  const totals = page.getByRole("region", { name: "This month" });
  await expect(totals.getByText("Gross", { exact: true })).toBeVisible();
  await expect(totals.getByText("Yuvoy's commission")).toBeVisible();
  await expect(totals.getByText("Refunds", { exact: true })).toBeVisible();
  await expect(totals.getByText("Net", { exact: true })).toBeVisible();

  // Paise rendered as rupees, in the Indian grouping.
  await expect(totals.getByText("₹54,000")).toBeVisible();
  await expect(totals.getByText("− ₹8,100")).toBeVisible();
  await expect(totals.getByText("₹41,400")).toBeVisible();

  // And it must not claim the figures disagree when they do not.
  await expect(page.getByText("These figures do not add up")).toHaveCount(0);
});

test("a figure that can still move says so; a settled one does not", async ({
  page,
}) => {
  await signIn(page);

  // This month is provisional.
  await page.goto("/earnings");
  await expect(page.getByText(/Still adding up/)).toBeVisible();

  // Last month is settled — no warning, and a different sentence.
  await page.goto("/earnings?month=last");
  await expect(page.getByText(/This period is closed/)).toBeVisible();
  await expect(page.getByText(/Still adding up/)).toHaveCount(0);
});

test("each booking shows what it contributed, and the list says why it does not sum", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/earnings");

  const list = page.getByRole("region", { name: "By booking" });

  /*
    `OperatorBooking.money` (yuvoy-api#60): the same frozen figures the totals
    sum, per booking, so "why is THIS one less" is answered on the row. Asha
    Menon's two seats at ₹4,500 — gross ₹9,000, commission ₹1,350, no refund,
    net ₹7,650 — and the row's own check stays quiet because it adds up.
  */
  const row = list.locator("li").filter({ hasText: "YV-4K2M9P7Q" });
  await expect(row.getByText("Asha Menon")).toBeVisible();
  await expect(row.getByText("₹9,000")).toBeVisible();
  await expect(row.getByText("− ₹1,350")).toBeVisible();
  await expect(row.getByText("₹7,650")).toBeVisible();
  await expect(row.getByText(/do not add up/)).toHaveCount(0);

  // A refund is a deduction on its own line, not a smaller gross: the
  // operator sees WHICH line moved.
  const refunded = list.locator("li").filter({ hasText: "YV-9Q5R2W6C" });
  await expect(refunded.getByText("− ₹4,500")).toBeVisible();
  await expect(refunded.getByText("₹3,150")).toBeVisible();

  /*
    "Absent, not zeroed." A seat request nobody has answered is a booking that
    has captured nothing, so it carries no money and says so — never a row of
    ₹0s inviting somebody to reconcile it. `req_urgent` is the request no test
    ever answers, so it is always here.

    And its state in the operator's words. This line used to assert that the
    raw `pending_request` token was on screen, which pinned the defect rather
    than the fact; "no booking is described by a column value" below holds
    the other half.
  */
  const awaiting = list.locator("li").filter({ hasText: "Reuben Mathai" });
  await expect(awaiting.getByText(/No money has moved/)).toBeVisible();
  await expect(awaiting.getByText("Waiting on you")).toBeVisible();
  await expect(awaiting.getByText("₹0")).toHaveCount(0);

  // No traveller phone number, anywhere on this list (O12).
  await expect(list.getByText(/\+91\d{10}/)).toHaveCount(0);

  /*
    Not summed, and the screen says so. `/earnings` selects on when the money
    moved; this list on when the trip runs — a page of these will not
    reproduce the total unless both windows agree, and an operator holding a
    calculator has to be told that before they start.
  */
  await expect(
    list.getByText(/Reconcile one booking against itself/),
  ).toBeVisible();
});

test("/earnings has no accessibility violations", async ({ page }) => {
  await signIn(page);
  await page.goto("/earnings");
  await page.waitForLoadState("networkidle");

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();

  expect(results.violations).toEqual([]);
});

test("no booking is described by a column value", async ({ page }) => {
  /*
    The By booking list printed `· pending_request` beside a booking with no
    money — the raw `fulfilment_state` yuvoy-operator#34 removed from Bookings
    and this list kept. Said in the operator's words now, and a cash booking
    says it was taken at the counter rather than showing gross ₹0 and a
    negative net.
  */
  await signIn(page);
  await page.goto("/earnings");
  await expect(page.getByRole("heading", { name: "Earnings" })).toBeVisible();

  const body = (await page.locator("body").innerText()).toLowerCase();
  for (const token of ["pending_request", "paid_pending_ops", "no_show"]) {
    expect(body, `"${token}" is a column value, not a word`).not.toContain(
      token,
    );
  }
});
