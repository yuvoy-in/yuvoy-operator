import { test, expect } from "@playwright/test";
import { DEV_CODE, newNumber, fill } from "./signup-kit";

/**
 * O1 — an operator creates their own account.
 *
 * The two claims that matter, both from the contract rather than from taste:
 *
 *   - **Creating an account is not being sellable.** A new account is
 *     `PROSPECT`, and an operator who believes otherwise waits for bookings
 *     that were never possible and concludes we are broken.
 *   - **A number that already has an account gets the same answer.** So the
 *     screen may never say "account created" — it says what to do next, which
 *     is true either way.
 *
 * Every test that writes uses its own phone number. The mock's signups live in
 * the Next server process that both Playwright projects share, so a fixed
 * number would be "already taken" for whichever project ran second — and the
 * duplicate path answers identically, which would hide a real failure.
 */

test("the question is asked, and not answering is refused rather than assumed", async ({
  page,
}) => {
  /*
    `relationship` is OPTIONAL in the contract and "absent means `own`, which is
    what every sign-up meant before the question was asked". Right for a client
    built before D15; wrong for one that can simply ask.

    Assuming it would make somebody who runs a business for its owner into its
    owner, and the first they would hear of it is a bank change they are allowed
    to make. So the form refuses an unanswered choice instead of sending one.
  */
  await page.goto("/signup");
  await expect(
    page.getByText("Do you own this business, or run it for the owner?"),
  ).toBeVisible();
  await expect(page.getByRole("radio", { name: "I own it" })).not.toBeChecked();
  await expect(
    page.getByRole("radio", { name: "I run it for the owner" }),
  ).not.toBeChecked();

  await page.getByLabel("Your business name").fill("Unanswered Divers");
  await page.getByLabel("Your name", { exact: true }).fill("Nobody");
  await page.getByLabel("Your phone number").fill("+919900000099");
  // Given, so the required email is not what stops the form.
  await page.getByLabel(/^Email/).fill("nobody@unanswered.example");
  await page.getByRole("button", { name: "Create the account" }).click();

  await expect(page.locator("form").getByRole("alert")).toContainText(
    "Say whether you own this business or run it for the owner",
  );
  // And nothing was sent: the code step never appeared.
  await expect(page.getByLabel("Your code")).toHaveCount(0);
});

test("the name field stops promising the owner role once they say they do not own it", async ({
  page,
}) => {
  /*
    "You will be the owner on this account" is FALSE for `run`: it makes the
    person an ADMIN, and the business has no owner until they invite one. A
    screen that says otherwise is contradicting itself about the one thing
    somebody came here to set up.
  */
  await page.goto("/signup");
  await page.getByRole("radio", { name: "I own it" }).check();
  await expect(
    page.getByText("You will be the owner on this account."),
  ).toBeVisible();

  await page.getByRole("radio", { name: "I run it for the owner" }).check();
  await expect(
    page.getByText("You will be an admin on this account, not its owner."),
  ).toBeVisible();
  await expect(
    page.getByText("You will be the owner on this account."),
  ).toHaveCount(0);
});

test("running it for the owner creates an ADMIN, and the payout screen proves it", async ({
  page,
}, testInfo) => {
  /*
    op#51 item 1's own acceptance: "signing up with 'I run it for the owner'
    gives `roles: ["ADMIN"]` on `GET /me`."

    Read through the one screen that tells the two apart rather than by poking
    at the API, because that is where it costs somebody something: raising a bank
    change is "three gates, not one: OWNER only", and an admin meets the sentence
    saying so. If this signed them up as an owner, the form would be there.
  */
  const phone = newNumber(8, testInfo);
  await page.goto("/signup");
  await fill(page, {
    business: "Stand-in Charters",
    name: "Rohit Das",
    phone,
    relationship: "I run it for the owner",
  });
  await page.getByRole("button", { name: "Create the account" }).click();
  await page.getByLabel("Your code").fill(DEV_CODE);
  await page.getByRole("button", { name: "Finish" }).click();
  await page.waitForURL("**/today");

  await page.goto("/payouts");
  await expect(
    page.getByText("Only the owner can change where the money goes."),
  ).toBeVisible();
  await expect(page.getByLabel("Name on the account")).toHaveCount(0);
});

test("owning it creates an OWNER, which is the control for the test above", async ({
  page,
}, testInfo) => {
  /*
    The positive control. Without it, the assertion above passes just as well
    against a build that refuses everybody the bank form — and the question
    would have changed nothing.
  */
  const phone = newNumber(9, testInfo);
  await page.goto("/signup");
  await fill(page, {
    business: "Own It Divers",
    name: "Kavya Nair",
    phone,
    relationship: "I own it",
  });
  await page.getByRole("button", { name: "Create the account" }).click();
  await page.getByLabel("Your code").fill(DEV_CODE);
  await page.getByRole("button", { name: "Finish" }).click();
  await page.waitForURL("**/today");

  await page.goto("/payouts");
  await expect(page.getByLabel("Name on the account")).toBeVisible();
});
