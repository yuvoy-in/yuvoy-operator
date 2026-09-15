import { writeFileSync } from "node:fs";
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

  An upload intent is a single per-operator slot, and since yuvoy-api#66 §3
  asking again RESUMES it rather than refusing — which makes the sharing worse,
  not better: two projects uploading as the same operator would now be handed
  the same in-flight upload and PATCH two different files into it. The mock
  holds that state in the Next server process both projects share. That is the
  domain, not flakiness, and it is the same shape the bank change has.

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
/** A colleague at their business already holds the one upload slot. */
const CONTENDED = "+919000000110";

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

/** The same, under a name of its own, for tests that need two clips. */
function testInfoClip(megabytes: number, name: string) {
  return { ...clip(megabytes), name };
}

/**
 * The uploader, where it lives now: behind the + on the business profile.
 *
 * `/services/reels` is a redirect since #58 item 8, and the two uploaders moved
 * into a sheet on `/account` rather than being rebuilt — one clip in flight at
 * a time, the tus resume and the local preflight are all the shipped ones.
 */
async function openUploader(page: Page) {
  await page.goto("/account");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("button", { name: "Add a reel" }).click();
  await expect(page.getByRole("dialog", { name: "Add a reel" })).toBeVisible();
}

async function choose(page: Page, file: ReturnType<typeof clip>) {
  await openUploader(page);
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
    The line that used to be a warning and is now a reassurance. Since
    yuvoy-api#66 §3 a closed tab is recoverable, so the copy says how rather
    than telling somebody not to close it.
  */
  await expect(
    page.getByText(/come back here and choose the same clip/),
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

test("a slot holding one clip's bytes refuses another, and resumes the first", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await signIn(page);

  /*
    Real files on disk rather than buffers: the slot recognises "the same
    clip" by name, size AND modification time, and a buffer handed to
    setInputFiles is a new File with a new time on every pick.
  */
  const reef = testInfo.outputPath("reef.mp4");
  writeFileSync(reef, Buffer.alloc(3 * 1024 * 1024, 7));
  const harbour = testInfo.outputPath("harbour.mp4");
  writeFileSync(harbour, Buffer.alloc(2 * 1024 * 1024, 9));

  /*
    The first 1 MB chunk lands; every PATCH after it dies on the wire. That is
    an upload a jetty connection abandoned with bytes already on the server —
    the state in which the slot used to be handed the next clip picked.
  */
  let patches = 0;
  await page.route(/\/uploads\//, (route) => {
    if (route.request().method() === "PATCH" && ++patches > 1) {
      return route.abort("connectionreset");
    }
    return route.continue();
  });

  await openUploader(page);
  await page.getByLabel("Choose a clip").setInputFiles(reef);
  await page.getByRole("button", { name: "Upload it" }).click();
  await expect(page.getByText(/It stopped at 1\.0 MB of 3\.0 MB/)).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByText(/Choose reef\.mp4 again/)).toBeVisible();

  /*
    A different clip. Before the fix this resumed at reef's offset: 1 MB of
    reef with harbour's tail, confirmed, attested, into review as one corrupt
    reel. Now it is refused, told why, and told the way forward.
  */
  await page.getByLabel("Choose a clip").setInputFiles(harbour);
  // Scoped: Next's route announcer is role="alert" too.
  await expect(
    page.getByRole("alert").filter({ hasText: "already holds" }),
  ).toContainText("already holds 1.0 MB of reef.mp4");
  await expect(page.getByText(/One clip at a time/)).toBeVisible();
  await page.getByRole("button", { name: "Pick a clip again" }).click();

  // The same clip: carries on from the server's offset, and finishes.
  await page.unroute(/\/uploads\//);
  await page.getByLabel("Choose a clip").setInputFiles(reef);
  await expect(
    page.getByText(/Picks up from 1\.0 MB already uploaded/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Upload it" }).click();
  await expect(page.getByText("Your clip is uploaded")).toBeVisible({
    timeout: 60_000,
  });
});

/**
 * The three cases yuvoy-api#66 §3 was raised for.
 *
 * `POST /media/upload-intents` used to answer 409 while an upload was open, so
 * a reload stranded it: the URL may not be persisted client-side and was never
 * stored server-side. PR #85 made the endpoint return the upload in flight with
 * a fresh URL, which is what makes O8's own acceptance criterion — "close the
 * app, come back, and have it finish" — reachable at all.
 *
 * It also made a corrupt reel reachable, which is the second test here. Before
 * the change a reloaded page could not obtain a URL at all; now it can, and the
 * page it reloaded into has no memory of whose bytes the slot holds. Resuming
 * blind would PATCH the new clip at the old clip's offset — one file's head
 * with another's tail, confirmed, attested and sent to a human reviewer.
 */
test("a reload does not strand the upload — the same clip carries on and finishes", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await signIn(page);

  const reef = testInfo.outputPath("reload-reef.mp4");
  writeFileSync(reef, Buffer.alloc(3 * 1024 * 1024, 7));

  // The first chunk lands; the rest die on the wire, as a jetty link does.
  let patches = 0;
  await page.route(/\/uploads\//, (route) => {
    if (route.request().method() === "PATCH" && ++patches > 1) {
      return route.abort("connectionreset");
    }
    return route.continue();
  });

  await openUploader(page);
  await page.getByLabel("Choose a clip").setInputFiles(reef);
  await page.getByRole("button", { name: "Upload it" }).click();
  /*
    How many chunks land before the link dies is the wire's business, not this
    test's — pinning an exact offset here would assert the abort's timing
    rather than the recovery. What matters is that it stopped part-way.
  */
  await expect(
    page.getByText(/It stopped at [\d.]+ MB of 3\.0 MB/),
  ).toBeVisible({ timeout: 60_000 });

  /*
    The tab goes. Everything the page held — the intent, the URL, which file
    the slot was bound to — goes with it. This is the reload the old contract
    could not survive.
  */
  await page.unroute(/\/uploads\//);
  await openUploader(page);

  await page.getByLabel("Choose a clip").setInputFiles(reef);
  await expect(
    page.getByText(/Picks up from [\d.]+ MB already uploaded/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Upload it" }).click();
  await expect(page.getByText("Your clip is uploaded")).toBeVisible({
    timeout: 60_000,
  });
});

test("after a reload, a different clip is refused rather than resumed into", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await signIn(page);

  const reef = testInfo.outputPath("blind-reef.mp4");
  writeFileSync(reef, Buffer.alloc(3 * 1024 * 1024, 7));
  const harbour = testInfo.outputPath("blind-harbour.mp4");
  writeFileSync(harbour, Buffer.alloc(2 * 1024 * 1024, 9));

  let patches = 0;
  await page.route(/\/uploads\//, (route) => {
    if (route.request().method() === "PATCH" && ++patches > 1) {
      return route.abort("connectionreset");
    }
    return route.continue();
  });

  await openUploader(page);
  await page.getByLabel("Choose a clip").setInputFiles(reef);
  await page.getByRole("button", { name: "Upload it" }).click();
  await expect(
    page.getByText(/It stopped at [\d.]+ MB of 3\.0 MB/),
  ).toBeVisible({ timeout: 60_000 });

  await page.unroute(/\/uploads\//);
  await openUploader(page);

  /*
    A different clip, into a slot holding 1 MB of the first one — and a page
    with no in-memory record of that, because it has just been created. The
    refusal has to come from what the server says the slot holds, not from what
    this page remembers about it.
  */
  await page.getByLabel("Choose a clip").setInputFiles(harbour);
  /*
    And the refusal names what it can and does not invent what it cannot. This
    browser's record is keyed on the intent id and the reload kept it, but the
    clip it names is not the one just picked — so the operator is told the slot
    is busy and which clip would resume it, not "choose a clip nothing knows".
  */
  await expect(
    page.getByRole("alert").filter({ hasText: "already holds" }),
  ).toContainText("blind-reef.mp4");
  await expect(page.getByText(/One clip at a time/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Upload it" })).toHaveCount(0);
});

test("with nothing remembered, the server's own declared length decides", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  /*
    The operator who cleared their site data, or came back on the laptop. There
    is no local record of the upload at all, so the only thing that can tell
    "this is my clip" from "this is somebody else's" is `Upload-Length` — the
    provider's own statement of how big the file it is holding is.

    ❌ NOT proven here: that Cloudflare Stream exposes `Upload-Length` across
    origins. The mock does (`mocks/tus-server.ts` lists it in
    `Access-Control-Expose-Headers`), and tus 1.0.0 requires the header on a
    HEAD once the length is known — but the CORS exposure is the provider's
    choice and is unverifiable until an account exists. If it is absent this
    degrades to a refusal, never to a wrong resume: `decideSlot` reads an
    unreadable length as "we do not know".
  */
  await signIn(page);

  const reef = testInfo.outputPath("amnesia-reef.mp4");
  writeFileSync(reef, Buffer.alloc(3 * 1024 * 1024, 7));
  const harbour = testInfo.outputPath("amnesia-harbour.mp4");
  writeFileSync(harbour, Buffer.alloc(2 * 1024 * 1024, 9));

  let patches = 0;
  await page.route(/\/uploads\//, (route) => {
    if (route.request().method() === "PATCH" && ++patches > 1) {
      return route.abort("connectionreset");
    }
    return route.continue();
  });

  await openUploader(page);
  await page.getByLabel("Choose a clip").setInputFiles(reef);
  await page.getByRole("button", { name: "Upload it" }).click();
  await expect(
    page.getByText(/It stopped at [\d.]+ MB of 3\.0 MB/),
  ).toBeVisible({ timeout: 60_000 });

  // Everything this browser knew about the slot, gone.
  await page.unroute(/\/uploads\//);
  await page.evaluate(() => window.localStorage.clear());
  await openUploader(page);

  // A different clip: refused, and it cannot name what is in the way.
  await page.getByLabel("Choose a clip").setInputFiles(harbour);
  await expect(
    page.getByRole("alert").filter({ hasText: "not this clip" }),
  ).toBeVisible();
  await expect(
    page.getByText(/this browser did not start that one/),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Upload it" })).toHaveCount(0);

  // The right clip: recognised by its size alone, and it finishes.
  await page.getByRole("button", { name: "Pick a clip again" }).click();
  await page.getByLabel("Choose a clip").setInputFiles(reef);
  await expect(
    page.getByText(/Picks up from [\d.]+ MB already uploaded/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Upload it" }).click();
  await expect(page.getByText("Your clip is uploaded")).toBeVisible({
    timeout: 60_000,
  });
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

test("a licensed clip needs its licence, even when the form's own check is bypassed", async ({
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
    The form marks the licence field `required`; a Server Action is a public
    POST endpoint that never sees the form. `rightsProblem()` existed for
    exactly this and was never called — so a "licensed" attestation with no
    licence reference went through. The browser's check is stripped here to
    reach the action's.
  */
  await page.getByRole("radio", { name: "We paid for it" }).check();
  await page
    .locator("#licenceRef")
    .evaluate((el) => el.removeAttribute("required"));
  await page.getByRole("radio", { name: /they knew and agreed/ }).check();
  await page
    .getByRole("button", { name: "I confirm this, and submit for review" })
    .click();

  await expect(
    page.getByRole("alert").filter({ hasText: "Which licence" }),
  ).toBeVisible();
  await expect(page.getByText("Recorded, and queued for review")).toHaveCount(
    0,
  );
});

test("the wrong clip can be taken down, while the page is still open", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await signIn(page);
  await choose(page, clip(3));
  await page.getByRole("button", { name: "Upload it" }).click();
  await expect(page.getByText("Your clip is uploaded")).toBeVisible({
    timeout: 60_000,
  });

  await page.getByRole("radio", { name: "We filmed it" }).check();
  await page.getByRole("radio", { name: /they knew and agreed/ }).check();
  await page
    .getByRole("button", { name: "I confirm this, and submit for review" })
    .click();
  await expect(page.getByText("Recorded, and queued for review")).toBeVisible();

  /*
    The case that actually happens: the wrong file, noticed immediately. There
    is also a durable reel library now, so the receipt makes clear that leaving
    this screen no longer strands the takedown action.
  */
  await expect(page.getByText(/also appear in your reel list/)).toBeVisible();
  await page.getByRole("button", { name: "Wrong clip? Take it down" }).click();

  /*
    Scoped to the receipt's own form.

    Every clip in the library below now offers a takedown of its own
    (yuvoy-operator#9), so a page-wide "Take it down" resolves to six buttons.
    This test is about the receipt — the wrong file noticed before leaving the
    screen — and it says which one it means.
  */
  const receipt = page.locator("form").filter({
    has: page.getByRole("radio", { name: /Somebody in it objected/ }),
  });

  // A closed set, because the counts matter — a consent takedown arriving
  // repeatedly is a signal about how somebody films.
  await expect(
    receipt.getByRole("radio", { name: /Somebody in it objected/ }),
  ).toBeVisible();
  await receipt.getByRole("radio", { name: /We just want it down/ }).check();
  await receipt.getByRole("button", { name: "Take it down" }).click();

  /*
    Says what is true now. "Only the first is transactional: it comes off Yuvoy
    immediately, and the original is deleted at the video provider shortly
    afterwards by a job." Promising the provider deletion here would tell an
    operator who asked because somebody objected that the footage is gone when
    it is not, yet.
  */
  await expect(
    page.getByRole("paragraph").filter({ hasText: "Taken down" }),
  ).toBeVisible();
  /*
    Said twice now, deliberately: once on the receipt, where the eye is, and
    once on the row in the library below, which is still there tomorrow.
    `.first()` rather than a count — a second withdrawn clip would make the
    count wrong without making anything worse.
  */
  await expect(
    page.getByText(/deleted at the video provider shortly/).first(),
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

  const grid = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(grid.violations).toEqual([]);

  /*
    And the sheet, which is the new thing axe has to be happy about: a dialog
    that claims `aria-modal` over a page it does not remove from the tree.
  */
  await page.getByRole("button").filter({ hasText: /\w/ }).last().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.waitForLoadState("networkidle");

  const open = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(open.violations).toEqual([]);
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
