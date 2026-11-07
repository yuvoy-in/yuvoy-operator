/**
 * What the three team specs share: sign-in, the owner number, the invitee slots
 * and the invite step (yuvoy-operator#178).
 */
import { expect, type Page, type TestInfo } from "@playwright/test";

export const DEV_CODE = "424242";

/** The owner. Every other spec signs in as this number too. */
export const OWNER = "+919000000101";

export type Slot =
  | "echo"
  | "revoke"
  | "accept"
  | "remove"
  | "owner"
  | "emailed"
  | "unsent"
  | "typo"
  | "listed";

/** The business's one join link, the same for everybody it adds. */
export const JOIN_TOKEN = "jn_reefdivers";

export const SLOTS: Slot[] = [
  "echo",
  "revoke",
  "accept",
  "remove",
  "owner",
  "emailed",
  "unsent",
  "typo",
  "listed",
];

export const NAMES: Record<Slot, string> = {
  echo: "Kiran",
  revoke: "Meera",
  accept: "Nikhil",
  remove: "Omar",
  owner: "Pallavi",
  emailed: "Qadir",
  unsent: "Rhea",
  typo: "Sana",
  listed: "Tara",
};

/**
 * A person this test alone may invite, remove and assert on.
 *
 * Split by project rather than serialised. Nothing about a team is genuinely
 * single-tenant the way one open bank change is, so the honest shape is
 * separate fixtures rather than a skip.
 */
export function invitee(slot: Slot, testInfo: TestInfo) {
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

export async function signIn(page: Page, phone = OWNER) {
  await page.goto("/sign-in");
  await page.getByLabel("Your phone number").fill(phone);
  await page.getByRole("button", { name: "Send me a code" }).click();
  await page.getByLabel("Your code").fill(DEV_CODE);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/today");
}

/** Invite somebody, and leave the page on /team with the form answered. */
export async function invite(
  page: Page,
  who: { phone: string; name: string; email?: string },
  role: "Owner" | "Staff" = "Staff",
) {
  await page.goto("/team");
  await page.getByLabel("Their name").fill(who.name);
  await page.getByLabel("Their phone number").fill(who.phone);
  // Optional, and where the invitation goes while there is no WhatsApp sender.
  if (who.email) await page.getByLabel(/^Their email/).fill(who.email);
  await page.getByRole("radio", { name: role, exact: false }).check();
  await page.getByRole("button", { name: "Send the invitation" }).click();
  await expect(page.getByText(`${who.name} is invited`)).toBeVisible();
}
