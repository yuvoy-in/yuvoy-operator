import { test, expect } from "@playwright/test";
import { expectAccessible } from "./axe";
import {
  CONTENDED,
  DROPPING,
  REFUSED,
  choose,
  clip,
  openUploader,
  signIn,
  testInfoClip,
} from "./reels-kit";

/*
  The reels tests that cannot meet the owner's upload slot, split off
  `reels.spec.ts` (yuvoy-operator#178).

  An upload intent is a single slot per signed-in user (`uploadIntents` in
  `mocks/handlers.ts` is keyed on the user id), and the two files run at the
  same time on two workers. So this file never opens a slot as OWNER, the
  identity `reels.spec.ts` uploads as. The three uploads here are each the
  only test that signs in as DROPPING, REFUSED or CONTENDED. The OWNER tests
  here open no slot: an image is refused before anything is sent, and the
  Reels tab and its sheet only read and attach clips that are already up.

  Serial, and one project only, for the reason `reels.spec.ts` gives: the
  mock holds the slots in the Next server process both projects share.
*/

test.describe.configure({ mode: "serial" });

test.beforeEach(({}, testInfo) => {
  test.skip(
    testInfo.project.name !== "mobile",
    "one upload slot per operator — this flow is single-tenant by design, so it runs on the primary project only",
  );
});

test("a dropped connection is a pause, not a failure", async ({ page }) => {
  test.setTimeout(90_000);
  await signIn(page, DROPPING);
  await choose(page, clip(3));
  await page.getByRole("button", { name: "Upload it" }).click();

  /*
    The socket is destroyed mid-body, which is what losing signal on a jetty
    actually does — it does not send a 500, it stops talking. The client asks
    the server where it got to and carries on from there, keeping the bytes
    that landed before the drop.

    Asserted on the PROCESSING screen rather than mid-upload. Over localhost the
    upload finishes in under a second, so the line during the progress bar is a
    flash nobody — including Playwright — reliably sees. It survives into
    processing for the same reason it is worth showing at all: somebody who
    looked away for twenty minutes should learn their upload survived a dropout.
  */
  await expect(
    page.getByText(
      /The connection dropped 1 time on the way up and picked up again/,
    ),
  ).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/Nothing was lost/)).toBeVisible();

  // And it still finishes.
  await expect(page.getByText("Your clip is uploaded")).toBeVisible({
    timeout: 60_000,
  });
});

test("a clip the host refuses says so, and the next clip can go in", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await signIn(page, REFUSED);
  await choose(page, clip(1));
  await page.getByRole("button", { name: "Upload it" }).click();

  /*
    `422 media_refused` once the bytes are up (yuvoy-api#286): the host will
    never make a clip of this upload, and asking again gives the same answer.
    It said "We could not check the upload. Try again shortly."
  */
  await expect(
    page.getByText(
      "That clip was refused, so it will not be in your reels. Choose another.",
    ),
  ).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/Try again shortly/)).toHaveCount(0);
  // Nothing offers the refused clip again.
  await expect(page.getByText(/again and it carries on/)).toHaveCount(0);

  /*
    And another clip can go in (yuvoy-operator#157). The refused upload kept
    its slot, so the next clip met it as an upload "already going" and could
    not be sent at all until a reload.
  */
  await page
    .getByLabel("Choose a clip")
    .setInputFiles(testInfoClip(2, "harbour.mp4"));
  await expect(page.getByText("harbour.mp4")).toBeVisible();
  await expect(page.getByRole("button", { name: "Upload it" })).toBeVisible();
  await expect(page.getByText(/already holds/)).toHaveCount(0);
});

test("a slot somebody else is holding is refused, and says so truthfully", async ({
  page,
}) => {
  test.setTimeout(60_000);
  /*
    The only 409 `POST /media/upload-intents` can still produce. Since
    yuvoy-api#66 §3 your own upload in flight comes back rather than being
    refused, so a refusal means somebody else has the slot — a colleague, if
    the quota is per operator rather than per user, which is still open on that
    issue. The copy has to be true under either reading, and must not promise
    anything about a URL that can no longer be lost.
  */
  await signIn(page, CONTENDED);
  await openUploader(page);
  await page
    .getByLabel("Choose a clip")
    .setInputFiles(testInfoClip(1, "colleague.mp4"));

  await expect(
    page.getByRole("alert").filter({ hasText: "already going" }),
  ).toContainText("started somewhere else");
  await expect(page.getByRole("button", { name: "Upload it" })).toHaveCount(0);
  // The old copy told them it "cannot be picked up again". It can, by whoever
  // started it, so that sentence is gone rather than reworded.
  await expect(page.getByText(/cannot be picked up/)).toHaveCount(0);
});

