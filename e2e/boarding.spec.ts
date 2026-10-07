import { test, expect, type Page } from "@playwright/test";
import { expectAccessible } from "./axe";

/**
 * Boarding mode: the manifest built for the jetty at 06:00 (operator
 * experiment D, approved 3 Oct 2026; online first).
 *
 * `slot_cash` leaves tomorrow at 10:00, so it is never boarding-closed
 * whatever hour the suite runs. Its parties are shared with the cash suite,
 * which reads their CASH and never their arrival, so checking one in here
 * changes nothing it reads. One party per project, because arriving is
 * one-way and both projects share the mock's state: Meera on a phone, Sofia
 * on a desktop. Anil is the cash suite's "still to check in", and only the
 * Undo test touches him, which sends nothing.
 */

const DEV_CODE = "424242";
const OWNER = "+919000000101";
const BOAT = "slot_cash";

async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Your phone number").fill(OWNER);
  await page.getByRole("button", { name: "Send me a code" }).click();
  await page.getByLabel("Your code").fill(DEV_CODE);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/today");
}

const toCome = (page: Page) =>
  page.getByRole("region", { name: /^To come · \d+$/ });
const aboard = (page: Page) =>
  page.getByRole("region", { name: /^Aboard · \d+$/ });

test("a departure opens boarding, and Done boarding comes back to it", async ({
  page,
}, testInfo) => {
  await signIn(page);
  await page.goto(`/today/${BOAT}`);
  await page.getByRole("link", { name: "Start boarding" }).click();

  await page.waitForURL(`**/today/${BOAT}/boarding?from=*`);
  // \s, not a space: the kicker's dots follow a no-break space, so that no
  // line ever starts with one.
  await expect(page.getByText(/^Boarding\s·\s10:00/)).toBeVisible();
  // The number read at arm's length, said in words a screen reader can read.
  await expect(page.getByText(/^\d+ of \d+ aboard$/)).toBeVisible();
  // A phone's bar is hidden: this is a screen to go into. (A desktop keeps
  // its rail, as every focused screen does.)
  if (testInfo.project.name === "mobile") {
    await expect(
      page.getByRole("navigation", { name: /Primary/i }),
    ).toHaveCount(0);
  }

  await page.getByRole("link", { name: "Done boarding" }).click();
  await page.waitForURL(`**/today/${BOAT}`);
  await expect(
    page.getByRole("link", { name: "Start boarding" }),
  ).toBeVisible();
});

test("Aboard sinks the party at once, waits five seconds with an Undo, then sends", async ({
  page,
}, testInfo) => {
  const who = testInfo.project.name === "mobile" ? "Meera Das" : "Sofia Alves";
  await signIn(page);
  await page.goto(`/today/${BOAT}/boarding`);

  await page
    .getByRole("button", { name: `Aboard: check in ${who}`, exact: true })
    .click();
  // In Aboard straight away, still to be sent, with the way back.
  await expect(aboard(page)).toContainText(who);
  await expect(aboard(page)).toContainText("Checking in");
  await expect(
    aboard(page).getByRole("button", { name: "Undo" }),
  ).toBeVisible();
  await expectAccessible(page, "boarding, a check-in held with its Undo");

  // Sent once the five seconds are up: a fresh read still has them aboard.
  await expect(aboard(page).getByRole("button", { name: "Undo" })).toHaveCount(
    0,
    { timeout: 15_000 },
  );
  await page.reload();
  await expect(aboard(page)).toContainText(who);
  await expect(toCome(page)).not.toContainText(who);
});

test("Undo takes a check-in back, and nothing is sent", async ({ page }) => {
  await signIn(page);
  await page.goto(`/today/${BOAT}/boarding`);

  await page
    .getByRole("button", { name: "Aboard: check in Anil Kumar", exact: true })
    .click();
  await aboard(page).getByRole("button", { name: "Undo" }).click();
  await expect(toCome(page)).toContainText("Anil Kumar");

  // Past the five seconds, and after a fresh read, he is still to come.
  await page.waitForTimeout(6_000);
  await page.reload();
  await expect(toCome(page)).toContainText("Anil Kumar");
});

test("a party is found by the last four of the reference", async ({ page }) => {
  await signIn(page);
  await page.goto(`/today/${BOAT}/boarding`);

  await page
    .getByLabel("Find a party by name or the last four of their reference")
    .fill("9K3L");
  // Anil, YV-0WED9K3L, and nobody else.
  await expect(
    page.getByRole("button", { name: /^Anil Kumar, 2 guests/ }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /^Kavya Iyer,/ })).toHaveCount(
    0,
  );
});

