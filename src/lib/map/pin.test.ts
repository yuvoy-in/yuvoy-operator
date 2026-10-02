import { describe, expect, it } from "vitest";
import {
  formatPin,
  isPin,
  mapsLink,
  pinOf,
  pinsSupported,
  readPinFields,
  readPinText,
  roundPin,
} from "./pin";

/*
  yuvoy-operator#113. A pin is set by a tap on the map, a search, the device's
  location, or by pasting what a maps app shows. The last is the one with the
  most ways to be misread.
*/

const JETTY = { lat: 11.9695, lng: 92.9631 };

describe("readPinText: numbers", () => {
  it.each([
    "11.9695, 92.9631",
    "11.9695,92.9631",
    "11.9695 92.9631",
    "  11.9695 ,  92.9631  ",
    "11.969500, 92.963100",
  ])("reads %s", (text) => {
    expect(readPinText(text)).toEqual({ pin: JETTY });
  });

  it("reads south and west as negative", () => {
    expect(readPinText("-33.8688, -70.6693")).toEqual({
      pin: { lat: -33.8688, lng: -70.6693 },
    });
    expect(readPinText("33.8688° S, 151.2093° E")).toEqual({
      pin: { lat: -33.8688, lng: 151.2093 },
    });
  });

  it("reads the hemisphere form Google Maps shows on a phone", () => {
    expect(readPinText("11.9695° N, 92.9631° E")).toEqual({ pin: JETTY });
    expect(readPinText("11.9695 N 92.9631 E")).toEqual({ pin: JETTY });
  });

  it("reads degrees, minutes and seconds, as on a computer", () => {
    const read = readPinText(`11°58'10.2"N 92°57'47.2"E`);
    expect(read).toEqual({ pin: { lat: 11.9695, lng: 92.963111 } });
  });

  it("says when the numbers are the wrong way round or off the map", () => {
    for (const text of ["92.9631, 11.9695", "91.5, 10.5", "10.5, 181.5"]) {
      expect(readPinText(text)).toEqual({
        problem: expect.stringMatching(/Latitude comes first/),
      });
    }
  });

  it("leaves plain numbers and words to the search", () => {
    for (const text of ["7 11", "Beach 3", "Havelock jetty", "", "   "]) {
      expect(readPinText(text)).toBeNull();
    }
  });
});

describe("readPinText: links", () => {
  it("reads the place in a Google Maps place link, not where the map looked", () => {
    expect(
      readPinText(
        "https://www.google.com/maps/place/Havelock+Jetty/@11.9701,92.9702,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d11.9695!4d92.9631!16s",
      ),
    ).toEqual({ pin: JETTY });
  });

  it.each([
    "https://www.google.com/maps/@11.9695,92.9631,15z",
    "https://www.google.co.in/maps/@11.9695,92.9631,15z",
    "https://maps.google.com/?q=11.9695,92.9631",
    "https://www.google.com/maps/search/?api=1&query=11.9695,92.9631",
    "https://www.google.com/maps/dir/?api=1&destination=11.9695,92.9631",
    "maps.google.com/?q=11.9695,92.9631",
    "https://maps.apple.com/?ll=11.9695,92.9631&q=Jetty",
    "https://www.openstreetmap.org/?mlat=11.9695&mlon=92.9631#map=17/11.97/92.97",
    "https://www.openstreetmap.org/#map=17/11.9695/92.9631",
    "geo:11.9695,92.9631?q=11.9695,92.9631(Jetty)",
  ])("reads %s", (link) => {
    expect(readPinText(link)).toEqual({ pin: JETTY });
  });

  it("reads back the link it gives an operator to check with", () => {
    expect(readPinText(mapsLink(JETTY))).toEqual({ pin: JETTY });
  });

  it("explains a short link instead of following it", () => {
    for (const link of [
      "https://maps.app.goo.gl/AbCdEf12345",
      "https://goo.gl/maps/xyz",
    ]) {
      expect(readPinText(link)).toEqual({
        problem: expect.stringMatching(/short link.*press and hold/),
      });
    }
  });

  it("says when a link names a place but no position", () => {
    expect(
      readPinText("https://www.google.com/maps/place/Havelock+Jetty"),
    ).toEqual({ problem: expect.stringMatching(/names a place/) });
  });

  it("refuses a link from anywhere else", () => {
    expect(readPinText("https://example.com/?q=11.9695,92.9631")).toEqual({
      problem: expect.stringMatching(/cannot be read here/),
    });
  });

  it("survives a malformed link", () => {
    expect(
      readPinText("https://www.google.com/maps/@11.9695,92.9631,15z%E0%A4%A"),
    ).toEqual({ pin: JETTY });
  });
});

describe("the pin's own rules", () => {
  it("keeps six places, as the column does", () => {
    expect(roundPin({ lat: 11.96950049, lng: 92.96310051 })).toEqual({
      lat: 11.9695,
      lng: 92.963101,
    });
  });

  it("knows the edges of the map", () => {
    expect(isPin(90, 180)).toBe(true);
    expect(isPin(-90, -180)).toBe(true);
    expect(isPin(90.1, 0)).toBe(false);
    expect(isPin(0, -180.1)).toBe(false);
    expect(isPin(Number.NaN, 0)).toBe(false);
  });

  it("shows five places and links to Google Maps", () => {
    expect(formatPin(JETTY)).toBe("11.96950, 92.96310");
    expect(mapsLink(JETTY)).toBe(
      "https://www.google.com/maps/search/?api=1&query=11.9695,92.9631",
    );
  });

  it("reads a listing's pin, and only a whole one", () => {
    expect(pinOf({ meetingLat: 11.9695, meetingLng: 92.9631 })).toEqual(JETTY);
    expect(pinOf({ meetingLat: null, meetingLng: null })).toBeNull();
    expect(pinOf({ meetingLat: 11.9695 })).toBeNull();
    expect(pinOf({})).toBeNull();
  });

  it("offers a pin only where the API sends the key", () => {
    // `null` is an API that knows pins and has none; absent is one from
    // before yuvoy-api#249, which would refuse the field.
    expect(pinsSupported({ meetingLat: null })).toBe(true);
    expect(pinsSupported({ meetingPoint: "Jetty" })).toBe(false);
  });
});

function fields(entries: Record<string, string | undefined>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) {
    if (v !== undefined) f.set(k, v);
  }
  return f;
}

describe("readPinFields", () => {
  it("leaves the pin alone when the form had none", () => {
    expect(readPinFields(fields({ meetingPoint: "Jetty" }))).toEqual({
      kind: "absent",
    });
  });

  it("clears with both empty", () => {
    expect(readPinFields(fields({ meetingLat: "", meetingLng: "" }))).toEqual({
      kind: "clear",
    });
  });

  it("sets both, rounded", () => {
    expect(
      readPinFields(
        fields({ meetingLat: "11.96950049", meetingLng: "92.9631" }),
      ),
    ).toEqual({ kind: "set", lat: 11.9695, lng: 92.9631 });
  });

  it("refuses half a pin and a pin off the map", () => {
    for (const entries of [
      { meetingLat: "11.9695", meetingLng: "" },
      { meetingLat: "", meetingLng: "92.9631" },
      { meetingLat: "11.9695" },
      { meetingLat: "95", meetingLng: "92.9631" },
      { meetingLat: "north", meetingLng: "east" },
    ]) {
      expect(readPinFields(fields(entries))).toEqual({
        kind: "invalid",
        message:
          "That pin is not a place on the map. Set it again, or remove it.",
      });
    }
  });
});
