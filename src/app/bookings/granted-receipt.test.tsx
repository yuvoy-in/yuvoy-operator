import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("./actions", () => ({
  acceptRequest: vi.fn(),
  declineRequest: vi.fn(),
}));

const { GrantedReceipt } = await import("./request-row");

const BASE = { id: "req_1", contactName: "Ingrid", guests: 4 };

/*
  The receipt after an accept (yuvoy-operator#95 item 1). The API's sentence
  when there is one; ours, with the day in the pay-by time, when there is not;
  and a warning, not a tick, when nobody could tell the traveller.
*/
describe("the accept receipt", () => {
  it("says the API's sentence as it is", () => {
    render(
      <ul>
        <GrantedReceipt
          receipt={{
            ...BASE,
            sentence:
              "They are holding 4 seats and still have to pay. We are letting them know by email.",
          }}
        />
      </ul>,
    );
    expect(
      screen.getByText(/We are letting them know by email/),
    ).toBeInTheDocument();
  });

  it("falls back to its own sentence, with the day in the time", () => {
    render(
      <ul>
        <GrantedReceipt receipt={{ ...BASE, payBy: "08:00 on Tue 22 Sep" }} />
      </ul>,
    );
    expect(
      screen.getByText(/If they have not paid by 08:00 on Tue 22 Sep/),
    ).toBeInTheDocument();
    // Nothing invented about how they were told.
    expect(screen.queryByText(/by email|on WhatsApp/)).toBeNull();
  });

  it("warns when nobody could reach the traveller", () => {
    render(
      <ul>
        <GrantedReceipt receipt={{ ...BASE, untold: true }} />
      </ul>,
    );
    expect(screen.getByText(/they do not know yet/)).toBeInTheDocument();
  });

  it("leaves the warning to the API's sentence when it sent one", () => {
    render(
      <ul>
        <GrantedReceipt
          receipt={{
            ...BASE,
            untold: true,
            sentence: "They are holding 4 seats. We could not reach them.",
          }}
        />
      </ul>,
    );
    expect(screen.getByText(/We could not reach them/)).toBeInTheDocument();
    expect(screen.queryByText(/they do not know yet/)).toBeNull();
  });
});
