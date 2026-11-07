import { beforeEach, describe, expect, it, vi } from "vitest";

/*
  Adding departures reads a form a visitor can send to the server. Two things
  hold that in: the session is checked before any of the form is parsed, and
  the weekdays list is capped at seven, so a form that sends the field
  thousands of times is refused instead of parsed.
*/

const post = vi.fn();
const revalidatePath = vi.fn();
const me = { canManage: true };
const signedIn = { value: true };

class Redirected extends Error {}

vi.mock("@/lib/api/server-client", () => ({
  operatorApi: () => ({ POST: post }),
}));
vi.mock("@/lib/auth/session", () => ({
  requireOperator: async () => {
    if (!signedIn.value) throw new Redirected("to sign in");
    return { token: "tok", me };
  },
}));
vi.mock("@/lib/format/market-time", async (original) => ({
  ...(await original<typeof import("@/lib/format/market-time")>()),
  marketDays: async () => ({ today: "2026-11-05" }),
}));
vi.mock("next/cache", () => ({
  revalidatePath: (path: string) => revalidatePath(path),
}));

const { addDepartures } = await import("./departure-actions");

function form(weekdays: string[]): FormData {
  const f = new FormData();
  f.set("experienceId", "exp_1");
  f.set("fromDate", "2026-11-09");
  f.set("toDate", "2026-11-30");
  f.append("times", "07:00");
  for (const d of weekdays) f.append("weekdays", d);
  f.set("seats", "10");
  f.set("capacity", "");
  return f;
}

beforeEach(() => {
  post.mockReset();
  revalidatePath.mockReset();
  me.canManage = true;
  signedIn.value = true;
});

describe("adding departures", () => {
  it("sends all seven weekdays when every day is ticked", async () => {
    post.mockResolvedValue({ data: { created: 22 }, error: undefined });
    const all = ["0", "1", "2", "3", "4", "5", "6"];

    const state = await addDepartures({}, form(all));

    expect(state.result?.created).toBe(22);
    expect(post.mock.calls[0][1].body.weekdays).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("refuses more than seven weekdays and sends nothing", async () => {
    const state = await addDepartures({}, form(Array(5000).fill("6")));

    expect(state.field).toBe("weekdays");
    expect(post).not.toHaveBeenCalled();
  });

  it("sends a visitor with no session to sign in before reading the form", async () => {
    signedIn.value = false;
    const broken = new FormData();

    await expect(addDepartures({}, broken)).rejects.toBeInstanceOf(Redirected);
    expect(post).not.toHaveBeenCalled();
  });

  it("tells somebody who may not manage departures that, whatever the form says", async () => {
    me.canManage = false;
    const broken = new FormData();

    const state = await addDepartures({}, broken);

    expect(state.field).toBeUndefined();
    expect(state.message).toMatch(/\S/);
    expect(post).not.toHaveBeenCalled();
  });
});
