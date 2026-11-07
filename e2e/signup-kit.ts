/**
 * What the two signup specs share: the dev code, the fresh number and the field
 * filler (yuvoy-operator#178).
 */
import type { Page, TestInfo } from "@playwright/test";

export const DEV_CODE = "424242";

/** A number this test alone may sign up. See the header. */
export function newNumber(slot: number, testInfo: TestInfo) {
  const project = testInfo.project.name === "mobile" ? "1" : "2";
  const retry = Math.min(testInfo.retry, 9);
  return `+9199${project}${retry}${slot}00000`.slice(0, 14);
}

export async function fill(
  page: Page,
  who: {
    business: string;
    name: string;
    phone: string;
    /** Defaults to a real-looking address; see the note in the body. */
    email?: string;
    /**
     * Own it, or run it for the owner (D15, yuvoy-operator#51 item 1).
     *
     * Answered in the helper because the choice is REQUIRED and has no default:
     * the endpoint reads an absent `relationship` as `own`, so a form that
     * quietly defaulted would turn somebody who runs a shop into its owner.
     * "I own it" here keeps every existing test asserting what it always did.
     */
    relationship?: "I own it" | "I run it for the owner";
  },
) {
  await page.getByLabel("Your business name").fill(who.business);
  /*
    Substring, not exact. Each option's accessible name is its whole label, and
    the label carries the consequence as well as the choice: "I own it You will
    be its owner, and can set up where it is paid." Neither answer is a substring
    of the other, so this stays unambiguous.
  */
  await page
    .getByRole("radio", { name: who.relationship ?? "I own it" })
    .check();
  await page.getByLabel("Your name", { exact: true }).fill(who.name);
  /*
    The field takes ten digits and shows a fixed `+91`, so a full E.164 number
    is normalised down to its national part as it arrives — which is the whole
    point of yuvoy-operator#19, and is why these tests can keep handing it one.
  */
  await page.getByLabel("Your phone number").fill(who.phone);
  /*
    Always filled. The email is REQUIRED until WhatsApp delivers (owner, 21 Sep
    2026, yuvoy-operator#91): every sign-in code goes to it, so the form will
    not submit without one. A test about something else still has to give one.
  */
  await page.getByLabel(/^Email/).fill(who.email ?? "priya@reef.example");
}
