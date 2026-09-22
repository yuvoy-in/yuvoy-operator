import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

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

const DEV_CODE = "424242";
const OWNER = "+919000000101";
/** Nisha, ADMIN: may see somebody else's switches. */
const ADMIN = "+919000000114";
/** Dev, MANAGER: has `canManage` and is refused these. */
const MANAGER = "+919000000102";
/** Arun, STAFF, whose switches an owner may turn off. */
const STAFF_ID = "usr_staff_arun";
/** Live and selling, with one required document unmet and its blocker. */
const LIVE_OUTSTANDING = "+919000000115";
/**
 * Waiting on our review, with a pending document that takes a file, on a
 * service with no documents store: its upload intents answer `503`.
 */
const AWAITING = "+919000000106";

/** A one-pixel PNG, as the story suite uses. Small, real, and a valid kind. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAMAASsJTYQAAAAASUVORK5CYII=",
  "base64",
);

async function signIn(page: Page, phone = OWNER) {
  await page.goto("/sign-in");
  await page.getByLabel("Your phone number").fill(phone);
  await page.getByRole("button", { name: "Send me a code" }).click();
  await page.getByLabel("Your code").fill(DEV_CODE);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/today");
}

test("the document count comes from the API, and names what is missing", async ({
  page,
}) => {
  /*
    op#46 item 1. This identity requires five and meets four, and the unmet one
    (`equipment`) has NO credential row at all — so a portal counting rows would
    answer "4 of 4" and tell an operator they were done.

    `LIVE_OUTSTANDING` rather than the owner: an unmet required document comes
    with a `CREDENTIAL_*` blocker, and the main LIVE fixture is the one several
    suites read as "a live account with nothing waiting on you".
  */
  await signIn(page, LIVE_OUTSTANDING);
  await page.goto("/account/verification");

  await expect(
    page.getByText("4 of 5 required documents are verified"),
  ).toBeVisible();

  /*
    And the blocker that says why, beside the document it is about. `exact`
    because `getByText` is a case-insensitive substring match by default, and
    the blocker's own sentence contains the document's name.
  */
  await expect(
    page.getByText("Equipment inspection", { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByLabel("Your documents")
      .getByText("We have no equipment inspection on file."),
  ).toBeVisible();
});

test("a business with everything met says so, counting what the API requires", async ({
  page,
}) => {
  /*
    The other half of item 1. `bank` is in this identity's required set and has
    no credential row, so a portal totalling the rows it can see would answer
    "5" rather than "4".
  */
  await signIn(page);
  await page.goto("/account/verification");
  await expect(
    page.getByText("4 of 4 required documents are verified"),
  ).toBeVisible();
});

test("a document says whether we hold a file, and only a pending one takes one", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/account/verification");

  // Verified, with a file: the name, and nothing to send.
  const boat = page.locator("li").filter({ hasText: "Boat papers" }).first();
  await expect(boat).toContainText("boat-survey-2026.pdf");
  await expect(boat.getByLabel(/^Send the file/)).toHaveCount(0);

  /*
    Pending, with none: "No file sent", and the control. "Once somebody at Yuvoy
    has verified or rejected a document, a new file behind it would change the
    evidence under a decision nobody re-made" — so the two verified rows above
    offer nothing, which is half of what this asserts.
  */
  const oxygen = page
    .locator("li")
    .filter({ hasText: "Oxygen certificate" })
    .first();
  await expect(oxygen).toContainText("No file sent");
  await expect(oxygen.getByLabel(/^Send the file/)).toBeVisible();
});

