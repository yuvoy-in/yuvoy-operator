import { beforeEach, describe, expect, it, vi } from "vitest";

/*
  A change to a published listing, at the boundary the browser cannot see.
  Since D-032.3 the API answers `200` with everything applied or `201` with
  something in review, and names both halves; the action hands that back
  rather than a bare "submitted".
*/

const post = vi.fn();

vi.mock("@/lib/api/server-client", () => ({
  operatorApi: () => ({ POST: post }),
}));
vi.mock("@/lib/auth/session", () => ({
  requireOperator: async () => ({ token: "tok", me: { canManage: true } }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { submitRevision } = await import("./actions");

function form(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

beforeEach(() => post.mockReset());

describe("submitRevision", () => {
  it("hands back what went live and what is with us", async () => {
    post.mockResolvedValue({
      data: {
        applied: ["unitPricePaise"],
        inReview: ["description"],
        state: "submitted",
        next: "The first list is live now. We read the second, and the listing keeps selling on the old wording meanwhile.",
        note: "Bookings already made are unaffected: they keep the price and terms they were made on.",
      },
      error: undefined,
    });

    const state = await submitRevision(
      {},
      form({ id: "exp_reef", unitPrice: "5,000", description: "New words" }),
    );

    expect(post).toHaveBeenCalledWith("/experiences/{id}/revisions", {
      params: { path: { id: "exp_reef" } },
      body: { description: "New words", unitPricePaise: 500000 },
    });
    expect(state).toEqual({
      outcome: {
        applied: ["unitPricePaise"],
        inReview: ["description"],
        next: "The first list is live now. We read the second, and the listing keeps selling on the old wording meanwhile.",
        note: "Bookings already made are unaffected: they keep the price and terms they were made on.",
      },
    });
  });

  it("sends a moved pin as both numbers, and a removed one as nulls", async () => {
    post.mockResolvedValue({
      data: { applied: ["meetingLat", "meetingLng"], inReview: [] },
      error: undefined,
    });

    await submitRevision(
      {},
      form({ id: "exp_reef", meetingLat: "11.9695", meetingLng: "92.9631" }),
    );
    expect(post.mock.calls[0][1].body).toEqual({
      meetingLat: 11.9695,
      meetingLng: 92.9631,
    });

    await submitRevision(
      {},
      form({ id: "exp_reef", meetingLat: "", meetingLng: "" }),
    );
    expect(post.mock.calls[1][1].body).toEqual({
      meetingLat: null,
      meetingLng: null,
    });
  });

  it("refuses half a pin before asking the API", async () => {
    const state = await submitRevision(
      {},
      form({ id: "exp_reef", meetingLat: "11.9695" }),
    );
    expect(post).not.toHaveBeenCalled();
    expect(state.message).toBe(
      "That pin is not a place on the map. Set it again, or remove it.",
    );
  });

  it("sends nothing when nothing changed", async () => {
    const state = await submitRevision({}, form({ id: "exp_reef" }));
    expect(post).not.toHaveBeenCalled();
    expect(state.message).toBe(
      "Nothing has changed, so there is nothing to send.",
    );
  });
});