test("a file that is not a video never leaves the phone", async ({ page }) => {
  await signIn(page);
  await openUploader(page);
  await page.getByLabel("Choose a clip").setInputFiles({
    name: "boat.heic",
    mimeType: "image/heic",
    buffer: Buffer.alloc(1024, 1),
  });

  // Scoped: Next renders its own `role="alert"` route announcer on every page.
  await expect(page.getByText("That is an image, not a video.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Upload it" })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Choose a different clip" }),
  ).toBeVisible();

  /*
    And no upload slot was spent finding that out. An intent is a single
    per-operator resource the API refuses to duplicate and gives no way to
    return, so asking for one before the free checks have run locks the
    operator out of the upload they actually meant to do.
  */
  await expect(
    page.getByText("Nothing was sent, and nothing was used up."),
  ).toBeVisible();
});

test("approved footage can be attached to a listing", async ({ page }) => {
  await signIn(page);

  /*
    From the reel's own sheet — #58 item 6 — which is where "put it on another
    listing" lives now. `.first()`: there is more than one approved clip in the
    fixtures, one of which exists precisely to stay attached to nothing, and
    attaching either proves the same thing.
  */
  await page.goto("/account?tab=reels");
  await page.getByRole("button", { name: "Not on a listing" }).first().click();

  const sheet = page.getByRole("dialog");
  await sheet.getByLabel("Listing").selectOption("exp_dive");
  await sheet.getByLabel("Gallery").check();
  await sheet.getByRole("button", { name: "Attach to listing" }).click();

  await expect(
    sheet.getByText("Attached. It is now available to that listing."),
  ).toBeVisible();
});

test("the Reels tab and its sheet have no accessibility violations", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/account?tab=reels");
  await page.waitForLoadState("networkidle");

  await expectAccessible(page, "the Reels tab");

  /*
    And the sheet, which is the new thing axe has to be happy about: a dialog
    that claims `aria-modal` over a page it does not remove from the tree.
  */
  /*
    A reel's own tile, by its name ("Reel, Live", "Photograph, In review").
    It was "the last button with text on the page", which stopped being a
    reel once the page's own section (Your page: Edit profile, Share) moved
    below the tabs. And this file is serial, so the miss retried the whole
    file and attached a second clip that services.spec counts on.
  */
  await page
    .getByRole("button", { name: /^(Reel|Photograph), / })
    .last()
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.waitForLoadState("networkidle");

  await expectAccessible(page, "the Reels tab, a reel's sheet open");
});

test("attaching to a listing nobody can book says so", async ({ page }) => {
  /*
    yuvoy-operator#31 §1 names this as the cost of attaching after approval:
    "after a generic approval the clip could then be attached to any listing at
    all, including a draft nobody can book."

    That half is the portal's and needs no migration. A warning rather than a
    refusal, because adding footage to a draft before sending it for review is
    the normal order — what an operator must not do is walk away believing
    travellers can see it.
  */
  await signIn(page);
  await page.goto("/account?tab=reels");
  await page.getByRole("button", { name: "Not on a listing" }).first().click();

  const row = page.getByRole("dialog");
  const select = row.getByLabel("Listing");

  /*
    Asserted as a PROPERTY, not a count. Other tests in this file and in
    services.spec create drafts against the same shared server, so the number
    of "· Draft" options grows during a full run — the claim here is that the
    status reads as words at all, never as a database key with its underscores
    stripped.
  */
  await expect(
    select.locator("option", { hasText: "· Draft" }).first(),
  ).toBeAttached();
  await expect(
    select.locator("option", { hasText: "live changes in review" }),
  ).toHaveCount(0);

  await select.selectOption({ label: "Island boat day · Draft" });
  await expect(row.getByText(/nobody will see this yet/)).toBeVisible();

  // A live listing draws no warning.
  await select.selectOption({ label: "Reef dive · Live" });
  await expect(row.getByText(/nobody will see this yet/)).toBeHidden();
});
