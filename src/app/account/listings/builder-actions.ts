"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { operatorApi } from "@/lib/api/server-client";
import { OperatorApiError, OperatorNetworkError } from "@/lib/api/errors";
import { requireOperator } from "@/lib/auth/session";
import { CATEGORIES, type Category } from "@/lib/services/vocabulary";
import { suspendedMessage } from "@/lib/account/suspended";
import { nextStep, type Step } from "@/lib/services/builder";

/**
 * Saving one step of the listing builder — yuvoy-operator#58 item 7.
 *
 * ## Next saves the step, and nothing else does
 *
 * No timer autosave and no separate Save button: "Next saves the step. Back
 * saves nothing." A failed save stays where it is and says what was refused,
 * because moving on from a step that did not save is how an operator loses
 * twenty minutes of typing and only finds out at Review.
 *
 * ## Why every success redirects
 *
 * Moving to the next step IS the receipt. There is nothing to render on a step
 * that has just been left, and a "Saved" panel on a form the operator is about
 * to leave is the tick this repo refuses everywhere else. The redirect also
 * puts the step in the URL, which is what makes a half-built listing survive a
 * phone going flat.
 *
 * ## The one call that is not a PATCH
 *
 * Basics on a listing that does not exist yet is `POST /experiences`, and its
 * answer carries the id every later step needs. That is the only moment the
 * draft is created, and the URL is replaced with the real one immediately.
 */

export interface StepState {
  message?: string;
  /** Field names to mark, from `details` on a `400`. */
  fields?: string[];
}

