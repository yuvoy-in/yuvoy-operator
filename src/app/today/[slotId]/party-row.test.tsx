import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PartyRow } from "./party-row";

/**
 * The second tap. A no-show is permanent — the API refuses to overwrite a
 * settled booking — so it is armed by one tap and sent by another, and the
 * screen says so in between.
 */
const markAttendance = vi.fn<
  (prev: unknown, form: FormData) => Promise<object>
>(async () => ({}));
vi.mock("./actions", () => ({
  markAttendance: (prev: unknown, form: FormData) => markAttendance(prev, form),
  sendRelay: vi.fn(async () => ({})),
}));
vi.mock("@/app/bookings/cash-actions", () => ({
  recordCashCollected: vi.fn(async () => ({})),
}));
vi.mock("@/app/bookings/cancel-actions", () => ({
  cancelBooking: vi.fn(async () => ({})),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  usePathname: () => "/today/slot_dawn",
}));

const party = {
  bookingId: "bk_1",
  reference: "YV-4K2M9P7Q",
  name: "Asha Menon",
  guests: 2,
  state: "confirmed",
  arrived: false,
};

const TZ = "Asia/Kolkata";

describe("PartyRow — terminal outcomes", () => {
  it("asks before recording a no-show, and records it on the second tap", async () => {
    const user = userEvent.setup();
    render(
      <ul>
        <PartyRow
          party={party}
          slotId="slot_dawn"
          departed
          screening={null}
          cash={null}
          timezone={TZ}
          canManage={false}
        />
      </ul>,
    );

    await user.click(screen.getByRole("button", { name: "No-show" }));
    expect(markAttendance).not.toHaveBeenCalled();
    expect(
      screen.getByText(/Mark Asha Menon as a no-show\? This cannot be changed/),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Confirm no-show" }));
    expect(markAttendance).toHaveBeenCalledTimes(1);
    const form = markAttendance.mock.calls[0][1];
    expect(form.get("outcome")).toBe("no_show");
    expect(form.get("bookingId")).toBe("bk_1");
  });

  it("can be disarmed", async () => {
    const user = userEvent.setup();
    render(
      <ul>
        <PartyRow
          party={party}
          slotId="slot_dawn"
          departed
          screening={null}
          cash={null}
          timezone={TZ}
          canManage={false}
        />
      </ul>,
    );
    await user.click(screen.getByRole("button", { name: "Completed" }));
    await user.click(screen.getByRole("button", { name: "Not that" }));
    expect(screen.getByRole("button", { name: "No-show" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Confirm/ })).toBeNull();
  });

  it("keeps arriving to one tap", async () => {
    const user = userEvent.setup();
    render(
      <ul>
        <PartyRow
          party={party}
          slotId="slot_dawn"
          departed
          screening={null}
          cash={null}
          timezone={TZ}
          canManage={false}
        />
      </ul>,
    );
    await user.click(screen.getByRole("button", { name: "Check in" }));
    expect(markAttendance).toHaveBeenCalled();
  });

  it("says Checked in once they are, with a drawn tick rather than a character", () => {
    /*
      yuvoy-operator#88 s3: "Here" is our word, and on a jetty it reads as a
      question. The button and the total above the list say the same thing.
    */
    render(
      <ul>
        <PartyRow
          party={{ ...party, arrived: true }}
          slotId="slot_dawn"
          departed
          screening={null}
          cash={null}
          timezone={TZ}
          canManage={false}
        />
      </ul>,
    );
    const done = screen.getByRole("button", { name: "Checked in" });
    expect(done.querySelector("svg")).not.toBeNull();
    expect(done.textContent).not.toMatch(/[✓✔]/);
    expect(screen.queryByRole("button", { name: /^Here/ })).toBeNull();
  });

  it("offers a message to the one party, by name", () => {
    render(
      <ul>
        <PartyRow
          party={party}
          slotId="slot_dawn"
          departed={false}
          screening={null}
          cash={null}
          timezone={TZ}
          canManage={false}
        />
      </ul>,
    );
    expect(
      screen.getByRole("button", { name: "Message Asha Menon" }),
    ).toBeInTheDocument();
  });
});

describe("PartyRow — the medical screener", () => {
  const row = (screening: "flagged" | "outstanding" | null) =>
    render(
      <ul>
        <PartyRow
          party={party}
          slotId="slot_dawn"
          departed
          screening={screening}
          cash={null}
          timezone={TZ}
          canManage={false}
        />
      </ul>,
    );

  it("says nothing at all when there is no signal", () => {
    /*
      `null` covers two different situations that must look identical: a
      departure that asks nothing (a snorkel trip, where "a false alarm on this
      signal teaches an instructor to skip the column"), and a party who
      answered with nothing flagged (where a tick would be one more thing to
      read past).
    */
    row(null);
    expect(screen.queryByText(/screening answer/i)).toBeNull();
    expect(screen.queryByText(/before boarding/i)).toBeNull();
  });

  it("renders the server's flag, and never says why", () => {
    row("flagged");
    expect(
      screen.getByText("Check with them before boarding."),
    ).toBeInTheDocument();
    // A manifest is read aloud on a jetty. Nothing here may describe a person.
    expect(
      screen.queryByText(/condition|medical history|declared/i),
    ).toBeNull();
  });

  it("marks a party with no answer on record as a statement about our records", () => {
    row("outstanding");
    expect(
      screen.getByText(/No screening answer recorded/),
    ).toBeInTheDocument();
    // Not "has not answered" — that is a claim about them, and an absent
    // record and a refused answer are not the same thing.
    expect(screen.queryByText(/refused|declined|has not answered/i)).toBeNull();
  });

  it("renders one line, never both", () => {
    /*
      "The interesting case is `needsAttention` on a party with
      `declared: false`" — flagged AND never asked. `screeningSignal` collapses
      that to "flagged" on the server; this pins that the row shows only the
      stronger line even so, because two would bury the one that says to stop
      somebody.
    */
    row("flagged");
    expect(screen.queryByText(/No screening answer recorded/)).toBeNull();
  });

  it("cannot be handed what anybody disclosed", () => {
    /*
      A type-level assertion, not a runtime one, and it is the load-bearing
      guard in this file. `PartyRow` is a client component, so anything it
      takes is serialised into the RSC payload in the page's HTML — `clear`
      shipped there for a while without being rendered anywhere.

      @ts-expect-error fails the BUILD if `screening` is ever allowed back onto
      the party prop, which is the only way that leak can return.
    */
    const withScreener = {
      ...party,
      screening: { declared: true, clear: false, needsAttention: false },
    };
    expect(() =>
      render(
        <ul>
          <PartyRow
            // @ts-expect-error `PartyForClient` omits the screener on purpose.
            party={withScreener}
            slotId="slot_dawn"
            departed
            screening={null}
            cash={null}
            timezone={TZ}
            canManage={false}
          />
        </ul>,
      ),
    ).not.toThrow();
  });
});

describe("PartyRow — cash at the counter (yuvoy-operator#40 §1)", () => {
  const owed = { collectPaise: 900_000, collected: false };
  const cashParty = { ...party, state: "paid_pending_ops" };

  it("offers taking the cash as its own act, beside arriving and not instead of it", () => {
    render(
      <ul>
        <PartyRow
          party={cashParty}
          slotId="slot_cash"
          departed={false}
          screening={null}
          cash={owed}
          timezone={TZ}
          canManage={false}
        />
      </ul>,
    );
    expect(
      screen.getByRole("button", { name: "Check in" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Take ₹9,000" }),
    ).toBeInTheDocument();
    expect(screen.getByText("₹9,000 to take in cash")).toBeInTheDocument();
  });

  it("offers a booking paid online nothing to collect", () => {
    render(
      <ul>
        <PartyRow
          party={party}
          slotId="slot_cash"
          departed={false}
          screening={null}
          cash={null}
          timezone={TZ}
          canManage={false}
        />
      </ul>,
    );
    expect(screen.queryByRole("button", { name: /^Take / })).toBeNull();
    expect(screen.queryByText(/in cash/)).toBeNull();
  });

  it("never offers a hold a collection — it is not a booking yet", () => {
    render(
      <ul>
        <PartyRow
          party={{ ...party, bookingId: "", state: "holding" }}
          slotId="slot_cash"
          departed={false}
          screening={null}
          cash={owed}
          timezone={TZ}
          canManage={false}
        />
      </ul>,
    );
    expect(screen.queryByRole("button", { name: /^Take / })).toBeNull();
  });

  it("warns before a trip is completed with its cash unrecorded", async () => {
    /*
      The API takes cash only from a `paid_pending_ops` or `confirmed` booking,
      so completing first strands the notes in the operator's hand for good.
    */
    const user = userEvent.setup();
    render(
      <ul>
        <PartyRow
          party={{ ...party, state: "confirmed" }}
          slotId="slot_cash"
          departed
          screening={null}
          cash={owed}
          timezone={TZ}
          canManage={false}
        />
      </ul>,
    );
    await user.click(screen.getByRole("button", { name: "Completed" }));
    expect(screen.getByText(/Record the cash first/)).toBeInTheDocument();
  });

  it("says nothing about cash when completing a booking with none owed", async () => {
    const user = userEvent.setup();
    render(
      <ul>
        <PartyRow
          party={party}
          slotId="slot_dawn"
          departed
          screening={null}
          cash={null}
          timezone={TZ}
          canManage={false}
        />
      </ul>,
    );
    await user.click(screen.getByRole("button", { name: "Completed" }));
    expect(screen.queryByText(/Record the cash first/)).toBeNull();
  });
});

/*
  The audit before release, O11 and #81: the act that ends something sits under
  the ones a jetty reaches for. The quiet cancel sat above Check in, a thumb's
  slip from it.
*/
describe("PartyRow: where the cancel sits", () => {
  it("is below Check in, not above it", () => {
    render(
      <ul>
        <PartyRow
          party={party}
          slotId="slot_dawn"
          departed={false}
          screening={null}
          cash={null}
          timezone={TZ}
          canManage
        />
      </ul>,
    );
    const checkIn = screen.getByRole("button", { name: "Check in" });
    const cancel = screen.getByRole("button", { name: "Cancel this booking" });
    expect(
      checkIn.compareDocumentPosition(cancel) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

/*
  Audit 5.2: a manifest row never opened its booking, and a traveller who
  wrote "we are running late" was only visible in the inbox.
*/
describe("PartyRow — its booking and its messages", () => {
  const HREF = "/bookings/bk_1?from=%2Ftoday%2Fslot_dawn";

  function row(extra: { bookingHref?: string; unread?: number }) {
    return render(
      <ul>
        <PartyRow
          party={party}
          slotId="slot_dawn"
          departed={false}
          screening={null}
          cash={null}
          timezone={TZ}
          canManage
          {...extra}
        />
      </ul>,
    );
  }

  it("opens its booking, with the departure as the way back", () => {
    row({ bookingHref: HREF });
    expect(screen.getByRole("link", { name: "Booking" })).toHaveAttribute(
      "href",
      HREF,
    );
  });

  it("says a traveller wrote, and opens the conversation", () => {
    row({ bookingHref: HREF, unread: 2 });
    expect(
      screen.getByRole("link", { name: "2 new messages" }),
    ).toHaveAttribute("href", `${HREF}#conversation`);
  });

  it("speaks one message in the singular, and says nothing at none", () => {
    const { unmount } = row({ bookingHref: HREF, unread: 1 });
    expect(screen.getByRole("link", { name: "1 new message" })).toBeVisible();
    unmount();
    row({ bookingHref: HREF, unread: 0 });
    expect(screen.queryByRole("link", { name: /new message/ })).toBeNull();
  });

  it("draws neither for a party with no booking to open", () => {
    row({ unread: 3 });
    expect(screen.queryByRole("link", { name: "Booking" })).toBeNull();
    expect(screen.queryByRole("link", { name: /new message/ })).toBeNull();
  });
});

/*
  With no signal (operator experiment D; owner go-ahead and storage ruling,
  4 Oct 2026). Checking in is kept on the phone and sent when the signal is
  back; closing out, messages and cancelling wait for the signal.
*/
describe("PartyRow with no signal", () => {
  async function offlineRow(departed = false) {
    const { ChromeProvider } =
      await import("@/components/chrome/chrome-context");
    const { offlineWrites } = await import("@/lib/site/offline-writes");
    offlineWrites.forget();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    render(
      <ChromeProvider
        identity={{ businessName: null, canManage: true, userId: "usr_owner" }}
      >
        <ul>
          <PartyRow
            party={party}
            slotId="slot_dawn"
            departed={departed}
            screening={null}
            cash={null}
            timezone={TZ}
            canManage
          />
        </ul>
      </ChromeProvider>,
    );
    return offlineWrites;
  }

  it("keeps a check-in on the phone, and says so in place of the button", async () => {
    markAttendance.mockClear();
    const offlineWrites = await offlineRow();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Check in" }));

    expect(markAttendance).not.toHaveBeenCalled();
    expect(offlineWrites.list()).toMatchObject([
      {
        kind: "arrived",
        userId: "usr_owner",
        slotId: "slot_dawn",
        bookingId: "bk_1",
      },
    ]);
    expect(
      screen.getByText(
        "Checked in on this phone. Sends when the signal is back.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Check in" })).toBeNull();
    vi.restoreAllMocks();
  });

  it("offers no message or cancel until the signal is back", async () => {
    await offlineRow();
    expect(
      screen.getByRole("button", { name: "Message Asha Menon" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Cancel this booking" }),
    ).toBeDisabled();
    // Checking in still works: it is kept on the phone.
    expect(screen.getByRole("button", { name: "Check in" })).toBeEnabled();
    vi.restoreAllMocks();
  });

  it("offers no closing out once the boat has left, until the signal is back", async () => {
    await offlineRow(true);
    expect(screen.getByRole("button", { name: "Completed" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "No-show" })).toBeDisabled();
    vi.restoreAllMocks();
  });
});

/*
  A session that ended at the jetty. The action's `requireOperator()`
  redirects to sign in, and Next 16.3's router follows that redirect itself:
  the call only rejects with it afterwards, marked handled
  (router-reducer/reducers/server-action-reducer.js). So the row catching it
  strands nobody, and catching it is what keeps the check-in, which the
  replayer sends once the operator has signed in again. Handing it back to
  Next instead (`unstable_rethrow`, as the forms do) would lose the check-in.
*/
describe("PartyRow when the session ends mid check-in", () => {
  it("keeps the check-in for after sign in", async () => {
    const { redirect } =
      await vi.importActual<typeof import("next/navigation")>(
        "next/navigation",
      );
    let ended: unknown;
    try {
      redirect("/sign-in");
    } catch (error) {
      ended = Object.assign(error as object, { handled: true });
    }
    markAttendance.mockRejectedValueOnce(ended);

    const { ChromeProvider } =
      await import("@/components/chrome/chrome-context");
    const { offlineWrites } = await import("@/lib/site/offline-writes");
    offlineWrites.forget();
    render(
      <ChromeProvider
        identity={{ businessName: null, canManage: true, userId: "usr_owner" }}
      >
        <ul>
          <PartyRow
            party={party}
            slotId="slot_dawn"
            departed={false}
            screening={null}
            cash={null}
            timezone={TZ}
            canManage
          />
        </ul>
      </ChromeProvider>,
    );

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Check in" }));

    expect(markAttendance).toHaveBeenCalled();
    expect(offlineWrites.list()).toMatchObject([
      { kind: "arrived", userId: "usr_owner", bookingId: "bk_1" },
    ]);
    offlineWrites.forget();
  });
});
