"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  loadEarlier,
  markThreadRead,
  reloadThread,
  sendMessage,
} from "./conversation-actions";
import {
  REMOVED_TEXT,
  closedLine,
  newestMessageId,
  shortDay,
  textRemoved,
  type BookingThread,
  type ThreadMessage,
} from "@/lib/messages/thread";
import { marketTime } from "@/lib/format/market-time";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { textareaClass } from "@/components/ui/input";
import { cn } from "@/lib/cn";

/**
 * The conversation with a booking's traveller — yuvoy-operator#52 items 1 to 3.
 *
 * ## Oldest at the top, and the pages arrive backwards
 *
 * The endpoint's FIRST page is the most recent messages, and `nextCursor` walks
 * backwards through what came before, so an earlier page is PREPENDED. Reading
 * order is the opposite of loading order, and getting that wrong puts last
 * week's question under this morning's answer.
 *
 * ## What the traveller can and cannot see
 *
 * Every outgoing message carries the name of whoever wrote it, and the traveller
 * does not see that name: "the traveller sees the business's name beside its
 * messages, not the name of the person who wrote them." It is here because the
 * business needs to know which colleague already answered, which is the question
 * a shared phone creates.
 *
 * And no phone number, email or link may be typed on either side (D-018). The
 * portal does not check for them; the API refuses and says which kind it found.
 */
export function Conversation({
  bookingId,
  initial,
}: {
  bookingId: string;
  initial: BookingThread;
}) {
  const [thread, setThread] = useState(initial);
  const [text, setText] = useState("");
  const [failure, setFailure] = useState<string | null>(null);
  const [sending, startSending] = useTransition();
  const [loading, startLoading] = useTransition();

  /*
    Marked read once, for the page as it was first drawn.

    `upTo` names a message somebody was SHOWN, so it is taken from the first
    page before anything is appended: a message that arrives after the screen was
    drawn has to stay unread, which is the whole reason this endpoint is named by
    a message rather than being "all of it, now".

    The ref is what makes it once. React runs effects twice in development's
    StrictMode, and while marking twice is harmless (the marker never moves
    back), a second call after somebody has sent a reply would name a newer
    message than the one the count was taken against.
  */
  const marked = useRef(false);
  useEffect(() => {
    if (marked.current) return;
    if (initial.unreadCount <= 0) return;
    const upTo = newestMessageId(initial.messages);
    if (!upTo) return;
    marked.current = true;
    void markThreadRead(bookingId, upTo);
  }, [bookingId, initial]);

  function showEarlier() {
    const cursor = thread.nextCursor;
    if (!cursor) return;
    setFailure(null);
    startLoading(async () => {
      const page = await loadEarlier(bookingId, cursor);
      if (!page.ok) {
        setFailure(page.message);
        return;
      }
      setThread((was) => ({
        ...was,
        // PREPENDED. An earlier page is older than everything already drawn.
        messages: [...page.messages, ...was.messages],
        nextCursor: page.nextCursor,
        complete: page.complete,
      }));
    });
  }

  function send(event: React.FormEvent) {
    event.preventDefault();
    setFailure(null);
    startSending(async () => {
      const result = await sendMessage(bookingId, text);
      if (result.ok) {
        setThread((was) => ({
          ...was,
          messages: [...was.messages, result.message],
        }));
        setText("");
        return;
      }
      setFailure(result.message);
      /*
        The text stays on a refusal, deliberately. A message turned away for a
        phone number should have the number taken out and sent, not retyped from
        memory on a phone in the sun.
      */
      if (result.reload) {
        const fresh = await reloadThread(bookingId);
        // The composer goes with it: `canWrite` is false on the fresh thread.
        if (fresh) setThread(fresh);
      }
    });
  }

  return (
    /*
      Two ids, and they must not be the same one. `#conversation` is the anchor
      `/messages` links to, so it belongs on the SECTION; the heading needs its
      own for `aria-labelledby`. Sharing one made the document invalid and, more
      to the point, made the section's accessible name the whole conversation,
      so `getByLabel("Write to them")` matched the section as well as the box.
    */
    <section
      className="mt-10"
      aria-labelledby="conversation-heading"
      id="conversation"
    >
      <h2
        id="conversation-heading"
        className="font-display tracking-display text-2xl leading-tight"
      >
        Conversation
      </h2>
      {/*
        The one sentence kept (#80 t4): it changes what somebody types. "With
        this traveller, about this trip" described the section and went.
      */}
      <p className="text-forest/70 mt-2 text-sm">
        Phone numbers, email addresses and links are not allowed on either side.
      </p>

      {!thread.complete && thread.nextCursor ? (
        <div className="mt-4">
          <Button
            variant="secondary"
            block={false}
            disabled={loading}
            onClick={showEarlier}
          >
            {loading ? "Loading…" : "Show earlier messages"}
          </Button>
        </div>
      ) : null}

      {thread.messages.length === 0 ? (
        <p className="text-forest/70 mt-4 text-sm">
          Nothing has been said here yet.
        </p>
      ) : (
        <ol className="mt-4 space-y-3">
          {thread.messages.map((message) => (
            <Bubble key={message.id} message={message} />
          ))}
        </ol>
      )}

      {thread.canWrite ? (
        <form onSubmit={send} className="mt-6">
          <label htmlFor="message" className="label text-forest/75">
            Write to them
          </label>
          <textarea
            id="message"
            name="text"
            rows={3}
            maxLength={1000}
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-describedby={failure ? "message-error" : undefined}
            aria-invalid={failure ? true : undefined}
            className={textareaClass("mt-2")}
          />
          {failure ? (
            <p
              id="message-error"
              role="alert"
              className="text-terra-deep mt-2 text-sm font-bold"
            >
              {failure}
            </p>
          ) : null}
          <div className="mt-3">
            <Button
              type="submit"
              disabled={sending || text.trim().length === 0}
            >
              {sending ? "Sending…" : "Send"}
            </Button>
          </div>
        </form>
      ) : (
        <Panel className="mt-6 p-4">
          <p className="text-sm">{closedLine(thread.closedReason)}</p>
          {/*
            A failure raised just before the thread closed still has something to
            say, and the composer it belonged to has gone. Kept rather than
            dropped: "messages are closed" beside no explanation reads as the
            screen having eaten the message.
          */}
          {failure ? (
            <p role="alert" className="text-terra-deep mt-2 text-sm font-bold">
              {failure}
            </p>
          ) : null}
        </Panel>
      )}
    </section>
  );
}

