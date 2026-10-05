import {
  test,
  expect,
  type Locator,
  type Page,
  type Route,
} from "@playwright/test";

/**
 * The portal's motion, in a real engine (approved 4 Oct 2026; the study and
 * its decisions are in yuvoy/motion-lab, the rules in lib/motion and the
 * "motion" sections of globals.css).
 *
 * The unit suite proves each motion is asked for with the right timing; this
 * proves the browser runs it: what is animating at the moment that matters,
 * what has `aria-busy` while an answer is slow, what is inert while it
 * leaves. Slow answers are made slow on purpose (`slow`), never waited for.
 *
 * Nothing here changes what another suite reads. Every write is one the
 * server refuses or one that is never sent: an Undo inside its five seconds,
 * Keep it, and a seat count below what is sold, which the action refuses
 * before it reaches the API. The fixtures used are the ones the suites that
 * own them already treat that way (`req_urgent`, Anil Kumar on `slot_cash`,
 * `slot_late_morning`).
 */

const DEV_CODE = "424242";
const OWNER = "+919000000101";

async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Your phone number").fill(OWNER);
  await page.getByRole("button", { name: "Send me a code" }).click();
  await page.getByLabel("Your code").fill(DEV_CODE);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/today");
}

/** A market day `n` days from today, the way the fixtures build them. */
function marketDay(offset: number): string {
  const now = new Date();
  const ist = new Date(now.getTime() + 5.5 * 3600_000 + offset * 86_400_000);
  return ist.toISOString().slice(0, 10);
}

interface Played {
  /** The element's role or tag, and its classes, enough to tell what moved. */
  on: string;
  keyframes: Keyframe[];
  duration: number;
  delay: number;
  easing: string;
}

declare global {
  interface Window {
    __played?: Played[];
  }
}

/**
 * Records every Web Animation the page asks for, from the first script on:
 * the portal's script motion all goes through `play()` (lib/motion), so this
 * is each one, with its timing, however briefly it ran.
 */
async function record(page: Page) {
  await page.addInitScript(() => {
    const animate = Element.prototype.animate;
    window.__played = [];
    Element.prototype.animate = function (keyframes, options) {
      const timing =
        typeof options === "number" ? { duration: options } : (options ?? {});
      window.__played!.push({
        on: `${this.getAttribute("role") ?? this.tagName.toLowerCase()} ${
          this.getAttribute("class") ?? ""
        }`,
        keyframes: Array.isArray(keyframes) ? keyframes : [],
        duration: Number(timing.duration ?? 0),
        delay: Number(timing.delay ?? 0),
        easing: String(timing.easing ?? "linear"),
      });
      return animate.call(this, keyframes, options);
    };
  });
}
const played = (page: Page) => page.evaluate(() => window.__played ?? []);
const forget = (page: Page) =>
  page.evaluate(() => {
    window.__played = [];
  });

interface Running {
  name: string;
  duration: number;
  easing: string;
  keyframes: { transform?: string; opacity?: string }[];
}

/** What an element is animating right now, as data. */
function running(target: Locator): Promise<Running[]> {
  return target.evaluate((el) =>
    el.getAnimations().map((a) => {
      const effect = a.effect as KeyframeEffect;
      return {
        name: (a as CSSAnimation).animationName ?? "",
        duration: Number(effect.getComputedTiming().duration),
        easing: String(effect.getTiming().easing),
        keyframes: effect.getKeyframes().map((k) => ({
          transform: k.transform as string | undefined,
          opacity: k.opacity === undefined ? undefined : String(k.opacity),
        })),
      };
    }),
  );
}

/**
 * Holds every request `when` picks for `ms` before letting it through: a
 * Server Action (a POST to the page) or a client navigation's RSC read.
 */
async function slow(
  page: Page,
  when: (route: Route) => boolean,
  ms: number,
): Promise<void> {
  await page.route("**/*", async (route) => {
    if (when(route)) await new Promise((resolve) => setTimeout(resolve, ms));
    await route.continue();
  });
}
const isAction = (route: Route) => route.request().method() === "POST";
const isNavigation = (route: Route) =>
  route.request().method() === "GET" &&
  route.request().headers()["rsc"] === "1";