/** Where a step goes when it saves. */
function onward(id: string, step: Step): never {
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
function saveFailure(err: unknown, id: string): StepState {
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
        { unknownFields?: string[]; screenerKey?: string[] } | undefined;
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

/* ----------------------------------------------------------- 1. basics -- */

const basicsSchema = z.object({
  id: z.string(),
  title: z.string().min(3, "A title of at least three characters."),
  category: z.enum(CATEGORIES as unknown as [Category, ...Category[]]),
  activityType: z.string(),
  destination: z.string().min(1, "Where it runs."),
  summary: z.string(),
  description: z.string(),
});

export async function saveBasics(
  _prev: StepState,
  form: FormData,
): Promise<StepState> {
  const parsed = basicsSchema.safeParse({
    id: String(form.get("id") ?? ""),
    title: String(form.get("title") ?? "").trim(),
    category: String(form.get("category") ?? ""),
    activityType: String(form.get("activityType") ?? ""),
    destination: String(form.get("destination") ?? ""),
    summary: String(form.get("summary") ?? "").trim(),
    description: String(form.get("description") ?? "").trim(),
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      message: issue.message,
      fields: [String(issue.path[0] ?? "")],
    };
  }

  const { token } = await requireOperator();
  const {
    id,
    title,
    category,
    activityType,
    destination,
    summary,
    description,
  } = parsed.data;

  /*
    Only what was filled in. An empty optional sent as "" is a value, and on a
    draft the API stores it — so a summary nobody typed would become a summary
    that exists and is blank, which clears the blocker without clearing the gap.
  */
  const body = {
    title,
    category,
    destination,
    ...(activityType ? { activityType } : {}),
    ...(summary ? { summary } : {}),
    ...(description ? { description } : {}),
  };

  let listingId = id;
  try {
    if (listingId) {
      const { error } = await operatorApi(token).PATCH("/experiences/{id}", {
        params: { path: { id: listingId } },
        body,
      });
      if (error) throw error;
    } else {
      const { data, error } = await operatorApi(token).POST("/experiences", {
        body,
      });
      if (error) throw error;
      listingId = data.id ?? "";
      if (!listingId) {
        return { message: "It saved, but we did not get an id back." };
      }
    }
  } catch (err) {
    return saveFailure(err, listingId);
  }

  revalidatePath("/account");
  onward(listingId, "basics");
}

/* ---------------------------------------------------------- 2. selling -- */

const sellingSchema = z.object({
  id: z.string().min(1),
  unitPrice: z.string(),
  pricingUnit: z.enum(["per_person", "per_group"]),
  maxPartySize: z.string(),
  durationMinutes: z.string(),
  bookingMode: z.enum(["allotment", "request"]),
});

export async function saveSelling(
  _prev: StepState,
  form: FormData,
): Promise<StepState> {
  const parsed = sellingSchema.safeParse({
    id: String(form.get("id") ?? ""),
    unitPrice: String(form.get("unitPrice") ?? "").trim(),
    pricingUnit: String(form.get("pricingUnit") ?? ""),
    maxPartySize: String(form.get("maxPartySize") ?? "").trim(),
    durationMinutes: String(form.get("durationMinutes") ?? "").trim(),
    bookingMode: String(form.get("bookingMode") ?? "allotment"),
  });
  if (!parsed.success) {
    /*
      The basis gets its own sentence. It is the one field with no default and
      no preselection (yuvoy-operator#30 §1), so "check the price, the party
      size and how long it takes" would send an operator looking at three
      controls that are fine.
    */
    const unstated = parsed.error.issues.some(
      (issue) => issue.path[0] === "pricingUnit",
    );
    return {
      message: unstated
        ? "Say whether that price is per person or for the whole group."
        : "Check the price, the party size and how long it takes.",
      ...(unstated ? { fields: ["pricingUnit"] } : {}),
    };
  }

  /*
    Rupees on screen, paise on the wire. Rounded once, at the boundary: a price
    that arrives a paisa off is a price an operator disputes at settlement.
  */
  const rupees = Number(parsed.data.unitPrice.replace(/[^\d.]/g, ""));
  if (!Number.isFinite(rupees) || rupees <= 0) {
    return { message: "A price in rupees.", fields: ["unitPrice"] };
  }
  const party = Number(parsed.data.maxPartySize);
  if (!Number.isInteger(party) || party < 1) {
    return {
      message: "The most people per booking.",
      fields: ["maxPartySize"],
    };
  }
  const minutes = Number(parsed.data.durationMinutes);
  if (!Number.isInteger(minutes) || minutes < 1) {
    return {
      message: "How long it takes, in minutes.",
      fields: ["durationMinutes"],
    };
  }

  const { token } = await requireOperator();
  try {
    const { error } = await operatorApi(token).PATCH("/experiences/{id}", {
      params: { path: { id: parsed.data.id } },
      body: {
        unitPricePaise: Math.round(rupees * 100),
        pricingUnit: parsed.data.pricingUnit,
        maxPartySize: party,
        durationMinutes: minutes,
        bookingMode: parsed.data.bookingMode,
      },
    });
    if (error) throw error;
  } catch (err) {
    return saveFailure(err, parsed.data.id);
  }

  revalidatePath("/account");
  onward(parsed.data.id, "selling");
}

/* ----------------------------------------------- 4. location and safety -- */

const locationSchema = z.object({
  id: z.string().min(1),
  meetingPoint: z.string().min(1, "Where the day actually starts."),
  meetingLandmark: z.string(),
  inclusions: z.string(),
  requirements: z.string(),
  safetyNotes: z.string(),
  screenerKey: z.string(),
});

/** One per line, blank lines dropped. The wire wants an array. */
function lines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export async function saveLocation(
  _prev: StepState,
  form: FormData,
): Promise<StepState> {
  const parsed = locationSchema.safeParse({
    id: String(form.get("id") ?? ""),
    meetingPoint: String(form.get("meetingPoint") ?? "").trim(),
    meetingLandmark: String(form.get("meetingLandmark") ?? "").trim(),
    inclusions: String(form.get("inclusions") ?? ""),
    requirements: String(form.get("requirements") ?? ""),
    safetyNotes: String(form.get("safetyNotes") ?? "").trim(),
    screenerKey: String(form.get("screenerKey") ?? ""),
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { message: issue.message, fields: [String(issue.path[0] ?? "")] };
  }

  const { token } = await requireOperator();
  try {
    const { error } = await operatorApi(token).PATCH("/experiences/{id}", {
      params: { path: { id: parsed.data.id } },
      body: {
        /*
          `meetingPoint`, never `meetingPointText`. The deprecated spelling maps
          to the same field and sending both with different values is a 400 —
          and approval used to apply one while create and read said the other,
          so a revision that changed only the meeting point changed nothing.
        */
        meetingPoint: parsed.data.meetingPoint,
        meetingLandmark: parsed.data.meetingLandmark,
        inclusions: lines(parsed.data.inclusions),
        requirements: lines(parsed.data.requirements),
        safetyNotes: parsed.data.safetyNotes,
        /*
          "None" sends an empty string rather than being left out. An absent key
          leaves whatever screener is already on the draft in place, and None is
          a real answer that most listings give.
        */
        screenerKey: parsed.data.screenerKey,
      },
    });
    if (error) throw error;
  } catch (err) {
    return saveFailure(err, parsed.data.id);
  }

  revalidatePath("/account");
  onward(parsed.data.id, "location");
}

/* -------------------------------------------------------- 5. questions -- */

const questionSchema = z.object({
  id: z.string().optional(),
  text: z.string().min(1).max(200),
  answerType: z.enum(["short_text", "choice", "yes_no"]),
  options: z.array(z.string().min(1).max(60)).optional(),
  required: z.boolean(),
});

const questionsSchema = z.object({
  id: z.string().min(1),
  questions: z.array(questionSchema).max(10),
});

export async function saveQuestions(
  _prev: StepState,
  form: FormData,
): Promise<StepState> {
  let rows: unknown;
  try {
    rows = JSON.parse(String(form.get("questions") ?? "[]"));
  } catch {
    return { message: "We could not read those questions. Try again." };
  }

  /*
    Spelled out rather than passed by shorthand, so `pnpm qa` check 16 can see
    every schema field in the object handed to `safeParse`. That guard exists
    because a waiver an operator picked was dropped on the floor by exactly this
    shape of call, and it still typechecked.
  */
  const parsed = questionsSchema.safeParse({
    id: String(form.get("id") ?? ""),
    questions: rows,
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue.path.filter((p) => p !== "questions").join(".");
    return {
      message: `That question list was refused: ${issue.message}`,
      ...(where ? { fields: [`questions.${where}`] } : {}),
    };
  }

  /*
    A `choice` needs 2 to 10 options, different ignoring case; the other two
    types carry none. Checked here as well as by the API, because the refusal
    names `questions[0].options` and an operator should not need a round trip to
    learn that two of their choices read the same.
  */
  for (const [i, q] of parsed.data.questions.entries()) {
    if (q.answerType === "choice") {
      const options = (q.options ?? []).filter(Boolean);
      if (options.length < 2 || options.length > 10) {
        return {
          message: "A choice question needs between two and ten options.",
          fields: [`questions.${i}.options`],
        };
      }
      const seen = new Set(options.map((o) => o.toLowerCase()));
      if (seen.size !== options.length) {
        return {
          message: "Two of those choices read the same.",
          fields: [`questions.${i}.options`],
        };
      }
    }
  }

  const { token } = await requireOperator();
  try {
    const { error } = await operatorApi(token).PUT(
      "/experiences/{id}/questions",
      {
        params: { path: { id: parsed.data.id } },
        body: {
          questions: parsed.data.questions.map((q) => ({
            ...(q.id ? { id: q.id } : {}),
            text: q.text,
            answerType: q.answerType,
            ...(q.answerType === "choice" ? { options: q.options ?? [] } : {}),
            required: q.required,
          })),
        },
      },
    );
    if (error) throw error;
  } catch (err) {
    return saveFailure(err, parsed.data.id);
  }

  onward(parsed.data.id, "questions");
}
