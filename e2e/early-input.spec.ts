import { test, expect, type Page } from "@playwright/test";

/**
 * Changed before the page hydrated (the stability pass, 6 Oct 2026).
 *
 * On a slow link a form the server drew is on screen for seconds before its
 * script. React keeps what was typed, ticked or picked in that time, and
 * tells nobody: the component's state still holds what the server drew. The
 * stress run found it on sign-in, where ten digits sat over a disabled "Send
 * me a code" until a digit was retyped, and the field's next render would
 * have taken the number away.
 *
 * Each of these holds the page's scripts, changes the fields as a person
 * would, lets the scripts go, and then reads what React holds for every
 * field against what the screen shows. They must agree.
 */

const DEV_CODE = "424242";

async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Your phone number").fill("+919000000101");
  await page.getByRole("button", { name: "Send me a code" }).click();
  await page.getByLabel("Your code").fill(DEV_CODE);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/today");
}

/**
 * The page's scripts. Not its stylesheets, which share the folder: a held
 * stylesheet holds every inline script after it, the document with them.
 */
const CHUNKS = /\/_next\/static\/chunks\/[^?]+\.js(\?|$)/;

/**
 * Opens `path` with its scripts held, so nothing hydrates until `change` has
 * run against the server's HTML. Returns once the page has hydrated and
 * settled.
 */
async function openHeld(
  page: Page,
  path: string,
  change: (page: Page) => Promise<void>,
) {
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route(CHUNKS, async (route) => {
    await held;
    await route.continue().catch(() => {});
  });
  // The whole document, streamed parts included. Those arrive as hidden
  // copies that inline scripts swap in (they run without the held ones), on
  // React's own clock, which can run past the end of the document.
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => !document.querySelector('div[hidden][id^="S:"]'),
  );
  await change(page);
  release();
  await page.unroute(CHUNKS);
  await page.waitForLoadState("networkidle");
  // Hydrated: React has claimed every field the server drew.
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll("input, textarea, select")).every(
      (el) => Object.keys(el).some((k) => k.startsWith("__reactProps$")),
    ),
  );
  await page.waitForLoadState("networkidle");
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
}

declare global {
  interface Window {
    /** What `changeEverything` changed, and to what. */
    __early: {
      el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
      name: string;
      kind: "text" | "check" | "select";
      value: string;
      checked: boolean;
    }[];
  }
}

/**
 * Changes every field on the page the way a person could: text gets more,
 * a select its next choice, a group of radios its other one, one switch is
 * flipped, and dates, times and numbers move on by one. Remembers each, by
 * the element itself: hydration keeps the server's elements.
 */
async function changeEverything(page: Page) {
  return page.evaluate(() => {
    window.__early = [];
    const groups = new Set<string>();
    let flipped = false;
    const fields = document.querySelectorAll<
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    >("input, textarea, select");
    const keep = (
      el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
      kind: "text" | "check" | "select",
    ) =>
      window.__early.push({
        el,
        name: el.id || el.getAttribute("name") || el.tagName,
        kind,
        value: el.value,
        checked: el instanceof HTMLInputElement && el.checked,
      });
    for (const el of fields) {
      if (el.disabled || el.closest("[inert], [hidden]")) continue;
      if (el instanceof HTMLSelectElement) {
        const next = Array.from(el.options).find(
          (o) => !o.selected && !o.disabled,
        );
        if (next) {
          next.selected = true;
          keep(el, "select");
        }
        continue;
      }
      if (el instanceof HTMLTextAreaElement) {
        el.value = `${el.value} and more`.trim();
        keep(el, "text");
        continue;
      }
      switch (el.type) {
        case "hidden":
        case "file":
        case "submit":
        case "button":
        case "reset":
        case "image":
          break;
        case "checkbox":
          if (!flipped) {
            el.checked = !el.checked;
            flipped = true;
            keep(el, "check");
          }
          break;
        case "radio": {
          if (groups.has(el.name)) break;
          groups.add(el.name);
          const other = Array.from(
            document.querySelectorAll<HTMLInputElement>(
              `input[type="radio"][name="${CSS.escape(el.name)}"]`,
            ),
          ).find((r) => !r.checked && !r.disabled);
          if (other) {
            other.checked = true;
            keep(other, "check");
          }
          break;
        }
        case "number":
          el.value = String((Number(el.value) || 0) + 1);
          keep(el, "text");
          break;
        case "time":
          el.value = el.value === "10:30" ? "11:15" : "10:30";
          keep(el, "text");
          break;
        case "date": {
          const day = new Date(`${el.value || "2026-10-10"}T00:00:00Z`);
          day.setUTCDate(day.getUTCDate() + 1);
          el.value = day.toISOString().slice(0, 10);
          keep(el, "text");
          break;
        }
        default:
          el.value = `${el.value}7`;
          keep(el, "text");
      }
    }
    return window.__early.length;
  });
}

