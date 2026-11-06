/**
 * What the two reels specs share: the upload identities, sign-in and the
 * uploader (yuvoy-operator#178).
 */
import { expect, type Page } from "@playwright/test";

export const DEV_CODE = "424242";
export const OWNER = "+919000000101";
/** Their uploads drop once, mid-chunk. */
export const DROPPING = "+919000000107";
/** A colleague at their business already holds the one upload slot. */
export const CONTENDED = "+919000000110";
/** The video host refuses their clips once they are up. */
export const REFUSED = "+919000000120";

export async function signIn(page: Page, phone = OWNER) {
  await page.goto("/sign-in");
  await page.getByLabel("Your phone number").fill(phone);
  await page.getByRole("button", { name: "Send me a code" }).click();
  await page.getByLabel("Your code").fill(DEV_CODE);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/today");
}

/**
 * A clip the browser cannot decode, which is deliberate.
 *
 * There is no ffmpeg here to make a real one, and a fake is the honest thing
 * to test with anyway: it exercises the path a phone's HEVC takes in a browser
 * that will not read it — where preflight must WARN and let the upload go
 * rather than refuse footage for a reason that has nothing to do with the
 * footage. The length and shape rules are unit-tested against known metadata
 * in `src/lib/media/preflight.test.ts`.
 */
export function clip(megabytes: number) {
  return {
    name: "reef.mp4",
    mimeType: "video/mp4",
    buffer: Buffer.alloc(megabytes * 1024 * 1024, 7),
  };
}

/** The same, under a name of its own, for tests that need two clips. */
export function testInfoClip(megabytes: number, name: string) {
  return { ...clip(megabytes), name };
}

/**
 * The uploader, where it lives now: behind the + on the business profile.
 *
 * `/services/reels` is a redirect since #58 item 8, and the two uploaders moved
 * into a sheet on `/account` rather than being rebuilt — one clip in flight at
 * a time, the tus resume and the local preflight are all the shipped ones.
 */
export async function openUploader(page: Page) {
  await page.goto("/account");
  // Named for what is behind it, and reads "Add" (yuvoy-operator#109).
  await page.getByRole("button", { name: "Add a listing or a reel" }).click();
  await page.getByRole("button", { name: "Add a reel" }).click();
  await expect(page.getByRole("dialog", { name: "Add a reel" })).toBeVisible();
}

export async function choose(page: Page, file: ReturnType<typeof clip>) {
  await openUploader(page);
  await page.getByLabel("Choose a clip").setInputFiles(file);
}
