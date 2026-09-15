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

/**
 * Pick the listing, then the file — yuvoy-operator#35, #31 §2.
 *
 * The order is the API's: `experienceId` is REQUIRED on
 * `POST /media/photo-intents`, so the file input stays disabled until a
 * listing is chosen. That is not a nicety — without it the first thing a
 * photograph does after eighty seconds of upload is fail, and the moderator
 * shown the picture has no listing to judge `NOT_THIS_EXPERIENCE` against.
 */
/**
 * The uploaders, where #58 item 8 put them: behind the + on the profile.
 * `/services/reels` is a redirect now.
 */
async function openUploader(page: Page) {
  await page.goto("/account");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("button", { name: "Add a reel" }).click();
  await expect(page.getByRole("dialog", { name: "Add a reel" })).toBeVisible();
}

async function choosePhoto(
  page: Page,
  opts: { name?: string; mimeType?: string; buffer?: Buffer } = {},
) {
  await page
    .getByLabel("Which listing this photograph is for")
    .selectOption({ index: 1 });
  await page.getByLabel("Choose a photograph").setInputFiles({
    name: opts.name ?? "reef.png",
    mimeType: opts.mimeType ?? "image/png",
    buffer: opts.buffer ?? pngBytes(),
  });
}

test("a photograph goes up and ends at the same attestation a clip needs", async ({
  page,
}, testInfo) => {
  // Two navigations and a real upload. The default 30s is the upload's alone.
  test.setTimeout(90_000);
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
  await openUploader(page);

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
    page.getByText(/tell us it is yours to give us/i).first(),
  ).toBeVisible({
    timeout: 60_000,
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
  await openUploader(page);

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
  await openUploader(page);

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
  await openUploader(page);
  await choosePhoto(page);
  await expect(
    page.getByText(/cannot pick up where it left off/),
  ).toBeVisible();
});

test("the sheet offers both, and says which is which", async ({ page }) => {
  // One sheet holds both, so neither is called the other.
  await signIn(page);
  await openUploader(page);

  const sheet = page.getByRole("dialog", { name: "Add a reel" });
  await expect(sheet.getByRole("heading", { name: "A clip" })).toBeVisible();
  await expect(
    sheet.getByRole("heading", { name: "A photograph" }),
  ).toBeVisible();
});

test("every tile says which of the two it is", async ({ page }) => {
  /*
    yuvoy-api#119. The grid could not tell one from the other before `kind` was
    on the wire, and the badge alone still cannot — "In review" is three tiles,
    one of them a photograph. The tile's own name carries both.
  */
  await signIn(page);
  await page.goto("/account?tab=reels");

  await expect(
    page.getByRole("button", { name: /^Reel,/ }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /^Photograph,/ }).first(),
  ).toBeVisible();
});

test("a clip still processing is not labelled a photograph", async ({
  page,
}) => {
  /*
    The defect the whole field exists to prevent, and the reason this portal
    labelled nothing until `kind` was on the wire.

    The one inference available was "no `durationSeconds` means a photograph" —
    and a clip that is still `uploaded` or `processing` has no duration either.
    So the very first thing an operator saw after posting a reel would have
    been that reel labelled a photograph, in the list they open to check it
    arrived.

    `med_processing_fixture` is exactly that shape: a video, processing, with
    no duration and no poster. Replace `kind` with the inference and this
    fails.
  */
  await signIn(page);
  await page.goto("/account?tab=reels");

  const processing = page.getByRole("button", { name: "Reel, Processing" });
  await expect(processing).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Photograph, Processing" }),
  ).toHaveCount(0);
});

test("a row with no preview says so, instead of being a grey rectangle", async ({
  page,
}) => {
  /*
    `posterUrl` is "absent on most clips today" — a poster is only stored once
    the provider has produced one, and an unpublished clip has no public URL:
    270 of 342 clips had none when this was written (yuvoy-api#121, and not
    ours to fix).

    What IS ours is that such a row renders as something an operator can read.
    "No preview yet" with a reason beats an unexplained empty box to somebody
    who has just spent twenty minutes of island uplink on the upload.
  */
  await signIn(page);
  await page.goto("/account?tab=reels");

  /*
    And it says WHICH kind of nothing — yuvoy-operator#29. A clip still
    arriving has no still at any price, and saying so is the difference between
    "nothing is wrong" and an unexplained empty box to somebody who has just
    spent twenty minutes of island uplink on the upload.
  */
  const processing = page.getByRole("button", { name: "Reel, Processing" });
  await expect(processing.getByText(/Still arriving/)).toBeVisible();
});

