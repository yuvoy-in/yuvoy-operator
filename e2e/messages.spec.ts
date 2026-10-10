import { test, expect, type Page } from "@playwright/test";
import { expectAccessible } from "./axe";

/**
 * Conversations — yuvoy-operator#52.
 *
 * Three claims run through everything here, and each one is a way an operator
 * can be told something untrue:
 *
 *   - **A closed conversation can still be READ.** A missing composer must not
 *     read as a missing history: what was agreed with a traveller outlives the
 *     booking that was cancelled.
 *   - **A removed message is still a message.** "The message stays, with who
 *     wrote it and when." An empty bubble says somebody sent nothing.
 *   - **Nothing is marked read that nobody was shown.** The marker moves to a
 *     named message and to everything before it, so naming a later one silently
 *     buries a traveller's question.
 *
 * ## State this suite shares
 *
 * The mock's conversations live in the Next server process both Playwright
 * projects share. Sending APPENDS, and marking read is not reversible, so the
 * tests that write use their own text and assert only on that — never on a
 * count of messages, and never on the unread strip being present, which the
 * other project is clearing at the same time.
 */

const DEV_CODE = "424242";
const OWNER = "+919000000101";
/** Asha's booking: the long conversation, for ordering, paging and the composer. */
const LIVE = "bkg_1";
/**
 * Sofia's: one of the two conversations with anything unread (Hana's, read
 * from Home, is the other), and the one this suite leaves alone until the
 * count test walks it.
 *
 * Separate from `LIVE` because reading is not reversible: the composer and
 * paging tests open that booking, which would clear a count they know nothing
 * about and leave the strip test racing them.
 */
const UNREAD = "bkg_card";
/** Daniel's, cancelled: readable, and no composer. */
const CANCELLED = "bkg_2";
/** Nadia's: the one whose text was removed after the trip. */
const REMOVED = "bkg_4";

/**
 * Where a message sits in the conversation, by position among the bubbles.
 *
 * Used instead of `.first()` / `.last()` for every ordering claim, and that is
 * not a style preference: the composer tests SEND, both Playwright projects
 * share the mock's state, and the newest message in `bkg_1` is therefore
 * whatever the other project wrote a second ago. Two known messages and the
 * order between them is a claim about this screen that nobody else can move.
 */
async function positionOf(page: Page, needle: string): Promise<number> {
  const texts = await page.locator("#conversation li").allInnerTexts();
  const at = texts.findIndex((t) => t.includes(needle));
  expect(at, `"${needle}" is on screen`).toBeGreaterThanOrEqual(0);
  return at;
}

async function signIn(page: Page, phone = OWNER) {
  await page.goto("/sign-in");
  await page.getByLabel("Your phone number").fill(phone);
  await page.getByRole("button", { name: "Send me a code" }).click();
  await page.getByLabel("Your code").fill(DEV_CODE);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/today");
}

test("a booking carries its conversation, oldest first, with who wrote each", async ({
  page,
}) => {
  await signIn(page);
  await page.goto(`/bookings/${LIVE}`);

  await expect(
    page.getByRole("heading", { name: "Conversation" }),
  ).toBeVisible();

  /*
    Newest at the BOTTOM. The endpoint's first page is the most recent messages
    and `nextCursor` walks backwards through what came before, so loading order
    is the reverse of reading order — and a client that got it wrong would put
    last week's question under this morning's answer.
  */
  await expect(page.getByText("We are on our way now.")).toBeVisible();
  expect(await positionOf(page, "do you have fins in size 44?")).toBeLessThan(
    await positionOf(page, "We are on our way now."),
  );

  /*
    The name of the colleague who answered, not the business's. The traveller
    sees the business; the business needs to know which of them already replied,
    which is the question a shared phone on a boat creates.
  */
  await expect(page.getByText("Dev Kapoor").first()).toBeVisible();
  await expect(page.getByText("Asha Menon").first()).toBeVisible();
});

