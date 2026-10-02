/**
 * A pin on the meeting point: `meetingLat` and `meetingLng` on the operator
 * contract (yuvoy-api#249, yuvoy-operator#113).
 *
 * The contract's rules, kept here so the builder, the live edit and the form
 * that carries the pin agree on them:
 * - numbers, -90 to 90 and -180 to 180;
 * - sent together, both or neither (the API checks each number on its own,
 *   so this half is ours to keep);
 * - an explicit `null` clears a pin, and leaving the keys out leaves it alone.
 *
 * Six decimal places, because the column is `numeric(9,6)`: about 11 cm, far
 * finer than a finger on a phone, and anything more is thrown away on save.
 */

export interface Pin {
  lat: number;
  lng: number;
}

const DECIMALS = 6;

export function isPin(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

export function roundPin(pin: Pin): Pin {
  return {
    lat: Number(pin.lat.toFixed(DECIMALS)),
    lng: Number(pin.lng.toFixed(DECIMALS)),
  };
}

/** The pin a listing carries, or null when it has none or it is unreadable. */
export function pinOf(listing: {
  meetingLat?: number | null;
  meetingLng?: number | null;
}): Pin | null {
  const { meetingLat: lat, meetingLng: lng } = listing;
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  return isPin(lat, lng) ? { lat, lng } : null;
}

/**
 * Whether the API this listing came from knows about pins at all.
 *
 * Merged is not deployed (yuvoy-api's deploy has failed since 24 Sep), and an
 * API from before #249 refuses `meetingLat` as an unknown field, which would
 * refuse the whole save. An API that has it always sends the key, `null` when
 * there is no pin, so its presence is the signal and the pin is offered only
 * then. Everything else on the step works as it did either way.
 */
export function pinsSupported(listing: object): boolean {
  return "meetingLat" in listing;
}

/** Five places on screen: about a metre, and short enough to read. */
export function formatPin(pin: Pin): string {
  return `${pin.lat.toFixed(5)}, ${pin.lng.toFixed(5)}`;
}

/** A link that opens the pin in Google Maps, so an operator can check it. */
export function mapsLink(pin: Pin): string {
  return `https://www.google.com/maps/search/?api=1&query=${pin.lat},${pin.lng}`;
}

/* ------------------------------------------------- reading what is typed -- */

export type PinText =
  | { pin: Pin }
  | { problem: string }
  /** Not coordinates or a link: a place name to search for. */
  | null;

const NOT_A_PLACE =
  "Those numbers are not a place on the map. Latitude comes first, between -90 and 90.";
const SHORT_LINK =
  "A short link cannot be read here. In Google Maps, press and hold the spot, then copy the numbers it shows.";
const NO_PIN_IN_LINK =
  "That link names a place but not where it is. Search for the place here instead.";
const UNKNOWN_LINK =
  "That link cannot be read here. Paste a Google Maps link, or the numbers of the spot.";

/*
  Decimals required. Every maps app shows a position with them, and two plain
  numbers ("7 11") are far more likely the start of an address than a place
  in the sea off Africa.
*/
const NUMBER = String.raw`[-+]?\d{1,3}\.\d+`;
/** "11.9695, 92.9631", "11.9695 92.9631", "11.9695,92.9631". */
const DECIMAL_PAIR = new RegExp(
  String.raw`^\s*(${NUMBER})\s*(?:,\s*|\s+)(${NUMBER})\s*$`,
);
/** "11.9695° N, 92.9631° E", as Google Maps shows a dropped pin. */
const HEMISPHERE_PAIR =
  /^\s*(\d{1,2}(?:\.\d+)?)\s*°?\s*([NS])\s*,?\s*(\d{1,3}(?:\.\d+)?)\s*°?\s*([EW])\s*$/i;
/** `11°58'10.2"N 92°57'47.2"E`, as Google Maps on a computer shows one. */
const DMS_PAIR =
  /^\s*(\d{1,2})\s*°\s*(\d{1,2})\s*['′]\s*(\d{1,2}(?:\.\d+)?)\s*(?:["″]|'')?\s*([NS])\s*,?\s*(\d{1,3})\s*°\s*(\d{1,2})\s*['′]\s*(\d{1,2}(?:\.\d+)?)\s*(?:["″]|'')?\s*([EW])\s*$/i;

function pinOrProblem(
  lat: number,
  lng: number,
): { pin: Pin } | { problem: string } {
  return isPin(lat, lng)
    ? { pin: roundPin({ lat, lng }) }
    : { problem: NOT_A_PLACE };
}

function readNumbers(text: string): { pin: Pin } | { problem: string } | null {
  const decimal = DECIMAL_PAIR.exec(text);
  if (decimal) return pinOrProblem(Number(decimal[1]), Number(decimal[2]));

  const hemisphere = HEMISPHERE_PAIR.exec(text);
  if (hemisphere) {
    const lat = Number(hemisphere[1]) * (/s/i.test(hemisphere[2]) ? -1 : 1);
    const lng = Number(hemisphere[3]) * (/w/i.test(hemisphere[4]) ? -1 : 1);
    return pinOrProblem(lat, lng);
  }

  const dms = DMS_PAIR.exec(text);
  if (dms) {
    const part = (d: string, m: string, s: string) =>
      Number(d) + Number(m) / 60 + Number(s) / 3600;
    const lat = part(dms[1], dms[2], dms[3]) * (/s/i.test(dms[4]) ? -1 : 1);
    const lng = part(dms[5], dms[6], dms[7]) * (/w/i.test(dms[8]) ? -1 : 1);
    return pinOrProblem(lat, lng);
  }
  return null;
}

/** Hosts whose links carry a position this file knows how to read. */
function mapHost(host: string): "google" | "apple" | "osm" | "short" | null {
  const h = host.toLowerCase().replace(/^www\./, "");
  if (h === "maps.app.goo.gl" || h === "goo.gl" || h === "g.co") {
    return "short";
  }
  if (/^(maps\.)?google\.[a-z.]+$/.test(h)) return "google";
  if (h === "maps.apple.com") return "apple";
  if (h === "openstreetmap.org" || h === "osm.org") return "osm";
  return null;
}

function readLink(url: URL): { pin: Pin } | { problem: string } {
  const host = mapHost(url.hostname);
  if (host === "short") return { problem: SHORT_LINK };
  if (!host) return { problem: UNKNOWN_LINK };

  let decoded = url.href;
  try {
    decoded = decodeURIComponent(url.href);
  } catch {
    // A stray % in a pasted link: read it as it is.
  }

  if (host === "google") {
    // The place itself, which a /place/ link carries in its data blob. Read
    // first: the @ that also appears is where the map was looking, which can
    // be a street away.
    const place = /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/.exec(decoded);
    if (place) return pinOrProblem(Number(place[1]), Number(place[2]));
  }

  for (const key of ["q", "query", "ll", "sll", "center", "destination"]) {
    const value = url.searchParams.get(key);
    if (value) {
      const read = readNumbers(value);
      if (read) return read;
    }
  }

  if (host === "osm") {
    const mlat = url.searchParams.get("mlat");
    const mlon = url.searchParams.get("mlon");
    if (mlat && mlon) return pinOrProblem(Number(mlat), Number(mlon));
    const hash = /map=\d+(?:\.\d+)?\/(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)/.exec(
      url.hash,
    );
    if (hash) return pinOrProblem(Number(hash[1]), Number(hash[2]));
  }

  if (host === "google") {
    const view = /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(decoded);
    if (view) return pinOrProblem(Number(view[1]), Number(view[2]));
  }

  return { problem: NO_PIN_IN_LINK };
}

/**
 * What was typed into the search box, read as a position if it is one.
 *
 * Coordinates in the three shapes maps apps show them, a `geo:` link, and
 * links from Google Maps, Apple Maps and OpenStreetMap. A short link
 * (`maps.app.goo.gl`, which is what Google Maps' Share gives on a phone) is
 * refused with how to get the numbers instead: reading one means following
 * Google's redirect from our server, which is a request to a third party on
 * an operator's behalf that this screen does not need to make.
 *
 * Returns null for anything else, which is a place name to search for.
 */
export function readPinText(text: string): PinText {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const geo = /^geo:\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/i.exec(
    trimmed,
  );
  if (geo) return pinOrProblem(Number(geo[1]), Number(geo[2]));

  if (/^https?:\/\//i.test(trimmed) || /^(www\.|maps\.)/i.test(trimmed)) {
    let url: URL;
    try {
      url = new URL(/^https?:/i.test(trimmed) ? trimmed : `https://${trimmed}`);
    } catch {
      return { problem: UNKNOWN_LINK };
    }
    return readLink(url);
  }

  return readNumbers(trimmed);
}

/* ------------------------------------------------- what a form carries -- */

export type PinField =
  /** The form had no pin on it: leave the listing's pin alone. */
  | { kind: "absent" }
  | { kind: "set"; lat: number; lng: number }
  | { kind: "clear" }
  | { kind: "invalid"; message: string };

/**
 * The pin a submitted form carries, by the contract's rules.
 *
 * Both fields empty is a clearing, which the API takes as explicit nulls.
 * One without the other, or numbers off the map, is refused here: the API
 * would take one coordinate on its own, and a pin with half a position is
 * worse than none.
 */
export function readPinFields(form: FormData): PinField {
  if (!form.has("meetingLat") && !form.has("meetingLng")) {
    return { kind: "absent" };
  }
  const lat = String(form.get("meetingLat") ?? "").trim();
  const lng = String(form.get("meetingLng") ?? "").trim();
  if (!lat && !lng) return { kind: "clear" };

  const pin = { lat: Number(lat), lng: Number(lng) };
  if (!lat || !lng || !isPin(pin.lat, pin.lng)) {
    return {
      kind: "invalid",
      message:
        "That pin is not a place on the map. Set it again, or remove it.",
    };
  }
  return { kind: "set", ...roundPin(pin) };
}