test("the four kinds of missing picture do not read the same", async ({
  page,
}) => {
  /*
    The actual ask of yuvoy-operator#29: "a single grey box flattens them."
    270 of 342 assets have no stored poster, so this is the common row, and an
    operator scanning the list needs to tell a clip on its way from one a
    reviewer refused.
  */
  await signIn(page);
  await page.goto("/account?tab=reels");

  /*
    `.first()` on every tile, deliberately. Other tests in this file upload into
    the same shared Next server, so a badge's tile count grows during a full run
    — and the assertion is about what a tile of that state SAYS, not how many
    exist. Without it this passes alone and fails on the second project.
  */
  const tileSaying = (name: string) =>
    page.getByRole("button", { name }).first();

  // In flight — nothing is wrong, and that is the whole message.
  await expect(
    tileSaying("Reel, Processing").getByText(/Still arriving/),
  ).toBeVisible();

  // With us — the most reassuring thing the screen can say.
  await expect(
    tileSaying("Reel, In review").getByText(/With us/),
  ).toBeVisible();

  // Waiting on the operator, and `not_attached` belongs HERE rather than with
  // the two above: approved and on nothing is their own next act.
  await expect(
    tileSaying("Reel, Not on a listing").getByText(/below is yours/),
  ).toBeVisible();
});

test("a photograph shows its picture before it is published", async ({
  page,
}) => {
  /*
    The poster used to be gated on `state === "published"`, which was right
    when clips were the only thing here. For a photograph the picture IS the
    item, and the API builds its URL at read time in every state — so an
    operator waiting on review has to be able to see which photograph they are
    waiting on.

    `med_photo_fixture` is an image in `in_moderation`: published gate on, and
    this is an empty frame.
  */
  await signIn(page);
  await page.goto("/account?tab=reels");

  /*
    Scoped by kind AND badge together. Neither half identifies it alone: "In
    review" is three tiles, and "is a photograph" matches every photograph,
    including the one the upload test in this file adds to the same shared Next
    server. `.first()` over the pair, because that upload can add a second
    photograph in review during a full run and the claim is about what such a
    tile shows.
  */
  const photo = page
    .getByRole("button", { name: "Photograph, In review" })
    .first();

  await expect(photo.locator("img")).toBeVisible();
  await expect(photo.getByText(/No preview yet/)).toHaveCount(0);
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
  await page.goto("/account/listings/new");

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
  await page.goto("/account/listings/new");

  await page.getByLabel("What is it called").fill(title);
  await page
    .getByLabel("What kind of thing it is")
    .selectOption({ label: "Nature & wildlife" });
  await page
    .getByLabel("Where it runs")
    .selectOption({ label: "Neil (Shaheed Dweep)" });
  await page.getByLabel("Price", { exact: true }).fill("1800");
  // A price now has to say what it means — yuvoy-operator#30 §1.
  await page.getByRole("radio", { name: /Per person/ }).check();
  await page.getByRole("button", { name: "Save as a draft" }).click();

  await expect(page.getByText(`${title} is a draft`)).toBeVisible();
});

test("a price must say whether it is per person or for the group", async ({
  page,
}, testInfo) => {
  /*
    yuvoy-operator#30 §1, and the reason it is a refusal rather than a default.

    `experiences.pricing_unit` always existed and checkout always divided
    correctly for a group price; what was missing is anybody stating which
    applies. The API stopped defaulting it so an unanswered listing is recorded
    as UNSTATED — and a form that quietly sent `per_person` would put the
    misstatement straight back, with our authority behind it on the traveller's
    card: a ₹12,000 charter for six reading "₹12,000 per person".

    So an unanswered price is refused here rather than guessed.
  */
  const suffix = testInfo.project.name === "mobile" ? "a" : "b";

  await signIn(page);
  await page.goto("/account/listings/new");

  await page.getByLabel("What is it called").fill(`Unstated basis ${suffix}`);
  await page
    .getByLabel("What kind of thing it is")
    .selectOption({ label: "Nature & wildlife" });
  await page
    .getByLabel("Where it runs")
    .selectOption({ label: "Neil (Shaheed Dweep)" });
  await page.getByLabel("Price", { exact: true }).fill("12000");

  // Neither option preselected — that is the whole point of the control.
  await expect(
    page.getByRole("radio", { name: /Per person/ }),
  ).not.toBeChecked();
  await expect(
    page.getByRole("radio", { name: /For the group/ }),
  ).not.toBeChecked();

  await page.getByRole("button", { name: "Save as a draft" }).click();

  await expect(
    page.getByText(/per person or for the whole group/i),
  ).toBeVisible();
  // And nothing was created behind the refusal.
  await expect(
    page.getByText(`Unstated basis ${suffix} is a draft`),
  ).toBeHidden();
});

test("a listing with no price is not asked for a basis", async ({
  page,
}, testInfo) => {
  /*
    `pricingUnit` describes a price. Asking "per person or for the group?"
    about a price that does not exist yet is a forced choice about nothing —
    and the price is deliberately optional, because a listing without one
    "saves but cannot be approved" and an operator should be able to write the
    rest first.
  */
  const suffix = testInfo.project.name === "mobile" ? "a" : "b";
  const title = `No price yet ${suffix}`;

  await signIn(page);
  await page.goto("/account/listings/new");

  await page.getByLabel("What is it called").fill(title);
  await page
    .getByLabel("What kind of thing it is")
    .selectOption({ label: "Nature & wildlife" });
  await page
    .getByLabel("Where it runs")
    .selectOption({ label: "Neil (Shaheed Dweep)" });
  await page.getByRole("button", { name: "Save as a draft" }).click();

  await expect(page.getByText(`${title} is a draft`)).toBeVisible();
});