test("earlier messages load above what is already there", async ({ page }) => {
  await signIn(page);
  await page.goto(`/bookings/${LIVE}`);

  const bubbles = page.locator("#conversation li");
  const before = await bubbles.count();
  /*
    A page is 50 and this conversation is longer, so its opening is NOT on the
    first page. That is the fixture's whole job: a conversation that fitted on
    one page would let a client ship the paging backwards and nothing would
    notice.
  */
  const OPENER = "This is where the conversation begins.";
  await expect(page.getByText(OPENER)).toHaveCount(0);

  await page.getByRole("button", { name: "Show earlier messages" }).click();

  await expect(page.getByText(OPENER)).toBeVisible();
  expect(await bubbles.count()).toBeGreaterThan(before);

  // ABOVE, not below. The oldest message in the conversation is now the first.
  await expect(bubbles.first()).toContainText(OPENER);
  /*
    And what was already on screen is still below it, in the same order. Asserted
    between two known messages rather than against the end of the list, which the
    other project's composer tests are appending to.
  */
  expect(await positionOf(page, OPENER)).toBeLessThan(
    await positionOf(page, "We are on our way now."),
  );

  // The control goes once the conversation begins on screen.
  await expect(
    page.getByRole("button", { name: "Show earlier messages" }),
  ).toHaveCount(0);
});

