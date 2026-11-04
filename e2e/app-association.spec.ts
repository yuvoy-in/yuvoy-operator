import { test, expect } from "@playwright/test";

/**
 * B12: the two files the native app needs for universal links, fetched from
 * the production build the way Apple's CDN and Google's verifier fetch them:
 * no cookies, no redirect followed, JSON type.
 */
for (const path of [
  "/.well-known/apple-app-site-association",
  "/.well-known/assetlinks.json",
]) {
  test(`${path} answers 200 as JSON without a redirect`, async ({
    request,
  }) => {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toBe("application/json");
    expect(JSON.parse(await response.text())).toBeTruthy();
  });
}

/**
 * yuvoy-operator#171: the served file, not only the one in public/, sends a
 * claim link to the Host app, which declares /claim/ (yuvoy-mobile#427).
 */
test("the served apple-app-site-association links /claim/* and not the bare /claim", async ({
  request,
}) => {
  const response = await request.get(
    "/.well-known/apple-app-site-association",
    {
      maxRedirects: 0,
    },
  );
  const aasa = JSON.parse(await response.text());
  const paths = aasa.applinks.details[0].components.map(
    (c: { "/": string }) => c["/"],
  );
  expect(paths).toContain("/claim/*");
  expect(paths).not.toContain("/claim");
});
