import { test, expect, type Page } from "@playwright/test";

/**
 * The logo, end to end: yuvoy-operator#89 f10.
 *
 * A LIVE business's `PUT /logo` answers `202 in_review` and keeps the old mark
 * up until somebody has looked (D-032.3). This screen said "Saved. Your mark is
 * on your listings now." about a logo nobody could see, so an operator saw the
 * old one and concluded the product was broken.
 *
 * `PUT /logo` had no mock at all until this file, so the whole save was
 * untested: the page soft-failed its read and nothing ever reached the receipt.
 */

const DEV_CODE = "424242";
const OWNER = "+919000000101"; // the LIVE fixture business
const PROSPECT = "+919000000105"; // not live yet, so a logo is applied at once
const STAFF = "+919000000103";

async function signIn(page: Page, phone: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Your phone number").fill(phone);
  await page.getByRole("button", { name: "Send me a code" }).click();
  await page.getByLabel("Your code").fill(DEV_CODE);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/today");
}

/** A real 1x1 PNG, so nothing on the way can mistake it for another type. */
function pngBytes(): Buffer {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
}

async function sendLogo(page: Page) {
  /*
    Hydrated first: a file set before React attaches `onChange` uploads
    nothing and says nothing (the same trap story.spec.ts hit under load).
  */
  await page.waitForLoadState("networkidle");
  await page.getByLabel(/your logo/i).setInputFiles({
    name: "mark.png",
    mimeType: "image/png",
    buffer: pngBytes(),
  });
}

/*
  One logo per business in the mock, shared by every test in the run, so the
  two writes run in order and on one project. The live one first: it asserts
  that nothing was applied, which the applied one below would contradict.
*/
test.describe.serial("setting a logo", () => {
  test("a live business's new logo is sent for a check, and nothing changes yet", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "mobile",
      "one logo in the shared mock, so single-tenant by design",
    );
    test.setTimeout(60_000);

    await signIn(page, OWNER);
    await page.goto("/logo");
    await expect(page.getByText("You have not set one yet")).toBeVisible();

    await sendLogo(page);

    await expect(page.getByText("Sent to us for a check")).toBeVisible();
    await expect(page.getByText(/on your listings now/)).toHaveCount(0);

    // Nothing was applied: the read an operator would trust says so, and it
    // says the new one is waiting rather than leaving them to wonder.
    await page.reload();
    await expect(page.getByText("You have not set one yet")).toBeVisible();
    await expect(
      page.getByText("A new logo is waiting for our check"),
    ).toBeVisible();
    await expect(
      page.getByText(/It appears on your listings once we have/),
    ).toBeVisible();
  });

  test("a business that is not live yet has its logo saved and shown", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "mobile",
      "one logo in the shared mock, so single-tenant by design",
    );
    test.setTimeout(60_000);

    await signIn(page, PROSPECT);
    await page.goto("/logo");

    await sendLogo(page);

    await expect(
      page.getByText("Saved. Your mark is on your listings now."),
    ).toBeVisible();
    await expect(page.getByText("Sent to us for a check")).toHaveCount(0);

    await page.reload();
    await expect(page.getByText("You have a logo")).toBeVisible();
    await expect(page.getByRole("img", { name: "Your logo" })).toBeVisible();
    // Applied, so nothing is waiting.
    await expect(page.getByText(/waiting for our check/)).toHaveCount(0);
  });
});

test("a staff login is told who can change the logo, before choosing a file", async ({
  page,
}) => {
  /*
    The upload slot and `PUT /logo` are OWNER, ADMIN or MANAGER only. Offering
    the picker meant choosing a picture, waiting for it, and only then being
    told the role could not do it.
  */
  await signIn(page, STAFF);
  await page.goto("/logo");

  await expect(
    page.getByText("Only an owner, an admin or a manager can change the logo."),
  ).toBeVisible();
  await expect(page.getByLabel(/your logo/i)).toHaveCount(0);
});

test("the logo screen leads with its title, and the rest is an answer in Help", async ({
  page,
}) => {
  /*
    yuvoy-operator#80 t2 and t4. It opened with an eyebrow ("Your account"),
    repeated its own title as a caption in the bar, and then said where
    travellers see a logo, which is what the screen IS rather than anything to
    do here.

    What stays is the sentence that changes what somebody does: without it, an
    operator whose new mark has not appeared yet uploads it again.
  */
  await signIn(page, OWNER);
  await page.goto("/logo");

  await expect(
    page.getByRole("heading", { level: 1, name: "Your logo" }),
  ).toBeVisible();
  await expect(page.locator(".eyebrow")).toHaveCount(0);
  // The stage caption is the one `<p>` the screen's header can carry.
  await expect(page.locator("header p")).toHaveCount(0);
  await expect(page.getByText(/on a card with no clip/)).toHaveCount(0);

  await expect(
    page.getByText(/we look at a new logo before it replaces/),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Where travellers see your logo" }),
  ).toHaveAttribute("href", "/account/help?from=%2Flogo#where-logo-appears");
});
