import { fetchWithin } from "@/lib/api/deadline";
import { PLACE_SEARCH_ORIGIN } from "./hosts";
import { isPin, roundPin, type Pin } from "./pin";

/**
 * Place search for the meeting-point pin, through Photon (yuvoy-operator#113).
 * Terms and why it is used: `./hosts`.
 *
 * Called from the browser, not through our server: the operator's own
 * connection asks komoot, so every operator's searches do not arrive from one
 * of our addresses, and nothing about the business goes with them, only what
 * was typed.
 */

export interface Place {
  /** The place's own name, or its street when it has none. */
  name: string;
  /** Where it is: town, district, state, country, without repeats. */
  area: string;
  pin: Pin;
}

/**
 * Where results lean towards. Every destination this portal sells is in the
 * Andaman Islands today, and without a strong lean "Havelock" answers with
 * towns in North Carolina and Iowa before the island (checked 2 Oct 2026).
 * `zoom` 9 widens the lean to the islands rather than a few streets, and a
 * low `location_bias_scale` weighs nearness over fame.
 */
const LEAN = {
  lat: "11.97",
  lon: "92.98",
  zoom: "9",
  location_bias_scale: "0.1",
};

export class PlaceSearchError extends Error {}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** One GeoJSON feature as a place, or null when it cannot be one. */
function placeOf(feature: unknown): Place | null {
  const f = (feature ?? {}) as {
    geometry?: { type?: unknown; coordinates?: unknown };
    properties?: Record<string, unknown>;
  };
  const coords = f.geometry?.coordinates;
  if (f.geometry?.type !== "Point" || !Array.isArray(coords)) return null;
  const [lng, lat] = coords;
  if (typeof lat !== "number" || typeof lng !== "number" || !isPin(lat, lng)) {
    return null;
  }

  const p = f.properties ?? {};
  const street = [text(p.street), text(p.housenumber)]
    .filter(Boolean)
    .join(" ");
  const name = text(p.name) ?? (street || text(p.city) || text(p.county));
  if (!name) return null;

  const area: string[] = [];
  for (const part of [p.city, p.district, p.county, p.state, p.country]) {
    const t = text(part);
    if (t && t !== name && !area.includes(t)) area.push(t);
  }
  return { name, area: area.join(", "), pin: roundPin({ lat, lng }) };
}

/*
  A search that has heard nothing for this long is not going to answer, and is
  reported as one that did not (production readiness, 6 Oct 2026). Without it
  the field said "Searching" until the next keystroke, which on a dock may
  never come. Five places are a few kilobytes; on a link that is still alive
  the gaps are well under a second.
*/
const PLACE_SEARCH_STALL_MS = 8_000;

/**
 * Up to five places for what was typed.
 *
 * Throws `PlaceSearchError` when Photon does not answer usefully, and lets an
 * abort through as itself, so a search replaced by the next keystroke is not
 * reported as a failure.
 */
export async function searchPlaces(
  query: string,
  { signal }: { signal?: AbortSignal } = {},
): Promise<Place[]> {
  const params = new URLSearchParams({
    q: query.trim(),
    limit: "5",
    lang: "en",
    ...LEAN,
  });
  let response: Response;
  try {
    response = await fetchWithin(
      `${PLACE_SEARCH_ORIGIN}/api/?${params}`,
      { signal, headers: { accept: "application/json" } },
      PLACE_SEARCH_STALL_MS,
    );
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new PlaceSearchError("no answer");
  }
  if (!response.ok) throw new PlaceSearchError(`answered ${response.status}`);

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new PlaceSearchError("not JSON");
  }
  const features = (body as { features?: unknown })?.features;
  if (!Array.isArray(features)) throw new PlaceSearchError("not a place list");

  const seen = new Set<string>();
  const places: Place[] = [];
  for (const feature of features) {
    const place = placeOf(feature);
    if (!place) continue;
    // The same place found twice (a node and its building) is one choice.
    const key = `${place.name}|${place.pin.lat.toFixed(4)}|${place.pin.lng.toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    places.push(place);
  }
  return places;
}
