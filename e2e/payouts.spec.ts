import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * O4 — the highest-risk thing an operator can do.
 *
 * Every assertion here is about a gate or a brake. A screen that merely
 * *works* would be a failure: the design is three gates and two clocks, and if
 * the UI lets somebody past one of them the design is decoration.
 */

const DEV_CODE = "424242";

/*
  Serial, and one project only.

  Not a workaround for flakiness — a consequence of the domain. An operator may
  have exactly ONE open bank change at a time, by design ("two open bank
  changes would mean the second approval silently decides which account wins"),
  and the mock holds that state in the Next server process both Playwright
  projects share. So these tests cannot run in parallel with each other or with
  their counterpart on the other project: they are all acting on the same
  single change.

  Running them serially on the primary project is the honest shape. The desktop
  skips are declared rather than hidden.
*/
test.describe.configure({ mode: "serial" });

/**
 * Leaves the account with no bank change in progress.
 *
 * Called by every test that needs the form rather than relying on an earlier
 * test having stopped one. Order dependence between tests is how a suite ends
 * up passing only when run whole, and then failing for whoever runs one.
 */
async function clearOpenChange(page: Page) {
  await page.goto("/payouts");
  const brake = page.getByRole("button", { name: "This wasn't me — stop it" });
  if (await brake.count()) {
    await brake.first().click();
    await expect(page.getByText("Stopped. Nothing was changed.")).toBeVisible();
    await page.goto("/payouts");
  }
}

test.beforeEach(({}, testInfo) => {
  test.skip(
    testInfo.project.name !== "mobile",
    "one open bank change at a time — this flow is single-tenant by design, so it runs on the primary project only",
  );
});

async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Your phone number").fill("+919000000101");
  await page.getByRole("button", { name: "Send me a code" }).click();
  await page.getByLabel("The code we sent").fill(DEV_CODE);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/today");
}

test("the in-flight change shows both clocks and the brake", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/payouts");
  // The first navigation after `pnpm build && pnpm start` is the slow one;
  // 5s is the assertion default and this is the only place it is tight.
  await page.waitForLoadState("networkidle");

  // The fixture is `cooling`: approved, not yet live, still stoppable.
  await expect(
    page.getByText("Approved, not yet live — still stoppable"),
  ).toBeVisible();

  // Both windows, always — the design is only trustworthy if it is visible.
  await expect(
    page.getByText("You can object until", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Goes live", { exact: true })).toBeVisible();

  // The brake, prominent, at every stoppable stage.
  await expect(
    page.getByRole("button", { name: "This wasn't me — stop it" }),
  ).toBeVisible();
  await expect(page.getByText("It takes no code and no waiting")).toBeVisible();

  // Masked, never a full account number.
  await expect(page.getByText(/••••4417/)).toBeVisible();
});

test("only one bank change at a time, and it says why", async ({ page }) => {
  await signIn(page);
  await page.goto("/payouts");

  /*
    "Two open bank changes would mean the second approval silently decides
    which account wins." Saying so beats letting somebody fill in a form and
    meet a 409.
  */
  await expect(page.getByText(/already a change in progress/)).toBeVisible();
  await expect(
    page.getByText(/whichever is approved last silently wins/),
  ).toBeVisible();
  await expect(page.getByLabel("Account number")).toHaveCount(0);
});

test("the emergency brake works, and needs no code", async ({ page }) => {
  await signIn(page);
  await page.goto("/payouts");

  /*
    Deliberately not behind step-up: "the person most likely to need this is
    the owner who just received a warning about a change they did not make,
    and making them pass another code first puts the emergency brake further
    away than the accelerator."
  */
  await page.getByRole("button", { name: "This wasn't me — stop it" }).click();
  await expect(page.getByText("Stopped. Nothing was changed.")).toBeVisible();
});

test("raising a change needs a code, and the code goes to the owner", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/payouts");

  // The fixture change was stopped by the test above (serial mode), so the
  // form is available here.
  // The submit is unreachable until a code has been asked for.
  await expect(
    page.getByRole("button", { name: "Raise the change" }),
  ).toBeDisabled();
  await expect(
    page.getByText(/A code goes to the owner.s phone/),
  ).toBeVisible();
  await expect(
    page.getByText(/A manager who requested this will not receive it/),
  ).toBeVisible();
});

