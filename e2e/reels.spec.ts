import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * O8 — the operator supplies the video the whole traveller feed is made of.
 *
 * These run against a **real tus server** on another origin (see
 * `mocks/tus-server.ts`), with real bytes, real chunking and a real dropped
 * socket. That matters more here than anywhere else in this suite: resumability
 * is not polish, it is the reason the protocol was chosen — "on a 0.5–3 Mbps
 * island uplink a non-resumable uploader is not slow, it is unusable" — and a
 * resumable uploader that has never been interrupted is one whose resume path
 * has never run.
 *
 * **What these do NOT prove** is stated rather than implied: they exercise this
 * client against a spec-correct tus endpoint, not against Cloudflare Stream.
 * Whether Cloudflare returns the offset we expect after a real forty-second
 * dropout is unverifiable until an account exists (`yuvoy-api#64`).
 */

/*
  Serial, and one project only.

  An upload intent is a single per-operator slot — `POST /media/upload-intents`
  answers 409 while one is open, and there is no endpoint to hand one back. The
  mock holds that state in the Next server process both Playwright projects
  share, so two projects uploading as the same operator are two tests competing
  for one slot. That is the domain, not flakiness, and it is the same shape the
  bank change has.

  The desktop skips are declared rather than hidden.
*/
test.describe.configure({ mode: "serial" });

test.beforeEach(({}, testInfo) => {
  test.skip(
    testInfo.project.name !== "mobile",
    "one upload slot per operator — this flow is single-tenant by design, so it runs on the primary project only",
  );
});

const DEV_CODE = "424242";
const OWNER = "+919000000101";
/** Their uploads drop once, mid-chunk. */
const DROPPING = "+919000000107";

async function signIn(page: Page, phone = OWNER) {
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
function clip(megabytes: number) {
  return {
    name: "reef.mp4",
    mimeType: "video/mp4",
    buffer: Buffer.alloc(megabytes * 1024 * 1024, 7),
  };
}

async function choose(page: Page, file: ReturnType<typeof clip>) {
  await page.goto("/reels");
  await page.getByLabel("Choose a clip").setInputFiles(file);
}

test("a clip goes up, is processed, and ends at an attestation", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await signIn(page);
  await choose(page, clip(3));

  // Checked locally first. Nothing has left the phone yet.
  await expect(page.getByText("reef.mp4")).toBeVisible();
  await expect(page.getByText("3.0 MB")).toBeVisible();
  await expect(
    page.getByText(/could not read the video to check its length or shape/),
  ).toBeVisible();

  /*
    The awkward truth, before they commit twenty minutes to it. The upload URL
    may not be persisted and a second intent is refused while one is open, so a
    closed tab is an upload nobody can pick up.
  */
  await expect(
    page.getByText(/Keep this tab open until it finishes/),
  ).toBeVisible();

  await page.getByRole("button", { name: "Upload it" }).click();

  // A real number, not a spinner.
  await expect(page.getByRole("progressbar")).toBeVisible();
  await expect(
    page.getByText("Uploaded. We are processing it now."),
  ).toBeVisible({
    timeout: 60_000,
  });

  // 202 `ready:false` is the normal first answer, so the client polls.
  await expect(page.getByText("Your clip is uploaded")).toBeVisible({
    timeout: 60_000,
  });
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

test("a file that is not a video never leaves the phone", async ({ page }) => {
  await signIn(page);
  await page.goto("/reels");
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

test("consent of the people filmed has no default, and the form refuses to guess", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await signIn(page);
  await choose(page, clip(3));
  await page.getByRole("button", { name: "Upload it" }).click();
  await expect(page.getByText("Your clip is uploaded")).toBeVisible({
    timeout: 60_000,
  });

  /*
    "`peopleConsentConfirmed` must be an explicit true or false, never
    defaulted and never omitted: consent of the people filmed is the one thing
    a moderator cannot check by watching."

    Two radios, neither preselected. A checkbox would default to unticked —
    an answer nobody gave, and the one that gets a clip rejected.
  */
  const yes = page.getByRole("radio", { name: /they knew and agreed/ });
  const no = page.getByRole("radio", { name: /nobody recognisable/ });
  await expect(yes).not.toBeChecked();
  await expect(no).not.toBeChecked();
  await expect(
    page.getByText(/There is no default here on purpose/),
  ).toBeVisible();
});

test("attesting says plainly that it is not publishing", async ({ page }) => {
  test.setTimeout(90_000);
  await signIn(page);
  await choose(page, clip(3));
  await page.getByRole("button", { name: "Upload it" }).click();
  await expect(page.getByText("Your clip is uploaded")).toBeVisible({
    timeout: 60_000,
  });

  // The statement is rendered verbatim — these are the bytes that get hashed.
  await expect(
    page.getByText("I confirm this footage is ours to give Yuvoy."),
  ).toBeVisible();

  await page.getByRole("radio", { name: "We filmed it" }).check();
  await page.getByRole("radio", { name: /they knew and agreed/ }).check();
  await page
    .getByRole("button", { name: "I confirm this, and submit for review" })
    .click();

  /*
    "Attesting does not publish. A reviewer checks it afterwards … Say so in
    the UI — operators reasonably assume attesting is the last step." An
    operator who thinks this published their clip goes looking for it in the
    feed tomorrow and finds nothing.
  */
  await expect(page.getByText("Recorded, and queued for review")).toBeVisible();
  await expect(page.getByText(/It is not published/)).toBeVisible();
  await expect(
    page.getByText(/A person at Yuvoy checks this before the clip can appear/),
  ).toBeVisible();
});

test("the screen says what it cannot show, rather than looking empty", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/reels");

  /*
    There is no `GET /media`, so nothing can list what has been uploaded,
    approved or published — and publish and withdraw are blocked on the same
    absence. An operator who sends three clips and finds no list would
    reasonably conclude they were lost.
  */
  await expect(
    page.getByText(/cannot yet show you the clips you have already sent/),
  ).toBeVisible();
  await expect(
    page.getByText(/Nothing you upload is lost by this/),
  ).toBeVisible();
});

test("/reels has no accessibility violations", async ({ page }) => {
  await signIn(page);
  await page.goto("/reels");
  await page.waitForLoadState("networkidle");

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();

  expect(results.violations).toEqual([]);
});
