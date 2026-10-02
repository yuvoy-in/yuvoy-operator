import { beforeEach, describe, expect, it, vi } from "vitest";
import { OperatorApiError } from "@/lib/api/errors";

/*
  Saving the week the picker builds (yuvoy-operator#111): one
  `PUT /experiences/{id}/schedule` with the whole schedule, and the API's row
  problems said by day and time, since the picker draws no rows.
*/

const put = vi.fn();
const revalidatePath = vi.fn();

vi.mock("@/lib/api/server-client", () => ({
  operatorApi: () => ({ PUT: put }),
}));
vi.mock("@/lib/auth/session", () => ({
  requireOperator: async () => ({ token: "tok", me: { canManage: true } }),
}));
vi.mock("next/cache", () => ({
  revalidatePath: (path: string) => revalidatePath(path),
}));

const { saveSchedule } = await import("./actions");

type Row = { weekday: number; startTime: string; seats: number };

function form(weekly: Row[]): FormData {
  const f = new FormData();
  f.set("experienceId", "exp_1");
  f.set("weekly", JSON.stringify(weekly));
  return f;
}

beforeEach(() => {
  put.mockReset();
  revalidatePath.mockReset();
});

const WEEK = [
  { weekday: 1, startTime: "07:30", seats: 10 },
  { weekday: 3, startTime: "07:30", seats: 10 },
];

describe("saving the week", () => {
  it("sends the whole schedule in one PUT", async () => {
    put.mockResolvedValue({
      data: { onSale: true, note: "2 days a week, from now on." },
      error: undefined,
    });

    const state = await saveSchedule({}, form(WEEK));

    expect(put).toHaveBeenCalledTimes(1);
    expect(put).toHaveBeenCalledWith("/experiences/{id}/schedule", {
      params: { path: { id: "exp_1" } },
      body: { weekly: WEEK },
    });
    expect(state).toEqual({ done: true, note: "2 days a week, from now on." });
  });

  it("refuses one weekday and time twice before the API is asked", async () => {
    const state = await saveSchedule(
      {},
      form([...WEEK, { weekday: 1, startTime: "07:30", seats: 4 }]),
    );

    expect(state.message).toBe("Monday at 07:30 is listed twice.");
    expect(put).not.toHaveBeenCalled();
  });

  it("names every row the API refused by its day and time", async () => {
    put.mockResolvedValue({
      data: undefined,
      error: new OperatorApiError({
        code: "invalid_input",
        message: "Some rows need fixing.",
        status: 400,
        details: { "weekly[1].seats": "seats are 1 to 200" },
      }),
    });

    const state = await saveSchedule({}, form(WEEK));

    expect(state).toEqual({
      message: "Some rows need fixing.",
      rowProblems: ["Wednesday at 07:30: Seats are 1 to 200."],
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