test("a verified document we hold no file for says so, and asks for a copy", async ({
  page,
}) => {
  /*
    yuvoy-operator#93, production's own row: "1 of 1 required documents are
    verified", then "Directorate registration, Verified, ... No file sent",
    with no way to act. Yuvoy had vouched for a document it could not produce.

    Not simply "Verified" any more, and still no upload control: the
    operator's upload answers `409 document_locked` for a verified document,
    and only our staff attach a file to one (D56). The ask goes by the route
    that can take the file.
  */
  await signIn(page);
  await page.goto("/account/verification");

  const row = page
    .locator("li")
    .filter({ hasText: "Directorate registration" })
    .first();
  await expect(
    row.getByText("Verified, but we hold no file for it"),
  ).toBeVisible();
  await expect(row.getByText("Verified", { exact: true })).toHaveCount(0);
  await expect(
    row.getByText(/A checked document cannot take a file from this screen/),
  ).toBeVisible();
  await expect(
    row.getByRole("link", { name: "+91 81216 57657" }),
  ).toHaveAttribute("href", "tel:+918121657657");
  await expect(row.getByLabel(/^Send the file/)).toHaveCount(0);

  // The summary is about verification, and stays true: it is verified.
  await expect(
    page.getByText("4 of 4 required documents are verified"),
  ).toBeVisible();

  // A verified document WITH a file is still simply verified.
  const boat = page.locator("li").filter({ hasText: "Boat papers" }).first();
  await expect(boat.getByText("Verified", { exact: true })).toBeVisible();
  await expect(boat.getByText(/we hold no file/)).toHaveCount(0);
});

test("a service with no documents store says so plainly, and offers no retry", async ({
  page,
}) => {
  /*
    yuvoy-operator#93. Upload intents answer `503 documents_unavailable` in
    production: no documents bucket is configured, which is an owner item and
    nothing the operator can change. It read "Sending files is not available
    yet." as a failure with "Pick another file" under it, a retry that cannot
    work for as long as the bucket is missing.
  */
  await signIn(page, AWAITING);
  await page.goto("/account/verification");

  const row = page
    .locator("li")
    .filter({ hasText: "Directorate registration" })
    .first();
  await row.getByLabel(/^Send the file/).setInputFiles({
    name: "registration.png",
    mimeType: "image/png",
    buffer: PNG,
  });

  await expect(row.getByRole("status")).toHaveText(
    "Sending files is switched off for now. Nothing to do on your side.",
  );
  await expect(row.getByRole("alert")).toHaveCount(0);
  await expect(
    row.getByRole("button", { name: "Pick another file" }),
  ).toHaveCount(0);
  await expect(row.getByLabel(/^Send the file/)).toHaveCount(0);
});

test("a file over 10 MB is refused before anything is uploaded", async ({
  page,
}) => {
  // Twelve megabytes cross the CDP connection before the page sees them, which
  // is slower than the default budget and is not what is being measured.
  test.setTimeout(90_000);
  /*
    op#46 item 3's own acceptance, and not politeness: "the size and the kind
    are signed into the URL, so the bucket itself refuses a file of any other
    length" — so a 12 MB file would be uploaded in full over an island
    connection and then turned away.
  */
  await signIn(page);
  await page.goto("/account/verification");

  const oxygen = page
    .locator("li")
    .filter({ hasText: "Oxygen certificate" })
    .first();
  await oxygen.getByLabel(/^Send the file/).setInputFiles({
    name: "huge.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.alloc(12 * 1024 * 1024, 7),
  });

  await expect(oxygen.getByRole("alert")).toContainText("over 10 MB");
  // Nothing was sent: the row still holds no file.
  await expect(oxygen).toContainText("No file sent");
});

test("a kind we cannot take names the three we can", async ({ page }) => {
  // An operator holding a HEIC from an iPhone can act on "send a PDF, a JPEG or
  // a PNG" and cannot act on "unsupported file type".
  await signIn(page);
  await page.goto("/account/verification");

  const oxygen = page
    .locator("li")
    .filter({ hasText: "Oxygen certificate" })
    .first();
  await oxygen.getByLabel(/^Send the file/).setInputFiles({
    name: "scan.heic",
    mimeType: "image/heic",
    buffer: Buffer.alloc(1024, 1),
  });

  await expect(oxygen.getByRole("alert")).toContainText(
    "Send a PDF, a JPEG or a PNG.",
  );
});

