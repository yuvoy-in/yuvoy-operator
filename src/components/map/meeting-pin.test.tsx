import { afterEach, describe, expect, it, vi } from "vitest";
import { useEffect } from "react";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Pin } from "@/lib/map/pin";

/*
  yuvoy-operator#113. The map is one of four ways to set the pin, and the
  only one that needs WebGL, the tile host and a network to it. These drive
  the other three, and stand the map in with a stub that can tap, fail and
  report ready, the way MapLibre would.
*/

const searchPlaces = vi.fn();
vi.mock("@/lib/map/photon", () => ({
  searchPlaces: (q: string, o: unknown) => searchPlaces(q, o),
  PlaceSearchError: class extends Error {},
}));

let mapPin: Pin | null = null;
vi.mock("next/dynamic", () => ({
  default: () =>
    function MapStub({
      pin,
      onPick,
      onReady,
      onFail,
    }: {
      pin: Pin | null;
      onPick: (p: Pin) => void;
      onReady: () => void;
      onFail: (why: string) => void;
    }) {
      mapPin = pin;
      useEffect(() => onReady(), [onReady]);
      return (
        <>
          <button
            type="button"
            onClick={() => onPick({ lat: 11.97000049, lng: 92.98 })}
          >
            Tap the map
          </button>
          <button type="button" onClick={() => onFail("style")}>
            Lose the tiles
          </button>
        </>
      );
    },
}));

const { MeetingPin } = await import("./meeting-pin");

const submitted = vi.fn((e: { preventDefault: () => void }) =>
  e.preventDefault(),
);

function renderPin(initial: Pin | null = null) {
  return render(
    <form onSubmit={submitted}>
      <MeetingPin initial={initial} />
    </form>,
  );
}

function sent() {
  const form = document.querySelector("form")!;
  const data = new FormData(form);
  return { lat: data.get("meetingLat"), lng: data.get("meetingLng") };
}

const box = () =>
  screen.getByRole("searchbox", {
    name: "Search for a place, or paste a maps link",
  });

afterEach(() => {
  searchPlaces.mockReset();
  submitted.mockClear();
  mapPin = null;
  vi.unstubAllGlobals();
});

describe("the meeting-point pin", () => {
  it("starts empty, and sends both fields empty", () => {
    renderPin();
    expect(
      screen.getByRole("group", { name: "Pin on the map" }),
    ).toBeInTheDocument();
    expect(screen.getByText("No pin yet.")).toBeInTheDocument();
    expect(sent()).toEqual({ lat: "", lng: "" });
    expect(screen.queryByRole("button", { name: "Remove the pin" })).toBeNull();
  });

  it("shows a pin on file, with a way to check it", () => {
    renderPin({ lat: 11.9695, lng: 92.9631 });
    expect(screen.getByText("11.96950, 92.96310")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Check it in Google Maps/ }),
    ).toHaveAttribute(
      "href",
      "https://www.google.com/maps/search/?api=1&query=11.9695,92.9631",
    );
    // Exactly the numbers on file, so an untouched pin is never "changed".
    expect(sent()).toEqual({ lat: "11.9695", lng: "92.9631" });
    expect(mapPin).toEqual({ lat: 11.9695, lng: 92.9631 });
  });

  it("offers typed numbers as a choice, and Enter takes it without sending the form", async () => {
    const user = userEvent.setup();
    renderPin();

    await user.type(box(), "11.9695, 92.9631");
    expect(
      screen.getByRole("button", { name: /Put the pin at 11.96950, 92.96310/ }),
    ).toBeInTheDocument();
    // Not yet: nothing moves until it is chosen.
    expect(sent()).toEqual({ lat: "", lng: "" });

    await user.keyboard("{Enter}");

    expect(submitted).not.toHaveBeenCalled();
    expect(sent()).toEqual({ lat: "11.9695", lng: "92.9631" });
    expect(box()).toHaveValue("");
    expect(box()).toHaveFocus();
    expect(searchPlaces).not.toHaveBeenCalled();
  });

  it("reads a pasted Google Maps link", async () => {
    const user = userEvent.setup();
    renderPin();

    await user.click(box());
    await user.paste("https://www.google.com/maps/@11.9695,92.9631,15z");
    await user.click(
      screen.getByRole("button", { name: /Put the pin at 11.96950, 92.96310/ }),
    );

    expect(sent()).toEqual({ lat: "11.9695", lng: "92.9631" });
  });

  it("says how to use a short link instead of guessing", async () => {
    const user = userEvent.setup();
    renderPin();

    await user.click(box());
    await user.paste("https://maps.app.goo.gl/AbCdEf12345");

    expect(screen.getByRole("status")).toHaveTextContent(
      /short link cannot be read here/,
    );
    expect(screen.queryByRole("list", { name: "Places" })).toBeNull();
  });

  it("searches after a pause, and a place found becomes the pin", async () => {
    searchPlaces.mockResolvedValue([
      {
        name: "Havelock island",
        area: "South Andaman, India",
        pin: { lat: 11.965195, lng: 92.995621 },
      },
    ]);
    const user = userEvent.setup();
    renderPin();

    await user.type(box(), "havelock");
    const place = await screen.findByRole("button", {
      name: /Havelock island/,
    });
    expect(searchPlaces).toHaveBeenCalledTimes(1);
    expect(searchPlaces.mock.calls[0][0]).toBe("havelock");

    await user.click(place);

    expect(sent()).toEqual({ lat: "11.965195", lng: "92.995621" });
    expect(screen.getByText("Pin set at Havelock island.")).toBeInTheDocument();
    expect(box()).toHaveFocus();
  });

  it("does not search two letters", async () => {
    const user = userEvent.setup();
    renderPin();
    await user.type(box(), "ha");
    await new Promise((r) => setTimeout(r, 450));
    expect(searchPlaces).not.toHaveBeenCalled();
  });

  it("says when nothing was found, and when search is down", async () => {
    const user = userEvent.setup();
    renderPin();

    searchPlaces.mockResolvedValueOnce([]);
    await user.type(box(), "zzzz");
    expect(await screen.findByText(/No place by that name/)).toBeVisible();

    searchPlaces.mockRejectedValueOnce(new Error("down"));
    await user.type(box(), "z");
    expect(await screen.findByText(/Search is not answering/)).toBeVisible();
  });

  it("removes the pin, and sends both fields empty", async () => {
    const user = userEvent.setup();
    renderPin({ lat: 11.9695, lng: 92.9631 });

    await user.click(screen.getByRole("button", { name: "Remove the pin" }));

    expect(sent()).toEqual({ lat: "", lng: "" });
    expect(screen.getByText("No pin yet.")).toBeInTheDocument();
    expect(screen.getByText("Pin removed.")).toBeInTheDocument();
    expect(box()).toHaveFocus();
  });

  it("puts the pin where a tap on the map was, to six places", async () => {
    const user = userEvent.setup();
    renderPin();
    await user.click(screen.getByRole("button", { name: "Tap the map" }));
    expect(sent()).toEqual({ lat: "11.97", lng: "92.98" });
    expect(screen.getByText("Pin moved.")).toBeInTheDocument();
  });

  it("carries on without the map when it fails", async () => {
    const user = userEvent.setup();
    renderPin();

    await user.click(screen.getByRole("button", { name: "Lose the tiles" }));

    expect(
      screen.getByText(
        "The map did not load. Search, paste a link or use your location instead.",
      ),
    ).toBeInTheDocument();
    await user.type(box(), "11.9695, 92.9631{Enter}");
    expect(sent()).toEqual({ lat: "11.9695", lng: "92.9631" });
  });
});

