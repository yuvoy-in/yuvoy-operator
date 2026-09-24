import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { OPERATOR_ROLES, describeRole } from "@/lib/team/roles";
import { helpHref } from "@/lib/help";
import { RoleGuide } from "./role-guide";

/*
  What each role can do, said once for the whole list (yuvoy-operator#88 s16):
  "Put the role in the chip that is already there and show the permission list
  once, under a 'What each role can do' link."

  Three people used to mean three paragraphs of nearly identical text. The
  words are the same words; what is under test is that there is now ONE copy
  of them, that it is out of the way until somebody asks, and that it still
  says something about every role this build knows.
*/

const guide = () => document.querySelector("details")!;

describe("what each role can do", () => {
  it("is out of the way until somebody asks", () => {
    render(<RoleGuide />);

    expect(guide().open).toBe(false);
    expect(screen.getByText("What each role can do")).toBeInTheDocument();
  });

  it("describes every role this build knows, once each", () => {
    render(<RoleGuide />);

    for (const role of OPERATOR_ROLES) {
      const described = describeRole(role);
      /*
        Every role in the list is described today. A role that gained an entry
        in OPERATOR_ROLES and no description would render nothing here, and the
        row's chip alone would be the only thing saying it exists.
      */
      expect(described, `${role} has no description`).not.toBeNull();
      expect(screen.getAllByText(described!.label)).toHaveLength(1);
      expect(screen.getAllByText(described!.can)).toHaveLength(1);
      if (described!.cannot) {
        expect(screen.getAllByText(described!.cannot)).toHaveLength(1);
      }
    }
  });

  it("says what a skipper gets, in the words the contract gives", () => {
    /*
      The two claims an owner acts on, pinned literally rather than through
      `describeRole`: this is the sentence somebody reads before handing a
      crew phone over, and a test that read the same function it renders
      would pass whatever that function said.
    */
    render(<RoleGuide />);

    expect(
      screen.getByText(
        "Who is booked on today's departures, and checking them in as they arrive.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Cannot change payout details, and cannot add, remove or pause people.",
      ),
    ).toBeInTheDocument();
  });

  it("keeps the reasons one tap away rather than on the screen", () => {
    // The four paragraphs under "Why the roles are different" are an answer
    // in Help now (#80 t4), and this is the way back to them.
    render(<RoleGuide />);

    expect(
      screen.getByRole("link", { name: "Why the roles are different" }),
    ).toHaveAttribute("href", helpHref("why-roles-differ"));
  });
});
