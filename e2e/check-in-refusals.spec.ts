import { test, expect, type Page } from "@playwright/test";

/**
 * Check-in by code when the code is refused (yuvoy-operator#175): each
 * refusal is said in words, nobody is shown as checked in, a code that
 * missed is never offered again, and the screen points to Today.
 *
 * Every code here is refused before the mock writes anything (the refusal
 * codes in `mocks/check-in-codes.ts`, a code that is no booking's, and
 * Daniel's code under another booking's reference), so both projects can run
 * them at once. The wait on `idempotency_in_progress` is in the action's unit
 * test: the mock never answers it.
 */

const DEV_CODE = "424242";
const OWNER = "+919000000101";

async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Your phone number").fill(OWNER);
  await page.getByRole("button", { name: "Send me a code" }).click();
  await page.getByLabel("Your code").fill(DEV_CODE);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/today");
}

/**
 * How many times the check-in action went with `code` in it. A Server Action
 * is a POST to the page with a `next-action` header and its arguments in the
 * body.
 */
function countSends(page: Page, code: string): () => number {
  let sent = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.headers()["next-action"] &&
      request.postData()?.includes(code)
    ) {
      sent += 1;
    }
  });
  return () => sent;
}

async function typeCode(page: Page, code: string) {
  await page.goto("/check-in");
  await page.getByLabel("Check-in code").fill(code);
  await page.getByRole("button", { name: "Check in" }).click();
}

/** Refused, and nothing on the screen says or offers otherwise. */
async function expectRefused(page: Page, says: string | RegExp) {
  await expect(page.getByText(says, { exact: true })).toBeVisible();
  await expect(page.getByText(/^(Already )?[Cc]hecked in at /)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Check them in by name on Today" }),
  ).toHaveAttribute("href", "/today");

  await page.getByRole("button", { name: "Type the code" }).click();
  await expect(page.getByLabel("Check-in code")).toHaveValue("");
}

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

const TYPED = [
  {
    what: "a code for another day",
    code: "TMRW-2345",
    says: /^This code is for \d{1,2} [A-Z][a-z]+ \d{4}\. Nobody was checked in\.$/,
  },
  {
    what: "a code after too many misses",
    code: "MANY-2345",
    says: "Too many codes did not match. Check people in by name for now.",
  },
  {
    what: "a code while check-in by code is paused",
    code: "PAUS-2345",
    says: "Check-in by code is paused. Use Aboard.",
  },
  {
    what: "a code that is no booking of ours",
    code: "ABCD-2345",
    says: "This code is not for one of your bookings.",
  },
];

for (const { what, code, says } of TYPED) {
  test(`${what} is refused in words, and not offered again`, async ({
    page,
  }) => {
    const sends = countSends(page, code.replace("-", ""));
    await typeCode(page, code);
    await expectRefused(page, says);
    expect(sends()).toBe(1);
  });
}

test("a link whose code is another booking's is refused in words", async ({
  page,
}) => {
  // Daniel's code (`bkg_2`, YV-7T1N4X8B) under a reference that is not his.
  await page.goto("/check-in#YV-4K2M9P7Q.R4TW9HNE");
  await expectRefused(
    page,
    "This code does not match booking YV-4K2M9P7Q. Check them in by name if it is them.",
  );
  expect(new URL(page.url()).hash).toBe("");
});

test("a typed code that cannot be one is said on the phone, and never sent", async ({
  page,
}) => {
  const sends = countSends(page, "K7QM");
  await typeCode(page, "K7QM");
  await expect(
    page.getByText(
      "That is not a check-in code. It is 8 letters and numbers, like K7QM-2XPA.",
    ),
  ).toBeVisible();
  await expect(page.getByLabel("Check-in code")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  expect(sends()).toBe(0);
});
