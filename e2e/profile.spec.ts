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
  // The doors moved behind the gear on the profile, #58 item 9.
  await page.goto("/account/settings");
  await page.getByRole("link", { name: /Business details/ }).click();
  await page.waitForURL("**/profile");
  await expect(
    page.getByRole("heading", { level: 1, name: "Business details" }),
  ).toBeVisible();
});

/*
  The read and the write of ONE profile, made to run in the order this file has
  always claimed they did.

  The read below says "both live on the primary project and run in file order —
  the read before the write". That was never enforced: `fullyParallel: true`
  parallelises tests WITHIN a file across workers, so the two raced for a single
  shared document and the read passed only when it happened to win. It lost
  under a fuller suite.

  `serial` makes the claim true rather than lucky. Scoped to the pair rather
  than the file, so the other seven still run in parallel.
*/
test.describe.serial("the profile, read then written", () => {
  test("it names the exact fields still outstanding, not a count", async ({
    page,
  }, testInfo) => {
    /*
      Reads state the save test below then completes. The profile is ONE
      document in the shared Next server, so the read has to happen before the
      write — which the `serial` above is what actually enforces. Declared
      rather than hidden, the same call the call-off and revision fixtures
      make.
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
    const region = page.locator("label", {
      hasText: "State or union territory",
    });
    await expect(region.getByText("still needed")).toBeVisible();
  });

  test("on a live account a change is sent for a check, and what is on file stays", async ({
    page,
  }, testInfo) => {
    /*
      yuvoy-operator#89 f10. A LIVE account's `PUT /profile` answers `202
      in_review`: the change waits for somebody at Yuvoy and the details on
      file stay in place (D-032.3). This screen said "Saved". Runs before the
      save below, because it asserts the document is still incomplete after
      it.
    */
    test.skip(
      testInfo.project.name !== "mobile",
      "the profile is one shared document, single-tenant by design, so it runs on the primary project only",
    );

    await signIn(page); // the owner of the LIVE fixture business
    await page.goto("/profile");

    await page.getByLabel("State or union territory").fill("Andaman & Nicobar");
    await page.getByLabel("PIN code").fill("744211");
    await page.getByRole("button", { name: "Save these details" }).click();

    await expect(page.getByText("Sent to us for a check")).toBeVisible();
    await expect(page.getByText("Saved", { exact: true })).toHaveCount(0);

    // Back to the form: the change was not applied, so the field is empty.
    await page.getByRole("button", { name: "Back to your details" }).click();
    await expect(page.getByLabel("State or union territory")).toHaveValue("");

    // The screen now says a change is waiting, which is what stops the
    // operator sending it again.
    await expect(
      page.getByText("A change to these details is waiting for our check"),
    ).toBeVisible();

    // And after a reload, which is the read an operator would trust.
    await page.reload();
    const region = page.locator("label", {
      hasText: "State or union territory",
    });
    await expect(region.getByText("still needed")).toBeVisible();
    await expect(
      page.getByText("A change to these details is waiting for our check"),
    ).toBeVisible();
  });

  test("filling the details in on a new account says saved, and never says live", async ({
    page,
  }, testInfo) => {
    /*
      Single-tenant: the profile is one document in the shared Next server, and
      the second project to run would find it already complete.

      A PROSPECT, because a business that is not LIVE yet is the one whose
      change is applied at once. The live owner's is sent for a check (above).
    */
    test.skip(
      testInfo.project.name !== "mobile",
      "the profile is one shared document, single-tenant by design, so it runs on the primary project only",
    );

    await signIn(page, "+919000000105"); // a PROSPECT's owner
    await page.goto("/profile");

    await page.getByLabel("State or union territory").fill("Andaman & Nicobar");
    await page.getByLabel("PIN code").fill("744211");
    await page.getByRole("button", { name: "Save these details" }).click();

    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    await expect(page.getByText("Sent to us for a check")).toHaveCount(0);
    /*
      Details are half the gate, never the whole of it. An operator who fills
      these in and reads anything about going live will wait for a call that is
      not coming.
    */
    const text = (await page.locator("body").innerText()).toLowerCase();
    expect(text).not.toContain("you are live");
    expect(text).not.toContain("your account is live");
  });
});

test("a staff login sees the details and is not offered the form", async ({
  page,
}) => {
  /*
    The API refuses the write to anybody but an OWNER, ADMIN or MANAGER, so a
    form here would be a promise the next tap breaks.
  */
  await signIn(page, "+919000000103"); // STAFF
  await page.goto("/profile");

  await expect(
    page.getByText("Only an owner, an admin or a manager can change these."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save these details" }),
  ).toHaveCount(0);
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

test("it does not repeat the expiry dates Verification already owns", async ({
  page,
}) => {
  /*
    Two copies of a date an operator plans a season around is two places for
    them to disagree. This screen points at the one that owns them, which is
    Verification since the profile became a profile (#58).
  */
  await signIn(page);
  await page.goto("/profile");
  await expect(
    page.getByRole("link", {
      name: "Documents we hold, and when they run out",
    }),
  ).toHaveAttribute("href", "/account/verification");
});

test("it links to what is waiting instead of repeating it", async ({
  page,
}) => {
  /*
    yuvoy-operator#88 s13: "Both items then repeat word for word on Business
    details, so the operator meets the same two sentences twice ... Show each
    blocker in one place only, and link to it from the other."
  */
  await signIn(page, "+919000000115"); // live, with three things outstanding
  await page.goto("/profile");

  await expect(
    page.getByRole("link", { name: /3 things waiting on you/ }),
  ).toHaveAttribute("href", "/account/verification");
  await expect(
    page.getByText("We still need your registered business name and address"),
  ).toHaveCount(0);
  await expect(page.getByText("We still need your logo")).toHaveCount(0);
  // One title: the form under it no longer says it again.
  await expect(
    page.getByRole("heading", { name: "Business details" }),
  ).toHaveCount(1);
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
