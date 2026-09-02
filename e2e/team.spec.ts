import { test, expect, type Page, type TestInfo } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * O5 — a dive shop is not one person.
 *
 * Two claims run through every test here, because they are the two an owner
 * acts on: **an invitation is not a person**, and **removing somebody ends
 * their access now rather than at their next sign-in**. A screen that merely
 * listed names would satisfy neither.
 *
 * Runs in parallel on both projects. The mock's team lives in the Next server
 * process both share, so every test that writes uses its own phone number and
 * its own name and asserts only on those — never on a count, which the other
 * project is changing at the same time. The fixture's own invitation is read
 * but never revoked, for the same reason.
 */

const DEV_CODE = "424242";

/** The owner. Every other spec signs in as this number too. */
const OWNER = "+919000000101";
/** Dev Kapoor, MANAGER — the read-only view of this screen. */
const MANAGER = "+919000000102";

type Slot = "echo" | "revoke" | "accept" | "remove";
const SLOTS: Slot[] = ["echo", "revoke", "accept", "remove"];
const NAMES: Record<Slot, string> = {
  echo: "Kiran",
  revoke: "Meera",
  accept: "Nikhil",
  remove: "Omar",
};

/**
 * A person this test alone may invite, remove and assert on.
 *
 * Split by project rather than serialised. Nothing about a team is genuinely
 * single-tenant the way one open bank change is, so the honest shape is
 * separate fixtures rather than a skip.
 */
function invitee(slot: Slot, testInfo: TestInfo) {
  const p = testInfo.project.name === "mobile" ? "1" : "2";
  const n = SLOTS.indexOf(slot) + 1;
  /*
    The retry counter is part of the identity, not decoration. The mock's team
    lives in the Next server process and survives a retry, so an attempt that
    got as far as accepting an invitation leaves that number belonging to an
    active member — and the retry's `POST /team` is then correctly refused with
    `cannot_invite`. A retried test that cannot re-run its own setup reports a
    product failure that is not there.
  */
  const r = Math.min(testInfo.retry, 9);
  return {
    phone: `+9190001${p}${r}${n}00`,
    name: `${NAMES[slot]} ${testInfo.project.name === "mobile" ? "M" : "D"}${r}`,
  };
}

async function signIn(page: Page, phone = OWNER) {
  await page.goto("/sign-in");
  await page.getByLabel("Your phone number").fill(phone);
  await page.getByRole("button", { name: "Send me a code" }).click();
  await page.getByLabel("Your code").fill(DEV_CODE);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/today");
}

/** Invite somebody, and leave the page on /team with the form answered. */
async function invite(
  page: Page,
  who: { phone: string; name: string },
  role: "Manager" | "Staff" = "Staff",
) {
  await page.goto("/team");
  await page.getByLabel("Their name").fill(who.name);
  await page.getByLabel("Their phone number").fill(who.phone);
  await page.getByRole("radio", { name: role, exact: false }).check();
  await page.getByRole("button", { name: "Send the invitation" }).click();
  await expect(page.getByText(`Code sent to ${who.name}`)).toBeVisible();
}

test("the team is two lists: people, and invitations nobody has used", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/team");
  await page.waitForLoadState("networkidle");

  // The three fixture people, each described by what they may actually do.
  await expect(page.getByText("Priya Raut")).toBeVisible();
  await expect(page.getByText("Dev Kapoor")).toBeVisible();
  await expect(page.getByText("Arun Biswas")).toBeVisible();

  /*
    The claims are load-bearing. An owner hands a phone to a skipper on the
    strength of this sentence, so it is asserted on the row that makes it — the
    same words also appear beside the radio buttons, and an assertion a form
    could satisfy would not be testing the list at all.
  */
  await expect(
    page
      .locator("li")
      .filter({ hasText: "Arun Biswas" })
      .getByText("Today's manifest — marks people off as they arrive."),
  ).toBeVisible();
  await expect(
    page
      .locator("li")
      .filter({ hasText: "Dev Kapoor" })
      .getByText(
        "Cannot change payout details, and cannot add or remove people.",
      ),
  ).toBeVisible();

  /*
    An invitation is a code on somebody's phone, not a person with less
    access. `id` is the invitation, not a user, and the section says so.
  */
  await expect(
    page.getByRole("heading", { name: "Invited, not accepted" }),
  ).toBeVisible();
  await expect(page.getByText("Ramesh Toppo")).toBeVisible();
  await expect(
    page.getByText(/It grants nothing until they use it/),
  ).toBeVisible();
});

