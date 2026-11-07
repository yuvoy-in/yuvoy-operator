/**
 * What the three calendar specs share: sign-in, the market day and its labels,
 * and the openers for a day, a departure, the inspector and the add form
 * (yuvoy-operator#178).
 */
import { expect, type Locator, type Page } from "@playwright/test";

export const DEV_CODE = "424242";

export async function signInAs(page: Page, phone: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Your phone number").fill(phone);
  await page.getByRole("button", { name: "Send me a code" }).click();
  await page.getByLabel("Your code").fill(DEV_CODE);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/today");
}

export async function signIn(page: Page) {
  await signInAs(page, "+919000000101");
}

/** A market day `n` days from today, the way the fixtures build them. */
export function marketDay(offset: number): string {
  const now = new Date();
  const ist = new Date(now.getTime() + 5.5 * 3600_000 + offset * 86_400_000);
  return ist.toISOString().slice(0, 10);
}

/**
 * What the day's own region is called on screen.
 *
 * Every day past tomorrow is captioned with its written-out date, so the label
 * has to be built the same way `dayCaption` does rather than guessed at. Today
 * and tomorrow have names of their own and are not used by these tests: both
 * carry fixtures other suites depend on.
 */
export function dayLabel(offset: number): string {
  const day = marketDay(offset);
  return new Intl.DateTimeFormat("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Asia/Kolkata",
  }).format(new Date(`${day}T06:00:00+05:30`));
}

export const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const MONTH = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** "Thu 8 Oct": a day as the board's grid names it, from fixed tables. */
export function shortDay(offset: number): string {
  const [y, m, d] = marketDay(offset).split("-").map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${WEEKDAY[weekday]} ${d} ${MONTH[m - 1]}`;
}

/** What the open day's region is called: Today, Tomorrow, or the date. */
export function dayName(offset: number): string {
  return offset === 0 ? "Today" : offset === 1 ? "Tomorrow" : dayLabel(offset);
}

export const escape = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * One day on the board, opened by its address: the board's whole state is
 * the URL (week, day, open departure), so a test goes where a pasted link
 * goes. Returns the day's region: what is on it, its closures and its own
 * actions (and, on a phone, its departures).
 */
export async function openDay(page: Page, offset: number): Promise<Locator> {
  await page.goto(`/calendar?day=${marketDay(offset)}`);
  const day = page.getByRole("region", { name: dayName(offset), exact: true });
  await expect(day).toBeVisible();
  return day;
}

/**
 * A departure on a day, by its accessible name: the grid's cell on a desktop
 * ("Thu 8 Oct, 09:00 Try-dive, 5 of 8 sold"), the day's row on a phone
 * ("09:00 Try-dive, 5 of 8 sold"). Only the one drawn for the viewport is in
 * the accessibility tree, so one locator serves both projects.
 */
export function departureOn(
  page: Page,
  offset: number,
  title: string,
  time?: string,
): Locator {
  const at = time ? escape(time) : "\\d\\d:\\d\\d";
  return page.getByRole("link", {
    name: new RegExp(
      `^(${escape(shortDay(offset))}, )?${at} ${escape(title)},`,
    ),
  });
}

/**
 * A departure opened into the inspector (the first by that title on that
 * day, which is the earliest: the day is in time order), and the inspector
 * returned: its seats, sales, counter sale, stopping it, and who is on it.
 */
export async function openDeparture(
  page: Page,
  offset: number,
  title: string,
  time?: string,
): Promise<Locator> {
  await openDay(page, offset);
  await departureOn(page, offset, title, time).first().click();
  const inspector = page.getByRole("dialog");
  await expect(inspector).toBeVisible();
  return inspector;
}

/**
 * The day's own marks, under its name: what is on it, "N not on sale",
 * "Closed". Not the departures' chips: on a phone the day also lists them,
 * and a stopped departure says Closed too.
 */
export function dayMarks(day: Locator): Locator {
  return day.locator(":scope > p").first();
}

/** Puts the inspector away, the way a thumb does: its Close. */
export async function closeInspector(page: Page) {
  const inspector = page.getByRole("dialog");
  await inspector.getByRole("button", { name: "Close" }).click();
  await expect(inspector).toHaveCount(0);
}

/** `YYYY-MM-DD`, n days after the market's today. Built in UTC, as dates are. */
export function dayAfter(today: string, n: number): string {
  return new Date(Date.parse(`${today}T00:00:00Z`) + n * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/** Opens the add-departures form and returns the market's today off it. */
export async function openAddDepartures(page: Page): Promise<string> {
  await page.goto("/calendar");
  await page.getByRole("button", { name: "Add departures" }).click();
  const first = page.getByLabel("First day");
  await expect(first).toBeVisible();
  return (await first.inputValue()) || "";
}