test("a malformed IFSC is refused before a code is spent", async ({ page }) => {
  await signIn(page);
  await clearOpenChange(page);

  await page.getByLabel("Name on the account").fill("Nemo Reef Divers");
  await page.getByLabel("Account number").fill("50100123456789");
  // The classic error: a letter O where the reserved zero goes.
  await page.getByLabel("IFSC").fill("HDFCO001234");
  await page.getByRole("button", { name: "Send the code" }).click();
  await page.getByLabel("The code").fill(DEV_CODE);
  await page.getByRole("button", { name: "Raise the change" }).click();

  await expect(page.locator("form").getByRole("alert")).toContainText(
    "never a letter O",
  );
});

test("a valid change is raised, and nothing is live yet", async ({ page }) => {
  await signIn(page);
  await clearOpenChange(page);

  await page.getByLabel("Name on the account").fill("Nemo Reef Divers");
  await page.getByLabel("Account number").fill("50100123456789");
  await page.getByLabel("IFSC").fill("HDFC0001234");

  // The mask is shown BEFORE sending, because it is what will be stored.
  await expect(page.getByText(/••••6789/)).toBeVisible();

  await page.getByRole("button", { name: "Send the code" }).click();
  await page.getByLabel("The code").fill(DEV_CODE);
  await page.getByRole("button", { name: "Raise the change" }).click();

  /*
    Raised is not applied, and the screen must not imply otherwise. The
    confirmation IS the in-progress panel: the page revalidates and the new
    change appears with its masked account, both clocks and the brake, which
    says more than a "raised" message could — and is live rather than a
    snapshot.
  */
  await expect(
    page.getByText("Raised — you can still stop this"),
  ).toBeVisible();
  await expect(page.getByText(/Bank ••••6789/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "This wasn't me — stop it" }),
  ).toBeVisible();
  // And the form is gone, because only one change may be open at a time.
  await expect(page.getByText(/already a change in progress/)).toBeVisible();
});

test("a bank change in flight holds the payout, and earnings says so", async ({
  page,
}) => {
  /*
    Lives here rather than in earnings.spec.ts because it depends on the same
    single-open-change state this file serialises. In the parallel spec it
    raced the tests below, which stop that change — a suite that passes only
    when its files run in a particular order is a suite that fails for
    whoever runs one.
  */
  await signIn(page);
  await clearOpenChange(page);

  await page.getByLabel("Name on the account").fill("Nemo Reef Divers");
  await page.getByLabel("Account number").fill("50100123456789");
  await page.getByLabel("IFSC").fill("HDFC0001234");
  await page.getByRole("button", { name: "Send the code" }).click();
  await page.getByLabel("The code").fill(DEV_CODE);
  await page.getByRole("button", { name: "Raise the change" }).click();
  await expect(
    page.getByText("Raised — you can still stop this"),
  ).toBeVisible();

  // "A payout on hold because a bank change is in flight should say so — that
  // is a real state and the operator can act on it."
  await page.goto("/earnings");
  await expect(
    page.getByText("Payouts are on hold while your bank change is reviewed"),
  ).toBeVisible();
  await expect(
    page.getByText(/objection window — you can still stop it/),
  ).toBeVisible();
  await expect(page.getByText(/If you did not request this/)).toBeVisible();
});

test("/payouts has no accessibility violations", async ({ page }) => {
  await signIn(page);
  await page.goto("/payouts");
  await page.waitForLoadState("networkidle");

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();

  expect(results.violations).toEqual([]);
});
