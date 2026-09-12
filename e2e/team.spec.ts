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
/** Arun, STAFF — sees the list and nothing to act on. */
const STAFF = "+919000000103";
/** Nisha, ADMIN — may invite, may not remove. See yuvoy-operator#23. */
const ADMIN = "+919000000114";
/** The business's one join link, the same for everybody it adds. */
const JOIN_TOKEN = "jn_reefdivers";

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
  await expect(page.getByText(`${who.name} is invited`)).toBeVisible();
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
      .getByText("Today's manifest: marks people off as they arrive."),
  ).toBeVisible();
  await expect(
    page
      .locator("li")
      .filter({ hasText: "Dev Kapoor" })
      .getByText(
        "Cannot change payout details, and cannot add, remove or pause people.",
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

  /*
    Four digits on every row (`phoneMasked`, yuvoy-api#62) — the invitation's
    especially, because it is the one a human typed at six in the morning and
    the only place a typo grants a stranger access. "Sent to" on an
    invitation, "Signs in with" on a person: the same field, two different
    claims.
  */
  await expect(
    page
      .locator("li")
      .filter({ hasText: "Ramesh Toppo" })
      .getByText("Sent to ••••0104"),
  ).toBeVisible();
  await expect(
    page
      .locator("li")
      .filter({ hasText: "Dev Kapoor" })
      .getByText("Signs in with ••••0102"),
  ).toBeVisible();
});

test("an owner's own row offers nothing, and does not explain why", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/team");

  /*
    `409 cannot_change_access` covers your own access on all four writes, and
    it is knowable from what is on screen — so the controls are withheld rather
    than offered and refused. Same call as O9's grant ceiling.

    What is NOT here any more is the sentence. It read "This is you. Another
    owner has to remove you.", and the owner cut that pattern
    (yuvoy-operator#25 §4): the row has the reader's own name on it, so not
    offering the control already says it.
  */
  const own = page.locator("li").filter({ hasText: "Priya Raut" });
  await expect(own.getByRole("button", { name: "Remove" })).toHaveCount(0);
  await expect(own.getByRole("button", { name: "Change role" })).toHaveCount(0);
  await expect(own.getByRole("button", { name: "Pause access" })).toHaveCount(
    0,
  );
  await expect(own.getByText("This is you", { exact: false })).toHaveCount(0);
  await expect(
    own.getByText("Another owner has to remove you", { exact: false }),
  ).toHaveCount(0);
});

