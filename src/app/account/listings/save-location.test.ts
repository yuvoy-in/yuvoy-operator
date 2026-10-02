import { beforeEach, describe, expect, it, vi } from "vitest";
import { OperatorApiError } from "@/lib/api/errors";

/*
  The Location step's save, for the pin (yuvoy-operator#113): both numbers,
  or both null to clear, and nothing at all when the form had no pin on it.
*/

const patch = vi.fn();
const redirect = vi.fn();

vi.mock("@/lib/api/server-client", () => ({
  operatorApi: () => ({ PATCH: patch }),
}));
vi.mock("@/lib/auth/session", () => ({
  requireOperator: async () => ({ token: "tok", me: { canManage: true } }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => redirect(to),
}));

const { saveLocation } = await import("./builder-actions");

function form(extra: Record<string, string> = {}): FormData {
  const f = new FormData();
  const fields = {
    id: "exp_1",
    meetingPoint: "Jetty 3",
    meetingLandmark: "",
    inclusions: "",
    requirements: "",
    safetyNotes: "",
    screenerKey: "",
    ...extra,
  };
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

const sentBody = () => patch.mock.calls[0][1].body as Record<string, unknown>;

beforeEach(() => {
  patch.mockReset();
  redirect.mockReset();
  patch.mockResolvedValue({ data: {}, error: undefined });
});

describe("saving the Location step's pin", () => {
  it("sends no pin when the form had none", async () => {
    await saveLocation({}, form());
    expect(sentBody()).not.toHaveProperty("meetingLat");
    expect(sentBody()).not.toHaveProperty("meetingLng");
    expect(redirect).toHaveBeenCalled();
  });

  it("sends both numbers, rounded to what the column keeps", async () => {
    await saveLocation(
      {},
      form({ meetingLat: "11.96950049", meetingLng: "92.9631" }),
    );
    expect(sentBody()).toMatchObject({
      meetingLat: 11.9695,
      meetingLng: 92.9631,
    });
  });

  it("clears with explicit nulls", async () => {
    await saveLocation({}, form({ meetingLat: "", meetingLng: "" }));
    expect(sentBody()).toMatchObject({ meetingLat: null, meetingLng: null });
  });

  it("refuses half a pin before asking the API", async () => {
    const state = await saveLocation({}, form({ meetingLat: "11.9695" }));
    expect(patch).not.toHaveBeenCalled();
    expect(state.message).toBe(
      "That pin is not a place on the map. Set it again, or remove it.",
    );
  });

  it("says a refused pin plainly, not as the field's name", async () => {
    patch.mockResolvedValue({
      data: undefined,
      error: new OperatorApiError({
        code: "invalid_input",
        message: "we could not read: meetingLat",
        status: 400,
        details: { meetingLat: "must be 90 or less" },
      }),
    });
    const state = await saveLocation(
      {},
      form({ meetingLat: "11.9695", meetingLng: "92.9631" }),
    );
    expect(state.message).toBe(
      "That pin is not a place on the map. Set it again, or remove it.",
    );
  });

  it("says when the API does not take pins yet", async () => {
    patch.mockResolvedValue({
      data: undefined,
      error: new OperatorApiError({
        code: "invalid_input",
        message: "we do not know how to change that: meetingLat, meetingLng",
        status: 400,
        details: { unknownFields: ["meetingLat", "meetingLng"] },
      }),
    });
    const state = await saveLocation(
      {},
      form({ meetingLat: "11.9695", meetingLng: "92.9631" }),
    );
    expect(state.message).toBe(
      "Pins are not switched on yet. Remove the pin to save.",
    );
  });
});
