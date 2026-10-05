"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  markThreadRead,
  reloadThread,
  sendMessage,
} from "@/app/bookings/[id]/conversation-actions";
import { Bubble } from "@/app/bookings/[id]/conversation";
import type { MessageNeed } from "@/lib/home/needs";
import {
  closedLine,
  newestMessageId,
  type BookingThread,
} from "@/lib/messages/thread";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { InboxIcon } from "@/components/ui/icons";
import { textareaClass } from "@/components/ui/input";
import { panelClass } from "@/components/ui/panel";
import { withFrom } from "@/lib/site/back-to";

/**
 * A guest who wrote, answered on Home (operator experiment A).
 *
 * ## The name arrives when it is opened
 *
 * A thread SUMMARY carries no name and no words, by contract ("never its
 * text, never the traveller's name"), so the closed card says which trip and
 * which booking, and the name and the words arrive with the thread itself,
 * read when the card is opened, as they are on the booking.
 *
 * Opening it marks it read up to the newest message shown, as the booking's
 * conversation does, so the inbox count and this card agree afterwards.
 *
 * ## Quick replies fill the box, they never send
 *
 * Three short answers that are true for any business ("No problem.") put
 * their words in the box to be sent or changed. A tap that sent on its own
 * would put words in the operator's mouth one wet tap from a mistake.
 *
 * The API refuses phone numbers, emails and links on either side and says
 * which it found (#52); this card does no filtering of its own.
 */

const QUICK_REPLIES = [
  "No problem.",
  "Yes, that is fine.",
  "Thank you, see you then.",
];

type Phase = "closed" | "opening" | "open" | "failed";

export function MessageCard({
  need,
  onTouch,
}: {
  need: MessageNeed;
  /** Told when the card is opened, so the list keeps it after a re-read. */
  onTouch: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("closed");
  const [thread, setThread] = useState<BookingThread | null>(null);
  const [text, setText] = useState("");
  const [failure, setFailure] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [sending, startSending] = useTransition();
  const box = useRef<HTMLTextAreaElement>(null);
  const heading = useRef<HTMLParagraphElement>(null);

  const name =
    thread?.messages
      .slice()
      .reverse()
      .find((m) => m.from === "traveller")?.senderName ?? null;
  const first = name?.split(/\s+/)[0] ?? "them";
  const boxId = `reply-${need.bookingId}`;

  // Focus moves to what opened, so the button that was pressed is not lost.
  useEffect(() => {
    if (phase === "open") heading.current?.focus({ preventScroll: true });
  }, [phase]);

  async function open() {
    onTouch();
    setPhase("opening");
    const fresh = await reloadThread(need.bookingId);
    if (!fresh) {
      setPhase("failed");
      return;
    }
    setThread(fresh);
    setPhase("open");
    /*
      `upTo` names a message somebody was SHOWN, taken from this page before
      anything is appended, so a message arriving after it stays unread.
    */
    const upTo = newestMessageId(fresh.messages);
    if (fresh.unreadCount > 0 && upTo)
      void markThreadRead(need.bookingId, upTo);
  }

  function send(event: React.FormEvent) {
    event.preventDefault();
    setFailure(null);
    setSentTo(null);
    startSending(async () => {
      const result = await sendMessage(need.bookingId, text);
      if (result.ok) {
        setThread((was) =>
          was ? { ...was, messages: [...was.messages, result.message] } : was,
        );
        setText("");
        setSentTo(name ?? "the guest");
        return;
      }
      // The words stay, so a refused number can be taken out and sent.
      setFailure(result.message);
      if (result.reload) {
        const fresh = await reloadThread(need.bookingId);
        if (fresh) setThread(fresh);
      }
    });
  }

  return (
    <li
      aria-label={name ? `Message from ${name}` : "Message from a guest"}
      className={panelClass("raised", "p-4 sm:p-5")}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="label text-forest/75 flex items-center gap-1.5">
          <InboxIcon className="size-4" />
          Message
        </p>
        {phase === "open" ? null : <Chip tone="accent">{need.unread}</Chip>}
      </div>

      <p
        ref={heading}
        tabIndex={-1}
        className="mt-2 text-lg leading-snug font-bold outline-none"
      >
        {name ? `${name} wrote` : "A guest wrote"}
      </p>
      <p className="text-forest/80 mt-1 text-sm">{need.trip}</p>
      <p className="text-forest/80 mt-1 text-sm">
        <span className="tracking-wider slashed-zero tabular-nums">
          {need.reference}
        </span>
      </p>

      {phase === "closed" || phase === "opening" ? (
        <div className="mt-4">
          <Button
            onClick={open}
            pending={phase === "opening"}
            pendingLabel="Opening"
          >
            Read and reply
          </Button>
        </div>
      ) : null}

      {phase === "failed" ? (
        <div role="alert" className="mt-4">
          <p className="text-terra-deep text-sm font-bold">
            That conversation did not open. Nothing was marked read.
          </p>
          <div className="mt-3">
            <Button variant="secondary" onClick={open}>
              Try again
            </Button>
          </div>
        </div>
      ) : null}

      {phase === "open" && thread ? (
        <div className="mt-4">
          {thread.messages.length === 0 ? (
            <p className="text-forest/70 text-sm">
              Nothing has been said here yet.
            </p>
          ) : (
            <ol className="space-y-3" aria-label="The latest messages">
              {thread.messages.slice(-3).map((message) => (
                <Bubble key={message.id} message={message} />
              ))}
            </ol>
          )}
          <Link
            href={withFrom(
              `/bookings/${need.bookingId}#conversation`,
              "/today",
            )}
            className="text-forest tap-target mt-2 text-sm font-bold underline underline-offset-4"
          >
            The whole conversation and the booking
          </Link>

          {thread.canWrite ? (
            <form onSubmit={send} className="mt-4">
              <div
                role="group"
                aria-label="Quick replies"
                className="flex flex-wrap gap-2"
              >
                {QUICK_REPLIES.map((reply) => (
                  <button
                    key={reply}
                    type="button"
                    onClick={() => {
                      setText(reply);
                      box.current?.focus();
                    }}
                    className="border-paper-line bg-paper hover:border-forest/40 ease-interaction inline-flex min-h-11 items-center rounded-full border px-4 py-2 text-sm transition-colors duration-200"
                  >
                    {reply}
                  </button>
                ))}
              </div>
              <label
                htmlFor={boxId}
                className="text-forest/75 mt-4 block text-sm font-medium"
              >
                Reply to {first}
              </label>
              <textarea
                ref={box}
                id={boxId}
                name="text"
                rows={2}
                maxLength={1000}
                value={text}
                onChange={(e) => setText(e.target.value)}
                aria-describedby={failure ? `${boxId}-error` : undefined}
                aria-invalid={failure ? true : undefined}
                className={textareaClass("mt-2")}
              />
              {failure ? (
                <p
                  id={`${boxId}-error`}
                  role="alert"
                  className="text-terra-deep mt-2 text-sm font-bold"
                >
                  {failure}
                </p>
              ) : null}
              {sentTo ? (
                <p role="status" className="mt-2 text-sm font-bold">
                  Sent to {sentTo}.
                </p>
              ) : null}
              <div className="mt-3">
                <Button
                  type="submit"
                  pending={sending}
                  pendingLabel="Sending"
                  disabled={text.trim().length === 0}
                >
                  Send
                </Button>
              </div>
            </form>
          ) : (
            <p className="text-forest/80 mt-4 text-sm">
              {closedLine(thread.closedReason)}
            </p>
          )}
        </div>
      ) : null}
    </li>
  );
}
