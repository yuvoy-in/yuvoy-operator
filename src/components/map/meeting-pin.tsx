"use client";

import dynamic from "next/dynamic";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ExternalIcon } from "@/components/ui/icons";
import { fieldLabelClass, inputClass } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { searchPlaces, type Place } from "@/lib/map/photon";
import {
  formatPin,
  mapsLink,
  readPinText,
  roundPin,
  type Pin,
} from "@/lib/map/pin";
import type { MapFailure } from "./pin-map";

/*
  MapLibre and its stylesheet load only here, only in the browser, and only
  when a form with a pin on it opens. A chunk that does not arrive (a dropped
  connection on a jetty) becomes "the map did not load" rather than an error
  that takes the whole step down with it.
*/
const PinMap = dynamic(
  () =>
    import("./pin-map").catch(() => ({
      default: function MapUnavailable({
        onFail,
      }: {
        onFail: (why: MapFailure) => void;
      }) {
        useEffect(() => onFail("load"), [onFail]);
        return null;
      },
    })),
  { ssr: false },
);

/** One thing to put the pin on: a place found, or the numbers typed. */
type Choice = { key: string; name: string; area: string; pin: Pin };

/** Wait for a pause in the typing before asking Photon. */
const SEARCH_PAUSE_MS = 350;
const SEARCH_MIN_LENGTH = 3;

const SAID = {
  noPlace: "No place by that name. Try another, or tap the map.",
  searchDown: "Search is not answering. Tap the map, or paste a link.",
  mapDown:
    "The map did not load. Search, paste a link or use your location instead.",
  noLocation:
    "This browser cannot share its location. Search instead, or tap the map.",
  locationOff: "Location is off for this site. Search instead, or tap the map.",
  locationLost:
    "Your location could not be found. Search instead, or tap the map.",
};

/**
 * A pin on the meeting point (yuvoy-operator#113, yuvoy-api#249).
 *
 * "Location we should add a pin" (Sai Teja, product, 29 Sep). The text fields
 * stay beside it, since "the blue boat shed" is something a pin cannot say.
 *
 * Four ways to set it, and the map is only one of them:
 * - tap or drag on the map;
 * - search for a place (Photon, see `@/lib/map/photon`);
 * - paste what a maps app shows, numbers or a link (`readPinText`);
 * - the device's own location, standing on the spot.
 *
 * So the pin can always be set without the map: no WebGL, no tiles and no
 * network to the tile host each leave the other three working, and the e2e
 * suite, which has no network, sets pins exactly that way.
 *
 * Search and the numbers typed both offer choices rather than moving the pin
 * as the text changes: a pin that jumped with every keystroke would be a pin
 * nobody chose. Enter takes the first choice, and never sends the form the
 * box sits in.
 *
 * The form gets two hidden fields, `meetingLat` and `meetingLng`: both
 * numbers, or both empty to clear (see `readPinFields`).
 */
