import { test, expect } from "@playwright/test";
import { expectAccessible } from "./axe";
import { signIn } from "./documents-kit";

/**
 * Documents, the payout code, and notification switches — yuvoy-operator#46.
 *
 * ## The three claims worth testing
 *
 *   - **The count is the API's, not ours.** `requiredDocuments` "can grow when a
 *     listing in a new category is approved", so a portal counting the rows it
 *     can see answers a different question and tells an operator they are
 *     finished when they are not.
 *   - **Only a pending document takes a file.** A verified one answers
 *     `409 document_locked`, so the control is withheld rather than offered.
 *   - **A code that was never sent has no field to type into.** The action
 *     returned `sent: true` whatever the API said, and at a business with no
 *     owner there is nobody it could have gone to.
 *
 * ## State this suite shares
 *
 * Uploading and toggling both write to the mock's state in the Next server
 * process both Playwright projects share, so each test that writes uses its own
 * switch or its own credential, or declares itself single-tenant.
 */

/** Nisha, ADMIN: may see somebody else's switches. */
const ADMIN = "+919000000114";
/** Dev, MANAGER: has `canManage` and is refused these. */
const MANAGER = "+919000000102";
/** Arun, STAFF, whose switches an owner may turn off. */
const STAFF_ID = "usr_staff_arun";

test("every role sees every switch, and what each one covers", async ({
  page,
}) => {
  /*
    op#46 item 5. "Every person sees every switch, so this is how a staff member
    can tell that a payout summary was never going to reach them" — the
    descriptions are the API's words for exactly that reason.
  */
  await signIn(page, "+919000000103");
  await page.goto("/notifications");

  await expect(
    page.getByRole("heading", { name: "Notifications" }),
  ).toBeVisible();
  for (const label of [
    "New bookings",
    "Guest cancellations",
    "Today's departures",
    "Seats to confirm",
    "Payout sent",
    "Documents running out",
  ]) {
    await expect(page.getByText(label, { exact: true })).toBeVisible();
  }

  // The one that tells a staff member why they never see a payout summary.
  await expect(
    page.getByText(/Owners, admins and managers only/),
  ).toBeVisible();

  /*
    And what has no switch at all. "Some messages have no switch, and
    `alwaysSent` says which" — five switches otherwise read as the whole of what
    somebody will be told.
  */
  await expect(page.getByText(/Some messages have no switch/)).toBeVisible();
});

test("seat confirmations has its own switch, on by default, where the API puts it", async ({
  page,
}) => {
  /*
    yuvoy-operator#94 item 3. `NotificationGroup` gained `seat_confirmations`:
    once a day, the departures off sale, or going off sale within a day,
    because nobody confirmed their seats. The row is the API's words, drawn
    the same way as the other switches, and it is on until somebody turns it
    off. Read only: the toggling tests below own the switches they change.
  */
  await signIn(page);
  await page.goto("/notifications");

  const row = page.locator("li").filter({ hasText: "Seats to confirm" });
  await expect(
    row.getByText(/Once a day, the departures that are off sale/),
  ).toBeVisible();
  await expect(row.getByRole("checkbox")).toBeChecked();

  // After the day's work and before money, as the API orders them.
  const labels = await page
    .locator("li")
    .filter({ has: page.getByRole("checkbox") })
    .allInnerTexts();
  const at = (text: string) => labels.findIndex((l) => l.includes(text));
  expect(at("Seats to confirm")).toBeGreaterThan(at("Today's departures"));
  expect(at("Seats to confirm")).toBeLessThan(at("Payout sent"));

  // And on somebody else's screen, which draws the same list.
  await page.goto(`/team/${STAFF_ID}/notifications`);
  await expect(
    page
      .locator("li")
      .filter({ hasText: "Seats to confirm" })
      .getByRole("checkbox"),
  ).toBeVisible();
});

test("turning a switch off survives a reload", async ({ page }, testInfo) => {
  /*
    op#46 item 5's acceptance. A switch each per project: the mock's state is
    shared, and two tests toggling one would each see the other's answer.
  */
  const label =
    testInfo.project.name === "mobile"
      ? "Guest cancellations"
      : "Documents running out";
  await signIn(page);
  await page.goto("/notifications");

  const row = page.locator("li").filter({ hasText: label });
  const box = row.getByRole("checkbox");
  await expect(box).toBeChecked();
  /*
    `click`, not `uncheck`. The checkbox is server-authoritative: it is redrawn
    from the answer rather than flipped locally, so between the click and the
    response it is still checked and `uncheck` reports that its click "did not
    change its state" and tries again. Waiting on the assertion below is the
    honest way to watch for the answer.
  */
  await box.click();
  await expect(box).not.toBeChecked();

  await page.reload();
  await expect(
    page.locator("li").filter({ hasText: label }).getByRole("checkbox"),
  ).not.toBeChecked();

  // Put it back, so the next run starts where this one did. `click` for the
  // same reason as above: the state follows the answer, not the click.
  const again = page
    .locator("li")
    .filter({ hasText: label })
    .getByRole("checkbox");
  await again.click();
  await expect(again).toBeChecked();
});

