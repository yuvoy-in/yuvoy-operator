import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

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
 * Sofia's: the ONLY conversation with anything unread, and the only one this
 * suite leaves alone until the strip test walks it.
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
  await expect(alert).toContainText("cannot contain a phone number");
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
  await expect(alert).toContainText("cannot contain an email address");

  await box.fill("the details are on www.reefdivers.test");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(alert).toContainText("cannot contain a link");
});

test("the conversations list names the trip, never the traveller", async ({
  page,
}) => {
  /*
    `MessageThreadSummary` "carries neither the traveller's name nor any contact
    detail, by design (D-018)", and never any message text. A list that previewed
    the last line would put a traveller's words where anybody at the business can
    read them over a shoulder, to save one tap.
  */
  await signIn(page);
  await page.goto("/messages");

  await expect(
    page.getByRole("heading", { name: "Conversations" }),
  ).toBeVisible();

  const row = page.locator("li").filter({ hasText: "YV-4K2M9P7Q" });
  await expect(row).toBeVisible();
  await expect(row).toContainText("Try-dive at Nemo Reef");

  const body = await page.locator("main").innerText();
  expect(body, "a traveller's name is not on this list").not.toContain(
    "Asha Menon",
  );
  expect(body, "message text is not on this list").not.toContain(
    "somewhere to leave a bag",
  );
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

test("Home counts unread, and opening the conversation clears it", async ({
  page,
}, testInfo) => {
  /*
    op#52 items 3 and 4, walked end to end, because neither half means anything
    alone: a count that never goes down is a badge somebody learns to ignore, and
    a mark-read nobody can see is unfalsifiable.

    Single-tenant BY DESIGN. Reading a conversation is not reversible and the
    mock's state lives in the Next server process both projects share, so the
    second project would find the strip already cleared. Declared rather than
    hidden, the same call the join and payout specs make.
  */
  test.skip(
    testInfo.project.name !== "mobile",
    "marking read is not reversible, and both projects share the mock's state",
  );

  await signIn(page);
  await page.goto("/today");

  /*
    A row in Home's "Needs you" since yuvoy-operator#96, counted in guests:
    one conversation with two unread messages is one guest waiting on a
    reply. The inbox on the stage says the same number.
  */
  const strip = page
    .getByRole("region", { name: "Needs you" })
    .getByRole("link", { name: /guests? wrote to you/ });
  await expect(strip).toContainText("1 guest wrote to you");
  await expect(
    page.getByRole("link", {
      name: "Messages, 1 unread conversation",
      exact: true,
    }),
  ).toBeVisible();

  await strip.click();
  await page.waitForURL("**/messages");
  /*
    The chip on the row carries the same two, which is what makes the list worth
    opening rather than scanning every booking.
  */
  await expect(
    page.locator("li").filter({ hasText: "YV-CARD6N7P" }),
  ).toContainText("2");

  await page.locator("li").filter({ hasText: "YV-CARD6N7P" }).click();
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
      page.getByRole("link", { name: /guests? wrote to you/ }),
    ).toHaveCount(0);
    // And the inbox carries no count.
    await expect(
      page.getByRole("link", { name: "Messages", exact: true }),
    ).toBeVisible();
  }).toPass({ timeout: 10_000 });
});

test("/messages has no accessibility violations", async ({ page }) => {
  await signIn(page);
  await page.goto("/messages");
  await expect(
    page.getByRole("heading", { name: "Conversations" }),
  ).toBeVisible();

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});

test("a conversation has no accessibility violations", async ({ page }) => {
  await signIn(page);
  await page.goto(`/bookings/${LIVE}`);
  await expect(
    page.getByRole("heading", { name: "Conversation" }),
  ).toBeVisible();

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});
