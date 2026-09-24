import { beforeEach, describe, expect, it, vi } from "vitest";

/*
  The business-details write, read by its STATUS rather than by its body.

  On a LIVE account `PUT /profile` answers `202 { state: "in_review", next }`:
  the change is recorded for review and the details on file stay in place,
  because the verified documents were checked against them (D-032.3). The
  contract declared that answer under `GET /profile` until yuvoy-api#222 moved
  it to the `PUT`, and the screen used to say "Saved" (yuvoy-operator#89 f10).

  Its own file rather than `actions.test.ts`, so the document half of these
  actions can grow tests without the two colliding.
*/

const put = vi.fn();
const revalidatePath = vi.fn();

vi.mock("@/lib/api/server-client", () => ({
  operatorApi: () => ({ PUT: put, POST: vi.fn() }),
}));
vi.mock("@/lib/auth/session", () => ({
  requireOperator: async () => ({ token: "tok", me: { canManage: true } }),
}));
vi.mock("next/cache", () => ({
  revalidatePath: (path: string) => revalidatePath(path),
}));

const { saveDetails } = await import("./actions");

function form(values: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.set(k, v);
  return f;
}

const COMPLETE = {
  legalName: "Nemo Reef Watersports",
  entityType: "sole_proprietor",
  addressLine1: "Beach 3",
  locality: "Havelock",
  region: "Andaman and Nicobar",
  postalCode: "744211",
  country: "IN",
};

function answered(status: number, data: unknown) {
  return { data, error: undefined, response: new Response(null, { status }) };
}

beforeEach(() => {
  put.mockReset();
  revalidatePath.mockReset();
});

describe("saving the business details: yuvoy-operator#89 f10", () => {
  it("reports a 202 as sent for a check, never as saved", async () => {
    put.mockResolvedValue(
      answered(202, { state: "in_review", next: "We check a change…" }),
    );

    const result = await saveDetails({}, form(COMPLETE));

    expect(result).toEqual({ inReview: true });
    expect(result.saved).toBeUndefined();
  });

  it("re-renders only this screen on a 202, for the note that a change is waiting", async () => {
    /*
      `/account`'s blockers are derived from what is on file, which a 202 did
      not change. This screen gains the "waiting for our check" note, which
      the operator meets when they put the receipt away.
    */
    put.mockResolvedValue(answered(202, { state: "in_review", next: "…" }));
    await saveDetails({}, form(COMPLETE));
    expect(revalidatePath).toHaveBeenCalledTimes(1);
    expect(revalidatePath).toHaveBeenCalledWith("/profile");
  });

  it("reports a 200 as saved and refreshes the details and the blockers", async () => {
    put.mockResolvedValue(answered(200, { missing: [] }));

    const result = await saveDetails({}, form(COMPLETE));

    expect(result).toEqual({ saved: true });
    expect(revalidatePath).toHaveBeenCalledWith("/profile");
    expect(revalidatePath).toHaveBeenCalledWith("/account");
  });

  it("sends the whole document, with an empty optional left out", async () => {
    put.mockResolvedValue(answered(200, {}));
    await saveDetails({}, form({ ...COMPLETE, gstin: "", addressLine2: "" }));

    const body = put.mock.calls[0][1].body;
    expect(body).toMatchObject({
      legalName: COMPLETE.legalName,
      postalCode: COMPLETE.postalCode,
    });
    expect(body).not.toHaveProperty("gstin");
    expect(body).not.toHaveProperty("addressLine2");
  });

  it("stops a missing required field before anything is sent", async () => {
    const result = await saveDetails({}, form({ ...COMPLETE, locality: "" }));
    expect(result.field).toBe("locality");
    expect(put).not.toHaveBeenCalled();
  });
});
