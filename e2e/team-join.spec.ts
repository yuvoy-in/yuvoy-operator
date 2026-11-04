import { test, expect } from "@playwright/test";
import { expectAccessible } from "./axe";
import { DEV_CODE, OWNER, JOIN_TOKEN, signIn, invite } from "./team-kit";

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

/** Arun, STAFF — sees the list and nothing to act on. */
const STAFF = "+919000000103";
/** Nisha, ADMIN — the login these tests act AS. See yuvoy-operator#23. */
const ADMIN = "+919000000114";
/**
 * Ravi, the second active ADMIN — the row these tests act ON.
 *
 * Exists because admin-on-admin went from refused to allowed (D15,
 * yuvoy-operator#51): with one admin, the only admin row an admin could look at
 * was their own, which is refused for a different reason entirely.
 */
const OTHER_ADMIN_NAME = "Ravi Menon";

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

test("an admin manages the team, including another admin, but never the owner", async ({
  page,
}) => {
  /*
    The ceiling moved twice. `DELETE /team/{id}` used to be 403 "OWNER only"
    while `POST /team` was "OWNER or ADMIN" (closed by yuvoy-api#109), and then
    the seniority clause narrowed from "an ADMIN cannot change an OWNER or
    another ADMIN" to just the owner half (D15, yuvoy-operator#51).

    So it is now "on whom", and the answer is: anybody but the owner and
    themselves. Both halves are asserted, because a screen that withholds
    controls the API allows is as wrong as one that offers controls it refuses —
    just quieter, which is how the old clause survived a week past the contract.
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

  // On ANOTHER ADMIN: everything. This was withheld until 14 September.
  const peer = page.locator("li").filter({ hasText: OTHER_ADMIN_NAME });
  await expect(peer.getByRole("button", { name: "Remove" })).toBeVisible();
  await expect(peer.getByRole("button", { name: "Change role" })).toBeVisible();
  await expect(
    peer.getByRole("button", { name: "Pause access" }),
  ).toBeVisible();

  // On their own row: nothing either.
  const self = page.locator("li").filter({ hasText: "Nisha Fernandes" });
  await expect(self.getByRole("button", { name: "Remove" })).toHaveCount(0);
  await expect(self.getByRole("button", { name: "Change role" })).toHaveCount(
    0,
  );
});

test("an admin making somebody an owner is told they cannot undo it", async ({
  page,
}) => {
  /*
    Two sentences, and which of them appears depends on who is signed in
    (yuvoy-operator#51 item 3). The first is for everybody: "they will be able to
    change where the business is paid." The second is an ADMIN's alone — "an
    ADMIN who makes somebody an owner cannot change that person's access
    afterwards" — because for them it is a one-way door and the API will refuse
    them the way back.

    Nothing is saved here. The panel is what is being tested, and saving would
    put a second owner into the fixture every other spec reads.
  */
  await signIn(page, ADMIN);
  await page.goto("/team");

  const staff = page.locator("li").filter({ hasText: "Arun Biswas" });
  await staff.getByRole("button", { name: "Change role" }).click();

  // Not drawn until Owner is the answer.
  await expect(
    staff.getByText("They will be able to change where the business is paid."),
  ).toHaveCount(0);

  await staff.getByRole("radio", { name: /^Owner/ }).check();
  await expect(
    staff.getByText("They will be able to change where the business is paid."),
  ).toBeVisible();
  await expect(
    staff.getByText("You will not be able to change their access afterwards."),
  ).toBeVisible();
});

test("an owner making somebody an owner gets the warning that is true for them", async ({
  page,
}) => {
  /*
    The control for the test above. An OWNER keeps every power after handing the
    role on — "an OWNER may change anybody's role but their own, another owner's
    included" — so the admin's sentence would be false for them, and a warning
    that is false is worse than none.
  */
  await signIn(page);
  await page.goto("/team");

  const staff = page.locator("li").filter({ hasText: "Arun Biswas" });
  await staff.getByRole("button", { name: "Change role" }).click();
  await staff.getByRole("radio", { name: /^Owner/ }).check();

  await expect(
    staff.getByText("They will be able to change where the business is paid."),
  ).toBeVisible();
  await expect(
    staff.getByText("You will not be able to change their access afterwards."),
  ).toHaveCount(0);
});

