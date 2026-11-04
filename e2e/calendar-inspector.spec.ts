import { test, expect } from "@playwright/test";
import { expectAccessible } from "./axe";
import {
  signInAs,
  signIn,
  shortDay,
  dayName,
  openDay,
  departureOn,
  openDeparture,
  dayMarks,
  closeInspector,
  dayAfter,
  openAddDepartures,
} from "./calendar-kit";

/**
 * O9's capacity half — the single most important number in the system.
 *
 * The assertions here are all about refusals, because that is what this screen
 * is for. A capacity screen that only proves you can raise a number has proved
 * nothing: the failure it exists to prevent is a boat leaving with people
 * still on the jetty.
 */

test("stopping one departure leaves the rest of the day selling, and reopens", async ({
  page,
}, testInfo) => {
  /*
    op#45 items 4 and 2. "This departure stops selling and the rest of its day
    does not", and "closing is not cancelling people": the bookings on it still
    stand, and the receipt says so. It is inside the departure now, quiet until
    asked for, behind a confirm (#84 s7, #81).
  */
  const offset = testInfo.project.name === "mobile" ? 7 : 8;
  const letter = testInfo.project.name === "mobile" ? "A" : "B";
  const kayak = `Lagoon kayak (stop fixture ${letter})`;
  await signIn(page);

  const stopping = await openDeparture(page, offset, kayak);
  await stopping.getByRole("button", { name: "Stop selling" }).click();
  /*
    "Staff" is this list's label: closing takes `BLACKOUT_REASONS` (Weather,
    Maintenance, Staff, Personal, Out of season, Something else), not the
    call-off list's "Staffing". The contract keeps four separate reason lists
    on purpose and each act takes only its own.
  */
  await stopping.getByRole("radio", { name: "Staff", exact: true }).check();
  await stopping.getByRole("button", { name: "Stop selling it" }).click();

  // The receipt, verbatim, in the departure it was made in: closing cancels
  // nobody.
  await expect(stopping.getByText(/is closed to new bookings$/)).toBeVisible();
  await expect(
    stopping.getByText(/The bookings already on this departure still stand/),
  ).toBeVisible();
  /*
    And the board re-reads underneath it, with no tap (op#89 f16): the
    departure now says why it is not selling, in the API's sentence, and the
    inspector is still open.
  */
  await expect(
    stopping.getByText(/^This departure is closed to new bookings\./),
  ).toBeVisible();

  // A reload lands on the same departure: the inspector is in the address.
  await page.reload();
  await expect(page.getByRole("dialog")).toContainText(
    "This departure is closed to new bookings.",
  );
  await closeInspector(page);
  const after = page.getByRole("region", {
    name: dayName(offset),
    exact: true,
  });

  // The other one on the day still sells.
  const other = await openDeparture(
    page,
    offset,
    `Sunset paddle (stop fixture ${letter})`,
  );
  await expect(other).not.toContainText("closed to new bookings");
  await closeInspector(page);

  // And the DAY is not closed: only one departure was.
  await expect(
    dayMarks(after).getByText("Closed", { exact: true }),
  ).toHaveCount(0);

  /*
    Reopening it is offered on the day, and it puts exactly that departure back:
    `departuresReopened: 1`, which the API's note says in words.
  */
  await expect(after.getByText("One departure", { exact: true })).toBeVisible();
  await after.getByRole("button", { name: "Reopen" }).click();
  await expect(after.getByText("1 departure is back on sale.")).toBeVisible();
  // Without a reload, too: the board re-reads as soon as it is reopened, and
  // the departure no longer says Closed.
  await expect(
    departureOn(page, offset, kayak).first(),
  ).not.toHaveAccessibleName(/, Closed(,|$)/);

  await page.reload();
  const reopened = await openDeparture(page, offset, kayak);
  await expect(reopened).not.toContainText("closed to new bookings");
});

test("a called-off departure says what the API says, not what we used to", async ({
  page,
}) => {
  /*
    op#45 item 5. The portal wrote its own sentence here: "Called off. Everyone
    booked on it was cancelled and refunded." It existed because the API filed
    `cancelled` under `departure_closed` with "anybody already booked on it is
    unaffected", which was the opposite of the truth.

    `departure_called_off` is its own reason now, and ours had to go because it
    was never true of a CASH booking: nothing was refunded on one, the money
    never reached us, and the operator is the one holding it.
  */
  await signIn(page);

  await openDay(page, 0);
  // The calendar's word on the board, exactly, in the departure's name.
  await expect(
    departureOn(page, 0, "Private boat charter, whole day").first(),
  ).toHaveAccessibleName(/, Called off(,|$)/);
  const row = await openDeparture(page, 0, "Private boat charter, whole day");
  await expect(row).toContainText("This departure was called off.");
  await expect(row).toContainText("anything paid in cash is with the operator");
  await expect(row).not.toContainText("Everyone booked on it was cancelled");
  // A called-off departure has nothing left to change.
  await expect(row.getByLabel("Seats offered")).toHaveCount(0);
});

