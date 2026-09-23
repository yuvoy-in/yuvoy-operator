import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const submitListing = vi.fn();
const push = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("./actions", () => ({
  submitListing: (prev: unknown, form: FormData) => submitListing(prev, form),
}));

const { SubmitButton } = await import("./submit-button");

beforeEach(() => {
  submitListing.mockReset().mockResolvedValue({});
  push.mockReset();
});

/*
  Send for review, counting what is left (yuvoy-operator#85 s10). The button
  used to be drawn whatever state the draft was in and to answer with the
  API's refusal after the tap.
*/
describe("sending a listing for review", () => {
  it("stays on the screen while something is missing, counting, disabled", () => {
    render(
      <SubmitButton experienceId="exp_1" label="Send for review" missing={1} />,
    );

    const send = screen.getByRole("button", {
      name: "Send for review (1 thing missing)",
    });
    expect(send).toBeDisabled();

    fireEvent.click(send);
    expect(submitListing).not.toHaveBeenCalled();
  });

  it("counts more than one as things", () => {
    render(
      <SubmitButton experienceId="exp_1" label="Send again" missing={3} />,
    );
    expect(
      screen.getByRole("button", { name: "Send again (3 things missing)" }),
    ).toBeDisabled();
  });

  it("sends when nothing is outstanding", async () => {
    submitListing.mockResolvedValue({ done: true });
    render(<SubmitButton experienceId="exp_1" label="Send for review" />);

    const send = screen.getByRole("button", { name: "Send for review" });
    expect(send).toBeEnabled();
    fireEvent.click(send);

    expect(
      await screen.findByText("Sent. Somebody at Yuvoy will look at it."),
    ).toBeInTheDocument();
    expect(
      (submitListing.mock.calls[0][1] as FormData).get("experienceId"),
    ).toBe("exp_1");
  });

  /*
    A refusal that names missing fields has one useful next step, and it is not
    reading the list again: it is the form that fills them in.
  */
  it("offers the way into the builder when the API refuses with a list", async () => {
    submitListing.mockResolvedValue({
      message: "Still missing: a price",
      missing: ["unitPricePaise"],
    });
    render(<SubmitButton experienceId="exp_1" label="Send for review" />);
    fireEvent.click(screen.getByRole("button", { name: "Send for review" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Still missing: a price",
    );
    fireEvent.click(screen.getByRole("button", { name: "Fix it" }));
    expect(push).toHaveBeenCalledWith("/account/listings/exp_1/edit");
  });
});
