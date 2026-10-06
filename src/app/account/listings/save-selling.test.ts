import { beforeEach, describe, expect, it, vi } from "vitest";

/*
  The Selling step's save, for the price (yuvoy-operator#144): the paise that
  were typed, or a refusal before anything is sent. "Rs. 1500" was saved as
  15 paise, because the box was read by deleting everything but digits and
  dots and the dot after "Rs" stayed.
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

const { saveSelling } = await import("./builder-actions");

function form(unitPrice: string): FormData {
  const f = new FormData();
  const fields = {
    id: "exp_1",
    unitPrice,
    pricingUnit: "per_person",
    maxPartySize: "6",
    durationMinutes: "120",
    bookingMode: "allotment",
  };
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

beforeEach(() => {
  patch.mockReset();
  redirect.mockReset();
  patch.mockResolvedValue({ data: {}, error: undefined });
});

describe("saving the Selling step's price", () => {
  it.each(["1500", "Rs. 1500", "₹1,500.00"])(
    "sends %s as 150000 paise",
    async (typed) => {
      await saveSelling({}, form(typed));
      expect(patch.mock.calls[0][1].body).toMatchObject({
        unitPricePaise: 150_000,
      });
      expect(redirect).toHaveBeenCalled();
    },
  );

  it.each(["1.005", "1500-2000", ""])(
    "refuses %j before asking the API",
    async (typed) => {
      const state = await saveSelling({}, form(typed));
      expect(patch).not.toHaveBeenCalled();
      expect(state).toEqual({
        message: "Check the price.",
        fields: ["unitPrice"],
      });
    },
  );
});
