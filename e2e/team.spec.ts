import { test, expect } from "@playwright/test";
import { invitee, signIn, invite } from "./team-kit";

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

test("the team is two lists: people, and invitations nobody has used", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/team");
  await page.waitForLoadState("networkidle");

  // The three fixture people, each with the chip that names their role.
  await expect(page.getByText("Priya Raut")).toBeVisible();
  await expect(page.getByText("Dev Kapoor")).toBeVisible();
  await expect(page.getByText("Arun Biswas")).toBeVisible();

  /*
    The role is the chip, and only the chip (yuvoy-operator#88 s16). "Three
    people means three paragraphs of nearly identical text to read past": each
    row carried the description of its own role, so the same claims were on
    screen as many times as the business has people.
  */
  const arun = page.locator("li").filter({ hasText: "Arun Biswas" });
  await expect(
    arun.locator("[data-chip]").filter({ hasText: /^Staff$/ }),
  ).toHaveCount(1);
  await expect(
    arun.getByText(
      "Who is booked on today's departures, and checking them in as they arrive.",
    ),
  ).toHaveCount(0);
  const dev = page.locator("li").filter({ hasText: "Dev Kapoor" });
  await expect(
    dev.locator("[data-chip]").filter({ hasText: /^Manager$/ }),
  ).toHaveCount(1);
  await expect(
    dev.getByText(
      "Cannot change payout details, and cannot add, remove or pause people.",
    ),
  ).toHaveCount(0);

  /*
    Said ONCE, for the whole list, and out of the way until somebody asks.

    The claims are still load-bearing: an owner hands a crew phone to a skipper
    on the strength of this sentence, and it is the contract's. So each is
    asserted inside the disclosure that now holds it, closed first and open
    after the tap, and asserted absent from every row, which is where the
    repetition was. Not counted on the PAGE: the invite form says what a Staff
    or an Owner invitation grants, beside the choice being made, which is the
    one place saying it twice was never the finding.
  */
  const guide = page.locator("details").filter({
    hasText: "What each role can do",
  });
  await expect(guide).not.toHaveAttribute("open", "");
  await guide.locator("summary").click();
  await expect(guide).toHaveAttribute("open", "");

  for (const claim of [
    "Everything, including where the money goes and who is on this list.",
    "Everything a manager can, plus this list: the stand-in for an owner who is off the island.",
    "Seats, closed dates, seat requests, calling off a departure, earnings and listing edits.",
    "Who is booked on today's departures, and checking them in as they arrive.",
  ]) {
    await expect(guide.getByText(claim)).toBeVisible();
    await expect(page.locator("li").getByText(claim)).toHaveCount(0);
  }

  // And the reasons that closed this screen are an answer in Help now (#80 t4).
  await expect(
    guide.getByRole("link", { name: "Why the roles are different" }),
  ).toHaveAttribute("href", "/account/help?from=%2Fteam#why-roles-differ");
  await expect(
    page.getByRole("heading", { name: "Why the roles are different" }),
  ).toHaveCount(0);

  /*
    An invitation is a way in nobody has used, not a person with less access.
    `id` is the invitation, not a user, and the section says so. It used to
    call it "a code on somebody's phone", and no code has ever reached a phone
    (yuvoy-operator#91).
  */
  await expect(
    page.getByRole("heading", { name: "Invited, not accepted" }),
  ).toBeVisible();
  await expect(page.getByText("Ramesh Toppo")).toBeVisible();
  await expect(
    page.getByText(/An invitation grants nothing until they accept it/),
  ).toBeVisible();
  await expect(page.getByText(/on somebody.s phone/)).toHaveCount(0);

  /*
    Four digits on every row (`phoneMasked`, yuvoy-api#62) — the invitation's
    especially, because it is the one a human typed at six in the morning and
    the only place a typo grants a stranger access. "Invited on" on an
    invitation, "Signs in with" on a person: the same field, two different
    claims. It said "Sent to", and nothing is sent to a phone (#91).
  */
  await expect(
    page
      .locator("li")
      .filter({ hasText: "Ramesh Toppo" })
      .getByText("Invited on ••••0104"),
  ).toBeVisible();
  await expect(page.getByText(/Sent to ••••/)).toHaveCount(0);
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
  const chips = devAfter.locator("[data-chip]");
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
    "/account?tab=reels",
    "/today",
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

test("the invitation is Staff or Owner, Staff preselected, and Manager is neither", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/team");

  /*
    REVERSED on 14 September (D15, yuvoy-operator#51 item 2). This screen used
    to say "there is no Owner option … Yuvoy sets it up", and `POST /team` now
    says "**everybody joins as `STAFF`, except an owner**".

    Manager and Admin are the ones that left, and their absence is the part worth
    asserting: asking for either is NOT refused — the invitation is sent,
    downgraded to staff, and answered with a `note`. A form still offering them
    would quietly do something other than what it says.
  */
  const form = page.locator("form").filter({ hasText: "Their phone number" });
  await expect(form.getByRole("radio", { name: /Staff/ })).toBeVisible();
  await expect(form.getByRole("radio", { name: /Owner/ })).toBeVisible();
  await expect(form.getByRole("radio", { name: /Manager/ })).toHaveCount(0);
  await expect(form.getByRole("radio", { name: /Admin/ })).toHaveCount(0);

  // Staff is preselected: the safer of the two, and the one a boat phone gets.
  await expect(form.getByRole("radio", { name: /Staff/ })).toBeChecked();
  await expect(
    page.getByText(/Manager and Admin are given after somebody has joined/),
  ).toBeVisible();
  // And the sentence that stopped being true went with it.
  await expect(page.getByText(/There is no Owner option/)).toHaveCount(0);
});

test("choosing Owner says what an owner can do, before the invitation goes", async ({
  page,
}) => {
  /*
    An invited owner "gains every owner power, including changing where the
    business is paid" — and unlike a role change it is handed to a phone number
    nobody has answered from yet. Said beside the choice, not after the send.
  */
  await signIn(page);
  await page.goto("/team");

  const form = page.locator("form").filter({ hasText: "Their phone number" });
  await expect(
    page.getByText("An owner can change where the business is paid."),
  ).toHaveCount(0);

  await form.getByRole("radio", { name: /Owner/ }).check();
  await expect(
    page.getByText("An owner can change where the business is paid."),
  ).toBeVisible();

  // And it goes away again, so it reads as a consequence of the choice.
  await form.getByRole("radio", { name: /Staff/ }).check();
  await expect(
    page.getByText("An owner can change where the business is paid."),
  ).toHaveCount(0);
});

test("inviting an owner says Owner on the receipt and on the pending row", async ({
  page,
}, testInfo) => {
  /*
    op#51 item 2's own acceptance: "inviting an owner answers `role: "OWNER"`,
    and the pending row says Owner."

    The receipt reads the RESPONSE's role rather than echoing the request, which
    is the whole reason the response carries one: an invitation for a role the
    API downgrades would otherwise be reported back as the role that was asked
    for.
  */
  const who = invitee("owner", testInfo);
  await signIn(page);
  await invite(page, who, "Owner");

  await expect(page.getByText(`${who.name} is invited as Owner`)).toBeVisible();

  const row = page.locator("li").filter({ hasText: who.name });
  await expect(
    row.locator("[data-chip]").filter({ hasText: /^Owner$/ }),
  ).toHaveCount(1);
});
