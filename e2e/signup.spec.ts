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
  /*
    The field takes ten digits and shows a fixed `+91`, so a full E.164 number
    is normalised down to its national part as it arrives — which is the whole
    point of yuvoy-operator#19, and is why these tests can keep handing it one.
  */
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

test("creating an account goes straight to the code, with no bounce to sign in", async ({
  page,
}, testInfo) => {
  /*
    yuvoy-operator#20. It used to end on a panel of prose and a button back to
    `/sign-in` — the thing they had just done the work for. Somebody who has
    typed their business name and their own name has proved they are engaged,
    and that is the worst moment to hand them a detour.
  */
  const phone = newNumber(1, testInfo);
  await page.goto("/signup");
  await fill(page, {
    business: "Reef Divers Havelock",
    name: "Priya Raut",
    phone,
  });
  await page.getByRole("button", { name: "Create the account" }).click();

  // The code field, immediately. No screen in between and nothing to press.
  await expect(page.getByLabel("Your code")).toBeVisible();
  await expect(page.getByRole("link", { name: "Go to sign in" })).toHaveCount(
    0,
  );

  /*
    NOT "your account is created", which #20 asked for. `POST /auth/signup`
    answers identically for a number that already has an account — deliberately,
    so it cannot be used to check whether a phone belongs to a Yuvoy operator —
    so that sentence is false for exactly the people the API refuses to let us
    tell apart. "Almost there" is true either way.
  */
  await expect(page.getByText(/Almost there/)).toBeVisible();
  await expect(page.getByText(/account (is )?created/i)).toHaveCount(0);
  await expect(page.getByText(/congratulations/i)).toHaveCount(0);

  /*
    And no claim that anything was delivered. A code may arrive by WhatsApp or
    be issued by Yuvoy out of band (yuvoy-api#59) and this screen is never told
    which — and on production nothing is delivered at all yet (yuvoy-api#68).
    `pnpm qa` holds the same rule statically; this is the rendered half.
  */
  await expect(page.getByText(/we (sent|have sent|messaged)/i)).toHaveCount(0);
  await expect(page.getByText(/sent to/i)).toHaveCount(0);
});

test("the code finishes the job — signed in, in the portal, on an account that cannot sell", async ({
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

  await page.getByLabel("Your code").fill(DEV_CODE);
  await page.getByRole("button", { name: "Finish" }).click();

  // Signed in and in the portal — not redirected to sign-in.
  await page.waitForURL("**/today");

  /*
    And the reassurance that used to sit on the confirmation panel is here
    instead, where it can be acted on: a brand-new account is PROSPECT, so the
    day says so rather than showing an empty day with no explanation.
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

test("another code can be asked for without creating the account again", async ({
  page,
}, testInfo) => {
  /*
    A code lasts a few minutes and the first send can fail — and by the code
    step the account already exists, so "start again" is not an option that
    means anything. Asking again must not run signup a second time.
  */
  const phone = newNumber(5, testInfo);
  await page.goto("/signup");
  await fill(page, { business: "Reef Divers", name: "Priya", phone });
  await page.getByRole("button", { name: "Create the account" }).click();
  await expect(page.getByLabel("Your code")).toBeVisible();

  await page.getByRole("button", { name: "Send another code" }).click();

  // Still on the code step, and the details form has not come back.
  await expect(page.getByLabel("Your code")).toBeVisible();
  await expect(page.getByLabel("Your business name")).toHaveCount(0);

  // And the code still signs them in.
  await page.getByLabel("Your code").fill(DEV_CODE);
  await page.getByRole("button", { name: "Finish" }).click();
  await page.waitForURL("**/today");
});

test("a number that already has an account gets exactly the same answer", async ({
  page,
}, testInfo) => {
  const phone = newNumber(2, testInfo);

  // First time: creates it.
  await page.goto("/signup");
  await fill(page, { business: "Reef Divers", name: "Priya", phone });
  await page.getByRole("button", { name: "Create the account" }).click();
  await expect(page.getByLabel("Your code")).toBeVisible();

  /*
    Second time, same number, a different business name. The API creates
    nothing and says nothing different, and the portal must not invent a
    difference — a "that number is taken" message here would rebuild the
    directory the endpoint refuses to be.
  */
  await page.goto("/signup");
  await fill(page, { business: "Somebody Else Diving", name: "Ravi", phone });
  await page.getByRole("button", { name: "Create the account" }).click();
  await expect(page.getByLabel("Your code")).toBeVisible();
  await expect(page.getByText(/Almost there/)).toBeVisible();
  await expect(
    page.getByText(/already registered|number is taken|account exists/i),
  ).toHaveCount(0);
});

test("the phone field fixes +91 and takes ten digits, however they are typed", async ({
  page,
}) => {
  /*
    yuvoy-operator#19. The field was a free-text box with a `+91 90000 00101`
    placeholder, and the API is strict — so `9966440677`, `09966440677` and
    `+91 99664 40677` were three rejections at the one moment somebody is
    trusting the form.
  */
  await page.goto("/signup");
  const field = page.getByLabel("Your phone number");

  // The country code is furniture, not something to type or delete.
  await expect(page.getByText("+91", { exact: true })).toBeVisible();

  // Until it is whole, the button waits and the field says how far off it is.
  await field.fill("99664");
  await expect(page.getByText("5 more digits.")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Create the account" }),
  ).toBeDisabled();

  // A leading zero, which people write constantly.
  await field.fill("09966440677");
  await expect(field).toHaveValue("9966440677");

  // A pasted international number, from a contacts app.
  await field.fill("+91 99664 40677");
  await expect(field).toHaveValue("9966440677");

  // And an eleventh digit is ignored rather than sliding the window.
  await field.fill("99664406779");
  await expect(field).toHaveValue("9966440677");

  await page.getByLabel("Your business name").fill("Reef Divers");
  await page.getByLabel("Your name", { exact: true }).fill("Priya Raut");
  await expect(
    page.getByRole("button", { name: "Create the account" }),
  ).toBeEnabled();
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

test("the sign-in door has the same field, and both its buttons wait for it", async ({
  page,
}) => {
  /*
    "Same component in both places. They are the same field and should not
    drift apart" — and the country-code refusal both doors used to give is now
    unreachable rather than merely handled, because the field cannot produce a
    number without one.
  */
  await page.goto("/sign-in");
  const field = page.getByLabel("Your phone number");

  await expect(page.getByText("+91", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Send me a code" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "I already have a code" }),
  ).toBeDisabled();

  await field.fill("+919000000101");
  await expect(field).toHaveValue("9000000101");
  await expect(
    page.getByRole("button", { name: "Send me a code" }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "I already have a code" }),
  ).toBeEnabled();
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