test("an owner changes a role, pauses access and gives it back", async ({
  page,
}, testInfo) => {
  /*
    Its own fixture row, one per project.

    All three writes mutate state in the shared Next server process and this
    walkthrough leaves somebody demoted — so a member both projects edit is a
    race in the FIXTURE, and using `usr_manager_dev` would take the Earnings
    link away from whichever `roles.spec.ts` ran second. Same call
    `slot_calloff_a` and `slot_calloff_b` make on the day screen.
  */
  const who =
    testInfo.project.name === "mobile"
      ? "Access Fixture A"
      : "Access Fixture B";

  await signIn(page);
  await page.goto("/team");

  const dev = page.locator("li").filter({ hasText: who });

  // Change role — replaced, not added to.
  await dev.getByRole("button", { name: "Change role" }).click();
  /*
    Said before the tap, not after. All three writes end that person's
    sessions, and somebody demoted mid-shift is signed out of the manifest they
    are holding — copy §4 keeps precisely because it changes what an owner does
    with it.
  */
  await expect(
    dev.getByText(`signs ${who} out everywhere`, { exact: false }),
  ).toBeVisible();
  await dev.getByRole("radio", { name: /^Staff/ }).check();
  await dev.getByRole("button", { name: "Save role" }).click();

  /*
    No success message: the list is the confirmation, and it says more than a
    sentence could. Asserted on the ROLE CHIP rather than on any "Staff" —
    the same word is a radio label inside the form, and an assertion either
    could satisfy would not be testing the list at all.
  */
  const devAfter = page.locator("li").filter({ hasText: who });
  const chips = devAfter.locator("span.label");
  await expect(chips.filter({ hasText: /^Staff$/ })).toHaveCount(1);
  await expect(chips.filter({ hasText: /^Manager$/ })).toHaveCount(0);

  /*
    Pause — the person, the role and the history stay.

    The role form has closed itself by now: it must, because the row it sits in
    has re-rendered with different controls and the open form would hide them.
  */
  await expect(devAfter.getByRole("button", { name: "Save role" })).toHaveCount(
    0,
  );
  await devAfter.getByRole("button", { name: "Pause access" }).click();
  await devAfter.getByRole("button", { name: "Pause access" }).last().click();

  const paused = page.locator("li").filter({ hasText: who });
  await expect(paused.getByText("Paused", { exact: true })).toBeVisible();
  await expect(paused.getByText("Staff", { exact: true })).toBeVisible();
  // Held, not removed: still on the list, with a way back and no Pause.
  await expect(
    paused.getByRole("button", { name: "Give access back" }),
  ).toBeVisible();
  await expect(
    paused.getByRole("button", { name: "Pause access" }),
  ).toHaveCount(0);

  // And back.
  await paused.getByRole("button", { name: "Give access back" }).click();
  await paused.getByRole("button", { name: "Give access back" }).last().click();
  const restored = page.locator("li").filter({ hasText: who });
  await expect(restored.getByText("Paused", { exact: true })).toHaveCount(0);
  await expect(
    restored.getByRole("button", { name: "Pause access" }),
  ).toBeVisible();
});

test("no screen explains a rule the missing control already stated", async ({
  page,
}) => {
  /*
    yuvoy-operator#25 §4, swept across the portal rather than only on Team.
    "The pattern to remove is a sentence that explains an internal rule where
    the interface has already made the answer obvious."

    Asserted as an absence on the served page, because the failure mode is
    somebody adding one back in good faith while explaining a 403.
  */
  await signIn(page);
  for (const route of [
    "/team",
    "/account",
    "/payouts",
    "/services/reels",
    "/services/activities",
  ]) {
    await page.goto(route);
    const text = (await page.locator("body").innerText()).toLowerCase();
    for (const banned of [
      "another owner has to remove you",
      "this is you.",
      "you cannot do this because",
    ]) {
      expect(text, `${route} still explains a rule: "${banned}"`).not.toContain(
        banned,
      );
    }
  }
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
    row.getByText(`Sent to ••••${who.phone.slice(-4)}`),
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
  await page.getByLabel("The code we sent you").fill(DEV_CODE);
  await page.getByRole("button", { name: "Accept the invitation" }).click();

  /*
    This used to end on "Accepting does not sign you in", which was correct:
    the API minted no session and the screen said so rather than blurring it.

    yuvoy-api#109 changed the endpoint — "the code they have just proved is the
    same proof a session needs" — so the second identical challenge is gone.
    Same reasoning O1's signup already followed.
  */
  await page.waitForURL("**/today");
  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
  await expect(page.getByText("Accepting does not sign you in.")).toHaveCount(
    0,
  );
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
  await page.getByLabel("The code we sent you").fill(DEV_CODE);
  await page.getByRole("button", { name: "Accept the invitation" }).click();
  await page.waitForURL("**/today");

  // Back as the owner. The invitee's session is live in this browser now, so
  // it has to go first — `/sign-in` sends a signed-in operator to the portal.
  await page.context().clearCookies();
  await signIn(page);
  await page.goto("/team");
  const row = page.locator("li").filter({ hasText: who.name });
  await expect(row.getByText("No sign-in recorded")).toBeVisible();

  await row.getByRole("button", { name: "Remove", exact: true }).click();
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

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();

  expect(results.violations).toEqual([]);
});