/**
 * Every change the page lost, or kept on screen while React held something
 * else. A select only has to agree: two choices that disagree (a date choice
 * and the dates themselves) are settled by the page, as it settles them for
 * a person. A field React only reads on submit is the browser's to keep.
 */
async function lost(page: Page) {
  return page.evaluate(() => {
    const out: string[] = [];
    for (const { el, name, kind, value, checked } of window.__early) {
      if (!el.isConnected) {
        out.push(`${name}: replaced, and the field changed is gone`);
        continue;
      }
      const key = Object.keys(el).find((k) => k.startsWith("__reactProps$"));
      const props = key
        ? (el as unknown as Record<string, Record<string, unknown>>)[key]
        : {};
      const owned = typeof props.onChange === "function";
      if (kind === "check") {
        const box = el as HTMLInputElement;
        if (box.checked !== checked) out.push(`${name}: the screen lost it`);
        else if (owned && typeof props.checked === "boolean") {
          if (props.checked !== box.checked) {
            out.push(
              `${name}: React holds ${props.checked}, the screen ${box.checked}`,
            );
          }
        }
        continue;
      }
      if (kind === "text" && el.value !== value) {
        out.push(`${name}: the screen lost "${value}" (now "${el.value}")`);
        continue;
      }
      if (
        owned &&
        props.value !== undefined &&
        String(props.value) !== el.value
      ) {
        out.push(
          `${name}: React holds "${String(props.value)}", the screen "${el.value}"`,
        );
      }
    }
    return out;
  });
}

test.beforeEach(({}, info) => {
  // Chromium on a phone is enough: this is React's behaviour, not a browser's.
  test.skip(info.project.name !== "mobile", "React, not the browser");
});

test("a number typed before sign-in hydrates is the number that signs in", async ({
  page,
}) => {
  await openHeld(page, "/sign-in", async (page) => {
    await page.getByLabel("Your phone number").fill("9000000101");
  });
  const send = page.getByRole("button", { name: "Send me a code" });
  await expect(send).toBeEnabled();
  await send.click();
  await page.getByLabel("Your code").fill(DEV_CODE);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/today");
});

test("signed out, every form keeps what was changed before it hydrated", async ({
  page,
}) => {
  for (const path of ["/sign-in", "/signup", "/join"]) {
    let changed = 0;
    await openHeld(page, path, async (page) => {
      changed = await changeEverything(page);
    });
    expect(changed, `${path}: changed something`).toBeGreaterThan(0);
    expect(await lost(page), path).toEqual([]);
  }
});

test("signed in, every form keeps what was changed before it hydrated", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signIn(page);

  // The mock's own: a booking with a thread, a boat, a listing and a draft.
  // Nothing here saves until somebody taps Save; the switches, which save
  // as they change, have their own test below.
  const paths = [
    "/today",
    "/bookings?from=2026-10-01&to=2026-10-05",
    "/bookings/bkg_1",
    "/team",
    "/profile",
    "/story",
    "/today/slot_cash/boarding",
    "/today/listing/exp_try_dive",
    "/account/listings/new",
    ...["basics", "selling", "schedule", "location", "media"].map(
      (step) => `/account/listings/exp_night/edit?step=${step}`,
    ),
    // The one listing with a question.
    "/account/listings/exp_boat/edit?step=questions",
  ];

  for (const path of paths) {
    let changed = 0;
    await openHeld(page, path, async (page) => {
      changed = await changeEverything(page);
    });
    expect(changed, `${path}: changed something`).toBeGreaterThan(0);
    expect(await lost(page), path).toEqual([]);
  }
});

test("a switch turned before the page hydrated is the one saved", async ({
  page,
}) => {
  /*
    A switch saves the moment it changes, so this one reloads to prove the
    save, and puts the switch back. "Payout sent", which no other test
    turns: the mock's state is shared.
  */
  await signIn(page);
  const box = () =>
    page.locator("li").filter({ hasText: "Payout sent" }).getByRole("checkbox");

  for (const path of ["/notifications", "/team/usr_staff_arun/notifications"]) {
    let was = false;
    await openHeld(page, path, async () => {
      was = await box().isChecked();
      // A tap, as the browser takes one with no script: the box flips.
      await box().evaluate((el: HTMLInputElement) => el.click());
    });
    await expect(box(), path).toBeChecked({ checked: !was });
    await page.reload();
    await expect(box(), `${path}, saved`).toBeChecked({ checked: !was });

    // Put it back. `click`, as the switch tests do: it follows the answer.
    await box().click();
    await expect(box()).toBeChecked({ checked: was });
  }
});
