import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OperatorApiError } from "@/lib/api/errors";

/*
  Pausing a listing, at the boundary the browser cannot see: the write itself
  (yuvoy-operator#30 §6). The sentence under test is the `409 sale_in_progress`
  one, which said "try again in a few minutes" whatever the wait was. An
  accepted request holds for up to twelve hours, so an operator tried again,
  was refused again, and concluded the button was broken.
*/

const post = vi.fn();
const revalidatePath = vi.fn();
let canManage = true;

vi.mock("@/lib/api/server-client", () => ({
  operatorApi: () => ({ POST: post }),
}));
vi.mock("@/lib/auth/session", () => ({
  requireOperator: async () => ({ token: "tok", me: { canManage } }),
}));
vi.mock("next/cache", () => ({
  revalidatePath: (path: string) => revalidatePath(path),
}));

const { pauseListing } = await import("./actions");

/** The clock the message is written against: 11:30 in the market. */
const NOW = Date.parse("2026-09-22T06:00:00Z");

function form(over: Record<string, string> = {}): FormData {
  const f = new FormData();
  const fields = {
    id: "exp_snorkel",
    reasonCode: "not_running",
    note: "",
    confirmExperienceId: "exp_snorkel",
    ...over,
  };
  for (const [key, value] of Object.entries(fields)) f.set(key, value);
  return f;
}

function refuses(code: string, message: string, details?: unknown) {
  post.mockResolvedValue({
    data: undefined,
    error: new OperatorApiError({ code, message, status: 409, details }),
  });
}

beforeEach(() => {
  post.mockReset();
  revalidatePath.mockReset();
  canManage = true;
  // The refusal is written against the clock at the moment of the tap.
  vi.spyOn(Date, "now").mockReturnValue(NOW);
});

afterEach(() => vi.restoreAllMocks());

describe("pausing a listing", () => {
  it("sends the reason and the typed id, and revalidates the hub", async () => {
    post.mockResolvedValue({
      data: {
        upcomingDepartures: 4,
        bookingsToHonour: 1,
        guestsToHonour: 2,
        note: "1 booking is unchanged.",
        next: "Resume on the listing puts it back straight away.",
      },
      error: undefined,
    });

    const state = await pauseListing({}, form({ note: "Engine out." }));

    expect(post.mock.calls[0][1].body).toEqual({
      reasonCode: "not_running",
      confirmExperienceId: "exp_snorkel",
      note: "Engine out.",
    });
    expect(state.done?.upcomingDepartures).toBe(4);
    expect(revalidatePath).toHaveBeenCalledWith("/today/listing/exp_snorkel");
  });

  it("refuses an id that does not match, without asking the API", async () => {
    const state = await pauseListing(
      {},
      form({ confirmExperienceId: "exp_x" }),
    );

    expect(state.message).toBe(
      "That id does not match this listing. Nothing changed.",
    );
    expect(post).not.toHaveBeenCalled();
  });
});

/*
  `409 sale_in_progress`. `details` carries `heldUntil` (the last unpaid hold's
  end) and `openRequests` (how many to answer first), both optional.
*/
describe("a pause refused because the listing is selling", () => {
  it("names when the hold ends, in the market's clock", async () => {
    refuses("sale_in_progress", "somebody holds unpaid seats", {
      heldUntil: "2026-09-22T09:11:00Z",
    });

    const state = await pauseListing({}, form());

    expect(state.message).toBe(
      "Somebody holds unpaid seats on this listing until 14:41. You can pause it after that. Nothing changed.",
    );
  });

  it("names the requests waiting for an answer", async () => {
    refuses("sale_in_progress", "requests are waiting", { openRequests: 2 });

    const state = await pauseListing({}, form());

    expect(state.message).toBe(
      "2 requests on this listing are waiting for your answer. Accept or decline them first. Nothing changed.",
    );
  });

  it("falls back to the API's own sentence when it sends no details", async () => {
    refuses("sale_in_progress", "somebody is paying for this listing");

    const state = await pauseListing({}, form());

    expect(state.message).toBe("Somebody is paying for this listing.");
  });

  /*
    And the answers already given come back, because React resets an
    uncontrolled form when the action completes: a refusal that emptied the
    reason would fail the next attempt for a different reason than the one on
    screen.
  */
  it("hands back what was typed, and counts the attempt", async () => {
    refuses("sale_in_progress", "somebody holds unpaid seats", {
      openRequests: 1,
    });

    const state = await pauseListing({ attempt: 1 }, form());

    expect(state.typed).toEqual({
      reasonCode: "not_running",
      confirmExperienceId: "exp_snorkel",
    });
    expect(state.attempt).toBe(2);
  });
});