/**
 * One message, aligned by who wrote it.
 *
 * Alignment is the only thing carrying `from` at a glance, so it is not the only
 * thing carrying it at all: the name is beside every message, and a screen
 * reader reads the name rather than inferring anything from a margin.
 */
function Bubble({ message }: { message: ThreadMessage }) {
  const mine = message.from === "operator";
  const removed = textRemoved(message);

  return (
    <li className={cn("flex", mine ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "rounded-card max-w-[85%] border px-4 py-3",
          mine
            ? "border-forest/15 bg-paper"
            : "border-paper-line bg-paper-deep",
        )}
      >
        <p className="text-forest/75 text-xs">
          <span className="font-bold">{message.senderName}</span>
          {" · "}
          {/*
            `Asia/Kolkata` rather than the departure's own zone. A conversation
            is not a departure: it happens in the operator's day, which is the
            market's day, and the same message must not read as a different time
            on the booking screen and in the list.
          */}
          {shortDay(message.sentAt, "Asia/Kolkata")}{" "}
          {marketTime(message.sentAt, "Asia/Kolkata")}
        </p>
        {removed ? (
          /*
            "The message stays, with who wrote it and when." Never an empty
            bubble, which would say somebody sent nothing.
          */
          <p className="text-forest/70 mt-1 text-sm italic">{REMOVED_TEXT}</p>
        ) : (
          /*
            `whitespace-pre-wrap`: the API keeps line breaks ("trimmed, with its
            line breaks"), and collapsing them turns a list of three things to
            bring into one run-on sentence.
          */
          <p className="mt-1 text-sm whitespace-pre-wrap">{message.text}</p>
        )}
      </div>
    </li>
  );
}
