import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ChromeProvider } from "./chrome-context";
import { KeptOnThisPhone } from "./kept-on-this-phone";
import { offlineWrites, replayWrites } from "@/lib/site/offline-writes";
import { SETTLE_MS } from "@/components/ui/use-online";

/*
  The strip on a departure's screens with no signal (boarding mode, operator
  experiment D): what is kept on this phone, that it is going, when it went,
  and who had already been done from somewhere else. It never lies.
*/

const TAPPED = Date.parse("2026-10-04T01:00:00Z"); // 06:30 in the market
let online = true;

beforeEach(() => {
  online = true;
  vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
  offlineWrites.forget();
});
afterEach(() => vi.restoreAllMocks());

function screenFor(userId = "usr_owner") {
  return render(
    <ChromeProvider identity={{ businessName: null, canManage: true, userId }}>
      <KeptOnThisPhone
        slotId="slot_dawn"
        timezone="Asia/Kolkata"
        names={{ bkg_asha: "Asha Menon", bkg_daniel: "Daniel Okafor" }}
      >
        {/* A plain anchor: Next's Link renders one, and the hold is on it. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/today/slot_dawn">Done boarding</a>
        <a href="tel:+918121657657">Call Yuvoy</a>
      </KeptOnThisPhone>
    </ChromeProvider>,
  );
}

function goOffline() {
  online = false;
  act(() => {
    window.dispatchEvent(new Event("offline"));
  });
}

function goOnline() {
  online = true;
  act(() => {
    window.dispatchEvent(new Event("online"));
  });
}

/** Long enough for a change of signal to be said (`useSettledOnline`). */
function settle() {
  act(() => {
    vi.advanceTimersByTime(SETTLE_MS);
  });
}

function keep() {
  act(() => {
    offlineWrites.add({
      kind: "arrived",
      userId: "usr_owner",
      slotId: "slot_dawn",
      bookingId: "bkg_asha",
      at: TAPPED,
    });
    offlineWrites.add({
      kind: "cash",
      userId: "usr_owner",
      slotId: "slot_dawn",
      bookingId: "bkg_daniel",
      at: TAPPED,
      mode: "fare",
      amount: "",
      amountPaise: 900_000,
    });
  });
}

describe("with no signal", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("says what it does with no signal before anything is kept", () => {
    screenFor();
    goOffline();
    settle();
    expect(screen.getByRole("status")).toHaveTextContent(
      "No signal Check-ins and cash you take are kept on this phone and sent when the signal is back. Closing out, messages and cancelling wait for the signal.",
    );
  });

  it("says what is kept on this phone, and that it goes when the signal is back", () => {
    screenFor();
    goOffline();
    settle();
    keep();
    expect(screen.getByRole("status")).toHaveTextContent(
      "1 check-in and ₹9,000 taken are saved on this phone. They send when the signal is back.",
    );
  });

  it("does not count what somebody else kept on this phone", () => {
    screenFor("usr_staff");
    goOffline();
    settle();
    keep();
    expect(screen.getByRole("status")).not.toHaveTextContent(
      "saved on this phone",
    );
  });

  it("holds a link that needs the server, and lets a phone call through", () => {
    screenFor();
    goOffline();
    expect(
      fireEvent.click(screen.getByRole("link", { name: "Done boarding" })),
    ).toBe(false);
    expect(screen.getByRole("status")).toHaveTextContent(
      "That opens once you are back online.",
    );
    expect(
      fireEvent.click(screen.getByRole("link", { name: "Call Yuvoy" })),
    ).toBe(true);
  });

  /*
    The strip sits above the manifest: on a connection that drops and comes
    back inside a couple of seconds, each blip used to push every row down
    and pull it back under the thumb at the jetty (the stability audit,
    P3-1).
  */
  it("does not move the manifest for a blip", () => {
    screenFor();
    goOffline();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    act(() => {
      vi.advanceTimersByTime(SETTLE_MS - 500);
    });
    goOnline();
    settle();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });
});

describe("once the signal is back", () => {
  it("says it is sending what was kept", () => {
    screenFor();
    keep();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Sending 1 check-in and ₹9,000 taken, kept on this phone.",
    );
  });

  it("says when it went, and who had already been checked in elsewhere", async () => {
    screenFor();
    keep();
    await act(async () => {
      await replayWrites(
        "usr_owner",
        {
          arrived: async () => ({
            kind: "sent",
            earlier: { at: "2026-10-04T00:55:00Z" },
          }),
          cash: async () => ({ kind: "sent" }),
        },
        () => Date.parse("2026-10-04T01:11:00Z"),
      );
    });
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(
      "What was kept on this phone was sent at 06:41.",
    );
    expect(status).toHaveTextContent(
      "Asha Menon was already checked in at 06:25.",
    );
  });

  it("says nothing when there is nothing to say", () => {
    screenFor();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });
});
