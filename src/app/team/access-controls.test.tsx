import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { TeamPerson } from "@/lib/team/members";

/*
  A refused role change keeps the role picked (the stability audit, P1-1).

  React resets a form when its action resolves, refusals included. The radio
  went back to the role they hold while the Owner warning, drawn from the
  choice, stayed for the role still picked: two answers to "what are they
  getting", and the next tap sent the one nobody was looking at.
*/

const setMemberRole = vi.fn();
vi.mock("./actions", () => ({
  setMemberRole: (prev: unknown, form: FormData) => setMemberRole(prev, form),
  holdMember: vi.fn(),
  restoreMember: vi.fn(),
}));

const { AccessControls } = await import("./access-controls");

afterEach(() => setMemberRole.mockReset());

const ARUN: TeamPerson = {
  id: "usr_staff",
  name: "Arun Biswas",
  roles: ["STAFF"],
  state: "active",
  pending: false,
};

async function makeOwner() {
  render(
    <AccessControls
      member={ARUN}
      canRole={{ allowed: true }}
      canHoldThem={{ allowed: false }}
      canRestoreThem={{ allowed: false }}
      iAmOnlyAdmin={false}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Change role" }));
  fireEvent.click(screen.getByRole("radio", { name: /^Owner/ }));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Save role" }));
  });
}

describe("a refused role change", () => {
  it("keeps the role picked, beside the warning that goes with it", async () => {
    setMemberRole.mockResolvedValue({
      message: "An admin cannot change an owner.",
    });
    await makeOwner();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "An admin cannot change an owner.",
    );
    expect(screen.getByRole("radio", { name: /^Owner/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: /^Staff/ })).not.toBeChecked();
    expect(
      screen.getByText(
        "They will be able to change where the business is paid.",
      ),
    ).toBeInTheDocument();
  });

  it("says no signal in place when the request never came back", async () => {
    setMemberRole.mockRejectedValue(new TypeError("Failed to fetch"));
    await makeOwner();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No signal. Nothing changed: change it again when you have one.",
    );
    expect(screen.getByRole("radio", { name: /^Owner/ })).toBeChecked();
  });
});