test("the join link is a copy control on the invitation, and never a URL on screen", async ({
  page,
}) => {
  /*
    yuvoy-operator#23 put `joinUrl` on the screen at all — there is no WhatsApp
    delivery yet, so the queued message never arrives and the inviter has to
    pass the link on themselves.

    #25 §1 cut it back. It sat permanently at the top of this screen as well as
    on the receipt; now it appears on the row of somebody who has not joined,
    and as a COPY control rather than raw text — "a raw
    https://operators.yuvoy.in/join/l1F-… in the layout reads as debug output".

    The property the permanent block protected is unchanged and is asserted
    here: an owner does NOT have to re-invite to see the link, which would
    replace the code the invitee is holding.
  */
  await signIn(page);
  await page.goto("/team");

  await expect(page.getByText("Your join link")).toHaveCount(0);
  await expect(page.getByText(/\/join\/jn_/)).toHaveCount(0);

  const pending = page.locator("li").filter({ hasText: "Ramesh Toppo" });
  await expect(
    pending.getByRole("button", { name: "Copy invite link" }),
  ).toBeVisible();
});

test("an admin manages the team, but not the owner and not another admin", async ({
  page,
}) => {
  /*
    `DELETE /team/{id}` used to be 403 "OWNER only" while `POST /team` was
    "OWNER or ADMIN", and this test asserted that split. yuvoy-api#109 closed
    it: all four writes are "OWNER or ADMIN only, and an ADMIN cannot change an
    OWNER or another ADMIN".

    So the ceiling moved from "what" to "on whom" — which is what this now
    checks, because a screen offering an admin a control the server refuses on
    the owner's row is the failure that replaced the old one.
  */
  await signIn(page, ADMIN);
  await page.goto("/team");

  await expect(
    page.getByRole("heading", { name: "Add somebody" }),
  ).toBeVisible();

  // On a staff member: everything.
  const staff = page.locator("li").filter({ hasText: "Arun Biswas" });
  await expect(staff.getByRole("button", { name: "Remove" })).toBeVisible();
  await expect(
    staff.getByRole("button", { name: "Change role" }),
  ).toBeVisible();
  await expect(
    staff.getByRole("button", { name: "Pause access" }),
  ).toBeVisible();

  // On the owner: nothing, and no sentence explaining it (§4).
  const owner = page.locator("li").filter({ hasText: "Priya Raut" });
  await expect(owner.getByRole("button", { name: "Remove" })).toHaveCount(0);
  await expect(owner.getByRole("button", { name: "Change role" })).toHaveCount(
    0,
  );
  await expect(owner.getByRole("button", { name: "Pause access" })).toHaveCount(
    0,
  );

  // On their own row: nothing either.
  const self = page.locator("li").filter({ hasText: "Nisha Fernandes" });
  await expect(self.getByRole("button", { name: "Remove" })).toHaveCount(0);
  await expect(self.getByRole("button", { name: "Change role" })).toHaveCount(
    0,
  );
});

test("a staff member gets neither the form nor the link", async ({ page }) => {
  await signIn(page, STAFF);
  await page.goto("/team");

  await expect(page.getByRole("heading", { name: "Add somebody" })).toHaveCount(
    0,
  );
  // The link is rendered on the API's own signal — `joinUrl` is "present only
  // for a caller who can invite" — so this proves the server's answer is what
  // the screen uses, not a second opinion derived from roles.
  await expect(page.getByText("Your join link")).toHaveCount(0);
});

test("the link names the business before anybody types a number", async ({
  page,
}) => {
  /*
    "Somebody who is not yet a user has to see who is asking before handing
    over a phone number." `GET /join/{token}` is unauthenticated and says which
    business and nothing else.
  */
  await page.goto(`/join/${JOIN_TOKEN}`);
  await expect(
    page.getByRole("heading", { name: /Join Reef Divers Havelock/ }),
  ).toBeVisible();
  await expect(page.getByLabel("Your phone number")).toBeVisible();
});

test("a link nobody recognises is a 404, not a retry", async ({ page }) => {
  const res = await page.goto("/join/jn_nonsense");
  expect(res!.status()).toBe(404);
});