export function MeetingPin({ initial }: { initial: Pin | null }) {
  const id = useId();
  const [pin, setPin] = useState<Pin | null>(initial);
  const [query, setQuery] = useState("");
  const [choices, setChoices] = useState<Choice[]>([]);
  const [searching, setSearching] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [map, setMap] = useState<"loading" | "ready" | "failed">("loading");
  const [locating, setLocating] = useState(false);
  const [announcement, setAnnouncement] = useState("");

  const box = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef<AbortController | null>(null);

  // A search still waiting, or still running, has nobody to answer.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      inFlight.current?.abort();
    },
    [],
  );

  function stopSearching() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    inFlight.current?.abort();
    inFlight.current = null;
    setSearching(false);
  }

  async function search(text: string) {
    const controller = new AbortController();
    inFlight.current = controller;
    setSearching(true);
    try {
      const places: Place[] = await searchPlaces(text, {
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setChoices(places.map((p, i) => ({ key: `place-${i}`, ...p })));
      setNote(places.length === 0 ? SAID.noPlace : null);
      // "Nothing found" is said once, by the note. A count has no note.
      setAnnouncement(
        places.length === 0
          ? ""
          : `${places.length} ${places.length === 1 ? "place" : "places"} found.`,
      );
    } catch {
      // Photon down, throttled or unreachable: the other ways still work.
      if (controller.signal.aborted) return;
      setChoices([]);
      setNote(SAID.searchDown);
    } finally {
      if (inFlight.current === controller) {
        inFlight.current = null;
        setSearching(false);
      }
    }
  }

  function onType(text: string) {
    setQuery(text);
    stopSearching();

    const read = readPinText(text);
    if (read && "pin" in read) {
      setChoices([
        {
          key: "numbers",
          name: `Put the pin at ${formatPin(read.pin)}`,
          area: "",
          pin: read.pin,
        },
      ]);
      setNote(null);
      return;
    }
    if (read && "problem" in read) {
      setChoices([]);
      setNote(read.problem);
      return;
    }
    setChoices([]);
    setNote(null);
    if (text.trim().length < SEARCH_MIN_LENGTH) return;
    setSearching(true);
    timer.current = setTimeout(() => {
      timer.current = null;
      void search(text);
    }, SEARCH_PAUSE_MS);
  }

  function place(at: Pin | null, said: string) {
    setPin(at ? roundPin(at) : null);
    setAnnouncement(said);
  }

  function choose(choice: Choice) {
    place(
      choice.pin,
      choice.key === "numbers"
        ? `Pin set at ${formatPin(choice.pin)}.`
        : `Pin set at ${choice.name}.`,
    );
    stopSearching();
    setChoices([]);
    setNote(null);
    if (choice.key === "numbers") setQuery("");
    // The chosen button is gone; the box is where the next move starts.
    box.current?.focus();
  }

  function locate() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setNote(SAID.noLocation);
      return;
    }
    setLocating(true);
    setNote(null);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setLocating(false);
        const at = roundPin({ lat: coords.latitude, lng: coords.longitude });
        place(at, `Pin set where you are, at ${formatPin(at)}.`);
        // A phone indoors can be a street out. Say so, so the pin gets moved.
        if (coords.accuracy > 100) {
          setNote(
            `Your location is only certain to about ${Math.round(coords.accuracy / 10) * 10} metres. Move the pin if it is off.`,
          );
        }
      },
      (error) => {
        setLocating(false);
        setNote(
          error.code === error.PERMISSION_DENIED
            ? SAID.locationOff
            : SAID.locationLost,
        );
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
    );
  }

  function remove() {
    place(null, "Pin removed.");
    setNote(null);
    // The button that was pressed is gone with the pin.
    box.current?.focus();
  }

  const searchId = `${id}-search`;
  const statusId = `${id}-status`;

  return (
    <fieldset>
      <legend className={fieldLabelClass()}>Pin on the map</legend>
      <p className="text-forest/70 mt-1 text-xs">
        Tap the map where people meet, or search for the place.
      </p>

      <input
        ref={box}
        id={searchId}
        type="search"
        aria-label="Search for a place, or paste a maps link"
        aria-describedby={statusId}
        placeholder="Search, or paste a maps link"
        autoComplete="off"
        enterKeyHint="search"
        value={query}
        onChange={(e) => onType(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            // Never the step's own submit: this box is inside its form.
            e.preventDefault();
            if (choices[0]) choose(choices[0]);
            else if (query.trim().length >= SEARCH_MIN_LENGTH) {
              stopSearching();
              void search(query);
            }
          } else if (e.key === "Escape" && choices.length > 0) {
            e.preventDefault();
            setChoices([]);
          }
        }}
        className={inputClass("mt-2")}
      />

      {/*
        What happened to the last thing typed. A note is read out when it
        appears; "Searching…" is shown and not read, or it would be read on
        every pause in the typing.
      */}
      <p
        id={statusId}
        role="status"
        className={cn(
          "text-forest/70 mt-1.5 min-h-4 text-xs",
          note && !searching && "text-terra-deep font-medium",
        )}
      >
        {searching ? <span aria-hidden="true">Searching…</span> : note}
      </p>

      {choices.length > 0 ? (
        <ul aria-label="Places" className="mt-1 space-y-1">
          {choices.map((choice) => (
            <li key={choice.key}>
              <button
                type="button"
                onClick={() => choose(choice)}
                className="rounded-control border-paper-line bg-paper hover:border-forest/40 tap-target w-full border px-4 py-2 text-left"
              >
                <span className="block text-sm font-medium">{choice.name}</span>
                {choice.area ? (
                  <span className="text-forest/70 block text-xs">
                    {choice.area}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div
        role="group"
        aria-label="Map"
        className="rounded-card border-paper-line bg-paper-deep relative mt-3 h-64 overflow-hidden border sm:h-80"
      >
        {map === "failed" ? (
          <p className="text-forest/80 flex h-full items-center justify-center p-6 text-center text-sm">
            {SAID.mapDown}
          </p>
        ) : (
          <>
            <PinMap
              pin={pin}
              onPick={(at) => place(at, "Pin moved.")}
              onReady={() => setMap("ready")}
              onFail={() => setMap("failed")}
            />
            {map === "loading" ? (
              <p className="text-forest/70 pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-sm">
                Loading the map…
              </p>
            ) : null}
          </>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        {pin ? (
          <p className="text-sm">
            Pin at <span className="tabular-nums">{formatPin(pin)}</span>.{" "}
            <a
              href={mapsLink(pin)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-forest inline-flex items-center gap-1 underline underline-offset-4"
            >
              Check it in Google Maps
              <ExternalIcon className="size-4" />
            </a>
          </p>
        ) : (
          <p className="text-forest/70 text-sm">No pin yet.</p>
        )}
      </div>

      <div className="mt-2 flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="md"
          block={false}
          onClick={locate}
          pending={locating}
          pendingLabel="Finding you…"
        >
          Use my location
        </Button>
        {pin ? (
          <Button variant="outline" size="md" block={false} onClick={remove}>
            Remove the pin
          </Button>
        ) : null}
      </div>

      {/* What the form sends: both numbers, or both empty to clear. */}
      <input
        type="hidden"
        name="meetingLat"
        value={pin ? String(pin.lat) : ""}
      />
      <input
        type="hidden"
        name="meetingLng"
        value={pin ? String(pin.lng) : ""}
      />

      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </fieldset>
  );
}