describe("Use my location", () => {
  function geolocation(
    run: (
      ok: (p: { coords: Partial<GeolocationCoordinates> }) => void,
      fail: (e: Partial<GeolocationPositionError>) => void,
    ) => void,
  ) {
    vi.stubGlobal("navigator", {
      ...navigator,
      geolocation: {
        getCurrentPosition: (
          ok: (p: { coords: Partial<GeolocationCoordinates> }) => void,
          fail: (e: Partial<GeolocationPositionError>) => void,
        ) => run(ok, fail),
      },
    });
  }

  it("puts the pin where the operator is standing", async () => {
    geolocation((ok) =>
      ok({
        coords: { latitude: 11.96951234, longitude: 92.9631, accuracy: 12 },
      }),
    );
    const user = userEvent.setup();
    renderPin();

    await user.click(screen.getByRole("button", { name: "Use my location" }));

    expect(sent()).toEqual({ lat: "11.969512", lng: "92.9631" });
    expect(screen.queryByRole("status")).toHaveTextContent("");
  });

  it("says when the location is rough", async () => {
    geolocation((ok) =>
      ok({ coords: { latitude: 11.9695, longitude: 92.9631, accuracy: 640 } }),
    );
    const user = userEvent.setup();
    renderPin();

    await user.click(screen.getByRole("button", { name: "Use my location" }));

    expect(screen.getByRole("status")).toHaveTextContent(
      "Your location is only certain to about 640 metres. Move the pin if it is off.",
    );
  });

  it("says when location is off, and when it cannot be found", async () => {
    const user = userEvent.setup();
    renderPin();

    geolocation((_ok, fail) => fail({ code: 1, PERMISSION_DENIED: 1 }));
    await user.click(screen.getByRole("button", { name: "Use my location" }));
    expect(screen.getByRole("status")).toHaveTextContent(
      "Location is off for this site.",
    );

    geolocation((_ok, fail) => fail({ code: 3, PERMISSION_DENIED: 1 }));
    await user.click(screen.getByRole("button", { name: "Use my location" }));
    expect(screen.getByRole("status")).toHaveTextContent(
      "Your location could not be found.",
    );
    expect(sent()).toEqual({ lat: "", lng: "" });
  });

  it("says when the browser has no location to share", async () => {
    vi.stubGlobal("navigator", { ...navigator, geolocation: undefined });
    const user = userEvent.setup();
    renderPin();

    await act(async () => {
      await user.click(screen.getByRole("button", { name: "Use my location" }));
    });

    expect(screen.getByRole("status")).toHaveTextContent(
      "This browser cannot share its location.",
    );
  });
});