test("an owner turns a staff switch off, and that person sees who did it", async ({
  page,
}, testInfo) => {
  /*
    op#46 item 6's own acceptance, walked end to end. The attribution is the
    point: an owner may turn somebody else's switch off, and that person opening
    their own screen should find out who rather than conclude the portal did it.

    Single-tenant: one staff member, one switch, and the name written on it is
    read back by a second sign-in.
  */
  test.skip(
    testInfo.project.name !== "mobile",
    "one staff member's switch, read back by a second sign-in",
  );

  await signIn(page);
  await page.goto("/team");
  await page
    .locator("li")
    .filter({ hasText: "Arun Biswas" })
    .getByRole("link", { name: "Their notifications" })
    .click();
  await page.waitForURL(`**/team/${STAFF_ID}/notifications`);

  await expect(
    page.getByRole("heading", { name: "Arun Biswas" }),
  ).toBeVisible();
  const row = page.locator("li").filter({ hasText: "Today's departures" });
  await row.getByRole("checkbox").click();
  await expect(row.getByRole("checkbox")).not.toBeChecked();
  // Redrawn from the answer, so the attribution appears without a reload — and
  // it says nothing about the owner to the owner, who was there.
  await expect(row.getByText(/Changed by/)).toHaveCount(0);

  // Now as Arun, on his own screen.
  await page.context().clearCookies();
  await signIn(page, "+919000000103");
  await page.goto("/notifications");

  const his = page.locator("li").filter({ hasText: "Today's departures" });
  await expect(his.getByRole("checkbox")).not.toBeChecked();
  await expect(his.getByText(/^Changed by Priya Raut on /)).toBeVisible();
});

test("a manager is refused somebody else's switches, and offered nothing", async ({
  page,
}) => {
  /*
    The narrowest gate on the team screens: `PUT /team/{id}/notifications` is
    OWNER or ADMIN and NOT `canManage`, so a MANAGER meets a 403 while being
    allowed plenty elsewhere. The link is withheld and the route says so.
  */
  await signIn(page, MANAGER);
  await page.goto("/team");
  await expect(
    page.getByRole("link", { name: "Their notifications" }),
  ).toHaveCount(0);

  await page.goto(`/team/${STAFF_ID}/notifications`);
  await expect(
    page.getByText(
      "Only an owner or an admin can change somebody else's notifications",
    ),
  ).toBeVisible();
});

test("an admin is offered them, because an admin stands in for the owner", async ({
  page,
}) => {
  // The positive control. Without it every assertion above passes against a
  // build that hides the link from everybody.
  await signIn(page, ADMIN);
  await page.goto("/team");
  await expect(
    page
      .locator("li")
      .filter({ hasText: "Arun Biswas" })
      .getByRole("link", { name: "Their notifications" }),
  ).toBeVisible();
});

test("an invitation is not a person, so it has no switches", async ({
  page,
}) => {
  // "That `id` is an invitation, not a person", and the endpoint has nobody to
  // answer for.
  await signIn(page);
  await page.goto("/team");

  await expect(
    page
      .locator("li")
      .filter({ hasText: "Ramesh Toppo" })
      .getByRole("link", { name: "Their notifications" }),
  ).toHaveCount(0);
});

test("both notification screens lead with their title, and nothing above it", async ({
  page,
}) => {
  /*
    yuvoy-operator#80 t2 and t4, on both of them. Each opened with an eyebrow
    over its heading, repeated its title as a caption in the bar, and then
    said what the screen is, over a list where every switch already carries
    the API's own description of what it covers.

    One sentence survives, on somebody else's screen, and it survives because
    this route lives under /team: "no switch exists that could silence a
    security warning", so what turning one off does NOT do is worth saying
    before somebody turns it off expecting it to.
  */
  await signIn(page);
  await page.goto("/notifications");

  await expect(
    page.getByRole("heading", { level: 1, name: "Notifications" }),
  ).toBeVisible();
  await expect(page.locator(".eyebrow")).toHaveCount(0);
  // The stage caption is the one `<p>` the screen's header can carry.
  await expect(page.locator("header p")).toHaveCount(0);
  await expect(
    page.getByText(/Which messages about the business reach you/),
  ).toHaveCount(0);

  await page.goto(`/team/${STAFF_ID}/notifications`);

  await expect(
    page.getByRole("heading", { level: 1, name: "Arun Biswas" }),
  ).toBeVisible();
  await expect(page.locator(".eyebrow")).toHaveCount(0);
  await expect(page.locator("header p")).toHaveCount(0);
  await expect(
    page.getByText(/Which messages about the business reach them/),
  ).toHaveCount(0);
  await expect(
    page.getByText("Changing a switch here does not change what they can do."),
  ).toBeVisible();
});

test("/notifications has no accessibility violations", async ({ page }) => {
  await signIn(page);
  await page.goto("/notifications");
  await expect(
    page.getByRole("heading", { name: "Notifications" }),
  ).toBeVisible();

  await expectAccessible(page, "/notifications");
});
