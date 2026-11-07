import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Need } from "@/lib/home/needs";
import { VIEW, REQUEST, MESSAGE, props } from "./home-kit";

const refresh = vi.fn();
const acceptRequest = vi.fn();
const declineRequest = vi.fn();
const confirmSeats = vi.fn();
const reloadThread = vi.fn();
const markThreadRead = vi.fn();
const sendMessage = vi.fn();
const recordCashCollected = vi.fn();

vi.mock("next/navigation", async (original) => ({
  // The real control flow helpers, which a dropped request goes through.
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh }),
}));
vi.mock("@/app/bookings/actions", () => ({
  acceptRequest: (prev: unknown, form: FormData) => acceptRequest(prev, form),
  declineRequest: (prev: unknown, form: FormData) => declineRequest(prev, form),
}));
vi.mock("@/app/calendar/departure-actions", () => ({
  confirmSeats: (prev: unknown, form: FormData) => confirmSeats(prev, form),
}));
vi.mock("@/app/bookings/[id]/conversation-actions", () => ({
  reloadThread: (id: string) => reloadThread(id),
  markThreadRead: (id: string, upTo: string) => markThreadRead(id, upTo),
  sendMessage: (id: string, text: string, key?: string) =>
    sendMessage(id, text, key),
  loadEarlier: vi.fn(),
}));
vi.mock("@/app/bookings/cash-actions", () => ({
  recordCashCollected: (prev: unknown, form: FormData) =>
    recordCashCollected(prev, form),
}));

const { NeedsYou } = await import("./needs-you");
const { StatusLine } = await import("./status-line");
const { DaySheet } = await import("./day-sheet");
const { StartSelling } = await import("./start-selling");
const { Glance, MoneyGlance } = await import("./glance");

afterEach(() => {
  for (const mock of [
    refresh,
    acceptRequest,
    declineRequest,
    confirmSeats,
    reloadThread,
    markThreadRead,
    sendMessage,
    recordCashCollected,
  ]) {
    mock.mockReset();
  }
});

/*
  O01 A (approved 4 Oct 2026): Today re-reads itself under the operator's
  thumb, and what a re-read changed is marked and said, never moved. The two
  sentences are the owner's words, with the live values.
*/
describe("Needs you, when a re-read changes it", () => {
  const KAVYA: Need = {
    kind: "request",
    key: "request-req_kavya",
    view: {
      ...VIEW,
      id: "req_kavya",
      name: "Kavya Iyer",
      firstName: "Kavya",
      title: "Kavya Iyer, 2 people",
      clock: "18 min left",
      urgent: true,
    },
  };
  const DANIEL: Need = {
    kind: "request",
    key: "request-req_daniel",
    view: {
      ...VIEW,
      id: "req_daniel",
      name: "Daniel Okafor",
      firstName: "Daniel",
      title: "Daniel Okafor, 1 person",
      clock: "3h left",
    },
  };
  const said = () =>
    screen
      .getAllByText(/./, { selector: "[aria-live=polite] > span" })
      .map((el) => el.textContent);

  it("marks nothing and says nothing on the first paint", () => {
    const { container } = render(
      <NeedsYou {...props} needs={[DANIEL, REQUEST]} />,
    );
    expect(container.querySelector(".motion-mark")).toBeNull();
    expect(
      screen.queryAllByText(/./, { selector: "[aria-live=polite] > span" }),
    ).toHaveLength(0);
  });

  it("marks a request that arrives where it lands, and says so once", () => {
    const { rerender } = render(
      <NeedsYou {...props} needs={[DANIEL, REQUEST]} />,
    );
    rerender(<NeedsYou {...props} needs={[KAVYA, DANIEL, REQUEST]} />);
    const kavya = screen.getByRole("listitem", {
      name: "Seat request from Kavya Iyer",
    });
    const tint = kavya.querySelector(":scope > .motion-mark");
    expect(tint).not.toBeNull();
    expect(tint).toHaveAttribute("aria-hidden", "true");
    // Nobody else is marked.
    expect(
      screen
        .getByRole("listitem", { name: "Seat request from Daniel Okafor" })
        .querySelector(".motion-mark"),
    ).toBeNull();
    expect(said()).toEqual(["Seat request from Kavya Iyer, 18 min left."]);
  });

  it("fades out a request answered elsewhere where it stands, then closes up", () => {
    vi.useFakeTimers();
    try {
      const { rerender } = render(
        <NeedsYou {...props} needs={[DANIEL, REQUEST]} />,
      );
      rerender(<NeedsYou {...props} needs={[REQUEST]} />);
      expect(said()).toEqual(["Daniel Okafor's request is no longer waiting."]);
      // Still drawn while it fades, in its place, and nothing on it answers.
      const daniel = screen.getByText("Daniel Okafor, 1 person").closest("li")!;
      expect(daniel.inert).toBe(true);
      const list = daniel.parentElement!;
      expect(list.firstElementChild).toBe(daniel);

      act(() => vi.advanceTimersByTime(100));
      expect(screen.queryByText("Daniel Okafor, 1 person")).toBeNull();
      expect(
        screen.getByRole("listitem", {
          name: "Seat request from Reuben Mathai",
        }),
      ).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("marks a guest's message that arrives, and says nothing a request would", () => {
    const { rerender, container } = render(
      <NeedsYou {...props} needs={[REQUEST]} />,
    );
    rerender(<NeedsYou {...props} needs={[REQUEST, MESSAGE]} />);
    expect(container.querySelectorAll(".motion-mark")).toHaveLength(1);
    expect(
      screen.queryAllByText(/./, { selector: "[aria-live=polite] > span" }),
    ).toHaveLength(0);
  });
});

describe("Needs you, when a card comes back before its fade has ended", () => {
  it("draws it again, answering, rather than leaving it faded", () => {
    vi.useFakeTimers();
    try {
      const daniel: Need = {
        kind: "request",
        key: "request-req_daniel",
        view: {
          ...VIEW,
          id: "req_daniel",
          name: "Daniel Okafor",
          title: "Daniel Okafor, 1 person",
        },
      };
      const { rerender } = render(
        <NeedsYou {...props} needs={[daniel, REQUEST]} />,
      );
      rerender(<NeedsYou {...props} needs={[REQUEST]} />);
      const row = screen.getByText("Daniel Okafor, 1 person").closest("li")!;
      expect(row.inert).toBe(true);
      // Back on the next read, inside its 100ms.
      rerender(<NeedsYou {...props} needs={[daniel, REQUEST]} />);
      act(() => vi.advanceTimersByTime(200));
      const back = screen.getByText("Daniel Okafor, 1 person").closest("li")!;
      expect(back.inert).toBe(false);
      expect(back.querySelector(".motion-mark")).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
