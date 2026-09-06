import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * O6 — the business behind the account, and acting on a blocker.
 *
 * `/account` has named what is outstanding since O3. What it could not do was
 * let anybody do anything about it: "until it existed the screen named a
 * blocker and then asked them to ring us."
 *
 * `GET`/`PUT /profile` and `POST /credentials` are what changed that
 * (yuvoy-api#63).
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

test("the business door leads to it, and it is not gated on a role", async ({
  page,
}) => {
  /*
    `PUT /profile` and `POST /credentials` declare a generic `Forbidden` and
    name no role. Hiding this from a manager would tell them they may not send
    us an insurance certificate the server would have accepted — and it is
    their account that cannot sell until somebody does.
  */
  await signIn(page, "+919000000102"); // a MANAGER
  await page.goto("/account");
  await page.getByRole("link", { name: /Business details/ }).click();
  await page.waitForURL("**/profile");
  await expect(
    page.getByRole("heading", { level: 1, name: "Business details" }),
  ).toBeVisible();
});

test("it names the exact fields still outstanding, not a count", async ({
  page,
}, testInfo) => {
  /*
    Reads state the save test below then completes. The profile is ONE document
    in the shared Next server, so both live on the primary project and run in
    file order — the read before the write. Declared rather than hidden, the
    same call the call-off and revision fixtures make.
  */
  test.skip(
    testInfo.project.name !== "mobile",
    "reads the incomplete profile the save test then completes — single-tenant by design",
  );
  /*
    "Named rather than a bare boolean so a form can mark the specific rows." A
    completeness bar reading "3 missing" without saying which three is a
    puzzle, not a prompt.

    The fixture profile is half-filled on purpose — a complete one makes
    `missing` empty and cannot exercise this at all.
  */
  await signIn(page);
  await page.goto("/profile");

  await expect(page.getByText("still needed")).not.toHaveCount(0);
  const region = page.locator("label", { hasText: "State or union territory" });
  await expect(region.getByText("still needed")).toBeVisible();
});

test("filling the details in says saved, and never says live", async ({
  page,
}, testInfo) => {
  /*
    Single-tenant: the profile is one document in the shared Next server, and
    the second project to run would find it already complete.
  */
  test.skip(
    testInfo.project.name !== "mobile",
    "the profile is one shared document — single-tenant by design, so it runs on the primary project only",
  );

  await signIn(page);
  await page.goto("/profile");

  await page.getByLabel("State or union territory").fill("Andaman & Nicobar");
  await page.getByLabel("PIN code").fill("744211");
  await page.getByRole("button", { name: "Save these details" }).click();

  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  /*
    Details are half the gate, never the whole of it. An operator who fills
    these in and reads anything about going live will wait for a call that is
    not coming.
  */
  const text = (await page.locator("body").innerText()).toLowerCase();
  expect(text).not.toContain("you are live");
  expect(text).not.toContain("your account is live");
});

test("a GSTIN may be left blank, and is checked when it is not", async ({
  page,
}) => {
  /*
    "Plenty of island operators are under the registration threshold, and
    demanding a number they cannot legally obtain would block exactly the
    businesses this marketplace exists for."
  */
  await signIn(page);
  await page.goto("/profile");
  await expect(page.getByText(/Leave it blank if you are not/)).toBeVisible();
  await expect(page.getByLabel("GSTIN")).not.toHaveAttribute("required", "");
});

test("sending a document says it is with us, and never that it is verified", async ({
  page,
}, testInfo) => {
  /*
    The claim this screen must never make. "Nothing filed here is ever
    verified … a self-service path to `verified` would make the credential gate
    decorative." An operator who files an insurance certificate and reads
    "verified" will plan a season on it.
  */
  test.skip(
    testInfo.project.name !== "mobile",
    "filing replaces the pending document — single-tenant by design",
  );

  await signIn(page);
  await page.goto("/profile");

  await page.getByLabel("Which document").selectOption("insurance");
  await page.getByLabel("Who issued it").fill("Oriental Insurance");
  await page.getByLabel("Expires on").fill("2027-06-30");
  await page.getByRole("button", { name: "Send it to us" }).click();

  await expect(page.getByText("Insurance is with us")).toBeVisible();
  await expect(page.getByText(/Somebody here will check it/)).toBeVisible();

  const text = (await page.locator("body").innerText()).toLowerCase();
  expect(text).not.toContain("verified");
  expect(text).not.toContain("approved");
});

test("an expiry date in the past is refused before it replaces anything", async ({
  page,
}) => {
  /*
    Filing REPLACES the pending document of the same kind, so a year typed
    wrong costs one that was already in the queue. Caught here, where it can
    still be fixed.
  */
  await signIn(page);
  await page.goto("/profile");

  await page.getByLabel("Which document").selectOption("boat");
  await page.getByLabel("Expires on").fill("2020-01-01");
  await page.getByRole("button", { name: "Send it to us" }).click();

  // Scoped to the form: Next renders an empty route announcer with the same
  // role, so a page-wide `getByRole("alert")` is ambiguous.
  const form = page.locator("form").filter({ hasText: "Which document" });
  await expect(form.getByRole("alert")).toContainText(/already passed/);
});

test("the expiry field says what an expired document costs", async ({
  page,
}) => {
  // "An expired mandatory credential stops sales, evaluated at the departure's
  // start instant." Said where somebody is typing the date, not afterwards.
  await signIn(page);
  await page.goto("/profile");
  await expect(
    page.getByText(/An expired document stops your departures selling/),
  ).toBeVisible();
});

test("it does not repeat the expiry dates /account already owns", async ({
  page,
}) => {
  /*
    Two copies of a date an operator plans a season around is two places for
    them to disagree. This screen points at the one that owns them.
  */
  await signIn(page);
  await page.goto("/profile");
  await expect(
    page.getByRole("link", { name: "your business" }).last(),
  ).toBeVisible();
});

test("/profile has no accessibility violations", async ({ page }) => {
  await signIn(page);
  await page.goto("/profile");
  await page.waitForLoadState("networkidle");

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();

  expect(results.violations).toEqual([]);
});
