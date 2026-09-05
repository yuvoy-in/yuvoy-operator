import { test, expect, type Page, type TestInfo } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

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

const DEV_CODE = "424242";

/** A number this test alone may sign up. See the header. */
function newNumber(slot: number, testInfo: TestInfo) {
  const project = testInfo.project.name === "mobile" ? "1" : "2";
  const retry = Math.min(testInfo.retry, 9);
  return `+9199${project}${retry}${slot}00000`.slice(0, 14);
}

async function fill(
  page: Page,
  who: { business: string; name: string; phone: string; email?: string },
) {
  await page.getByLabel("Your business name").fill(who.business);
  await page.getByLabel("Your name", { exact: true }).fill(who.name);
  await page.getByLabel("Your phone number").fill(who.phone);
  if (who.email) await page.getByLabel(/^Email/).fill(who.email);
}

test("the screen says creating an account is not being on sale, before the form", async ({
  page,
}) => {
  await page.goto("/signup");

  /*
    Hima's first load-bearing point, and the single most expensive
    misunderstanding this flow can create: "an operator who thinks they are
    live and gets no bookings concludes we are broken."
  */
  await expect(
    page.getByText("Creating an account does not put you on sale"),
  ).toBeVisible();
  await expect(
    page.getByText(/Travellers cannot book you until somebody at Yuvoy/),
  ).toBeVisible();
});

test("a new account is accepted, and is told to sign in rather than congratulated", async ({
  page,
}, testInfo) => {
  const phone = newNumber(1, testInfo);
  await page.goto("/signup");
  await fill(page, {
    business: "Reef Divers Havelock",
    name: "Priya Raut",
    phone,
  });
  await page.getByRole("button", { name: "Create the account" }).click();

  /*
    NOT "account created". `POST /auth/signup` answers identically for a number
    that already has an account — deliberately, so it cannot be used to check
    whether a phone belongs to a Yuvoy operator — so that sentence would be
    false for some of the people who read it.
  */
  await expect(page.getByText("Now sign in with that number")).toBeVisible();
  await expect(page.getByText(phone)).toBeVisible();
  await expect(
    page.getByText(
      /whether this is a brand-new account or one you already had/,
    ),
  ).toBeVisible();
  await expect(page.getByText(/account created/i)).toHaveCount(0);
});

test("a number that already has an account gets exactly the same answer", async ({
  page,
}, testInfo) => {
  const phone = newNumber(2, testInfo);

  // First time: creates it.
  await page.goto("/signup");
  await fill(page, { business: "Reef Divers", name: "Priya", phone });
  await page.getByRole("button", { name: "Create the account" }).click();
  await expect(page.getByText("Now sign in with that number")).toBeVisible();

  /*
    Second time, same number, a different business name. The API creates
    nothing and says nothing different, and the portal must not invent a
    difference — a "that number is taken" message here would rebuild the
    directory the endpoint refuses to be.
  */
  await page.goto("/signup");
  await fill(page, { business: "Somebody Else Diving", name: "Ravi", phone });
  await page.getByRole("button", { name: "Create the account" }).click();
  await expect(page.getByText("Now sign in with that number")).toBeVisible();
  /*
    No refusal of any kind. Matched narrowly on purpose: a loose /already/
    matches this screen's own success line ("one you already had"), which is
    the sentence that makes the two cases indistinguishable rather than a
    rejection.
  */
  await expect(page.locator("form")).toHaveCount(0);
  await expect(
    page.getByText(/already registered|number is taken|account exists/i),
  ).toHaveCount(0);
});

test("signing up then signing in works, and lands on an account that cannot sell", async ({
  page,
}, testInfo) => {
  const phone = newNumber(3, testInfo);

  await page.goto("/signup");
  await fill(page, {
    business: "Jetty Boats Havelock",
    name: "Asha Menon",
    phone,
    email: "asha@example.com",
  });
  await page.getByRole("button", { name: "Create the account" }).click();
  await page.getByRole("link", { name: "Go to sign in" }).click();
  await page.waitForURL("**/sign-in");

  // The ordinary sign-in flow — no second code path for a new account.
  await page.getByLabel("Your phone number").fill(phone);
  await page.getByRole("button", { name: "Send me a code" }).click();
  await page.getByLabel("Your code").fill(DEV_CODE);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/today");

  /*
    The promise the signup screen made, kept by the portal they land in: a
    brand-new account is PROSPECT, so the day screen says so rather than
    showing an empty day with no explanation.
  */
  await expect(
    page.getByRole("link", { name: /You cannot be booked yet/ }),
  ).toBeVisible();

  await page.goto("/account");
  await expect(
    page.getByRole("heading", { name: "You cannot be booked yet" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Your account is live" }),
  ).toHaveCount(0);
});

test("a number with no country code is refused, and the field is named", async ({
  page,
}) => {
  await page.goto("/signup");
  await fill(page, {
    business: "Reef Divers",
    name: "Priya Raut",
    phone: "9000000101",
  });
  await page.getByRole("button", { name: "Create the account" }).click();

  /*
    Scoped to the form. Next renders its own `role="alert"` route announcer on
    every page, so an unscoped alert query resolves to two elements, always —
    the same trap `team.spec.ts` documents.
  */
  await expect(page.locator("form").getByRole("alert")).toContainText(
    "country code",
  );
  // Still on the form, with what they typed intact — a refusal that clears the
  // fields is a refusal somebody meets twice.
  await expect(page.getByLabel("Your business name")).toHaveValue(
    "Reef Divers",
  );
});

test("an email is optional, and a mistyped one is caught before it is stored", async ({
  page,
}, testInfo) => {
  await page.goto("/signup");
  await fill(page, {
    business: "Reef Divers",
    name: "Priya Raut",
    phone: newNumber(4, testInfo),
    email: "priya@",
  });
  await page.getByRole("button", { name: "Create the account" }).click();
  await expect(page.locator("form").getByRole("alert")).toContainText(
    "email address",
  );
});

test("a refused number survives on the sign-in door too", async ({ page }) => {
  /*
    The same defect the signup form had, in the screen next door, and it had
    shipped: a mistyped country code emptied the field and the operator
    retyped thirteen digits on a phone in sunlight. Found by probing for it
    rather than by anybody reporting it.
  */
  await page.goto("/sign-in");
  await page.getByLabel("Your phone number").fill("9000000101");
  await page.getByRole("button", { name: "Send me a code" }).click();

  await expect(page.locator("form").getByRole("alert")).toContainText(
    "country code",
  );
  await expect(page.getByLabel("Your phone number")).toHaveValue("9000000101");
});

test("the sign-in door offers signing up, and the signup door offers signing in", async ({
  page,
}) => {
  // One loop, both ways. Somebody who guesses the wrong door must not be stuck
  // at it — this is the whole reason the link exists on each.
  await page.goto("/sign-in");
  await page.getByRole("link", { name: "Create an account" }).click();
  await page.waitForURL("**/signup");

  await page.getByRole("link", { name: "Sign in" }).click();
  await page.waitForURL("**/sign-in");
});

test("/signup has no accessibility violations", async ({ page }) => {
  await page.goto("/signup");
  await page.waitForLoadState("networkidle");

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();

  expect(results.violations).toEqual([]);
});