test("an owner cannot remove themselves, and the row says why", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/team");

  /*
    `409 cannot_remove` is "yourself, or the last owner", and both are knowable
    from what is on screen. Same call as O9's grant ceiling: disable the
    control and say why, rather than explain a refusal afterwards.
  */
  const own = page.locator("li").filter({ hasText: "Priya Raut" });
  await expect(own.getByText("This is you.", { exact: false })).toBeVisible();
  await expect(own.getByRole("button", { name: "Remove" })).toHaveCount(0);
});

test("there is no Owner to invite, and the form says why not", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/team");

  /*
    "OWNER cannot be invited, because the owner is the person whose bank
    account this is, and that is not a thing one login should be able to hand
    to a phone number." The absence is stated rather than left to be noticed.
  */
  await expect(page.getByRole("radio", { name: /Manager/ })).toBeVisible();
  await expect(page.getByRole("radio", { name: /Staff/ })).toBeVisible();
  await expect(page.getByRole("radio", { name: /Owner/ })).toHaveCount(0);
  await expect(page.getByText(/There is no Owner option/)).toBeVisible();

  // Staff is preselected: the safest of the two, and the one a boat phone gets.
  await expect(page.getByRole("radio", { name: /Staff/ })).toBeChecked();
});

test("inviting echoes the number back, because the list cannot show it", async ({
  page,
}, testInfo) => {
  const who = invitee("echo", testInfo);
  await signIn(page);
  await invite(page, who);

  /*
    `TeamMember` carries no phone, so once the list re-renders the pending row
    is a name with nothing to check a typo against — and an invitation sent to
    a wrong number is one a stranger can accept. Raised on yuvoy-api; until it
    lands this confirmation is the only place to check.
  */
  await expect(page.getByText(who.phone)).toBeVisible();
  await expect(
    page.getByText(
      /a new invitation to the same person replaces the old code/i,
    ),
  ).toBeVisible();

  // Revalidated: the pending row is the real confirmation, and it says what
  // an invitation is.
  const row = page.locator("li").filter({ hasText: who.name });
  await expect(row.getByText(/They have not signed in yet/)).toBeVisible();
});

test("a number already on the account is refused with one message", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/team");

  await page.getByLabel("Their name").fill("Somebody Else");
  await page.getByLabel("Their phone number").fill(MANAGER);
  await page.getByRole("button", { name: "Send the invitation" }).click();

  /*
    ONE message for every failure, deliberately. "A number already belonging to
    any operator is refused with the same message as any other failure, so this
    endpoint cannot be used to find out which businesses are on Yuvoy." The
    screen must not guess between "already here" and "cannot invite an owner".
  */
  // Scoped to the form. Next renders its own `role="alert"` route announcer on
  // every page, so an unscoped alert query resolves to two elements, always.
  const alert = page.locator("form").getByRole("alert");
  await expect(alert).toContainText("We could not send that invitation");
  await expect(alert).toContainText("an owner cannot be invited");
});

test("revoking an invitation says the code stops working", async ({
  page,
}, testInfo) => {
  const who = invitee("revoke", testInfo);
  await signIn(page);
  await invite(page, who);

  const row = page.locator("li").filter({ hasText: who.name });
  await row.getByRole("button", { name: "Revoke invitation" }).click();
  // Two taps, not one. A wet thumb on a 56px target costs a skipper their
  // access if the first tap is the last one.
  await expect(
    row.getByText(`Revoke the invitation to ${who.name}?`),
  ).toBeVisible();
  await row.getByRole("button", { name: "Revoke", exact: true }).click();

  await expect(
    page.getByText(`Invitation to ${who.name} revoked`),
  ).toBeVisible();
  await expect(
    page.getByText("The code we sent them no longer works."),
  ).toBeVisible();
});

