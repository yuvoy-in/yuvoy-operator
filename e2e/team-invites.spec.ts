import { test, expect } from "@playwright/test";
import { expectAccessible } from "./axe";
import { DEV_CODE, JOIN_TOKEN, invitee, signIn, invite } from "./team-kit";

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

/** Dev Kapoor, MANAGER — the read-only view of this screen. */
const MANAGER = "+919000000102";

test("inviting echoes the whole number once, and the pending row keeps its last four", async ({
  page,
}, testInfo) => {
  const who = invitee("echo", testInfo);
  await signIn(page);
  await invite(page, who);

  /*
    Two checks against a typo, at two distances. The confirmation echoes the
    whole number the moment it was sent, while the owner still remembers what
    they meant to type; the row keeps the last four digits (`phoneMasked`,
    yuvoy-api#62) for the morning after, when somebody actually looks at the
    list. An invitation sent to a wrong number is one a stranger can accept.
  */
  await expect(page.getByText(who.phone)).toBeVisible();
  await expect(
    page.getByText(
      /a new invitation to the same person replaces the old code/i,
    ),
  ).toBeVisible();

  // Revalidated: the pending row is the real confirmation, and it says what
  // an invitation is — and to which four digits it went.
  const row = page.locator("li").filter({ hasText: who.name });
  await expect(row.getByText(/They have not signed in yet/)).toBeVisible();
  await expect(
    row.getByText(`Invited on ••••${who.phone.slice(-4)}`),
  ).toBeVisible();
});

test("an invitation with no email says nothing was sent, and what makes it go", async ({
  page,
}, testInfo) => {
  /*
    yuvoy-operator#91 f20. The form promised "We message them a code", the only
    channel was WhatsApp, and there is no WhatsApp sender: the owner believed
    their colleague had been told and nothing arrived. `sent` is read back now,
    and with no email it is false.

    And the link is not offered as the way in: accepting takes the code, and
    the code goes only to an email address. The API's own note says to pass
    on "the code yourself", which this screen never has, so ours is said.
  */
  const who = invitee("unsent", testInfo);
  await signIn(page);
  await invite(page, who);

  const receipt = page.getByRole("status").filter({ hasText: "is invited" });
  await expect(
    receipt.getByText(/Nothing was sent: we hold no email address for them/),
  ).toBeVisible();
  await expect(receipt.getByText("Send them this link")).toHaveCount(0);
  await expect(receipt.getByText(/the code yourself/)).toHaveCount(0);
  await expect(receipt.getByText(/We also sent them/)).toHaveCount(0);
  await expect(page.getByText(/We message them/)).toHaveCount(0);

  /*
    And the invitee is told the same thing (yuvoy-api#227). Their join code
    has nowhere to go either, and `POST /join/{token}/code` used to answer
    `sent: true` regardless, so the join page asked for a code that nothing
    was carrying. It now says so, in the API's words, before anything else.
  */
  await page.context().clearCookies();
  await page.goto(`/join/${JOIN_TOKEN}`);
  await page.getByLabel("Your phone number").fill(who.phone.slice(3));
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "We could not send your code." })
      .getByText(/Ask whoever invited you to add you again with an email/),
  ).toBeVisible();
});

test("an invitation with an email says it was sent, and still leads with the link", async ({
  page,
}, testInfo) => {
  const who = invitee("emailed", testInfo);
  await signIn(page);
  await invite(page, {
    ...who,
    email: `${who.name.split(" ")[0]}@example.com`,
  });

  const receipt = page.getByRole("status").filter({ hasText: "is invited" });
  await expect(
    receipt.getByText(
      "We also sent them the invitation, with the link and their code.",
    ),
  ).toBeVisible();
  await expect(receipt.getByText(/We could not send/)).toHaveCount(0);
  await expect(receipt.getByText("Send them this link")).toBeVisible();
});

test("a mistyped email is refused on its own field, and nothing typed is lost", async ({
  page,
}, testInfo) => {
  const who = invitee("typo", testInfo);
  await signIn(page);
  await page.goto("/team");
  await page.getByLabel("Their name").fill(who.name);
  await page.getByLabel("Their phone number").fill(who.phone);
  await page.getByLabel(/^Their email/).fill("sana@");
  await page.getByRole("button", { name: "Send the invitation" }).click();

  const alert = page.locator("form").getByRole("alert");
  await expect(alert).toContainText("does not look like an email address");
  const email = page.getByLabel(/^Their email/);
  await expect(email).toHaveAttribute("aria-invalid", "true");
  await expect(email).toHaveValue("sana@");
  // One character to fix, not three fields to retype.
  await expect(page.getByLabel("Their name")).toHaveValue(who.name);
  await expect(page.getByLabel("Their phone number")).toHaveValue(who.phone);
  await expect(page.getByText(`${who.name} is invited`)).toHaveCount(0);
});

