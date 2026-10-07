import { test, expect, type Locator, type Page } from "@playwright/test";
import { expectAccessible } from "./axe";

/**
 * Yuvoy's commission on cash trips, billed weekly (yuvoy-operator#121, owner
 * decision D-043).
 *
 * A traveller who pays at the counter pays the business, so the business
 * holds Yuvoy's share of it. From the Tuesday after each week with cash trips
 * the API issues a statement, and the business pays it by UPI.
 *
 * ## What these hold
 *
 *   - What is owed is the statements' total, on Money, and nowhere a figure
 *     that counts paid trips too.
 *   - A statement shows its trips, its payments and what is left, and offers
 *     a UPI link that pays exactly that, with the UPI ID and payee as text
 *     beside it and the reference to keep in the note.
 *   - A waived statement reads as settled, with nothing to pay.
 *
 * Reef Divers (the owner) has four statements, one in each state, ₹3,550
 * owed across them. The manager has none.
 */

const DEV_CODE = "424242";
const OWNER = "+919000000101";
const MANAGER = "+919000000102";
const STAFF = "+919000000103";

async function signIn(page: Page, phone = OWNER) {
  await page.goto("/sign-in");
  await page.getByLabel("Your phone number").fill(phone);
  await page.getByRole("button", { name: "Send me a code" }).click();
  await page.getByLabel("Your code").fill(DEV_CODE);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/today");
}

/** The rows that open a statement, found by the week each one names. */
const statementRows = (scope: Page | Locator) =>
  scope.getByRole("link", { name: /^Mon \d+ [A-Z][a-z]{2} to Sun/ });

test("Money leads with what is owed, and every statement still to pay", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/earnings");

  const bill = page.getByRole("region", { name: "Commission to pay" });
  await expect(bill).toContainText("₹3,550");
  await expect(bill).toContainText("owed to Yuvoy on 2 statements");

  /*
    Each row: the week, its trips, its commission, what is owed, its state.
    Both statements still to pay, then the newest settled one, newest first.
  */
  const rows = statementRows(bill);
  await expect(rows).toHaveText([
    /^Mon 21 Sep to Sun 27 Sep\s*2 trips · ₹2,250 commission\s*To pay\s*₹2,250 owed$/,
    /^Mon 14 Sep to Sun 20 Sep\s*3 trips · ₹3,300 commission\s*Part paid\s*₹1,300 owed$/,
    /^Mon 10 Aug to Sun 16 Aug\s*1 trip · ₹1,350 commission\s*Paid\s*Nothing owed$/,
  ]);

  // First on the tab: it is the one thing on it to do.
  const leads = await page.evaluate(() => {
    const bill = document.getElementById("commission-to-pay");
    const payout = document.getElementById("next-payout");
    return Boolean(
      bill &&
      payout &&
      bill.compareDocumentPosition(payout) & Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });
  expect(leads).toBe(true);

  // The fourth is one tap away.
  await bill.getByRole("link", { name: "All statements" }).click();
  await page.waitForURL("**/earnings/commission");
  await expect(statementRows(page)).toHaveCount(4);
});

test("the full list is newest first, with what is owed across it", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/earnings/commission");

  await expect(
    page.getByRole("heading", { level: 1, name: "Commission statements" }),
  ).toBeVisible();
  await expect(page.getByText("owed to Yuvoy on 2 statements")).toBeVisible();
  await expect(statementRows(page)).toHaveText([
    /^Mon 21 Sep/,
    /^Mon 14 Sep/,
    /^Mon 10 Aug/,
    /^Mon 3 Aug .*Settled\s*Nothing owed$/,
  ]);
});

test("a statement shows its trips, its payments, and how to pay what is left", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/earnings/commission/cst_part_paid");

  await expect(
    page.getByRole("heading", { level: 1, name: "Mon 14 Sep to Sun 20 Sep" }),
  ).toBeVisible();
  await expect(page.getByText("Part paid. ₹1,300 still to pay.")).toBeVisible();

  // Each trip: reference, day, guests, fare, rate, commission.
  const trips = page.getByRole("region", { name: "Trips on this statement" });
  await expect(trips.getByRole("listitem")).toHaveCount(3);
  const trip = trips.getByRole("listitem").filter({ hasText: "YV-2KW9TJ" });
  await expect(trip).toContainText("Thu 17 Sep");
  await expect(trip).toContainText("2 guests");
  await expect(trip).toContainText(/Fare\s*₹8,000/);
  await expect(trip).toContainText(/Rate\s*12.5%/);
  await expect(trip).toContainText(/Commission\s*₹1,000/);

  // The payments recorded against it.
  const payments = page.getByRole("region", { name: "Payments received" });
  await expect(payments).toContainText("₹2,000");
  await expect(payments).toContainText("Received 24 September 2026");
  await expect(payments).toContainText("425918736201");

  /*
    The button opens a UPI app on exactly what is left, to Yuvoy, with the
    reference as the note; the UPI ID and payee are text beside it.
  */
  const pay = page.getByRole("region", { name: "Pay this statement" });
  await expect(
    pay.getByRole("link", { name: "Pay ₹1,300 by UPI" }),
  ).toHaveAttribute(
    "href",
    /^upi:\/\/pay\?pa=yuvoy\.dev%40example&pn=[^&]+&am=1300\.00&cu=INR&tn=YC-3HD8WQ4N$/,
  );
  await expect(pay).toContainText("yuvoy.dev@example");
  await expect(pay).toContainText("Yuvoy (development)");
  await expect(pay).toContainText(
    "Keep YC-3HD8WQ4N in the payment note, so we can match your payment to this statement.",
  );
  await expect(
    pay.getByRole("button", { name: "Copy the UPI ID" }),
  ).toBeVisible();
});

