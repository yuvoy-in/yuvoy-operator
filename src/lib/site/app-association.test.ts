import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { unstable_getResponseFromNextConfig } from "next/experimental/testing/server";
import nextConfig from "../../../next.config";

/**
 * The universal link (iOS) and app link (Android) files for the operator app
 * (B12). iOS fetches the first through Apple's CDN and gives up on a redirect
 * or a type other than JSON, and Android drops the host if the second fails,
 * so these pin the files, the type they go out with and that no redirect in
 * next.config catches them.
 */

const ROOT = process.cwd();
const WELL_KNOWN = join(ROOT, "public", ".well-known");
const AASA = "/.well-known/apple-app-site-association";
const ASSETLINKS = "/.well-known/assetlinks.json";

const BUNDLE_ID = "in.yuvoy.operator";
const TEAM_ID = "K8PFJNX7U8";
const RELEASE_SHA256 =
  "6B:AF:2D:A4:F5:57:8F:E3:B1:52:5E:24:2A:F1:73:AE:7F:CC:08:9E:C6:99:6D:FC:02:0B:79:DC:9B:76:A4:B1";

/**
 * What opens in the app. The same list as LINK_PATHS in the app's
 * apps/operator/app.config.ts (its Android intent filters), so iOS and Android
 * claim the same links: change both or neither. A trailing /* is a prefix.
 */
const LINKED = [
  "/today",
  "/today/*",
  "/bookings",
  "/bookings/*",
  "/requests",
  "/calendar",
  "/capacity",
  "/cash",
  "/earnings",
  "/earnings/*",
  "/payouts",
  "/profile",
  "/account",
  "/account/*",
  "/services",
  "/services/*",
  "/reels",
  "/logo",
  "/story",
  "/team",
  "/team/*",
  "/notifications",
  "/messages",
  "/join",
  "/join/*",
  "/sign-in",
  "/signup",
];

const read = (name: string) =>
  JSON.parse(readFileSync(join(WELL_KNOWN, name), "utf8"));

describe("apple-app-site-association", () => {
  const aasa = read("apple-app-site-association");

  it("names the operator app once, with the Yuvoy Apple Team ID", () => {
    expect(aasa.applinks.details).toHaveLength(1);
    const [detail] = aasa.applinks.details;
    expect(detail.appIDs).toEqual([`${TEAM_ID}.${BUNDLE_ID}`]);
    expect(detail.paths).toBeUndefined();
  });

  it("links exactly the agreed paths", () => {
    const paths = aasa.applinks.details[0].components.map(
      (c: { "/": string }) => c["/"],
    );
    expect(paths).toEqual(LINKED);
  });

  it("claims no root and no catch-all", () => {
    expect(LINKED).not.toContain("/");
    expect(LINKED).not.toContain("/*");
  });
});

describe("assetlinks.json", () => {
  const links = read("assetlinks.json");

  it("delegates every URL on this host to the operator app", () => {
    expect(links).toHaveLength(1);
    expect(links[0].relation).toEqual([
      "delegate_permission/common.handle_all_urls",
    ]);
    expect(links[0].target.namespace).toBe("android_app");
    expect(links[0].target.package_name).toBe(BUNDLE_ID);
  });

  it("carries the EAS release signing SHA-256 and nothing malformed", () => {
    const prints: string[] = links[0].target.sha256_cert_fingerprints;
    expect(prints).toContain(RELEASE_SHA256);
    for (const print of prints) {
      expect(print).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
    }
  });
});

describe("serving", () => {
  it.each([AASA, ASSETLINKS])(
    "https://operators.yuvoy.in%s answers 200 as JSON with no redirect",
    async (path) => {
      const response = await unstable_getResponseFromNextConfig({
        url: `https://operators.yuvoy.in${path}`,
        nextConfig,
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("application/json");
    },
  );

  it("is a static file, so no route or extensionless page shadows it", () => {
    expect(existsSync(join(WELL_KNOWN, "apple-app-site-association"))).toBe(
      true,
    );
    expect(existsSync(join(WELL_KNOWN, "assetlinks.json"))).toBe(true);
  });
});