test("a new invitation is on the pending list at once, beside its receipt", async ({
  page,
}, testInfo) => {
  /*
    yuvoy-operator#89 f16: "the new invitation did not appear until a reload",
    so an owner could invite twice. Reached the way an owner reaches it, by the
    link on Settings rather than a fresh page load, and asserted without a
    reload: the receipt with its link stays, and the pending row is there too.
  */
  const who = invitee("listed", testInfo);
  await signIn(page);
  await page.goto("/account/settings");
  await page.getByRole("link", { name: /Team access/ }).click();
  await page.waitForURL("**/team");

  await page.getByLabel("Their name").fill(who.name);
  await page.getByLabel("Their phone number").fill(who.phone);
  await page.getByRole("button", { name: "Send the invitation" }).click();

  await expect(page.getByText(`${who.name} is invited as Staff`)).toBeVisible();
  const row = page.locator("li").filter({ hasText: who.name });
  await expect(row.getByText(/They have not signed in yet/)).toBeVisible();
  await expect(
    row.getByText(`Invited on ••••${who.phone.slice(-4)}`),
  ).toBeVisible();
  await expect(
    row.getByRole("button", { name: "Copy invite link" }),
  ).toBeVisible();
  // And the receipt is still on screen, not unmounted by the list catching up.
  await expect(
    page.getByText(/Nothing was sent: we hold no email address for them/),
  ).toBeVisible();
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
  /*
    The sentence that went with it was "note that an owner cannot be invited.
    The first one is set up by Yuvoy", and it stopped being true on 14 September
    — an owner IS invitable now, from the form directly above this message
    (yuvoy-operator#51 item 2). The server's own message is rendered instead, so
    the copy cannot drift from the rule a second time.
  */
  await expect(alert).not.toContainText("an owner cannot be invited");
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
  // True whether or not anything was ever sent to them (#91).
  await expect(
    page.getByText("The invitation and its code no longer work."),
  ).toBeVisible();
});

test("accepting an invitation signs you in, and lands you in the portal", async ({
  page,
}, testInfo) => {
  const who = invitee("accept", testInfo);
  await signIn(page);
  await invite(page, who);

  // The invitee opens /join on their own phone. Public, no session.
  await page.context().clearCookies();
  await page.goto("/join");
  await page.getByLabel("Your phone number").fill(who.phone);
  await page.getByLabel("Your code").fill(DEV_CODE);
  await page.getByRole("button", { name: "Accept the invitation" }).click();

  /*
    This used to end on "Accepting does not sign you in", which was correct:
    the API minted no session and the screen said so rather than blurring it.

    yuvoy-api#109 changed the endpoint — "the code they have just proved is the
    same proof a session needs" — so the second identical challenge is gone.
    Same reasoning O1's signup already followed.
  */
  await page.waitForURL("**/today");
  await expect(
    page.getByRole("heading", { level: 1, name: "Today" }),
  ).toBeVisible();
  await expect(page.getByText("Accepting does not sign you in.")).toHaveCount(
    0,
  );
});

test("a wrong code on /join gives one answer, whatever went wrong", async ({
  page,
}) => {
  await page.goto("/join");
  await page.getByLabel("Your phone number").fill("+919000099999");
  await page.getByLabel("Your code").fill("000000");
  await page.getByRole("button", { name: "Accept the invitation" }).click();

  /*
    No invitation for that number, a wrong code, an expired one and a used one
    all answer 401 with one message. Distinguishing them would tell whoever is
    holding somebody else's phone that they had the right number.
  */
  const alert = page.locator("form").getByRole("alert");
  await expect(alert).toContainText("That did not work");
  await expect(alert).toContainText("Codes last seven days");
});

test("removing somebody ends their access now, and says so", async ({
  page,
}, testInfo) => {
  const who = invitee("remove", testInfo);
  await signIn(page);
  await invite(page, who);

  /*
    Accept, so the row is a person rather than an invitation. Accepting now
    signs them in and lands them on Today (yuvoy-api#109), so this leaves the
    owner's session behind — hence the sign-in back in afterwards.
  */
  await page.goto("/join");
  await page.getByLabel("Your phone number").fill(who.phone);
  await page.getByLabel("Your code").fill(DEV_CODE);
  await page.getByRole("button", { name: "Accept the invitation" }).click();
  await page.waitForURL("**/today");

  // Back as the owner. The invitee's session is live in this browser now, so
  // it has to go first — `/sign-in` sends a signed-in operator to the portal.
  await page.context().clearCookies();
  await signIn(page);
  await page.goto("/team");
  const row = page.locator("li").filter({ hasText: who.name });
  await expect(row.getByText("No sign-in recorded")).toBeVisible();

  // The trigger says whose it is to a screen reader; the confirm says Remove.
  await row
    .getByRole("button", { name: `Remove ${who.name}`, exact: true })
    .click();
  await expect(
    row.getByText("Their sessions end immediately. Not at their next sign-in."),
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
    Up front, not after a tap. Every team write is 403 "OWNER or ADMIN only" —
    and `canManage` now includes ADMIN as well as MANAGER, so gating this
    screen on it would offer a manager a form that fails.

    "An owner or an admin", not "the owner": an admin reading the old sentence
    on a screen full of controls they CAN use was being told something false.
  */
  await expect(
    page.getByText(
      "Only an owner or an admin can change who is on this account.",
    ),
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

  await expectAccessible(page, "/team");
});