/* -------------------------------------------------------------- presses */

test("every press animates the property it presses with", async ({ page }) => {
  // Tailwind 4 writes `active:scale-*` to `scale`; a list without it snaps.
  await signIn(page);
  const button = page
    .getByRole("region", { name: "Needs you" })
    .getByRole("button", { name: "Accept" })
    .first();
  const disc = page.getByRole("link", { name: /^Messages/ });
  for (const control of [button, disc]) {
    const property = await control.evaluate(
      (el) => getComputedStyle(el).transitionProperty,
    );
    expect(property.split(",").map((s) => s.trim())).toContain("scale");
  }
});

/* -------------------------------------------- reduced motion swaps (S01) */

test.describe("reduced motion swaps travel for a fade", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
  });

  test("what is unmarked is instant; the inspector fades in 120ms and travels nowhere", async ({
    page,
  }) => {
    await record(page);
    await signIn(page);
    /*
      Polled: the bar is drawn again as Today settles after sign-in, and a
      link read in that moment is already out of the page (its style is
      empty, NaN). Only a link in the page answers.
    */
    await expect
      .poll(
        () =>
          page
            .getByRole("link", { name: /^Messages/ })
            .evaluate((el) =>
              el.isConnected
                ? parseFloat(getComputedStyle(el).transitionDuration)
                : Number.NaN,
            ),
        { message: "an unmarked control's transitions are instant" },
      )
      .toBeLessThan(0.01);

    await page.goto(`/calendar?day=${marketDay(0)}`);
    await page
      .getByRole("link", { name: /Try-dive at Nemo Reef, \d+ of \d+ sold/ })
      .first()
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    const sheet = (await played(page)).filter((p) => p.on.startsWith("dialog"));
    expect(sheet.length, "the inspector arrived with no fade").toBeGreaterThan(
      0,
    );
    for (const animation of sheet) {
      expect(animation.duration).toBe(120);
      expect(animation.keyframes.some((k) => "transform" in k)).toBe(false);
    }
  });
});

/* --------------------------------------------------- O04 forms and saving */

test("a pending button keeps its colour, says it is busy, and shows its ring only after 300ms", async ({
  page,
}) => {
  await signIn(page);
  await page.goto(`/calendar?day=${marketDay(0)}`);
  await page
    .getByRole("link", { name: /Try-dive at Nemo Reef, \d+ of \d+ sold/ })
    .first()
    .click();
  const inspector = page.getByRole("dialog");
  const floor = inspector.getByText(
    /^\d+ already sold, so it cannot go lower\.$/,
  );
  /*
    Waited for, never skipped. The inspector draws its seats a moment after
    it rises, and a count taken at once found nothing, so this check skipped
    itself on every run and proved nothing. The fixture's departure has five
    on it (slot_dawn); refusing a number below that is what keeps this
    read-only, so a departure with nobody on it is a broken check, not a skip.
  */
  await expect(
    floor,
    "needs a departure with somebody on it: the refusal is what keeps this read-only",
  ).toBeVisible();
  // Below what is sold: refused by the action before the API, so nothing changes.
  const sold = Number((await floor.innerText()).split(" ")[0]);
  expect(sold, "nothing sold to go below").toBeGreaterThan(0);
  await inspector.getByLabel("Seats offered").fill(String(sold - 1));

  await slow(page, isAction, 1_500);
  await inspector.getByRole("button", { name: "Set seats" }).click();
  // In the first moments of the wait the ring is there but not yet drawn.
  const early = await page.evaluate(() => {
    const ring = document.querySelector("[aria-busy=true] .motion-busy-ring");
    return ring ? Number(getComputedStyle(ring).opacity) : null;
  });
  if (early !== null) expect(early).toBeLessThan(0.5);
  const busy = inspector.getByRole("button", { name: "Saving", exact: true });
  await expect(busy).toHaveAttribute("aria-busy", "true");
  // Full colour, and still focusable: not `disabled`.
  expect(await busy.evaluate((el) => (el as HTMLButtonElement).disabled)).toBe(
    false,
  );
  expect(await busy.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
  const ring = busy.locator(".motion-busy-ring");
  await expect(ring).toHaveCount(1);
  // Held back for the show delay, then drawn.
  await expect
    .poll(() => ring.evaluate((el) => Number(getComputedStyle(el).opacity)), {
      timeout: 1_200,
    })
    .toBeGreaterThan(0.9);

  // The refusal arrives, rising in, and the button is itself again.
  const refusal = inspector.getByRole("alert");
  await expect(refusal).toContainText("already sold");
  await expect(refusal).toHaveClass(/\bmotion-rise-in\b/);
  await expect(
    inspector.getByRole("button", { name: "Set seats" }),
  ).not.toHaveAttribute("aria-busy");
});

/* ---------------------------------------------------- O05 bookings pills */

test("a pill fills on the tap, before the server answers, and its rows say they are on their way", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/bookings?view=upcoming");
  const pills = page.getByRole("navigation", { name: "Which bookings" });
  await slow(page, isNavigation, 1_500);

  const past = pills.getByRole("link", { name: /^Past/ });
  await past.click();
  // Lit in the frame it is tapped, long before the server's answer.
  await expect(past).toHaveAttribute("aria-current", "page", { timeout: 300 });
  await expect(
    pills.getByRole("link", { name: /^Upcoming/ }),
  ).not.toHaveAttribute("aria-current");
  // Slow: past 300ms the old rows say they are on their way.
  await expect(page.locator("[aria-busy=true]")).toHaveCount(1, {
    timeout: 1_000,
  });

  await page.waitForURL("**/bookings?view=past*");
  await expect(page.locator("[aria-busy=true]")).toHaveCount(0);
  await expect(past).toHaveAttribute("aria-current", "page");
});

