import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../builder-actions", () => ({
  saveLocation: vi.fn(async () => ({})),
}));
// The control is tested where it lives; here only whether it is offered.
vi.mock("@/components/map/meeting-pin", () => ({
  MeetingPin: ({ initial }: { initial: unknown }) => (
    <p>Pin control, starting at {JSON.stringify(initial)}</p>
  ),
}));

const { LocationStep } = await import("./location");

function open(listing: Record<string, unknown>) {
  render(
    <LocationStep
      id="exp_1"
      listing={listing}
      vocabulary={null}
      back="/account/listings/exp_1/edit?step=schedule"
    />,
  );
}

/*
  yuvoy-operator#113. The pin is offered only by an API that takes one: since
  yuvoy-api#249 every read carries `meetingLat`, `null` with no pin, and an
  API from before it would refuse the field and with it the whole step.
*/
describe("the Location step's pin", () => {
  it("is offered when the listing says the API takes pins", () => {
    open({ meetingPoint: "Jetty 3", meetingLat: null, meetingLng: null });
    expect(screen.getByText("Pin control, starting at null")).toBeVisible();
  });

  it("starts at the pin on file", () => {
    open({ meetingLat: 11.9695, meetingLng: 92.9631 });
    expect(
      screen.getByText(
        'Pin control, starting at {"lat":11.9695,"lng":92.9631}',
      ),
    ).toBeVisible();
  });

  it("is not offered by an API from before pins, and the step is as it was", () => {
    open({ meetingPoint: "Jetty 3" });
    expect(screen.queryByText(/Pin control/)).toBeNull();
    expect(screen.getByLabelText("Where to meet")).toHaveValue("Jetty 3");
  });
});
