import { writeFileSync } from "node:fs";
import { test, expect } from "@playwright/test";
import { choose, clip, openUploader, signIn } from "./reels-kit";

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