/* ---------------------------------------------------- O06 named confirm */

test("the call-off confirm fades in, and Keep it leaves a copy fading where it stood", async ({
  page,
}) => {
  await record(page);
  await signIn(page);
  // Kept, never sent: day.spec treats this departure the same way.
  await page.goto("/today/slot_late_morning");
  await forget(page);
  await page.getByRole("button", { name: "Call this departure off" }).click();
  // The confirm fades in where the text was: opacity only, 150ms.
  await expect
    .poll(async () =>
      (await played(page)).some(
        (p) =>
          p.on.startsWith("form") &&
          p.keyframes[0]?.opacity === 0 &&
          p.duration === 150,
      ),
    )
    .toBe(true);
  const confirm = page.locator("form", {
    has: page.getByRole("button", { name: "Call it off" }),
  });

  await page.getByRole("radio", { name: "Weather" }).check();
  // Whatever is laid over the page from here on, however briefly.
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { __layers: string[] }).__layers = seen;
    new MutationObserver((changes) => {
      for (const change of changes) {
        for (const node of change.addedNodes) {
          if (
            node instanceof HTMLElement &&
            node.getAttribute("aria-hidden") === "true" &&
            node.hasAttribute("data-motion")
          ) {
            seen.push(node.textContent ?? "");
          }
        }
      }
    }).observe(document.body, { childList: true });
  });
  await forget(page);
  await confirm.getByRole("button", { name: "Keep it" }).click();
  // The real change landed at once: the text is back, with focus.
  await expect(
    page.getByRole("button", { name: "Call this departure off" }),
  ).toBeFocused();
  // The confirm as it was went over it, fading out as the text faded in, and
  // is gone once it has faded.
  const layers = await page.evaluate(
    () => (window as unknown as { __layers: string[] }).__layers,
  );
  expect(layers.some((text) => text.startsWith("Call off the"))).toBe(true);
  const fades = await played(page);
  expect(
    fades.some((p) => p.keyframes.at(-1)?.opacity === 0 && p.duration === 150),
  ).toBe(true);
  expect(
    fades.some((p) => p.keyframes[0]?.opacity === 0 && p.duration === 150),
  ).toBe(true);
  await expect(
    page.locator("body > [aria-hidden=true][data-motion]"),
  ).toHaveCount(0, { timeout: 1_000 });
});