test("a number nobody invited is told so, and told what to do", async ({
  page,
}) => {
  /*
    Refused BEFORE anything is sent, and the contract says why: "the
    alternative is a page that fires one-time codes at any phone somebody
    types, which is a free SMS gateway pointed at strangers." The API's own
    sentence names the business and the next step, so it is rendered as it came.
  */
  await page.goto(`/join/${JOIN_TOKEN}`);
  await page.getByLabel("Your phone number").fill("9000099999");
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.locator("form").getByRole("alert")).toContainText(
    /No invitation for that number/,
  );
  await expect(page.getByLabel("Your code")).toHaveCount(0);
});

test("an invited number joins, and is signed straight in", async ({
  page,
}, testInfo) => {
  /*
    Accepting CONSUMES the invitation — it flips from pending to active in the
    mock state both Playwright projects share, so the second project to run
    finds nothing to accept. That is the domain, not flakiness: an invitation
    is used once. Declared rather than hidden, the same call reels and payouts
    make.
  */
  test.skip(
    testInfo.project.name !== "mobile",
    "accepting an invitation consumes it — single-tenant by design, so it runs on the primary project only",
  );

  await page.goto(`/join/${JOIN_TOKEN}`);
  await page.getByLabel("Your phone number").fill("9000000113");
  await page.getByRole("button", { name: "Continue" }).click();

  // What they are accepting, before they accept it.
  await expect(page.getByText(/as Staff/)).toBeVisible();

  await page.getByLabel("Your code").fill(DEV_CODE);
  await page.getByRole("button", { name: "Join", exact: true }).click();

  /*
    Accepting now signs them in and lands them in the portal (yuvoy-api#109).
    It used to end on a panel saying "accepting does not sign you in", which
    was true then and is a second identical challenge now — they proved a code
    seconds ago.
  */
  await page.waitForURL("**/today");
  await expect(page.getByText(/does not sign you in/)).toHaveCount(0);
});

test("joining from another business asks first, and names what is lost", async ({
  page,
}, testInfo) => {
  /*
    Accepting CONSUMES the invitation — it flips from pending to active in the
    mock state both Playwright projects share, so the second project to run
    finds nothing to accept. That is the domain, not flakiness: an invitation
    is used once. Declared rather than hidden, the same call reels and payouts
    make.
  */
  test.skip(
    testInfo.project.name !== "mobile",
    "accepting an invitation consumes it — single-tenant by design, so it runs on the primary project only",
  );

  /*
    The destructive one. "One number works with one business at a time. The
    previous membership is ended and its sessions dropped, so somebody who has
    left cannot keep reading their old employer's manifest from an open tab."

    That is the right behaviour and exactly why it needs a deliberate tap: it
    happens to a person who may be standing on a jetty using the other
    business's app right now. `confirmLeaving` is never sent by default, and
    the API refuses with 409 until it is.
  */
  await page.goto(`/join/${JOIN_TOKEN}`);
  await page.getByLabel("Your phone number").fill("9000000112");
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(
    page.getByText(/This will take you off Havelock Water Sports/),
  ).toBeVisible();
  await expect(page.getByText(/including on any device already/)).toBeVisible();

  // Nothing may be sent while the question is unanswered.
  const submit = page.getByRole("button", {
    name: /Join and leave Havelock Water Sports/,
  });
  await expect(submit).toBeDisabled();

  await page.getByLabel("Your code").fill(DEV_CODE);
  await expect(submit).toBeDisabled();

  await page.getByRole("checkbox", { name: /take me off/ }).check();
  await expect(submit).toBeEnabled();
  await submit.click();

  // And straight into the portal — as the new business, having just lost the
  // old one.
  await page.waitForURL("**/today");
});

test("/join has no accessibility violations", async ({ page }) => {
  await page.goto("/join");
  await page.waitForLoadState("networkidle");

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();

  expect(results.violations).toEqual([]);
});
