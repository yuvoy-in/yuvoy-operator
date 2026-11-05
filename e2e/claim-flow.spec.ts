import { test, expect, type Page } from "@playwright/test";
import { expectAccessible } from "./axe";

/**
 * The claim, signed in (yuvoy-operator#388, the web half of
 * yuvoy-mobile#388): the four proofs and what comes after each, the email
 * code sent and checked, the listings that cannot be claimed, who may claim,
 * and the claims list on Verification.
 *
 * The mock server is shared by every worker, and a listing takes one waiting
 * claim at a time. So each test claims its own `e2e-` listing, made by the
 * mock on first sight; its ending picks the edge (`mocks/claims-handlers.ts`).
 */

const DEV_CODE = "424242";
const OWNER = "+919000000101";
const MANAGER = "+919000000102";
/** Their claims list is one claim in every state. */
const EVERY_STATE = "+919000000119";
/** Their claims list does not load. */
const LIST_FAILS = "+919000000111";

/** A listing for this test alone, retries included. */
function listing(edge = "") {
  const info = test.info();
  const who = `${info.project.name}-${info.testId}-${info.retry}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-");
  return `e2e-${who}${edge ? `-${edge}` : ""}`;
}

/** Signs in from the claim link's own Sign in, so it lands back on the claim. */
async function signInTo(page: Page, path: string, phone = OWNER) {
  await page.goto(`/sign-in?next=${encodeURIComponent(path)}`);
  await page.getByLabel("Your phone number").fill(phone);
  await page.getByRole("button", { name: "Send me a code" }).click();
  await page.getByLabel("Your code").fill(DEV_CODE);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => url.pathname === path);
}

const ask = (page: Page) => page.getByRole("button", { name: "Ask to claim" });
const proof = (page: Page, name: RegExp) => page.getByRole("radio", { name });

test("signed out, Sign in brings the person back to the claim", async ({
  page,
}) => {
  const slug = listing();
  await page.goto(`/claim/${slug}`);
  await page.getByRole("link", { name: "Sign in" }).click();
  await page.getByLabel("Your phone number").fill(OWNER);
  await page.getByRole("button", { name: "Send me a code" }).click();
  await page.getByLabel("Your code").fill(DEV_CODE);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(`**/claim/${slug}`);
  await expect(page.getByTestId("claim-listing-name")).toHaveText(/^Test /);
});

test("an owner posts a code on their page, and finds it under Verification", async ({
  page,
}) => {
  const slug = listing("code");
  await signInTo(page, `/claim/${slug}`);
  await expect(page.getByText("Claim a listing")).toBeVisible();
  await expect(page.getByRole("radio")).toHaveCount(4);
  await expectAccessible(page, "the claim form");
  await expect(ask(page)).toBeDisabled();
  await proof(page, /Post a code on your own page/).check();
  await ask(page).click();

  await expect(
    page.getByRole("heading", { name: "Post this code on your page" }),
  ).toBeVisible();
  await expect(page.getByTestId("claim-proof-code")).toHaveText("YUVOY-7KQ4MX");
  await expect(
    page.getByRole("button", { name: "Copy code YUVOY-7KQ4MX" }),
  ).toBeVisible();
  await expect(page.getByTestId("claim-decide")).toHaveText(
    "We email the owner when we decide.",
  );

  await page
    .getByRole("link", { name: "See your claims under Verification" })
    .click();
  await page.waitForURL("**/account/verification");
  const claims = page.getByTestId("claims");
  await expect(
    claims.getByRole("heading", { name: "Listing claims" }),
  ).toBeVisible();
  const name = await page.getByTestId(/^claim-row-name-/).allTextContents();
  expect(name.some((n) => n.startsWith("Test "))).toBe(true);
  await expect(claims.getByText("YUVOY-7KQ4MX").first()).toBeVisible();
});

test("an owner proves it by email: a wrong address, a wrong code, then the right one", async ({
  page,
}) => {
  const slug = listing("email");
  await signInTo(page, `/claim/${slug}`);
  await proof(page, /Get a code at your business email/).check();
  await ask(page).click();

  const address = page.getByLabel("Your address at claimtest.yuvoy.in");
  await address.fill("priya@gmail.com");
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Use an address at the listing's website.",
  );
  await expect(address).toHaveValue("priya@gmail.com");

  await address.fill("priya@claimtest.yuvoy.in");
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(
    page.getByText(
      "If that address is at your website, a code is on its way. It can take a few minutes.",
    ),
  ).toBeVisible();

  const code = page.getByLabel("Enter the six-digit code");
  await code.fill("135791");
  await page.getByRole("button", { name: "Check code" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "That code did not work. Ask for a new one.",
  );
  await code.fill("246810");
  await page.getByRole("button", { name: "Check code" }).click();
  await expect(
    page.getByText("Email checked. A person at Yuvoy decides next."),
  ).toBeVisible();
});

test("a call or papers claim says what we do next", async ({ page }) => {
  const slug = listing("call");
  await signInTo(page, `/claim/${slug}`);
  await proof(page, /We call your business/).check();
  await ask(page).click();
  await expect(page.getByTestId("claim-next")).toHaveText(
    "We will call the number on your public page. Nothing more to do here.",
  );
});

test("a listing with no website has the email proof greyed before any tap", async ({
  page,
}) => {
  await signInTo(page, `/claim/${listing("nosite")}`);
  await expect(proof(page, /Get a code at your business email/)).toBeDisabled();
  await expect(page.getByTestId("claim-no-website")).toHaveText(
    "This listing has no website, so prove it another way.",
  );
  await proof(page, /Send us your papers/).check();
  await ask(page).click();
  await expect(page.getByTestId("claim-next")).toHaveText(
    "We will get in touch to ask for your papers. Nothing more to do here.",
  );
});

for (const edge of ["held", "busy"]) {
  test(`a listing that is ${edge === "held" ? "held already" : "waiting on another claim"} is not open`, async ({
    page,
  }) => {
    await signInTo(page, `/claim/${listing(edge)}`);
    await expect(page.getByTestId("claim-not-open")).toHaveText(
      "A claim on this listing is already with our team, or a business holds it already.",
    );
    await expect(ask(page)).toHaveCount(0);
  });
}

test("a second claim on a listing is the API's sentence", async ({ page }) => {
  const slug = listing("twice");
  await signInTo(page, `/claim/${slug}`);
  await proof(page, /We call your business/).check();
  await ask(page).click();
  await expect(page.getByTestId("claim-made")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("claim-not-open")).toBeVisible();
});

test("too many claims today is the API's sentence, and the choice stays", async ({
  page,
}) => {
  await signInTo(page, `/claim/${listing("limited")}`);
  await proof(page, /Send us your papers/).check();
  await ask(page).click();
  await expect(page.getByTestId("claim-error")).toHaveText(
    "You have made a lot of claims today. Try again tomorrow.",
  );
  await expect(proof(page, /Send us your papers/)).toBeChecked();
});

test("a listing that did not load offers Try again", async ({ page }) => {
  await signInTo(page, `/claim/${listing("down")}`);
  await expect(page.getByTestId("claim-read-failed")).toContainText(
    "We could not read this listing just now.",
  );
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
});

test("a removed listing says so, with no retry", async ({ page }) => {
  await signInTo(page, `/claim/${listing("off")}`);
  await expect(page.getByTestId("claim-no-listing")).toHaveText(
    "There is no listing to claim here.",
  );
  await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0);
});

test("a manager is told who can claim, with no proofs", async ({ page }) => {
  await signInTo(page, `/claim/${listing()}`, MANAGER);
  await expect(page.getByTestId("claim-role-line")).toHaveText(
    /^Only an owner or admin of .+ can claim a listing\. Send them this link\.$/,
  );
  await expect(page.getByRole("radio")).toHaveCount(0);
});

test.describe("the claims list on Verification", () => {
  test("shows every state, the code again, and the email steps", async ({
    page,
  }) => {
    await signInTo(page, "/account/verification", EVERY_STATE);
    const claims = page.getByTestId("claims");
    await expect(claims.getByTestId(/^claim-row-name-/)).toHaveCount(10);
    for (const line of [
      "Waiting for us to check",
      "Approved",
      "Not approved: we could not confirm your proof. You can claim again another way.",
      "Not approved: this listing looks like a different business.",
      "Not approved: this listing is already covered by another claim or account.",
      "Closed: this listing was removed while we were checking. Nothing more to do.",
    ]) {
      await expect(
        claims.getByText(line, { exact: true }).first(),
      ).toBeVisible();
    }
    await expect(claims.getByText("A removed listing")).toBeVisible();
    await expect(claims.getByText("YUVOY-7KQ4MX")).toBeVisible();
    await expect(
      claims.getByText("Email checked. A person at Yuvoy decides next."),
    ).toBeVisible();
    await claims
      .getByRole("button", { name: "Get a code at your business email" })
      .click();
    await expect(
      claims.getByLabel("Your address at claimtest.yuvoy.in"),
    ).toBeVisible();
    await expectAccessible(page, "the claims list");
  });

  test("a list that did not load says so, with Try again", async ({ page }) => {
    await signInTo(page, "/account/verification", LIST_FAILS);
    const failed = page.getByTestId("claims-error");
    await expect(
      failed.getByText("We could not read your listing claims just now."),
    ).toBeVisible();
    await expect(
      failed.getByRole("button", { name: "Try again" }),
    ).toBeVisible();
  });
});
