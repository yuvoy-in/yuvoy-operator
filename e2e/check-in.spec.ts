import { test, expect, type Page } from "@playwright/test";

/**
 * Check-in by code (yuvoy-operator#175): the code in a traveller's link
 * leaves the address bar, and stays out of it when the screen re-reads.
 *
 * Daniel (`bkg_2` on `slot_dawn`) arrived at 06:31 and is a fixture both
 * projects read, so his link answers "Already checked in" and nobody is
 * moved from to come to aboard.
 */

const DEV_CODE = "424242";
const OWNER = "+919000000101";
/** `GET /me`'s `id` for the owner, which the kept writes are filed under. */
const OWNER_ID = "usr_havelock_owner";
const LINK = "/check-in#YV-7T1N4X8B.R4TW9HNE";
/** Where boarding mode keeps a check-in taken with no signal. */
const KEPT = "yuvoy-operator:offline-writes:v1";

async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Your phone number").fill(OWNER);
  await page.getByRole("button", { name: "Send me a code" }).click();
  await page.getByLabel("Your code").fill(DEV_CODE);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/today");
}

test("the code stays out of the address bar when the screen re-reads", async ({
  page,
}) => {
  await signIn(page);

  /*
    A check-in kept on this phone with no signal is what re-reads /check-in:
    it is sent as the page opens, then the screen re-reads with
    `router.refresh()`. Before the fix, the code was taken out with the
    page's own history state, which carries Next's mark, so Next never
    learned the address had changed and that re-read wrote the code back.
    The kept one is Daniel again, already aboard, so sending it changes
    nothing another test reads.
  */
  await page.evaluate(
    ([key, userId]) => {
      window.localStorage.setItem(
        key,
        JSON.stringify([
          {
            key: "arrived:bkg_2",
            kind: "arrived",
            userId,
            slotId: "slot_dawn",
            bookingId: "bkg_2",
            at: Date.now() - 60_000,
          },
        ]),
      );
    },
    [KEPT, OWNER_ID] as const,
  );

  const reread = page.waitForResponse((r) => {
    const sent = r.request();
    const headers = sent.headers();
    return (
      sent.method() === "GET" &&
      r.url().includes("/check-in") &&
      headers["rsc"] === "1" &&
      !headers["next-router-prefetch"] &&
      !headers["next-router-segment-prefetch"]
    );
  });

  await page.goto(LINK);
  await expect(
    page.getByText(/^Already checked in at \d\d:\d\d$/),
  ).toBeVisible();
  await expect(page).not.toHaveURL(/#/);

  // The kept check-in went, and the screen re-read after it.
  await expect
    .poll(() => page.evaluate((key) => window.localStorage.getItem(key), KEPT))
    .toBeNull();
  await reread;
  // Two frames, so the re-read's render and its history write are in.
  await page.evaluate(
    () =>
      new Promise<void>((done) =>
        requestAnimationFrame(() => requestAnimationFrame(() => done())),
      ),
  );

  expect(new URL(page.url()).hash).toBe("");
  expect(page.url()).not.toContain("R4TW9HNE");
  await expect(
    page.getByText(/^Already checked in at \d\d:\d\d$/),
  ).toBeVisible();
});
