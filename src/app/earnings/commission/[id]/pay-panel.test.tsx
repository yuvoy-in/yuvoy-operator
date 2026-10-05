import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PayPanel } from "./pay-panel";

/*
  How to pay one statement (yuvoy-operator#121): "a 'Pay ₹X by UPI' button
  opening `payTo.upiLink`, the UPI ID and payee shown as text beside it, and a
  line asking to keep the statement reference in the note."
*/

const LINK =
  "upi://pay?pa=yuvoy.dev@example&pn=Yuvoy%20(dev)&am=2250.00&cu=INR&tn=YC-7KQ2MZ9P";
const TO = { upiId: "yuvoy.dev@example", name: "Yuvoy (dev)" };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("paying a statement", () => {
  it("opens the UPI app on the amount owed, with the details beside it", () => {
    render(
      <PayPanel
        owedPaise={225_000}
        reference="YC-7KQ2MZ9P"
        link={LINK}
        to={TO}
        message={null}
      />,
    );
    const pay = screen.getByRole("link", { name: "Pay ₹2,250 by UPI" });
    expect(pay).toHaveAttribute("href", LINK);
    // Opened where it is, never a new tab: a UPI app is not a page.
    expect(pay).not.toHaveAttribute("target");

    expect(screen.getByText("yuvoy.dev@example")).toBeVisible();
    expect(screen.getByText("Yuvoy (dev)")).toBeVisible();
    expect(
      screen.getByText(
        "Keep YC-7KQ2MZ9P in the payment note, so we can match your payment to this statement.",
      ),
    ).toBeVisible();
    expect(
      screen.getByText(/Paying from another phone or a computer\?/),
    ).toBeVisible();
  });

  it("still says where to pay when there is no link to open", () => {
    render(
      <PayPanel
        owedPaise={225_000}
        reference="YC-7KQ2MZ9P"
        link={null}
        to={TO}
        message={null}
      />,
    );
    expect(screen.queryByRole("link", { name: /by UPI/ })).toBeNull();
    expect(screen.getByText("yuvoy.dev@example")).toBeVisible();
    expect(
      screen.getByText(/^Send ₹2,250 to the UPI ID above from any UPI app/),
    ).toBeVisible();
  });

  it("shows the API's sentence when paying is not set up, and no button", () => {
    render(
      <PayPanel
        owedPaise={225_000}
        reference="YC-7KQ2MZ9P"
        link={null}
        to={null}
        message="Our UPI details are not set up yet, so there is nowhere to pay this yet. We will tell you as soon as there is."
      />,
    );
    // The API's own sentence (yuvoy-api `payToNotSet`), shown as it is.
    expect(
      screen.getByText(
        "Our UPI details are not set up yet, so there is nowhere to pay this yet. We will tell you as soon as there is.",
      ),
    ).toBeVisible();
    expect(screen.queryByRole("link", { name: /by UPI/ })).toBeNull();
    expect(screen.queryByText("UPI ID")).toBeNull();
    expect(
      screen.getByRole("link", { name: "+91 81216 57657" }),
    ).toHaveAttribute("href", "tel:+918121657657");
  });

  it("says so in its own words when the API sent no sentence", () => {
    render(
      <PayPanel
        owedPaise={225_000}
        reference="YC-7KQ2MZ9P"
        link={null}
        to={null}
        message={null}
      />,
    );
    expect(screen.getByText("Paying by UPI is not set up yet.")).toBeVisible();
  });

  it("copies the UPI ID, and says when it could not", async () => {
    // After `setup`, which puts its own clipboard on `navigator`.
    const user = userEvent.setup();
    const writeText = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue(undefined);
    render(
      <PayPanel
        owedPaise={225_000}
        reference="YC-7KQ2MZ9P"
        link={LINK}
        to={TO}
        message={null}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Copy the UPI ID" }));
    expect(writeText).toHaveBeenCalledWith("yuvoy.dev@example");
    expect(
      screen.getByRole("button", { name: "Copied the UPI ID" }),
    ).toBeVisible();

    writeText.mockRejectedValueOnce(new Error("not allowed"));
    await user.click(
      screen.getByRole("button", { name: "Copy the reference" }),
    );
    expect(writeText).toHaveBeenLastCalledWith("YC-7KQ2MZ9P");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Could not copy it here. Select it and copy it by hand.",
    );
  });
});
