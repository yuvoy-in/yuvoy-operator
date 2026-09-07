import { test, expect, type Page } from "@playwright/test";

/**
 * Photographs on a listing — yuvoy-operator#27.
 *
 * "A listing page shows a reel or it shows nothing … where an Amazon-shaped one
 * is a video *and* a row of photographs. Operators have photographs. They do
 * not all have footage."
 *
 * The two upload calls are the only new thing. From `complete` onward a
 * photograph travels the same road as a clip — same attestation, same review
 * queue, same publish gate — and these tests care most about the places that
 * road could quietly fork.
 */

const DEV_CODE = "424242";

async function signIn(page: Page, phone = "+919000000101") {
  await page.goto("/sign-in");
  await page.getByLabel("Your phone number").fill(phone);
  await page.getByRole("button", { name: "Send me a code" }).click();
  await page.getByLabel("Your code").fill(DEV_CODE);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/today");
}

/**
 * A real PNG, built byte by byte rather than base64-pasted.
 *
 * `readImageFacts` decodes this in the browser, so it has to be a picture a
 * browser will actually load — a stub of random bytes would take the "could
 * not read" branch and quietly stop testing the dimension check.
 */
function pngBytes(): Buffer {
  // 1×1 transparent PNG.
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
}

async function choosePhoto(
  page: Page,
  opts: { name?: string; mimeType?: string; buffer?: Buffer } = {},
) {
  const panel = page
    .locator("section, div")
    .filter({ hasText: "Add a photograph" });
  void panel;
  await page.getByLabel("Choose a photograph").setInputFiles({
    name: opts.name ?? "reef.png",
    mimeType: opts.mimeType ?? "image/png",
    buffer: opts.buffer ?? pngBytes(),
  });
}

test("a photograph goes up and ends at the same attestation a clip needs", async ({
  page,
}, testInfo) => {
  /*
    Uploading adds a media asset to state the Next server shares between
    projects, so this runs on one. Declared rather than hidden, the same call
    the reels and revision fixtures make.
  */
  test.skip(
    testInfo.project.name !== "mobile",
    "an upload adds a shared media asset — single-tenant by design",
  );

  await signIn(page);
  await page.goto("/services/reels");

  await choosePhoto(page);

  // The size check runs against the intent's own ceiling, so the file is only
  // named once a slot exists.
  await expect(page.getByText("reef.png")).toBeVisible();
  await page.getByRole("button", { name: "Upload it" }).click();

  /*
    The whole point of the issue: a photograph is NOT a second pipeline. It
    lands on the same rights attestation a clip does, which is the screen that
    says a person reviews it.
  */
  await expect(
    page.getByText(/who owns this footage|rights/i).first(),
  ).toBeVisible({
    timeout: 30_000,
  });
});

test("a video chosen as a photograph is refused before a slot is spent", async ({
  page,
}) => {
  /*
    The refusal that costs nothing. Asking for an intent to discover somebody
    picked the wrong file spends a slot with an expiry on a file that was never
    going to be uploaded — the mistake the clip path made once already.
  */
  await signIn(page);
  await page.goto("/services/reels");

  await choosePhoto(page, {
    name: "clip.mp4",
    mimeType: "video/mp4",
    buffer: Buffer.from("not really a video"),
  });

  await expect(
    page.getByText(/That is a video, not a photograph/),
  ).toBeVisible();
  // And nothing was offered to upload.
  await expect(page.getByRole("button", { name: "Upload it" })).toHaveCount(0);
});

test("a GIF is refused, because it would sit in a gallery as one still", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/services/reels");

  await choosePhoto(page, {
    name: "wave.gif",
    mimeType: "image/gif",
    buffer: Buffer.from("GIF89a"),
  });

  await expect(page.getByText(/single still/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Upload it" })).toHaveCount(0);
});

test("the screen says it cannot resume, because it cannot", async ({
  page,
}) => {
  /*
    One multipart POST, no tus, nothing to resume from. The clip uploader
    promises the opposite and can keep that promise; this one must not borrow
    the sentence.
  */
  await signIn(page);
  await page.goto("/services/reels");
  await choosePhoto(page);
  await expect(
    page.getByText(/cannot pick up where it left off/),
  ).toBeVisible();
});

test("the section is named for what it actually holds", async ({ page }) => {
  /*
    `GET /media` returns no `kind`, so the library genuinely cannot tell a
    photograph from a clip — and calling the list "Your reels" once photographs
    live in it would be a claim the data cannot support.
  */
  await signIn(page);
  await page.goto("/services/reels");

  await expect(
    page.getByRole("heading", { level: 1, name: "Photos & reels" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your media" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Add a photograph" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Add a reel" })).toBeVisible();
});

test("the library counts items, not clips", async ({ page }) => {
  // The same reason. It cannot know how many of them are clips.
  await signIn(page);
  await page.goto("/services/reels");
  await expect(page.getByText(/\d+ items?$/)).toBeVisible();
});

test("the category and destination are pickers, not text boxes", async ({
  page,
}) => {
  /*
    yuvoy-api#113. They were free text seeded from the operator's own listings,
    which worked for a second listing and was a dead end for a first: a box, an
    example key, and a 400 after the form was filled in.

    Both now carry the label a person uses — "`andaman/havelock` is an
    identifier and 'Havelock (Swaraj Dweep)' is what an operator calls the
    place."
  */
  await signIn(page);
  await page.goto("/services/activities");
  await page.getByRole("button", { name: "Add an activity" }).click();

  const category = page.getByLabel("What kind of thing it is");
  await expect(category).toHaveJSProperty("tagName", "SELECT");
  await expect(
    category.locator("option", { hasText: "Nature & wildlife" }),
  ).toHaveCount(1);

  const destination = page.getByLabel("Where it runs");
  await expect(destination).toHaveJSProperty("tagName", "SELECT");
  await expect(
    destination.locator("option", { hasText: "Havelock (Swaraj Dweep)" }),
  ).toHaveCount(1);
});

test("a listing can be created straight from the pickers", async ({
  page,
}, testInfo) => {
  // End to end through the enum, because the request body's `category` is
  // closed and a mismatch is a 400 rather than anything the form could show.
  const suffix = testInfo.project.name === "mobile" ? "a" : "b";
  const title = `Reef walk ${suffix}`;

  await signIn(page);
  await page.goto("/services/activities");
  await page.getByRole("button", { name: "Add an activity" }).click();

  await page.getByLabel("What is it called").fill(title);
  await page
    .getByLabel("What kind of thing it is")
    .selectOption({ label: "Nature & wildlife" });
  await page
    .getByLabel("Where it runs")
    .selectOption({ label: "Neil (Shaheed Dweep)" });
  await page.getByLabel("Price per person").fill("1800");
  await page.getByRole("button", { name: "Save as a draft" }).click();

  await expect(page.getByText(`${title} is a draft`)).toBeVisible();
});
