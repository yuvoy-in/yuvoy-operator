import { describe, it, expect, vi, beforeEach } from "vitest";
import { OperatorApiError } from "@/lib/api/errors";
import { inviteMember, type InviteState } from "./actions";

/**
 * `POST /team`, as the invite form sends it and reads it back.
 *
 * yuvoy-operator#91 f20: an optional email on the invitation, `sent` read back
 * rather than assumed, the API's `note` rendered when nothing went, and a bad
 * address refused on the email field rather than on the number.
 *
 * The session, the API client and the cache are replaced, and nothing else:
 * what is under test is what this action sends and what it makes of the
 * answer, which is everything the receipt then says.
 */
const post = vi.fn();
const revalidatePath = vi.fn();

vi.mock("@/lib/auth/session", () => ({
  requireOperator: async () => ({ token: "tok_owner", me: { id: "usr_1" } }),
}));
vi.mock("@/lib/api/server-client", () => ({
  operatorApi: () => ({ POST: post }),
}));
vi.mock("next/cache", () => ({
  revalidatePath: (path: string) => revalidatePath(path),
}));

const EM_DASH = "\u2014";

function form(fields: Record<string, string>) {
  const data = new FormData();
  const all = { name: "Ramesh Toppo", phone: "+919000000104", role: "STAFF" };
  for (const [key, value] of Object.entries({ ...all, ...fields })) {
    data.set(key, value);
  }
  return data;
}

async function invite(fields: Record<string, string> = {}, prev = {}) {
  return inviteMember(prev as InviteState, form(fields));
}

beforeEach(() => {
  post.mockReset();
  revalidatePath.mockReset();
  post.mockResolvedValue({
    data: {
      sent: true,
      role: "STAFF",
      joinUrl: "https://operators.yuvoy.in/join/jn_reef",
    },
  });
});

describe("what the invitation sends", () => {
  it("carries the email when one is given, trimmed", async () => {
    await invite({ email: "  ramesh@example.com " });
    expect(post).toHaveBeenCalledWith("/team", {
      body: {
        phone: "+919000000104",
        name: "Ramesh Toppo",
        role: "STAFF",
        email: "ramesh@example.com",
      },
    });
  });

  it("leaves it out when the field is blank, rather than sending an empty one", async () => {
    await invite({ email: "   " });
    expect(post.mock.calls[0][1].body).not.toHaveProperty("email");
  });

  it("refuses a mistyped address on the email field, before anything is sent", async () => {
    const state = await invite({ email: "ramesh@" }, { attempt: 2 });
    expect(post).not.toHaveBeenCalled();
    expect(state.field).toBe("email");
    expect(state.message).toBe(
      "That does not look like an email address. Check it, or leave it out.",
    );
    // What was typed comes back, so fixing one character is not retyping three
    // fields, and the form remounts to show it.
    expect(state.values).toEqual({
      name: "Ramesh Toppo",
      phone: "+919000000104",
      email: "ramesh@",
      role: "STAFF",
    });
    expect(state.attempt).toBe(3);
  });
});

describe("whether anything was actually sent", () => {
  it("says delivered only when the API says `sent: true`", async () => {
    const state = await invite({ email: "ramesh@example.com" });
    expect(state.sent?.delivered).toBe(true);
    expect(state.note).toBeUndefined();
    expect(state.joinUrl).toBe("https://operators.yuvoy.in/join/jn_reef");
  });

  it("says not delivered on `sent: false`, with the API's note", async () => {
    post.mockResolvedValue({
      data: {
        sent: false,
        role: "STAFF",
        note: "We could not send that invitation to them. Give them the join link and the code yourself, or add them again with an email address.",
        joinUrl: "https://operators.yuvoy.in/join/jn_reef",
      },
    });
    const state = await invite();
    expect(state.sent?.delivered).toBe(false);
    expect(state.note).toBe(
      "We could not send that invitation to them. Give them the join link and the code yourself, or add them again with an email address.",
    );
  });

  it("reads an absent `sent` as not sent, never as sent", async () => {
    /*
      The failure of claiming a send nobody carried is a colleague waiting on
      a phone. The failure of the reverse is a link passed on by hand.
    */
    post.mockResolvedValue({ data: { role: "STAFF" } });
    const state = await invite();
    expect(state.sent?.delivered).toBe(false);
  });

  it("renders the API's note without a long dash, whatever the API wrote", async () => {
    post.mockResolvedValue({
      data: {
        sent: false,
        note: `we could not send that invitation ${EM_DASH} pass the link on yourself`,
      },
    });
    const state = await invite();
    expect(state.note).not.toMatch(/[\u2013\u2014\u2015]/);
    expect(state.note).toBe(
      "We could not send that invitation. Pass the link on yourself.",
    );
  });

  it("keeps the role the API granted rather than the one asked for", async () => {
    post.mockResolvedValue({ data: { sent: true, role: "OWNER" } });
    const state = await invite({ role: "OWNER" });
    expect(state.sent?.role).toBe("OWNER");
  });
});

describe("the refusals, each on the field it is about", () => {
  it("puts an address the API refuses on the email field, in its words", async () => {
    post.mockRejectedValue(
      new OperatorApiError({
        status: 400,
        code: "invalid_input",
        message: "that email address does not look right",
        details: { email: "for example ramesh@example.com" },
      }),
    );
    const state = await invite({ email: "ramesh@example.com" });
    expect(state.field).toBe("email");
    expect(state.message).toBe("That email address does not look right.");
    expect(state.values?.email).toBe("ramesh@example.com");
  });

  it("puts a number the API refuses on the number, with or without details", async () => {
    for (const details of [{ phone: "for example +919000000101" }, undefined]) {
      post.mockRejectedValue(
        new OperatorApiError({
          status: 400,
          code: "invalid_input",
          message: "we need their number with the country code",
          details,
        }),
      );
      const state = await invite();
      expect(state.field, JSON.stringify(details)).toBe("phone");
      expect(state.message).toBe("We need their number with the country code.");
    }
  });

  it("says a suspended business cannot invite before any role sentence", async () => {
    post.mockRejectedValue(
      new OperatorApiError({
        status: 403,
        code: "account_suspended",
        message:
          "Your account has been suspended. Please reach out to admin for help.",
      }),
    );
    const state = await invite();
    expect(state.message).toBe(
      "Your account has been suspended. Please reach out to admin for help.",
    );
  });
});

describe("the list behind the receipt", () => {
  it("is revalidated when the invitation was created", async () => {
    await invite();
    expect(revalidatePath).toHaveBeenCalledWith("/team");
  });

  it("is left alone when nothing changed", async () => {
    await invite({ email: "ramesh@" });
    post.mockRejectedValue(
      new OperatorApiError({
        status: 409,
        code: "cannot_invite",
        message: "We could not send that invitation.",
      }),
    );
    await invite();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
