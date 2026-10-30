import { describe, expect, it } from "vitest";
import {
  claimBanner,
  claimLink,
  hostAppPlatform,
  openInAppLink,
} from "./host-app";

/**
 * "Open in the app" on `/claim/{slug}` (yuvoy-operator#171). A link tapped
 * on a page of the same host stays in the browser, so iOS gets the Smart App
 * Banner instead of the button and Android an `intent://` link (manager
 * decision, 29 Oct 13:07).
 */

const PIXEL =
  "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";
const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const DESKTOP =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

const PLAY_FALLBACK = encodeURIComponent(
  "https://play.google.com/store/apps/details?id=in.yuvoy.operator",
);

describe("hostAppPlatform", () => {
  it("knows an Android phone, an iPhone and anything else", () => {
    expect(hostAppPlatform(PIXEL)).toBe("android");
    expect(hostAppPlatform(IPHONE)).toBe("ios");
    expect(hostAppPlatform(DESKTOP)).toBe("other");
  });

  it("is other on an iPhone browser that draws no banner", () => {
    // Chrome, Firefox and Instagram's browser on an iPhone.
    const chrome = IPHONE.replace("Version/18.0", "CriOS/130.0.6723.90");
    const firefox = IPHONE.replace("Version/18.0", "FxiOS/132.0");
    const instagram =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0.0.0.0";
    for (const ua of [chrome, firefox, instagram]) {
      expect(hostAppPlatform(ua)).toBe("other");
    }
  });

  it("is other in an Android app's WebView, which cannot follow intent://", () => {
    const webView = PIXEL.replace("Pixel 7)", "Pixel 7; wv)");
    expect(hostAppPlatform(webView)).toBe("other");
  });

  it("is other with no User-Agent at all", () => {
    expect(hostAppPlatform(null)).toBe("other");
    expect(hostAppPlatform("")).toBe("other");
  });
});

describe("openInAppLink", () => {
  it("is no button on an iPhone: the banner takes its place", () => {
    expect(openInAppLink("example-reef-divers", "ios")).toBeNull();
  });

  it("is an intent link to Yuvoy Host on Android, falling back to Play", () => {
    expect(openInAppLink("example-reef-divers", "android")).toBe(
      `intent://operators.yuvoy.in/claim/example-reef-divers#Intent;scheme=https;package=in.yuvoy.operator;S.browser_fallback_url=${PLAY_FALLBACK};end`,
    );
  });

  it("is the claim link itself anywhere else", () => {
    expect(openInAppLink("example-reef-divers", "other")).toBe(
      "https://operators.yuvoy.in/claim/example-reef-divers",
    );
  });

  it("encodes the slug once, so the intent's own # and ; stay its own", () => {
    expect(openInAppLink("a#b;c", "android")).toMatch(
      /^intent:\/\/operators\.yuvoy\.in\/claim\/a%23b%3Bc#Intent;/,
    );
  });

  it("is no button on any phone with no slug", () => {
    for (const platform of ["ios", "android", "other"] as const) {
      expect(openInAppLink(null, platform)).toBeNull();
      expect(openInAppLink("  ", platform)).toBeNull();
    }
  });
});

describe("claimBanner", () => {
  it("hands the app the claim link", () => {
    expect(claimBanner("example-reef-divers")).toEqual({
      appId: "6820854539",
      appArgument: claimLink("example-reef-divers"),
    });
  });

  it("still offers the app with no slug, with nothing to open", () => {
    expect(claimBanner(null)).toEqual({ appId: "6820854539" });
  });
});
