import { http, HttpResponse } from "msw";
import {
  type MockMessage,
  type MockTeamMember,
  type MockThread,
} from "./fixtures";

/**
 * The conversations routes of the mock API: a booking's messages, sending
 * one, marking them read and the list of conversations. Moved out of
 * `handlers.ts` as they were (yuvoy-operator#178). The helpers and the state
 * stay there. The state comes in through a getter in `deps`, because
 * `__resetOperatorMocks` replaces it.
 */
export interface ConversationMockDeps {
  url: (path: string) => string;
  requireSession: (request: Request) => Response | null;
  requireWritable: (request: Request) => Response | null;
  envelope: (
    code: string,
    message: string,
    status: number,
    details?: unknown,
  ) => Response;
  sessionUser: (request: Request) => MockTeamMember | null;
  isNewBusiness: (request: Request) => boolean;
  threadFor: (id: string) => MockThread | null;
  bookingOf: (id: string) => {
    reference: string;
    experience: string;
    slotId: string;
    slot: { startsAt: string; timezone: string };
  } | null;
  threadRows: () => {
    bookingId: string;
    reference: string;
    experience: string;
    slotId: string;
    slot: { startsAt: string; timezone: string };
    lastMessageAt: string;
    lastFrom: MockMessage["from"];
    unreadCount: number;
  }[];
  contactDetailIn: (text: string) => "phone" | "email" | "link" | null;
  contactKindWords: (kind: "phone" | "email" | "link") => string;
  IDEMPOTENCY_KEY: RegExp;
  /** Sends kept by idempotency key. Cleared in place on reset, so not a getter. */
  messageKeys: Map<string, { fingerprint: string; message: MockMessage }>;
  /** Conversations, by booking. */
  threads: () => MockThread[];
}