test("a cancelled booking shows its messages, says why, and offers no box", async ({
  page,
}) => {
  /*
    The whole point of the closed state. A missing composer does not say the
    conversation can still be read, so the sentence does — an operator opening a
    cancelled booking to find out what was agreed should find it rather than
    conclude the history went with the booking.
  */
  await signIn(page);
  await page.goto(`/bookings/${CANCELLED}`);

  await expect(
    page.getByText("Sorry, something has come up and I need to cancel."),
  ).toBeVisible();
  await expect(
    page.getByText(
      "This booking was cancelled, so no more messages can be sent. The conversation can still be read.",
    ),
  ).toBeVisible();

  await expect(page.getByLabel("Write to them")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Send" })).toHaveCount(0);
});

test("a message whose text was removed is still a message", async ({
  page,
}) => {
  /*
    "The message stays, with who wrote it and when." An empty bubble would say
    somebody sent nothing, which is a different and untrue thing about a
    conversation an operator may be relying on.
  */
  await signIn(page);
  await page.goto(`/bookings/${REMOVED}`);

  const bubbles = page.locator("#conversation li");
  await expect(bubbles.first()).toContainText("Message removed");
  await expect(bubbles.first()).toContainText("Rhea Kapoor");
  await expect(page.getByText("Message removed")).toHaveCount(2);
});

test("a phone number is refused, and the typed text is kept to edit", async ({
  page,
}) => {
  /*
    op#52 item 2's own acceptance. D-018 carried into the conversation: "you do
    not see a traveller's number, and neither side can type one."

    The portal does NO filtering of its own (`Do not build`) — this asserts that
    the API's refusal reaches the screen, and that the message survives it. A
    message turned away for a phone number should have the number taken out and
    sent, not retyped from memory on a phone in the sun.
  */
  await signIn(page);
  await page.goto(`/bookings/${LIVE}`);

  const box = page.getByLabel("Write to them");
  await box.fill("call me on 98765 43210");
  await page.getByRole("button", { name: "Send" }).click();

  const alert = page.locator("#conversation").getByRole("alert");
  await expect(alert).toContainText("looks like it has a phone number");
  await expect(box).toHaveValue("call me on 98765 43210");

  // And nothing was added to the conversation.
  await expect(
    page.locator("#conversation li").filter({ hasText: "98765" }),
  ).toHaveCount(0);
});

test("a date is not a phone number, and sends", async ({ page }, testInfo) => {
  /*
    The exception in the contract, and the reason it is there: "except the digits
    of a date written like 14.09.2026 or 2026-09-14". An operator telling somebody
    when to turn up must not be told they typed a phone number.

    Its own text per project, because sending appends to state both share.
  */
  const text = `see you on 14.09.2026 at the jetty (${testInfo.project.name})`;
  await signIn(page);
  await page.goto(`/bookings/${LIVE}`);

  const box = page.getByLabel("Write to them");
  await box.fill(text);
  await page.getByRole("button", { name: "Send" }).click();

  // Appended, at the bottom, over the signed-in operator's name.
  const mine = page.locator("#conversation li").filter({ hasText: text });
  await expect(mine).toHaveCount(1);
  await expect(mine).toContainText("Priya Raut");
  // The box is cleared only on success.
  await expect(box).toHaveValue("");
});

test("an email address and a link are refused too", async ({ page }) => {
  await signIn(page);
  await page.goto(`/bookings/${LIVE}`);

  const box = page.getByLabel("Write to them");
  const alert = page.locator("#conversation").getByRole("alert");

  await box.fill("write to me at priya@reefdivers.example");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(alert).toContainText("looks like it has an email address");

  await box.fill("the details are on www.reefdivers.test");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(alert).toContainText("looks like it has a link");
});

test("a conversation row leads with the trip, and the reference comes last", async ({
  page,
}) => {
  /*
    yuvoy-operator#83 s6: every row led with a booking reference in monospace,
    which is what a support agent reads out and not how anybody finds a
    conversation. The trip and its time lead now, then who wrote last, and the
    reference sits last in small type.

    And never any message text: `MessageThreadSummary` carries none, and a list
    that previewed the last line would put a traveller's words where anybody at
    the business can read them over a shoulder, to save one tap.
  */
  await signIn(page);
  await page.goto("/messages");

  await expect(
    page.getByRole("heading", { name: "Conversations" }),
  ).toBeVisible();

  const row = page.locator("li").filter({ hasText: "YV-4K2M9P7Q" });
  await expect(row).toBeVisible();
  const text = await row.innerText();
  const trip = text.indexOf("Try-dive at Nemo Reef");
  const written = text.search(/(You|They) wrote/);
  const reference = text.indexOf("YV-4K2M9P7Q");
  expect(trip, "the trip is on the row").toBeGreaterThanOrEqual(0);
  expect(written, "who wrote last comes after the trip").toBeGreaterThan(trip);
  expect(reference, "the reference comes last").toBeGreaterThan(written);

  const body = await page.locator("main").innerText();
  expect(body, "message text is not on this list").not.toContain(
    "somewhere to leave a bag",
  );
  // One title: the eyebrow and the sentence explaining the list are gone.
  expect(body).not.toContain("One per booking");
});

test("a row opens that booking's conversation", async ({ page }) => {
  await signIn(page);
  await page.goto("/messages");

  await page.locator("li").filter({ hasText: "YV-4K2M9P7Q" }).click();
  await page.waitForURL(`**/bookings/${LIVE}**`);
  await expect(
    page.getByRole("heading", { name: "Conversation" }),
  ).toBeVisible();
});

/*
  op#52 items 3 and 4, walked end to end, because neither half means anything
  alone: a count that never goes down is a badge somebody learns to ignore, and
  a mark-read nobody can see is unfalsifiable. Two ways to read: answering on
  Home (operator experiment A), and opening the booking's conversation.

  Single-tenant BY DESIGN, and serial. Reading a conversation is not
  reversible and the mock's state lives in the Next server process both
  projects share, so the second project would find the count already cleared;
  and the two tests here count each other's conversation, so they run in
  order. Declared rather than hidden, the same call the join and payout specs
  make.
*/
const SINGLE_TENANT =
  "marking read is not reversible, and both projects share the mock's state";

test.describe.serial("guests waiting on a reply", () => {
  test("a guest is answered on Home, in place, and stops waiting", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", SINGLE_TENANT);
    await signIn(page);
    await page.goto("/today");

    // Two conversations unread: Sofia's, and Hana's on today's 20:30.
    await expect(
      page.getByRole("link", {
        name: "Messages, 2 unread conversations",
        exact: true,
      }),
    ).toBeVisible();
    const needs = page.getByRole("region", { name: "Needs you" });
    const card = needs
      .getByRole("listitem", { name: "Message from a guest" })
      .filter({ hasText: "YV-T0DAY4K5" });
    await expect(card).toContainText("1 new");
    // A summary carries no name and no words, by contract.
    await expect(card).not.toContainText("Hana");

    await card.getByRole("button", { name: "Read and reply" }).click();
    const open = needs.getByRole("listitem", { name: "Message from Hana Ito" });
    await expect(open).toContainText("Hana Ito wrote");
    await expect(open).toContainText("Can I pay you in cash at the jetty?");
    await expectAccessible(page, "Home, a conversation open to reply");

    // A quick reply fills the box; only Send sends.
    await open.getByRole("button", { name: "Yes, that is fine." }).click();
    await expect(open.getByLabel("Reply to Hana")).toHaveValue(
      "Yes, that is fine.",
    );
    await open.getByRole("button", { name: "Send" }).click();
    await expect(open.getByRole("status")).toHaveText("Sent to Hana Ito.");
    await expect(open).toContainText("Yes, that is fine.");

    // Read, so one guest is left waiting, and Home no longer offers Hana.
    await expect(async () => {
      await page.goto("/today");
      await expect(
        page.getByRole("link", {
          name: "Messages, 1 unread conversation",
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        page
          .getByRole("region", { name: "Needs you" })
          .getByRole("listitem")
          .filter({ hasText: "YV-T0DAY4K5" }),
      ).toHaveCount(0);
    }).toPass({ timeout: 10_000 });

    // And the reply is on the booking, where the traveller's thread lives.
    await page.goto("/bookings/bkg_cash_today");
    await expect(
      page.getByRole("region", { name: "Conversation" }),
    ).toContainText("Yes, that is fine.");
  });

  test("Home counts unread, and opening the conversation clears it", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", SINGLE_TENANT);
    await signIn(page);
    await page.goto("/today");

    /*
      A card in Home's "Needs you", counted in messages on the card and in
      guests on the stage: one conversation with two unread messages is one
      guest waiting on a reply.
    */
    const card = page
      .getByRole("region", { name: "Needs you" })
      .getByRole("listitem", { name: "Message from a guest" })
      .filter({ hasText: "YV-CARD6N7P" });
    await expect(card).toContainText("2 new");
    const inbox = page.getByRole("link", {
      name: "Messages, 1 unread conversation",
      exact: true,
    });
    await expect(inbox).toBeVisible();

    await inbox.click();
    await page.waitForURL("**/messages");
    /*
      The row carries the same two, which is what makes the list worth opening
      rather than scanning every booking: a dot to the eye, and the count in the
      row's name to a screen reader (yuvoy-operator#83 s6).
    */
    await expect(
      page.getByRole("link", { name: /YV-CARD6N7P/ }),
    ).toHaveAccessibleName(/2 unread messages/);

    /*
      And on the manifest, at the jetty: Sofia's row on her departure says
      she wrote, and opens her conversation (audit 5.2). Read here, in this
      serial block, because reading clears it.
    */
    await page.goto("/today/slot_cash");
    const row = page.getByRole("listitem").filter({ hasText: "YV-CARD6N7P" });
    const wrote = row.getByRole("link", { name: "2 new messages" });
    await expect(wrote).toHaveAttribute(
      "href",
      /^\/bookings\/bkg_card\?from=%2Ftoday%2Fslot_cash#conversation$/,
    );

    await wrote.click();
    await page.waitForURL(`**/bookings/${UNREAD}**`);
    await expect(
      page.getByRole("heading", { name: "Conversation" }),
    ).toBeVisible();

    /*
      The marker moves on the client, after the page is drawn, so the assertion
      waits on Home rather than on anything here. `toPass` because the write is a
      Server Action fired from an effect: it has landed by the time Home is
      re-requested, but not necessarily by the time the click happens.
    */
    await expect(async () => {
      await page.goto("/today");
      await expect(
        page
          .getByRole("region", { name: "Needs you" })
          .getByRole("listitem")
          .filter({ hasText: "YV-CARD6N7P" }),
      ).toHaveCount(0);
      // And the inbox carries no count.
      await expect(
        page.getByRole("link", { name: "Messages", exact: true }),
      ).toBeVisible();
    }).toPass({ timeout: 10_000 });
  });
});

test("/messages has no accessibility violations", async ({ page }) => {
  await signIn(page);
  await page.goto("/messages");
  await expect(
    page.getByRole("heading", { name: "Conversations" }),
  ).toBeVisible();

  await expectAccessible(page, "/messages");
});

test("a conversation has no accessibility violations", async ({ page }) => {
  await signIn(page);
  await page.goto(`/bookings/${LIVE}`);
  await expect(
    page.getByRole("heading", { name: "Conversation" }),
  ).toBeVisible();

  await expectAccessible(page, "a conversation");
});
