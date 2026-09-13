import { describe, it, expect, afterEach, vi } from "vitest";
import { operatorPageUrl, travellerAppOrigin } from "./traveller-app";

afterEach(() => vi.unstubAllEnvs());

/**
 * Where a business's page lives for a traveller — yuvoy-operator#41.
 *
 * "Preview your operator page" could not be built for two days because no
 * operator endpoint returned the slug, and a button that guessed the address
 * would lead to somebody else's page on the day the guess was wrong. `GET /me`
 * carries it now, so the address is read rather than constructed — and this
 * module is the one place that decides the origin, because the app is due to
 * move onto the root domain (yuvoy-app#12).
 */
describe("travellerAppOrigin", () => {
  it("defaults to production rather than to nothing", () => {
    /*
      An empty default would render `/o/reef-divers-havelock`, which on THIS
      origin is a 404 inside the portal rather than a business's page — a
      broken button that looks like a working one.
    */
    expect(travellerAppOrigin()).toBe("https://app.yuvoy.in");
  });

  it("takes a configured origin, so a preview can point at a preview", () => {
    vi.stubEnv(
      "NEXT_PUBLIC_TRAVELLER_APP_URL",
      "https://app-preview.vercel.app",
    );
    expect(travellerAppOrigin()).toBe("https://app-preview.vercel.app");
  });

  it("keeps only the origin, whatever path the variable carries", () => {
    // A trailing path would be joined twice and produce `/o/…` under it.
    vi.stubEnv(
      "NEXT_PUBLIC_TRAVELLER_APP_URL",
      "https://app.yuvoy.in/some/path",
    );
    expect(travellerAppOrigin()).toBe("https://app.yuvoy.in");
  });

  it("falls back rather than throwing on a value that is not a URL", () => {
    /*
      A malformed variable must not take the story screen down. This project
      has been bitten by a `NEXT_PUBLIC_` value arriving wrong from a
      dashboard — yuvoy-app's `NEXT_PUBLIC_SITE_URL` reached three builds as
      `[SENSITIVE]` because it was marked Sensitive in Vercel.
    */
    vi.stubEnv("NEXT_PUBLIC_TRAVELLER_APP_URL", "[SENSITIVE]");
    expect(travellerAppOrigin()).toBe("https://app.yuvoy.in");
  });
});

describe("operatorPageUrl", () => {
  it("builds the business's public address from its slug", () => {
    expect(operatorPageUrl("reef-divers-havelock")).toBe(
      "https://app.yuvoy.in/o/reef-divers-havelock",
    );
  });

  it("answers null rather than linking to /o/undefined", () => {
    /*
      `operators.slug` is `not null unique` and the contract marks it required,
      so this should never happen. But required in a pinned contract is a
      promise about master, not about the deployed API — and no button at all
      beats a Preview button that opens a 404.
    */
    expect(operatorPageUrl(undefined)).toBeNull();
    expect(operatorPageUrl(null)).toBeNull();
    expect(operatorPageUrl("   ")).toBeNull();
  });

  it("escapes a slug rather than trusting it into a URL", () => {
    // The slug comes off the wire. It is a database column we control, but a
    // value from an API is not a value to interpolate unescaped.
    expect(operatorPageUrl("a b/c")).toBe("https://app.yuvoy.in/o/a%20b%2Fc");
  });
});
