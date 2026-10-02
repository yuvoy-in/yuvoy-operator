"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useEffectEvent, useRef } from "react";
import type { Map as MapLibreMap, Marker } from "maplibre-gl";
import { MAP_STYLE_URL, mapWorkerUrl } from "@/lib/map/hosts";
import type { Pin } from "@/lib/map/pin";

/**
 * The map under the meeting-point pin (yuvoy-operator#113): MapLibre on
 * OpenFreeMap's tiles, loaded only in the browser and only when this
 * component mounts (`MeetingPin` imports it lazily), so no other screen
 * carries it.
 *
 * Tap the map to put the pin there, or drag the pin. The first tap at the
 * islands' scale also zooms in on it, because a pin dropped from that far up
 * is a few hundred metres either way and the next move should be the fine one.
 *
 * Cooperative gestures, so a phone scrolling the form does not pan the map by
 * accident: one finger scrolls the page, two move the map, and a tap still
 * drops the pin. Rotation and pitch are off; a meeting point is found on a
 * flat, north-up map.
 *
 * Every way this can fail ends in `onFail` and nothing thrown: the library
 * not loading, no WebGL, and the style not arriving. `MeetingPin` then says so and the other ways to set a pin
 * carry on.
 */

/** Where the map opens with no pin: the islands this portal sells in today. */
const ISLANDS: [number, number] = [92.85, 11.8];
const ISLANDS_ZOOM = 8.5;
/** Close enough to see a jetty and a beach hut apart. */
const PIN_ZOOM = 15;
/** Below this the map is still showing islands, not places. */
const PLACE_SCALE = 12;

export type MapFailure = "load" | "webgl" | "style";

export default function PinMap({
  pin,
  onPick,
  onReady,
  onFail,
}: {
  pin: Pin | null;
  onPick: (pin: Pin) => void;
  onReady: () => void;
  onFail: (why: MapFailure) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const marker = useRef<Marker | null>(null);

  const pick = useEffectEvent((at: Pin) => onPick(at));
  const ready = useEffectEvent(() => onReady());
  const fail = useEffectEvent((why: MapFailure) => onFail(why));
  // The pin as it is when the map is first drawn, which may have moved while
  // the library was loading.
  const startingPin = useEffectEvent(() => pin);

  useEffect(() => {
    let cancelled = false;
    let styled = false;

    (async () => {
      let lib: typeof import("maplibre-gl");
      try {
        lib = await import("maplibre-gl");
      } catch {
        if (!cancelled) fail("load");
        return;
      }
      if (cancelled || !box.current) return;

      // See scripts/vendor-maplibre.mjs for why the worker is ours to serve.
      lib.setWorkerUrl(mapWorkerUrl(lib.getVersion()));

      const start = startingPin();
      let created: MapLibreMap;
      try {
        created = new lib.Map({
          container: box.current,
          style: MAP_STYLE_URL,
          center: start ? [start.lng, start.lat] : ISLANDS,
          zoom: start ? PIN_ZOOM : ISLANDS_ZOOM,
          attributionControl: { compact: false },
          cooperativeGestures: true,
          dragRotate: false,
          pitchWithRotate: false,
          touchPitch: false,
          maxPitch: 0,
        });
      } catch {
        // No WebGL, or a context the browser would not give.
        fail("webgl");
        return;
      }
      map.current = created;
      created.touchZoomRotate.disableRotation();
      created.keyboard.disableRotation();
      created.addControl(
        new lib.NavigationControl({ showCompass: false }),
        "top-right",
      );

      created.on("load", () => ready());
      /*
        Only the style not arriving is a map that failed. Once it has, an
        error is one tile, sprite or glyph that did not come, which on an
        island connection is a gap in one square: the map draws the rest and
        the pin still works on it.
      */
      created.on("styledata", () => {
        styled = true;
      });
      created.on("error", () => {
        if (!styled) fail("style");
      });
      created.on("click", (e) => {
        pick({ lat: e.lngLat.lat, lng: e.lngLat.lng });
      });

      const pinMarker = new lib.Marker({
        element: pinElement(),
        draggable: true,
        anchor: "bottom",
      });
      pinMarker.on("dragend", () => {
        const at = pinMarker.getLngLat();
        pick({ lat: at.lat, lng: at.lng });
      });
      marker.current = pinMarker;
      if (start) pinMarker.setLngLat([start.lng, start.lat]).addTo(created);
    })();

    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
      marker.current = null;
    };
  }, []);

  // Follow the pin when it is set another way: a search, a pasted link, the
  // device's location, or removing it.
  useEffect(() => {
    const drawnMap = map.current;
    const pinMarker = marker.current;
    if (!drawnMap || !pinMarker) return;
    if (!pin) {
      pinMarker.remove();
      return;
    }
    pinMarker.setLngLat([pin.lng, pin.lat]).addTo(drawnMap);
    const inView = drawnMap.getBounds().contains([pin.lng, pin.lat]);
    if (!inView || drawnMap.getZoom() < PLACE_SCALE) {
      drawnMap.easeTo({
        center: [pin.lng, pin.lat],
        zoom: Math.max(drawnMap.getZoom(), PIN_ZOOM),
      });
    }
  }, [pin]);

  /*
    Full size rather than absolutely placed: MapLibre's own stylesheet gives
    its container `position: relative`, unlayered, which outranks Tailwind's
    layered `absolute` and would leave the map zero pixels tall.
  */
  return <div ref={box} className="h-full w-full" />;
}

/**
 * The pin itself: the system's terracotta, outlined in paper so it reads on
 * water, sand and road alike. Built as an element because MapLibre places it.
 */
function pinElement(): HTMLElement {
  const element = document.createElement("div");
  element.className = "cursor-grab active:cursor-grabbing";
  element.innerHTML =
    '<svg viewBox="0 0 24 32" width="30" height="40" aria-hidden="true" focusable="false">' +
    '<path d="M12 31s10-10.6 10-18.5A10 10 0 0 0 2 12.5C2 20.4 12 31 12 31Z" class="fill-terra-deep stroke-paper" stroke-width="1.5"/>' +
    '<circle cx="12" cy="12.5" r="3.5" class="fill-paper"/>' +
    "</svg>";
  return element;
}