test("a party opens onto everything else about them", async ({ page }) => {
  await signIn(page);
  await page.goto(`/today/${BOAT}/boarding`);

  await page.getByRole("button", { name: /^Anil Kumar, 2 guests/ }).click();
  const sheet = page.getByRole("dialog", { name: "Anil Kumar" });
  // The manifest's own row: the cash, named, and the booking, with boarding
  // as its way back.
  await expect(
    sheet.getByRole("button", { name: "Take ₹9,000" }),
  ).toBeVisible();
  await expect(sheet.getByRole("link", { name: "Booking" })).toHaveAttribute(
    "href",
    /^\/bookings\/bkg_cash_owed\?from=%2Ftoday%2Fslot_cash%2Fboarding/,
  );
  await expectAccessible(page, "boarding, a party's sheet open");
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
});

test("a boat that has left is closed out, not boarded", async ({ page }) => {
  // slot_dawn is anchored to a few hours ago, so it has always departed.
  await signIn(page);
  await page.goto("/today/slot_dawn");
  await page.getByRole("link", { name: "Close out the boat" }).click();
  await page.waitForURL("**/today/slot_dawn/boarding?from=*");

  await expect(page.getByText(/^Closing out\s·\s/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: /^Aboard: check in/ }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Done", exact: true }),
  ).toBeVisible();
});

test("boarding has no accessibility violations, in sun mode and out of it", async ({
  page,
}) => {
  await signIn(page);
  await page.goto(`/today/${BOAT}/boarding`);
  await expect(page.getByRole("button", { name: "Sun mode" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await expectAccessible(page, "boarding, in sun mode");

  await page.getByRole("button", { name: "Sun mode" }).click();
  await expectAccessible(page, "boarding, out of sun mode");
});

/*
  With no signal (operator experiment D; owner go-ahead and storage ruling,
  4 Oct 2026): a check-in is kept on the phone, survives the app closing, and
  goes when the signal is back. One party per project, because arriving is
  one-way and both projects share the mock's state. Kavya, Tom, Lena and Omar
  are the cash suite's, which reads their cash and never their arrival.
*/
test("with no signal a check-in is kept on the phone, and sent when the signal is back", async ({
  page,
  context,
}, testInfo) => {
  const who = testInfo.project.name === "mobile" ? "Kavya Iyer" : "Tom Becker";
  await signIn(page);
  await page.goto(`/today/${BOAT}/boarding`);

  await context.setOffline(true);
  const strip = page.getByRole("status").filter({ hasText: "No signal" });
  await expect(strip).toContainText(
    "Check-ins and cash you take are kept on this phone and sent when the signal is back.",
  );

  await page
    .getByRole("button", { name: `Aboard: check in ${who}`, exact: true })
    .click();
  // Past its five seconds, kept on the phone rather than sent.
  await expect(aboard(page)).toContainText("Saved on this phone", {
    timeout: 15_000,
  });
  await expect(strip).toContainText(
    "1 check-in is saved on this phone. They send when the signal is back.",
  );
  await expectAccessible(page, "boarding, a check-in kept with no signal");

  // Back online: it goes on its own, and says when.
  await context.setOffline(false);
  await expect(
    page.getByRole("status").filter({ hasText: /was sent at \d\d:\d\d/ }),
  ).toBeVisible({ timeout: 30_000 });
  await page.reload();
  await expect(aboard(page)).toContainText(who);
  await expect(toCome(page)).not.toContainText(who);
});

test("a check-in kept with no signal survives the app closing, and goes from another screen", async ({
  page,
  context,
}, testInfo) => {
  const who = testInfo.project.name === "mobile" ? "Lena Park" : "Omar Haddad";
  await signIn(page);
  await page.goto(`/today/${BOAT}/boarding`);

  await context.setOffline(true);
  await page
    .getByRole("button", { name: `Aboard: check in ${who}`, exact: true })
    .click();
  await expect(aboard(page)).toContainText("Saved on this phone", {
    timeout: 15_000,
  });

  // The phone closes the app at the jetty; the signal comes back later.
  await page.close();
  await context.setOffline(false);
  const later = await context.newPage();
  await later.goto("/today");
  await expect(later.getByRole("heading", { level: 1 }).first()).toBeVisible();

  // Sent from Today, with nobody back on boarding to do it.
  await expect(async () => {
    await later.goto(`/today/${BOAT}/boarding`);
    await expect(aboard(later)).toContainText(who);
    await expect(aboard(later)).not.toContainText("Saved on this phone");
  }).toPass({ timeout: 30_000 });
});
