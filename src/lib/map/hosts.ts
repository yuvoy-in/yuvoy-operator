/**
 * Where the meeting-point map comes from (yuvoy-operator#113).
 *
 * Dependency-free on purpose: `src/lib/site/csp.ts` reads these to build
 * `connect-src`, and `next.config.ts` loads that file, so the policy and the
 * code that makes the requests are written from one place and cannot name
 * different hosts.
 *
 * ## OpenFreeMap, for the map
 *
 * The owner's call (2 Oct 2026): OpenStreetMap, with no API key. Terms read
 * on openfreemap.org on 2 Oct 2026: free, commercial use included, no key, no
 * registration and no cookies, and no limit on map views or requests. The
 * credit it asks for ("OpenFreeMap © OpenMapTiles Data from OpenStreetMap")
 * arrives in the vector source's TileJSON, and MapLibre's attribution control
 * shows it on the map. The style, the vector and raster tiles, the glyphs and
 * the sprites are all on the one origin below (checked against the style and
 * its TileJSON the same day).
 *
 * The service is provided as is and may stop without notice, which is why the
 * pin never depends on the map: search, a pasted link and the device's
 * location all set it without one.
 *
 * ## Photon, for place search
 *
 * Run by komoot on OpenStreetMap data. Terms read on photon.komoot.io on 2 Oct
 * 2026: "You can use the API for your project, but please be fair - extensive
 * usage will be throttled. We do not guarantee for the availability". This
 * portal searches only while an operator types where their day starts, waits
 * for a pause in the typing, and cancels a search the next keystroke replaces,
 * which is light use by any measure. When it does not answer, the screen says
 * so and the other three ways to set a pin still work.
 */

export const MAP_TILE_ORIGIN = "https://tiles.openfreemap.org";
export const MAP_STYLE_URL = `${MAP_TILE_ORIGIN}/styles/liberty`;

export const PLACE_SEARCH_ORIGIN = "https://photon.komoot.io";

/**
 * MapLibre's worker for a given MapLibre version, served from this origin.
 * The files are committed by `scripts/vendor-maplibre.mjs`, and `pnpm qa`
 * fails when they do not match the installed package.
 */
export function mapWorkerUrl(version: string): string {
  return `/vendor/maplibre/${version}/worker.js`;
}