/* ------------------------------------------------------- O07 boarding */

test("a check-in draws Undo's five seconds, and the headcount stays one number", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/today/slot_cash/boarding");
  // Anil: only Undo touches him, which sends nothing (boarding.spec).
  await page
    .getByRole("button", { name: "Aboard: check in Anil Kumar", exact: true })
    .click();
  const aboard = page.getByRole("region", { name: /^Aboard · \d+$/ });
  const undo = aboard.getByRole("button", { name: "Undo" });
  const hairline = undo.locator(".motion-drain");
  await expect(hairline).toHaveAttribute("aria-hidden", "true");
  expect(
    await hairline.evaluate((el) =>
      (el as HTMLElement).style.getPropertyValue("--window"),
    ),
  ).toBe("5000ms");
  // The roll's old number is drawn, never text: the count reads as one.
  await expect(page.getByText(/^\d+ of \d+ aboard$/)).toBeVisible();

  await undo.click();
  await expect(
    page.getByRole("region", { name: /^To come · \d+$/ }),
  ).toContainText("Anil Kumar");
});

/* ------------------------------------------------- O02 answering, on Home */

test("answering on Home draws the window, and Undo inside it sends nothing", async ({
  page,
}) => {
  await signIn(page);
  // `req_urgent` is never answered by any test (home.spec).
  const card = page
    .getByRole("region", { name: "Needs you" })
    .getByRole("listitem", { name: "Seat request from Reuben Mathai" });
  await card.getByRole("button", { name: "Accept" }).click();
  const held = page
    .getByRole("region", { name: "Needs you" })
    .getByRole("listitem")
    .filter({ hasText: "Accepting Reuben Mathai, 2 people" });
  const bar = held.locator(".motion-drain");
  await expect(bar).toHaveAttribute("aria-hidden", "true");
  const drain = await running(bar);
  expect(drain.find((a) => a.name === "motion-drain")?.duration).toBe(5_000);
  await held.getByRole("button", { name: "Undo" }).click();
  await expect(card.getByRole("button", { name: "Accept" })).toBeFocused();
});

/* -------------------------------------------------------- O08 calendar */

test.describe("the calendar", () => {
  test("a day takes its fill on the press, before the server answers", async ({
    page,
    isMobile,
  }) => {
    test.skip(!isMobile, "the strip of days is a phone's");
    await signIn(page);
    await page.goto(`/calendar?day=${marketDay(0)}`);
    await slow(page, isNavigation, 1_500);
    const days = page.getByRole("navigation", { name: "Days" });
    const next = days
      .getByRole("link")
      .nth((await days.getByRole("link").count()) - 1);
    await next.click();
    await expect(next).toHaveAttribute("aria-current", "page", {
      timeout: 300,
    });
  });

  test("the inspector rises from its edge, and leaves on the tap with the address following at once", async ({
    page,
    isMobile,
  }) => {
    await record(page);
    await signIn(page);
    await page.goto(`/calendar?day=${marketDay(0)}`);
    const link = page
      .getByRole("link", { name: /Try-dive at Nemo Reef, \d+ of \d+ sold/ })
      .first();
    await forget(page);
    await link.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const edge = isMobile ? "translateY(100%)" : "translateX(100%)";
    const rise = (await played(page)).find(
      (p) => p.on.startsWith("dialog") && p.keyframes[0]?.transform === edge,
    );
    expect(rise, "the inspector did not rise from its edge").toBeTruthy();
    expect(rise!.duration).toBe(200);

    await forget(page);
    await dialog.getByRole("button", { name: "Close" }).click();
    // Let go at once: the address has lost the departure before it has gone.
    expect(new URL(page.url()).searchParams.get("dep")).toBeNull();
    const leave = (await played(page)).find(
      (p) =>
        p.on.startsWith("dialog") && p.keyframes.at(-1)?.transform === edge,
    );
    expect(leave, "the inspector did not leave the way it came").toBeTruthy();
    expect(leave!.duration).toBe(150);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(link).toBeFocused();
  });
});
