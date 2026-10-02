import { afterEach, describe, expect, it, vi } from "vitest";
import { PlaceSearchError, searchPlaces } from "./photon";

/*
  Place search for the pin (yuvoy-operator#113). The answer below is the
  shape Photon gave on 2 Oct 2026 for "havelock", trimmed.
*/
const ISLAND = {
  type: "Feature",
  geometry: { type: "Point", coordinates: [92.9956211, 11.9651954] },
  properties: {
    name: "Havelock island",
    city: "Vijay Nagar",
    county: "South Andaman",
    state: "Andaman and Nicobar Islands",
    country: "India",
    osm_value: "island",
  },
};

function answer(body: unknown, status = 200) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
}

afterEach(() => vi.restoreAllMocks());

describe("searchPlaces", () => {
  it("asks Photon, leaning hard towards the islands", async () => {
    const fetch = answer({ type: "FeatureCollection", features: [ISLAND] });

    await searchPlaces("  havelock ");

    const url = new URL(String(fetch.mock.calls[0][0]));
    expect(url.origin).toBe("https://photon.komoot.io");
    expect(url.pathname).toBe("/api/");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      q: "havelock",
      limit: "5",
      lang: "en",
      lat: "11.97",
      lon: "92.98",
      zoom: "9",
      location_bias_scale: "0.1",
    });
  });

  it("reads each place's name, where it is and its pin", async () => {
    answer({ features: [ISLAND] });
    expect(await searchPlaces("havelock")).toEqual([
      {
        name: "Havelock island",
        area: "Vijay Nagar, South Andaman, Andaman and Nicobar Islands, India",
        pin: { lat: 11.965195, lng: 92.995621 },
      },
    ]);
  });

  it("names a place with no name by its street", async () => {
    answer({
      features: [
        {
          geometry: { type: "Point", coordinates: [92.97, 11.97] },
          properties: {
            street: "Jetty Road",
            housenumber: "4",
            country: "India",
          },
        },
      ],
    });
    expect((await searchPlaces("jetty road"))[0].name).toBe("Jetty Road 4");
  });

  it("skips what cannot be a place, and the same place twice", async () => {
    answer({
      features: [
        ISLAND,
        ISLAND,
        { geometry: { type: "LineString", coordinates: [[1, 2]] } },
        { geometry: { type: "Point", coordinates: [200, 95] }, properties: {} },
        { geometry: { type: "Point", coordinates: [92.9, 11.9] } },
      ],
    });
    expect(await searchPlaces("havelock")).toHaveLength(1);
  });

  it("finds nothing without failing", async () => {
    answer({ type: "FeatureCollection", features: [] });
    expect(await searchPlaces("zzzz")).toEqual([]);
  });

  it("fails as a search failure when Photon does not answer usefully", async () => {
    answer({ message: "throttled" }, 429);
    await expect(searchPlaces("havelock")).rejects.toBeInstanceOf(
      PlaceSearchError,
    );

    answer({ unexpected: true });
    await expect(searchPlaces("havelock")).rejects.toBeInstanceOf(
      PlaceSearchError,
    );

    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new TypeError("Failed to fetch"),
    );
    await expect(searchPlaces("havelock")).rejects.toBeInstanceOf(
      PlaceSearchError,
    );
  });

  it("lets a cancelled search stay cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new DOMException("Aborted", "AbortError"),
    );
    await expect(
      searchPlaces("havelock", { signal: controller.signal }),
    ).rejects.toHaveProperty("name", "AbortError");
  });
});