test("a trip where less was taken says the commission is on the fare", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/earnings/commission/cst_issued");

  const trip = page
    .getByRole("region", { name: "Trips on this statement" })
    .getByRole("listitem")
    .filter({ hasText: "YV-9RT2KD" });
  await expect(trip).toContainText(
    "You recorded taking ₹4,000. The commission is worked out on the fare.",
  );
  // Nothing has been paid against it yet.
  await expect(
    page.getByRole("region", { name: "Payments received" }),
  ).toContainText("Nothing received yet.");
});

test("a waived statement reads as settled, with nothing to pay", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/earnings/commission/cst_waived");

  await expect(
    page.getByText("Settled on 25 August 2026. Nothing more to pay."),
  ).toBeVisible();
  await expect(page.getByText("Settled", { exact: true })).toBeVisible();
  // What was not collected is said, so the figures still close.
  await expect(page.getByText("Not collected")).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Pay this statement" }),
  ).toHaveCount(0);
  await expect(page.getByRole("link", { name: /by UPI/ })).toHaveCount(0);
});

test("a paid statement offers nothing to pay", async ({ page }) => {
  await signIn(page);
  await page.goto("/earnings/commission/cst_paid");

  await expect(page.getByText("Paid in full.")).toBeVisible();
  await expect(page.getByRole("link", { name: /by UPI/ })).toHaveCount(0);
});

const nothingThere = (page: Page) =>
  page.getByRole("heading", {
    level: 1,
    name: "There is nothing at that address",
  });

test("a statement that does not exist is not found", async ({ page }) => {
  await signIn(page);
  const res = await page.goto("/earnings/commission/cst_somebody_else");
  expect(res?.status()).toBe(404);
  await expect(nothingThere(page)).toBeVisible();
});

test("a statement this login cannot see is not found, not an error", async ({
  page,
}) => {
  /*
    The manager reads no statements in the mock, so the owner's answers 404
    to them, exactly as another business's does from the API.
  */
  await signIn(page, MANAGER);
  const res = await page.goto("/earnings/commission/cst_issued");
  expect(res?.status()).toBe(404);
  await expect(nothingThere(page)).toBeVisible();
});

test("with no statement, Money draws no commission block at all", async ({
  page,
}) => {
  await signIn(page, MANAGER);
  await page.goto("/earnings");
  await expect(
    page.getByRole("heading", { level: 1, name: "Money" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Commission to pay" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Commission statements" }),
  ).toHaveCount(0);
});

test("staff are told, not refused into the error boundary", async ({
  page,
}) => {
  await signIn(page, STAFF);
  for (const path of [
    "/earnings/commission",
    "/earnings/commission/cst_issued",
  ]) {
    await page.goto(path);
    await expect(
      page.getByText(
        "Only owners, admins and managers can see what the business owes",
      ),
    ).toBeVisible();
    await expect(page.getByText(/did not load/i)).toHaveCount(0);
  }
});

test("how to pay is one tap from a statement, and comes back to it", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/earnings/commission/cst_issued");
  await page.getByRole("link", { name: "How to pay a statement" }).click();
  await page.waitForURL(
    /\/account\/help\?from=%2Fearnings%2Fcommission%2Fcst_issued#settling-cash$/,
  );
  const answer = page.locator("#settling-cash");
  await expect(answer).toHaveAttribute("open", "");
  await expect(answer.getByText(/tap Pay by UPI/)).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Back to the statement" }),
  ).toHaveAttribute("href", "/earnings/commission/cst_issued");
});

test("a statement page has no accessibility violations", async ({ page }) => {
  await signIn(page);
  await page.goto("/earnings/commission/cst_part_paid");
  await expect(
    page.getByRole("region", { name: "Pay this statement" }),
  ).toBeVisible();

  await expectAccessible(page, "a statement, part paid");
});

test("the statements list has no accessibility violations", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/earnings/commission");
  await expect(statementRows(page)).toHaveCount(4);

  await expectAccessible(page, "the statements list");
});
