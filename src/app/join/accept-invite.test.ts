import { beforeEach, describe, expect, it, vi } from "vitest";
import { OperatorApiError } from "@/lib/api/errors";

/*
  Accepting an invitation by number and code (`POST /team/accept`), when the
  answer is one no retry can change. It read "We could not accept that
  invitation just now", which is an invitation to try again.
*/

const post = vi.fn();

vi.mock("@/lib/api/server-client", () => ({
  operatorApi: () => ({ POST: post }),
}));
vi.mock("@/lib/auth/session-writes", () => ({ writeSessionToken: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

const { acceptInvite } = await import("./actions");

function form(): FormData {
  const f = new FormData();
  f.set("phone", "+919000000104");
  f.set("code", "482913");
  return f;
}

function refuse(status: number, code: string, message: string) {
  post.mockResolvedValue({
    data: undefined,
    error: new OperatorApiError({ code, message, status }),
  });
}

beforeEach(() => post.mockReset());

describe("an invitation that cannot be accepted now", () => {
  it("says the business is on hold, and who to call", async () => {
    refuse(403, "account_not_active", "this business cannot be joined");
    expect(await acceptInvite({}, form())).toEqual({
      message:
        "This business account is on hold, so it cannot be signed into. Call us on +91 81216 57657.",
    });
  });

  it("says a closed login cannot join, and who to call", async () => {
    refuse(
      403,
      "account_deletion_pending",
      "Your account is being deleted, so you cannot sign in. If you did not mean to close it, contact support.",
    );
    expect(await acceptInvite({}, form())).toEqual({
      message:
        "Your login was closed and is being deleted, so it cannot be signed into. If you did not mean to close it, call us on +91 81216 57657.",
    });
  });

  it("renders whom to ask when nobody can join the business right now", async () => {
    // `404 invitation_unavailable`: "The message says whom to ask, never why".
    refuse(
      404,
      "invitation_unavailable",
      "reef Divers cannot take anybody on right now. Ask its owner when it can",
    );
    expect(await acceptInvite({}, form())).toEqual({
      message:
        "Reef Divers cannot take anybody on right now. Ask its owner when it can.",
    });
  });

  it("says so in our words when the API sends none", async () => {
    refuse(404, "invitation_unavailable", "");
    expect(await acceptInvite({}, form())).toEqual({
      message:
        "Nobody can join this business right now, and your invitation still works once they can. Ask whoever invited you.",
    });
  });

  it("keeps one sentence for every wrong code", async () => {
    refuse(401, "unauthorized", "that invitation did not work");
    expect(await acceptInvite({}, form())).toEqual({
      message:
        "That did not work. Check the number and the code, and ask whoever invited you to send a new one. Codes last seven days.",
    });
  });

  it("is still a moment's trouble for anything else", async () => {
    refuse(500, "internal", "Something went wrong.");
    expect(await acceptInvite({}, form())).toEqual({
      message: "We could not accept that invitation just now.",
    });
  });
});