test("a staff login is told who can change this, in one sentence, and offered nothing to change", async ({
  page,
}) => {
  // op#45 item 7: three sentences opening "Your role cannot ..." became one
  // that says who to ask rather than what the reader is.
  await signInAs(page, "+919000000103");
  await page.goto("/calendar");

  await expect(
    page.getByText(
      "Only owners, admins and managers can change seats or close dates.",
    ),
  ).toBeVisible();
  /*
    And no control the API would refuse. Closing dates used to be drawn for
    staff and refused after the tap.
  */
  await expect(
    page.getByRole("button", { name: "Close dates to new bookings" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Add departures" }),
  ).toHaveCount(0);
  const inspector = await openDeparture(page, 0, "Try-dive at Nemo Reef");
  // The departure's own controls, apart from the inspector's frame.
  const row = inspector.getByRole("region", { name: "Seats and sales" });
  await expect(row.getByRole("link", { name: "Who is booked" })).toBeVisible();
  await expect(row.getByLabel("Seats offered")).toHaveCount(0);
  /*
    A counter sale is the one control staff are given: the API has never
    role-gated it, and the person at the counter is often staff (owner ruling,
    23 Sep 2026). Seats and stopping a sale stay with managers.
  */
  await expect(row.getByRole("button")).toHaveCount(1);
  await expect(
    row.getByRole("button", { name: "I sold seats at my counter" }),
  ).toBeVisible();
});

test("/calendar has no accessibility violations", async ({ page }) => {
  await signIn(page);
  // Every form open, or the audit only ever sees collapsed ones.
  const tomorrow = await openDay(page, 1);
  await page.getByRole("button", { name: "Add departures" }).click();
  await page
    .getByRole("button", { name: "Close dates to new bookings" })
    .click();
  await tomorrow.getByRole("button", { name: /^Close this day/ }).click();
  await page.waitForLoadState("networkidle");

  await expectAccessible(page, "/calendar, every form open");

  // And the inspector, open over the board.
  await departureOn(page, 1, "Snorkel trip to Elephant Beach").first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.waitForLoadState("networkidle");

  await expectAccessible(page, "/calendar, a departure's inspector open");
});

/*
  The board's reach and its inspector (operator experiment B; audit 5.1).
*/
test("a departure past the old fortnight is on the board, and changes there", async ({
  page,
}, testInfo) => {
  /*
    The fortnight stopped at today plus thirteen, so a departure three weeks
    out could not have its seats changed. Made here, on a day per project far
    past anything else in the suite, and found on its own week.
  */
  test.setTimeout(60_000);
  await signIn(page);
  const mobile = testInfo.project.name === "mobile";
  const offset = mobile ? 20 : 23;
  const time = mobile ? "06:10" : "06:40";
  const title = mobile
    ? "Try-dive at Nemo Reef"
    : "Snorkel trip to Elephant Beach";

  const today = await openAddDepartures(page);
  const day = dayAfter(today, offset);
  await page.getByLabel("Which listing").selectOption({ label: title });
  await page.getByLabel("First day").fill(day);
  await page.getByLabel("Last day").fill(day);
  await page.getByRole("textbox", { name: "Departure time 1" }).fill(time);
  await page.getByLabel("Seats on each departure").fill("6");
  await page.getByRole("button", { name: "Add 1 departure" }).click();
  await expect(
    page.getByText(/1 departure added|Nothing to add/).first(),
  ).toBeVisible();

  const inspector = await openDeparture(page, offset, title, time);
  await expect(page.getByRole("heading", { name: /^Week of / })).toBeVisible();
  await inspector.getByLabel("Seats offered").fill("7");
  await inspector.getByRole("button", { name: "Set seats" }).click();
  await expect(inspector.getByText("Now offering 7.")).toBeVisible();
});

test("the inspector closes with Escape, back onto the departure that opened it", async ({
  page,
}) => {
  await signIn(page);
  await openDay(page, 0);
  const link = departureOn(page, 0, "Try-dive at Nemo Reef").first();
  await link.click();
  const inspector = page.getByRole("dialog");
  await expect(inspector).toBeVisible();
  // The address says which departure is open, so a reload or a pasted link
  // lands on it.
  expect(new URL(page.url()).searchParams.get("dep")).toBe("slot_dawn");

  await page.keyboard.press("Escape");
  await expect(inspector).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get("dep")).toBeNull();
  await expect(link).toBeFocused();
});

test("on a desktop the arrow keys move along the board", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "the grid is a desktop's");
  await signIn(page);
  await page.goto("/calendar");

  /*
    Where each departure sits, as the grid itself says (`data-row`,
    `data-col`), and a direction from today's dive that has a departure in
    it: today may be the week's last day, or its listing's only one.
  */
  const cells = await page
    .locator("[data-row][data-col]")
    .evaluateAll((links) =>
      links.map((link) => ({
        row: Number((link as HTMLElement).dataset.row),
        col: Number((link as HTMLElement).dataset.col),
        name: link.getAttribute("aria-label") ?? "",
      })),
    );
  const start = cells.find(
    (c) =>
      c.name.startsWith(`${shortDay(0)}, `) &&
      c.name.includes("Try-dive at Nemo Reef"),
  )!;
  const ways: [string, string, (c: (typeof cells)[number]) => boolean][] = [
    [
      "ArrowRight",
      "ArrowLeft",
      (c) => c.row === start.row && c.col > start.col,
    ],
    [
      "ArrowLeft",
      "ArrowRight",
      (c) => c.row === start.row && c.col < start.col,
    ],
    ["ArrowDown", "ArrowUp", (c) => c.row > start.row],
    ["ArrowUp", "ArrowDown", (c) => c.row < start.row],
  ];
  const way = ways.find(([, , has]) => cells.some(has));
  expect(way, "a departure next to today's on the board").toBeTruthy();
  const [go, back] = way!;

  const from = departureOn(page, 0, "Try-dive at Nemo Reef").first();
  await from.focus();
  await page.keyboard.press(go);
  // Somewhere else on the board, by the keys alone.
  await expect(page.locator(":focus")).not.toHaveAccessibleName(start.name);
  await expect(page.locator(":focus")).toHaveAttribute("data-row", /\d+/);
  // And back to today's cell the other way.
  await page.keyboard.press(back);
  await expect(page.locator(":focus")).toHaveAttribute(
    "data-col",
    String(start.col),
  );
  await expect(page.locator(":focus")).toHaveAttribute(
    "data-row",
    String(start.row),
  );
});

