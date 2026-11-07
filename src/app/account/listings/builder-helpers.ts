/**
 * The builder actions' private helpers, moved out of builder-actions.ts
 * (yuvoy-operator#178). Deliberately not "use server": there every async
 * export would become an action a browser can call.
 */
import { redirect } from "next/navigation";
import { OperatorApiError, OperatorNetworkError } from "@/lib/api/errors";
import { suspendedMessage } from "@/lib/account/suspended";
import { nextStep, type Step } from "@/lib/services/builder";
import { sentence } from "@/lib/format/sentence";
import type { StepState } from "./builder-actions";

/** Where a step goes when it saves. */
export function onward(id: string, step: Step): never {
  const next = nextStep(step);
  redirect(
    next
      ? `/account/listings/${id}/edit?step=${next}`
      : `/account/listings/${id}`,
  );
}

/**
 * Every way a draft save can be refused, in one place.
 *
 * `409` is the one worth naming: the listing stopped being a draft while the
 * operator was typing, which means somebody sent it for review from another
 * device. The way forward is the listing screen, not another save.
 */
export function saveFailure(err: unknown, id: string): StepState {
  if (err instanceof OperatorNetworkError) {
    return { message: "No signal. Nothing was saved. Try again." };
  }
  if (err instanceof OperatorApiError) {
    const refusal = suspendedMessage(err);
    if (refusal) return { message: refusal };
    if (err.status === 409) {
      return {
        message: "This listing is no longer a draft.",
        fields: [],
      };
    }
    if (err.status === 403) {
      return {
        message: "Only owners, admins and managers can change a listing.",
      };
    }
    if (err.isNotFound) {
      return { message: "That listing is no longer on your account." };
    }
    if (err.status === 400) {
      const details = err.details as
        | {
            unknownFields?: string[];
            screenerKey?: string[];
            meetingLat?: string;
            meetingLng?: string;
          }
        | undefined;
      /*
        The pin, refused. The API's sentence is "we could not read:
        meetingLat", which names a field nobody sees; this screen checks the
        numbers before sending, so this is rare and the plain version will do.
      */
      if (details?.meetingLat || details?.meetingLng) {
        return {
          message:
            "That pin is not a place on the map. Set it again, or remove it.",
        };
      }
      if (
        details?.unknownFields?.some(
          (f) => f === "meetingLat" || f === "meetingLng",
        )
      ) {
        return {
          message: "Pins are not switched on yet. Remove the pin to save.",
        };
      }
      /*
        `details.screenerKey` lists the keys that ARE current. A screener is a
        row added or retired on medical advice rather than by a release, so a
        key this build offered can stop being valid without anything here
        changing — and the API's own sentence names the ones that work.
      */
      const fields = [
        ...(details?.unknownFields ?? []),
        ...(details?.screenerKey ? ["screenerKey"] : []),
      ];
      return { message: err.message, ...(fields.length ? { fields } : {}) };
    }
  }
  void id;
  return { message: "Nothing was saved. Try again." };
}

/**
 * A question list the API would not save, marked on the questions it names.
 *
 * The API refuses the whole list with one sentence ("some of these questions
 * need fixing") and says which and why in `details`, keyed by the field:
 * `questions[1].text`, `questions[2].options`. Printing only the sentence
 * left the operator guessing which of ten questions to change. Since
 * yuvoy-api#282 item 5 that includes a question or a choice holding a phone
 * number, an email address or a link, which every traveller would read, and
 * which only the API can say: this portal does no screening of its own.
 *
 * `id` is a question the listing no longer asks; it is told on the question.
 * `null` for any other refusal, which the shared handling words as before.
 */
export function questionsRefused(err: unknown): StepState | null {
  if (!(err instanceof OperatorApiError) || err.status !== 400) return null;
  const details = err.details;
  if (!details || typeof details !== "object") return null;
  const fields: string[] = [];
  const notes: Record<string, string> = {};
  for (const [key, why] of Object.entries(details)) {
    const at = /^questions\[(\d+)\]\.(text|options|answerType|id)$/.exec(key);
    if (!at) continue;
    const field = `questions.${at[1]}.${at[2] === "id" ? "text" : at[2]}`;
    if (!fields.includes(field)) fields.push(field);
    if (typeof why === "string" && why.trim() && !notes[field]) {
      notes[field] = sentence(why);
    }
  }
  if (fields.length === 0) return null;
  return {
    message: sentence(err.message) || "Some of these questions need fixing.",
    fields,
    notes,
  };
}
