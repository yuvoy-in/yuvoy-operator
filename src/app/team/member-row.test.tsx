import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { Removability, TeamPerson } from "@/lib/team/members";

/*
  One person on the team list, after yuvoy-operator#88 s16 and #81.

  Two things are under test, and both are about weight rather than wording.
  The role is the chip and only the chip, so three people are three rows and
  not three paragraphs. Remove is "a small text action, behind a confirm": it
  is the one irreversible thing here and it must never be the widest, darkest
  control on the card, which is what it was.

  The Server Action is replaced: what it does to a team is the e2e suite's
  business, and what this row does BEFORE calling it is the point here.
*/

const removeMember = vi.fn();

vi.mock("./actions", () => ({
  removeMember: (prev: unknown, form: FormData) => removeMember(prev, form),
  setMemberRole: vi.fn(),
  holdMember: vi.fn(),
  restoreMember: vi.fn(),
}));

const { MemberRow } = await import("./member-row");

const ARUN: TeamPerson = {
  id: "usr_staff",
  name: "Arun Biswas",
  roles: ["STAFF"],
  state: "active",
  pending: false,
  phoneMasked: "••••0103",
};

const INVITED: TeamPerson = {
  id: "inv_1",
  name: "Ramesh Toppo",
  roles: ["STAFF"],
  pending: true,
  phoneMasked: "••••0104",
};

function row(
  member: TeamPerson,
  removability: Removability = { removable: true },
  canRole = false,
) {
  return render(
    <MemberRow
      member={member}
      removability={removability}
      lastSeenLabel={member.pending ? null : "Seen yesterday"}
      held={false}
      canRole={{ allowed: canRole }}
      canHoldThem={{ allowed: false }}
      canRestoreThem={{ allowed: false }}
      iAmOnlyAdmin={false}
      canSeeNotifications={false}
    />,
  );
}

afterEach(() => removeMember.mockReset());

describe("the role on a row", () => {
  it("is the chip, and not a paragraph under it", () => {
    row(ARUN);

    expect(screen.getByText("Staff")).toBeInTheDocument();
    // The same words are said once for the whole list, in the disclosure.
    expect(
      screen.queryByText("Today's manifest: marks people off as they arrive."),
    ).toBeNull();
    expect(
      screen.queryByText(/Sees seat requests but cannot answer them/),
    ).toBeNull();
  });

  it("says so plainly when this build cannot describe the role", () => {
    /*
      The one case the chip alone cannot carry. Telling an owner that somebody
      has LESS access than they do is how a phone gets handed over, so an
      unknown role is stated rather than guessed at.
    */
    row({ ...ARUN, roles: ["DECKHAND"] });

    expect(screen.getByText("DECKHAND")).toBeInTheDocument();
    expect(
      screen.getByText(/We cannot describe this role in this version/),
    ).toBeInTheDocument();
  });
});

describe("removing somebody", () => {
  it("is quiet: never a pill, never full width, never the tallest control", () => {
    row(ARUN, { removable: true }, true);

    const remove = screen.getByRole("button", { name: "Remove" });
    // The accent as text (op#81's danger-quiet), with no fill and no pill.
    expect(remove.className).toContain("text-terra-deep");
    expect(remove.className).not.toContain("bg-forest");
    expect(remove.className).not.toMatch(/\bborder-2\b/);
    expect(remove.className).not.toMatch(/\bw-full\b/);
    /*
      And smaller than the safe control beside it. "Remove somebody from the
      team is a full-width button with the same weight as Change role" was the
      finding; 44px of text under a 56px pill is the answer.
    */
    expect(remove.className).toContain("h-11");
    expect(
      screen.getByRole("button", { name: "Change role" }).className,
    ).toContain("dock-target");
  });

  it("asks first, and sends nothing on the first tap", () => {
    row(ARUN);

    const trigger = screen.getByRole("button", { name: "Remove" });
    fireEvent.click(trigger);

    // Named, and told what happens, before the tap that does it.
    expect(screen.getByText("Remove Arun Biswas?")).toBeInTheDocument();
    expect(
      screen.getByText(/Their sessions end immediately/),
    ).toBeInTheDocument();
    expect(removeMember).not.toHaveBeenCalled();
    // The trigger itself is gone, so the second tap cannot land on it.
    expect(trigger).not.toBeInTheDocument();
  });

  it("puts the danger pill on the button that does it, not on the way in", () => {
    row(ARUN);
    const trigger = screen.getByRole("button", { name: "Remove" });
    fireEvent.click(trigger);

    const confirm = screen.getByRole("button", { name: "Remove" });
    expect(confirm).not.toBe(trigger);
    expect(confirm).toHaveAttribute("type", "submit");
    expect(confirm.className).toContain("border-terra-deep");
    // And a way out that is the safe one beside it.
    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
  });

  it("takes the confirm back without sending anything", () => {
    row(ARUN);

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(screen.queryByText("Remove Arun Biswas?")).toBeNull();
    expect(removeMember).not.toHaveBeenCalled();
  });

  it("becomes its own receipt, saying when their access ended", async () => {
    /*
      The row does not vanish, and the action deliberately does not
      revalidate: a vanished line answers "did it work" ambiguously and "when
      does their access end" not at all, and the second is the whole reason
      somebody is removed in a hurry.
    */
    removeMember.mockResolvedValue({ removed: true });
    row(ARUN);

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    expect(await screen.findByText("Arun Biswas removed")).toBeInTheDocument();
    expect(screen.getByText(/Signed out everywhere, now/)).toBeInTheDocument();
    expect(removeMember).toHaveBeenCalledTimes(1);
  });

  it("keeps a refusal beside the row it is about", async () => {
    removeMember.mockResolvedValue({ message: "We could not do that." });
    row(ARUN);

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We could not do that.",
    );
  });

  it("does not offer the control where the server would refuse it", () => {
    // "The last owner or admin" is the one refusal an owner would otherwise
    // read as a bug, so it is stated. The control is not offered either way.
    row(ARUN, { removable: false, reason: "The last owner or admin." });

    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
    expect(screen.getByText("The last owner or admin.")).toBeInTheDocument();
  });
});

describe("an invitation nobody has accepted", () => {
  it("is revoked rather than removed, and says what stops working", async () => {
    // On a pending row `id` is the INVITATION, not a user: different thing,
    // different verb, different consequences.
    removeMember.mockResolvedValue({ removed: true });
    row(INVITED);

    fireEvent.click(screen.getByRole("button", { name: "Revoke invitation" }));
    expect(
      screen.getByText("Revoke the invitation to Ramesh Toppo?"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));

    expect(
      await screen.findByText("Invitation to Ramesh Toppo revoked"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("The invitation and its code no longer work."),
    ).toBeInTheDocument();
  });
});