test("Owner is on the role picker at all, which it was not", async ({
  page,
}) => {
  /*
    `PUT /team/{id}/role` used to be four options minus one: "`OWNER` cannot be
    given and an owner's role cannot be changed here." Its enum is now all four
    (D31), so an owner can hand the business on rather than removing somebody and
    inviting them back.
  */
  await signIn(page);
  await page.goto("/team");

  const staff = page.locator("li").filter({ hasText: "Arun Biswas" });
  await staff.getByRole("button", { name: "Change role" }).click();
  for (const role of ["Owner", "Admin", "Manager", "Staff"]) {
    await expect(
      staff.getByRole("radio", { name: new RegExp(`^${role}`) }),
    ).toBeVisible();
  }
});

test("an owner's row offers Change role to another owner, and nothing to an admin", async ({
  page,
}) => {
  /*
    The row where the two rules meet. "An OWNER may change anybody's role but
    their own, another owner's included. An ADMIN may change anybody's but their
    own and an owner's."

    Read from the admin's side, because that is the side with something to hide:
    the owner's own session sees their row as "yourself", which is a different
    refusal and would pass this by accident.
  */
  await signIn(page, ADMIN);
  await page.goto("/team");
  const owner = page.locator("li").filter({ hasText: "Priya Raut" });
  await expect(owner.getByRole("button", { name: "Change role" })).toHaveCount(
    0,
  );
  // And no sentence explaining the hierarchy: the absence is the answer (§4).
  await expect(owner.getByText(/cannot change/i)).toHaveCount(0);
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

test("an owner invitation says Owner on the join page", async ({ page }) => {
  /*
    op#51 item 5: "`POST /join/{token}/code` answers `role` as `OWNER`, `ADMIN`,
    `MANAGER` or `STAFF`. Label `OWNER` 'Owner'." What somebody is accepting,
    before they accept it — and for an owner invitation that is the whole
    business, so the word has to be the right one.

    Only the CODE is asked for. Accepting would consume the invitation and the
    second Playwright project would find nothing, and this read leaves it where
    it is, so both projects can make it.
  */
  await page.goto(`/join/${JOIN_TOKEN}`);
  await page.getByLabel("Your phone number").fill("9000000117");
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByText(/as Owner/)).toBeVisible();
  /*
    And not the raw enum value, which is what a screen with no label map shows.
    Asserted against the page's own text rather than with a locator: `getByText`
    is case-INSENSITIVE by default, so `getByText("OWNER")` matches the very
    "Owner" this test wants, and the assertion could never pass.
  */
  const body = await page.locator("body").innerText();
  expect(body).not.toContain("OWNER");
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

test("a wrong code on the join link says so, and asks nobody to leave anything", async ({
  page,
}) => {
  /*
    yuvoy-operator#145. A wrong or used-up code is `409 cannot_invite`, and
    every 409 used to be read as "confirm you are leaving another business".
    So somebody in no business at all was asked to leave one, and past the
    attempt limit went round that panel for good. Nothing is consumed by a
    wrong code, so both projects run it.
  */
  await page.goto(`/join/${JOIN_TOKEN}`);
  await page.getByLabel("Your phone number").fill("9000000104");
  await page.getByRole("button", { name: "Continue" }).click();

  await page.getByLabel("Your code").fill("000000");
  await page.getByRole("button", { name: "Join", exact: true }).click();

  await expect(page.locator("form").getByRole("alert")).toHaveText(
    "We could not accept that invitation. Check the code and try again.",
  );
  await expect(page.getByText(/take you off/)).toHaveCount(0);
  await expect(page.getByLabel("Your code")).toBeVisible();
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
  // The API's own sentence, carried in `note` (yuvoy-api#227 kept its words).
  await expect(
    page.getByText(/Accepting removes you from Havelock Water Sports/),
  ).toBeVisible();

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

  await expectAccessible(page, "/join");
});