test("the file goes to the bucket, and the row then names it", async ({
  page,
}, testInfo) => {
  /*
    The whole walk: intent, a cross-origin PUT straight to the store, and the
    complete step that asks the bucket what actually arrived.

    Single-tenant. There is one pending document in the fixtures and sending a
    file to it is not reversible, so the second project would find a document
    that already has one.
  */
  test.skip(
    testInfo.project.name !== "mobile",
    "one pending document, and a file on it cannot be taken off again",
  );

  await signIn(page);
  await page.goto("/account/verification");

  /*
    The GST row, which nothing else reads. `cred_oxygen_pending` is asserted
    empty by the two tests above and by the other Playwright project, and a
    successful upload cannot be undone.
  */
  const gst = page.locator("li").filter({ hasText: "GST certificate" }).first();
  await gst.getByLabel(/^Send the file/).setInputFiles({
    name: "gst-2026.png",
    mimeType: "image/png",
    buffer: PNG,
  });

  await expect(gst.getByText("gst-2026.png is with us")).toBeVisible();
  /*
    And nothing claims the document is verified: "nothing here verifies the
    document. It still waits for somebody at Yuvoy, who opens the file to
    decide."
  */
  await expect(
    gst.getByText(/Somebody at Yuvoy still has to check it/),
  ).toBeVisible();

  // Read back from the server rather than believed: the row carries the name.
  await page.reload();
  await expect(
    page.locator("li").filter({ hasText: "GST certificate" }).first(),
  ).toContainText("gst-2026.png");
});

test("a business with no owner is told no code was sent, and gets no field", async ({
  page,
}, testInfo) => {
  /*
    op#46 item 4's own acceptance. `requestStepUp` returned `sent: true`
    whatever the API said, so somebody at such a business was handed a code
    field and left typing into it waiting for a message nobody sent.

    The business is made here rather than found: a business with no owner is
    exactly one whose first person answered "I run it for the owner" (D15), and
    `POST /auth/signup` makes them its ADMIN. Its own identity per project, and
    it has no bank change in flight, so the form is actually drawn.
  */
  const phone = `+9198${testInfo.project.name === "mobile" ? "1" : "2"}0000001`;
  await page.goto("/signup");
  await page.getByLabel("Your business name").fill("Stand-in Charters");
  await page.getByRole("radio", { name: "I run it for the owner" }).check();
  await page.getByLabel("Your name", { exact: true }).fill("Rohit Das");
  await page.getByLabel("Your phone number").fill(phone);
  // Required until WhatsApp delivers (owner, 21 Sep 2026, op#91).
  await page.getByLabel(/^Email/).fill("rohit@standin.example");
  await page.getByRole("button", { name: "Create the account" }).click();
  await page.getByLabel("Your code").fill(DEV_CODE);
  await page.getByRole("button", { name: "Finish" }).click();
  await page.waitForURL("**/today");

  await page.goto("/payouts");
  /*
    An ADMIN cannot raise a bank change at all, so the form says so before the
    code ever comes up. That is the sentence #50 shipped and it is the right one
    here too: this person's way forward is inviting an owner, not a code.
  */
  await expect(
    page.getByText("Only the owner can change where the money goes."),
  ).toBeVisible();
  await expect(page.getByLabel("The code")).toHaveCount(0);
});

test("a code that WAS sent still gets a field, which is the control", async ({
  page,
}) => {
  /*
    Without this, every assertion above passes against a build that shows nobody
    a code field. The owner's own business has an active owner, so a code goes
    out and the field appears.

    `/payouts` on this fixture has a bank change in flight, which replaces the
    form — so the step-up is reached from a business with none: a fresh signup
    that answered "I own it" is an OWNER with nothing in flight.
  */
  const phone = "+919830000002";
  await page.goto("/signup");
  await page.getByLabel("Your business name").fill("Own It Divers");
  await page.getByRole("radio", { name: "I own it" }).check();
  await page.getByLabel("Your name", { exact: true }).fill("Kavya Nair");
  await page.getByLabel("Your phone number").fill(phone);
  // Required until WhatsApp delivers (owner, 21 Sep 2026, op#91).
  await page.getByLabel(/^Email/).fill("kavya@ownit.example");
  await page.getByRole("button", { name: "Create the account" }).click();
  await page.getByLabel("Your code").fill(DEV_CODE);
  await page.getByRole("button", { name: "Finish" }).click();
  await page.waitForURL("**/today");

  await page.goto("/payouts");
  await page.getByRole("button", { name: "Send the code" }).click();
  await expect(page.getByLabel("The code")).toBeVisible();
  await expect(page.getByText(/No code was sent/)).toHaveCount(0);
});

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

test("/notifications has no accessibility violations", async ({ page }) => {
  await signIn(page);
  await page.goto("/notifications");
  await expect(
    page.getByRole("heading", { name: "Notifications" }),
  ).toBeVisible();

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});