test("accepting an invitation does not sign you in", async ({
  page,
}, testInfo) => {
  const who = invitee("accept", testInfo);
  await signIn(page);
  await invite(page, who);

  // The invitee opens /join on their own phone. Public, no session.
  await page.context().clearCookies();
  await page.goto("/join");
  await page.getByLabel("Your phone number").fill(who.phone);
  await page.getByLabel("The code we sent you").fill(DEV_CODE);
  await page.getByRole("button", { name: "Accept the invitation" }).click();

  /*
    "No session is minted here. They sign in through the ordinary flow
    afterwards, so one code path creates operator sessions rather than two."
    A screen that implied otherwise would leave somebody tapping a portal that
    keeps asking them to sign in.
  */
  await expect(page.getByText("You are on the account")).toBeVisible();
  await expect(page.getByText("Accepting does not sign you in.")).toBeVisible();

  // And they really are on the account: the ordinary sign-in now works for a
  // number that was not a member two steps ago.
  // The link inside the success panel, not the "Already accepted?" one below.
  await page.getByRole("status").getByRole("link", { name: "Sign in" }).click();
  await page.getByLabel("Your phone number").fill(who.phone);
  await page.getByRole("button", { name: "Send me a code" }).click();
  await page.getByLabel("Your code").fill(DEV_CODE);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/today");
});

test("a wrong code on /join gives one answer, whatever went wrong", async ({
  page,
}) => {
  await page.goto("/join");
  await page.getByLabel("Your phone number").fill("+919000099999");
  await page.getByLabel("The code we sent you").fill("000000");
  await page.getByRole("button", { name: "Accept the invitation" }).click();

  /*
    No invitation for that number, a wrong code, an expired one and a used one
    all answer 401 with one message. Distinguishing them would tell whoever is
    holding somebody else's phone that they had the right number.
  */
  const alert = page.locator("form").getByRole("alert");
  await expect(alert).toContainText("That did not work");
  await expect(alert).toContainText("codes last seven days");
});

test("removing somebody ends their access now, and says so", async ({
  page,
}, testInfo) => {
  const who = invitee("remove", testInfo);
  await signIn(page);
  await invite(page, who);

  // Accept, so the row is a person rather than an invitation.
  await page.goto("/join");
  await page.getByLabel("Your phone number").fill(who.phone);
  await page.getByLabel("The code we sent you").fill(DEV_CODE);
  await page.getByRole("button", { name: "Accept the invitation" }).click();
  await expect(page.getByText("You are on the account")).toBeVisible();

  await page.goto("/team");
  const row = page.locator("li").filter({ hasText: who.name });
  await expect(row.getByText("No sign-in recorded")).toBeVisible();

  await row.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(
    row.getByText(
      "Their sessions end immediately — not at their next sign-in.",
    ),
  ).toBeVisible();
  await row.getByRole("button", { name: "Remove", exact: true }).click();

  /*
    The row becomes its own confirmation. This action deliberately does NOT
    revalidate: a vanished line answers "did it work" ambiguously and "when
    does their access end" not at all — and the second is the whole reason
    somebody is removed in a hurry.
  */
  await expect(page.getByText(`${who.name} removed`)).toBeVisible();
  await expect(page.getByText(/Signed out everywhere, now/)).toBeVisible();
});

test("a manager sees the team and is told they cannot change it", async ({
  page,
}) => {
  await signIn(page, MANAGER);
  await page.goto("/team");

  /*
    Up front, not after a tap. `POST /team` and `DELETE /team/{id}` are both
    403 "OWNER only" — and `canManage` is OWNER **or** MANAGER, so gating this
    screen on it would have offered a manager a form that fails.
  */
  await expect(
    page.getByText("Only the owner can add or remove people."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Send the invitation" }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Remove" })).toHaveCount(0);

  // They can still see who is on the account: `GET /team` has no role gate.
  await expect(page.getByText("Priya Raut")).toBeVisible();
  await expect(page.getByText("Arun Biswas")).toBeVisible();
});

test("/team has no accessibility violations", async ({ page }) => {
  await signIn(page);
  await page.goto("/team");
  await page.waitForLoadState("networkidle");

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();

  expect(results.violations).toEqual([]);
});

test("/join has no accessibility violations", async ({ page }) => {
  await page.goto("/join");
  await page.waitForLoadState("networkidle");

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();

  expect(results.violations).toEqual([]);
});