export function conversationHandlers(deps: ConversationMockDeps) {
  const {
    url,
    requireSession,
    requireWritable,
    envelope,
    sessionUser,
    isNewBusiness,
    threadFor,
    bookingOf,
    threadRows,
    contactDetailIn,
    contactKindWords,
    IDEMPOTENCY_KEY,
    messageKeys,
    threads,
  } = deps;

  return [
    /* ------------------------------------------------ conversations ------- */

    http.get(url("/bookings/:id/messages"), async ({ request, params }) => {
      const failed = requireSession(request);
      if (failed) return failed;

      const id = String(params.id);
      const thread = threadFor(id);
      /*
        A booking with no conversation is an EMPTY one, not a 404 — nobody has
        written in it yet, and the composer belongs there. Only a booking that is
        not this operator's is missing, and that is what `bookingOf` decides.
      */
      if (!bookingOf(id)) return envelope("not_found", "No such booking.", 404);

      const all = thread?.messages ?? [];
      const limitRaw = Number(new URL(request.url).searchParams.get("limit"));
      const limit =
        Number.isInteger(limitRaw) && limitRaw > 0
          ? Math.min(limitRaw, 200)
          : 50;
      const cursor = new URL(request.url).searchParams.get("cursor");

      /*
        The cursor is the index one past the oldest message already sent, so
        paging walks BACKWARDS through a list stored oldest-first. Opaque to the
        client by contract, and this is a mock, so a number is honest enough —
        what matters is that a cursor this conversation did not issue is a 400,
        which is the branch a client that constructs one would hit.
      */
      let end = all.length;
      if (cursor !== null) {
        const parsed = Number(cursor);
        if (!Number.isInteger(parsed) || parsed < 0 || parsed > all.length) {
          return envelope("invalid_input", "Not a cursor we issued.", 400);
        }
        end = parsed;
      }
      const start = Math.max(0, end - limit);
      const page = all.slice(start, end);

      const closed = thread?.closedReason;
      return HttpResponse.json({
        messages: page,
        complete: start === 0,
        ...(start > 0 ? { nextCursor: String(start) } : {}),
        unreadCount: thread?.unread ?? 0,
        canWrite: !closed,
        ...(closed ? { closedReason: closed } : {}),
        /*
          Absent on a cancelled or declined booking, by the contract: there is no
          moment writing stops on its own, because it has already stopped.
        */
        ...(closed
          ? {}
          : {
              writableUntil: new Date(
                Date.now() + 7 * 86_400_000,
              ).toISOString(),
            }),
      });
    }),

    http.post(url("/bookings/:id/messages"), async ({ request, params }) => {
      const failed = requireSession(request);
      if (failed) return failed;
      /*
        NOT `requireWritable`. "It still works while the business is suspended"
        (#50): a suspended business must still be able to answer the travellers it
        already has, and a mock that refused would let the portal hide the composer
        from exactly the operator who most needs it.

        And no role gate: "any role can write: whoever is holding the phone answers
        the question."
      */

      const id = String(params.id);

      /*
        The optional Idempotency-Key, as the API's middleware takes it (B4):
        after the session, before the booking is even looked up. Scoped to the
        person, and the request's fingerprint is the booking and the body as
        sent, so a resend of the same words replays the first answer, and the
        same key on other words is refused. Only a success is kept: a refusal
        lets the key go, so the same request can run again.
      */
      const key = request.headers.get("Idempotency-Key");
      if (key !== null && !IDEMPOTENCY_KEY.test(key)) {
        return envelope(
          "idempotency_key_malformed",
          "Idempotency-Key must be 16-128 characters of A-Z a-z 0-9 _ . : -",
          400,
        );
      }
      const raw = await request.text();
      const scope = key ? `${sessionUser(request)!.id}:${key}` : null;
      const fingerprint = `${id}\n${raw}`;
      const kept = scope ? messageKeys.get(scope) : undefined;
      if (kept) {
        if (kept.fingerprint !== fingerprint) {
          return envelope(
            "idempotency_key_reuse",
            "that Idempotency-Key was already used for a different request",
            409,
          );
        }
        return HttpResponse.json(kept.message, {
          status: 201,
          headers: { "Idempotent-Replay": "true" },
        });
      }

      let body: { text?: unknown };
      try {
        body = JSON.parse(raw) as { text?: unknown };
      } catch {
        return envelope(
          "invalid_input",
          "We could not read that message.",
          400,
          {
            text: "required",
          },
        );
      }
      const text = typeof body.text === "string" ? body.text.trim() : "";

      // The API's own sentences (`readMessageText`), in its order.
      const length = [...text].length;
      if (length > 1000) {
        return envelope(
          "invalid_input",
          `A message can be up to 1000 characters, and this one is ${length}. Shorten it and send it again.`,
          400,
          { text: "too long" },
        );
      }

      const kind = contactDetailIn(text);
      if (kind) {
        /*
          The message names the KIND and never repeats any of the text: "nothing
          is stored, and the refusal names the kind without repeating any of it".
          A refusal that echoed the number back would put it on a screen, which is
          the thing the rule exists to prevent.
        */
        const out =
          kind === "email"
            ? "Take the address out"
            : kind === "link"
              ? "Take the link out"
              : "Take the number out";
        return envelope(
          "invalid_input",
          `Messages cannot include phone numbers, email addresses or links. This one looks like it has ${contactKindWords(kind)}. ${out} and send the message again.`,
          400,
          { text: "contact details", contactDetail: kind },
        );
      }

      if (length === 0) {
        return envelope(
          "invalid_input",
          "Write something before sending.",
          400,
          {
            text: "required",
          },
        );
      }

      /*
        The text is read before the booking, as the API's handler reads it, so
        a refused message on a booking that is gone is the text's refusal.
      */
      if (!bookingOf(id)) return envelope("not_found", "No such booking.", 404);

      const thread = threadFor(id);
      if (thread?.closedReason) {
        return HttpResponse.json(
          {
            error: {
              code: "messages_closed",
              message:
                thread.closedReason === "cancelled"
                  ? "This booking was cancelled, so no more messages can be sent."
                  : thread.closedReason === "declined"
                    ? "This booking was declined, so no more messages can be sent."
                    : "Messages for this trip are closed.",
              details: { reason: thread.closedReason },
            },
          },
          { status: 409 },
        );
      }

      const message: MockMessage = {
        id: `msg_${Math.random().toString(36).slice(2, 10)}`,
        from: "operator",
        // "Signed with the name of whoever is signed in."
        senderName: sessionUser(request)!.name,
        text,
        sentAt: new Date().toISOString(),
      };
      if (thread) {
        thread.messages.push(message);
      } else {
        threads().push({ bookingId: id, messages: [message], unread: 0 });
      }
      if (scope) messageKeys.set(scope, { fingerprint, message });
      return HttpResponse.json(message, { status: 201 });
    }),

    http.post(
      url("/bookings/:id/messages/read"),
      async ({ request, params }) => {
        const failed = requireSession(request);
        if (failed) return failed;

        const id = String(params.id);
        const thread = threadFor(id);
        if (!thread) return envelope("not_found", "No such conversation.", 404);

        const { upTo } = (await request.json()) as { upTo?: string };
        const at = thread.messages.findIndex((m) => m.id === upTo);
        /*
          "No such booking for this operator, or that message is not in its
          conversation. Deliberately indistinguishable." One answer, and the mock
          does not tell them apart either.
        */
        if (at < 0) return envelope("not_found", "No such message.", 404);

        /*
          The marker moves to this message "and so to everything before it", and
          NEVER back. What stays unread is the traveller's messages after it — which
          is the whole reason the endpoint is named by a message rather than being
          "all of it, now": one that arrived while somebody read stays unread.
        */
        const after = thread.messages
          .slice(at + 1)
          .filter((m) => m.from === "traveller").length;
        thread.unread = Math.min(thread.unread, after);
        return HttpResponse.json({ unreadCount: thread.unread });
      },
    ),

    http.get(url("/message-threads"), async ({ request }) => {
      const failed = requireSession(request);
      if (failed) return failed;
      if (isNewBusiness(request)) {
        return HttpResponse.json({ threads: [], complete: true });
      }

      const params = new URL(request.url).searchParams;
      /*
        `unread=true` lists only the conversations with something unread
        (yuvoy-api#282 item 6), in the same order and pages. Anything but
        `true`, `false` or nothing is refused, as the API refuses it.
      */
      const unreadOnly = params.get("unread");
      if (
        unreadOnly !== null &&
        unreadOnly !== "true" &&
        unreadOnly !== "false"
      ) {
        return envelope("invalid_input", "unread is true or false", 400, {
          unread: "true or false",
        });
      }
      const rows = threadRows()
        .filter((r) => unreadOnly !== "true" || r.unreadCount > 0)
        // "The one with the latest message first."
        .sort(
          (a, b) => Date.parse(b.lastMessageAt) - Date.parse(a.lastMessageAt),
        );

      const limitRaw = Number(params.get("limit"));
      const limit =
        Number.isInteger(limitRaw) && limitRaw > 0
          ? Math.min(limitRaw, 200)
          : 50;
      const cursor = params.get("cursor");
      let start = 0;
      if (cursor !== null) {
        const parsed = Number(cursor);
        if (!Number.isInteger(parsed) || parsed < 0 || parsed > rows.length) {
          return envelope("invalid_input", "Not a cursor we issued.", 400);
        }
        start = parsed;
      }
      const page = rows.slice(start, start + limit);
      const end = start + page.length;

      return HttpResponse.json({
        threads: page,
        // "Told rather than inferred", so the client never has to guess from a
        // page's length whether a full one was the last.
        complete: end >= rows.length,
        ...(end < rows.length ? { nextCursor: String(end) } : {}),
      });
    }),
  ];
}