/*
  With no signal (operator experiment B's offline state, built 4 Oct 2026).
  The board is server-rendered: offline there is no other week, day or
  inspector to fetch, and Next falls back to a full browser navigation that
  lands on the browser's own "no internet" page. So the board stays readable,
  nothing that changes something can be pressed, and a link that needs the
  server is held with the reason.
*/
test("with no signal the calendar stays readable, changes nothing, and says so", async ({
  page,
  context,
}) => {
  await signIn(page);
  await openDay(page, 1);
  const notice = page.getByRole("status").filter({ hasText: "No signal" });
  await expect(notice).toHaveCount(0);

  await context.setOffline(true);
  await expect(notice).toContainText(
    "The calendar is read-only until you are back online. What it shows may be out of date.",
  );
  await expect(
    page.getByRole("button", { name: "Add departures" }),
  ).toBeDisabled();

  // Another week needs the server: held where it is, with the reason.
  const here = page.url();
  await page
    .getByRole("navigation", { name: "Weeks" })
    .getByRole("link", { name: "Later" })
    .click();
  await expect(notice).toContainText("That opens once you are back online.");
  expect(page.url()).toBe(here);
  await expect(page.getByRole("heading", { name: "Calendar" })).toBeVisible();

  await expectAccessible(page, "/calendar, with no signal");

  // Back online: the notice goes, and the board is usable again.
  await context.setOffline(false);
  await expect(notice).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Add departures" }),
  ).toBeEnabled();
});

test("with no signal the inspector closes on the phone, and changes nothing", async ({
  page,
  context,
}) => {
  await signIn(page);
  const inspector = await openDeparture(
    page,
    1,
    "Snorkel trip to Elephant Beach",
  );
  await context.setOffline(true);
  await expect(
    page.getByRole("status").filter({ hasText: "No signal" }),
  ).toBeVisible();

  // Everything inside that changes the departure is off; Close is not.
  const buttons = inspector.getByRole("button");
  const names = (await buttons.allTextContents()).map((n) => n.trim());
  expect(names.length, "the inspector offers something to do").toBeGreaterThan(
    1,
  );
  for (let i = 0; i < names.length; i += 1) {
    const button = buttons.nth(i);
    const label = (await button.getAttribute("aria-label")) ?? names[i];
    if (label === "Close") await expect(button).toBeEnabled();
    else await expect(button).toBeDisabled();
  }

  await inspector.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(new URL(page.url()).searchParams.has("dep")).toBe(false);
  await expect(page.getByRole("heading", { name: "Calendar" })).toBeVisible();
  await context.setOffline(false);
});
