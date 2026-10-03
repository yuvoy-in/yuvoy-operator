import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { RequestView } from "@/lib/day/request-view";

const refresh = vi.fn();
const acceptRequest = vi.fn();
const declineRequest = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/app/bookings/actions", () => ({
  acceptRequest: (prev: unknown, form: FormData) => acceptRequest(prev, form),
  declineRequest: (prev: unknown, form: FormData) => declineRequest(prev, form),
}));

const { RequestQueue } = await import("./request-queue");

const VIEW: RequestView = {
  id: "req_1",
  name: "Ingrid Sorensen",
  firstName: "Ingrid",
  guests: 4,
  title: "Ingrid Sorensen, 4 people",
  trip: "Snorkel trip to Elephant Beach · Today at 23:30",
  asked: "Asked 2 h ago · Answer by 10:00",
  clock: "2h 55m left",
  urgent: false,
  seats: "6 seats you can still give",
  short: false,
  preset: null,
  timezone: "Asia/Kolkata",
};

const props = {
  canAnswer: true,
  canAccept: true,
  empty: "No requests waiting",
};

beforeEach(() => {
  window.history.replaceState(null, "", "/bookings");
});
afterEach(() => {
  refresh.mockReset();
  acceptRequest.mockReset();
  declineRequest.mockReset();
  vi.useRealTimers();
});

describe("the request queue on Bookings", () => {
  it("is Home's card: the traveller first, both clocks, and 56px answers", () => {
    render(<RequestQueue {...props} views={[VIEW]} />);
    const card = screen.getByRole("listitem", {
      name: "Seat request from Ingrid Sorensen",
    });
    expect(card).toHaveTextContent("Ingrid Sorensen, 4 people");
    expect(card).toHaveTextContent("2h 55m left");
    expect(card).toHaveTextContent("Answer by 10:00");
    expect(screen.getByRole("button", { name: "Accept" })).toBeEnabled();
  });

  it("pins the Requests pill in the address, so answering the last request does not flip the pill", () => {
    render(<RequestQueue {...props} views={[VIEW]} />);
    expect(window.location.search).toBe("?view=requests");
  });

  it("leaves an address that already names a pill alone", () => {
    window.history.replaceState(null, "", "/bookings?view=requests&q=YV-7K3");
    render(<RequestQueue {...props} views={[VIEW]} />);
    expect(window.location.search).toBe("?view=requests&q=YV-7K3");
  });

  it("stays mounted when empty and says so, keeping the receipt of the last answer", async () => {
    vi.useFakeTimers();
    acceptRequest.mockResolvedValue({ granted: true });
    const { rerender } = render(<RequestQueue {...props} views={[VIEW]} />);
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    // The re-read queue is empty now: the receipt is still the one row.
    rerender(<RequestQueue {...props} views={[]} />);
    expect(
      screen.getByText("Seats granted to Ingrid Sorensen"),
    ).toBeInTheDocument();
    expect(screen.queryByText("No requests waiting")).toBeNull();
  });

  it("says the queue is empty, in the words the page chose", () => {
    render(<RequestQueue {...props} views={[]} empty="No requests match" />);
    expect(screen.getByText("No requests match")).toBeInTheDocument();
  });

  it("keeps a staff login's buttons, disabled, rather than live ones the server refuses", () => {
    render(<RequestQueue {...props} canAnswer={false} views={[VIEW]} />);
    expect(screen.getByRole("button", { name: "Accept" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Decline" })).toBeDisabled();
  });
});
