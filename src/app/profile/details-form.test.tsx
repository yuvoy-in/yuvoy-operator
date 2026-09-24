import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { DetailsFormValues } from "@/lib/profile/details";

/*
  The business-details form after D-032.3 (yuvoy-operator#89 f10).

  The API stopped refusing a LIVE account's change and started queueing it for
  review, so the "Locked" panel became a screen for a refusal nobody gets. What
  replaced it: the form for whoever may change the details, a receipt that
  says "sent for a check" when that is what happened, and the details as
  plain rows for a staff login the API would refuse.
*/

const saveDetails = vi.fn();

vi.mock("./actions", () => ({
  saveDetails: (prev: unknown, form: FormData) => saveDetails(prev, form),
}));

const { DetailsForm } = await import("./details-form");

const VALUES: DetailsFormValues = {
  legalName: "Nemo Reef Watersports",
  entityType: "sole_proprietor",
  gstin: "",
  addressLine1: "Beach 3",
  addressLine2: "",
  locality: "Havelock",
  region: "Andaman and Nicobar",
  postalCode: "744211",
  country: "IN",
};

const DETAILS = {
  legalName: VALUES.legalName,
  entityType: VALUES.entityType,
  address: { line1: "Beach 3", locality: "Havelock" },
  missing: [],
  editable: true,
};

afterEach(() => saveDetails.mockReset());

function submit() {
  fireEvent.click(screen.getByRole("button", { name: "Save these details" }));
}

describe("business details: yuvoy-operator#89 f10", () => {
  it("offers the form even when the API says the account is live", () => {
    // `editable: false` is what the contract still describes. The API has not
    // sent it since D-032.3, and the form is no longer gated on it.
    render(
      <DetailsForm
        details={{ ...DETAILS, editable: false }}
        values={VALUES}
        canManage
      />,
    );
    expect(
      screen.getByRole("button", { name: "Save these details" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Locked")).toBeNull();
  });

  it("says a queued change was sent for a check, not saved", async () => {
    saveDetails.mockResolvedValue({ inReview: true });
    render(<DetailsForm details={DETAILS} values={VALUES} canManage />);

    submit();

    expect(
      await screen.findByText("Sent to us for a check"),
    ).toBeInTheDocument();
    expect(screen.getByText(/stays in\s+place/)).toBeInTheDocument();
    expect(screen.queryByText("Saved")).toBeNull();
  });

  it("goes back to the form from the receipt", async () => {
    saveDetails.mockResolvedValue({ inReview: true });
    render(<DetailsForm details={DETAILS} values={VALUES} canManage />);

    submit();
    fireEvent.click(
      await screen.findByRole("button", { name: "Back to your details" }),
    );

    expect(
      screen.getByRole("button", { name: "Save these details" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Sent to us for a check")).toBeNull();
  });

  it("says saved when the API saved it", async () => {
    saveDetails.mockResolvedValue({ saved: true });
    render(<DetailsForm details={DETAILS} values={VALUES} canManage />);

    submit();

    expect(await screen.findByText("Saved")).toBeInTheDocument();
    expect(screen.queryByText("Sent to us for a check")).toBeNull();
  });

  it("says a change is waiting, above the form it would change", () => {
    render(
      <DetailsForm
        details={DETAILS}
        values={VALUES}
        canManage
        review={{
          state: "waiting",
          sentOn: "21 September 2026",
          reason: null,
        }}
      />,
    );
    expect(
      screen.getByText("A change to these details is waiting for our check"),
    ).toBeInTheDocument();
    expect(screen.getByText(/Sent on 21 September 2026/)).toBeInTheDocument();
  });

  it("says why in the API's own sentence when it sent one, and nothing twice", () => {
    render(
      <DetailsForm
        details={DETAILS}
        values={VALUES}
        canManage
        review={{
          state: "refused",
          sentOn: "21 September 2026",
          reason:
            "We could not accept the change to your registered details. What we hold stays as it was. Call us on +91 81216 57657 and we will tell you what we need.",
        }}
      />,
    );
    expect(
      screen.getByText(
        /We could not accept the change to your registered details/,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Sent on 21 September 2026.")).toBeInTheDocument();
    // Our generic words are not said beside it.
    expect(
      screen.queryByText("We did not apply the change you sent"),
    ).toBeNull();
  });

  it("says a refused change was not applied, without inventing why", () => {
    render(
      <DetailsForm
        details={DETAILS}
        values={VALUES}
        canManage={false}
        review={{ state: "refused", sentOn: null, reason: null }}
      />,
    );
    expect(
      screen.getByText("We did not apply the change you sent"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Sent on/)).toBeNull();
  });

  it("shows a staff login the details and no form", () => {
    render(<DetailsForm details={DETAILS} values={VALUES} canManage={false} />);

    expect(screen.getByText("Nemo Reef Watersports")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Only an owner, an admin or a manager can change these.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Save these details" }),
    ).toBeNull();
  });
});
