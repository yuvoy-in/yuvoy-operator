import { http, HttpResponse, type HttpHandler } from "msw";
import type { MockTeamMember } from "./fixtures";

/** One question a listing asks, as the mock stores it. */
export type MockQuestion = {
  id: string;
  text: string;
  answerType: string;
  options: string[];
  required: boolean;
};

/**
 * The routes of the mock API that read and change one listing: its questions,
 * the documents its category needs, reading it, pausing and resuming it, and a
 * change to it. Moved out of `handlers.ts` as they were (yuvoy-operator#178).
 * The helpers and the state stay there. The listings come in through a getter
 * in `deps`, because `__resetOperatorMocks` replaces them.
 */
export interface ListingMockDeps {
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
  canManage: (member: MockTeamMember) => boolean;
  contactRefusal: (text: string, what: string) => string;
  choiceOptionsOf: (raw: string[]) => [string[], string];
  withPin: <
    T extends { meetingLat?: number | null; meetingLng?: number | null },
  >(
    listing: T,
  ) => T & { meetingLat: number | null; meetingLng: number | null };
  pinRefusal: (body: Record<string, unknown>) => Response | null;
  LISTING_FIELDS: string[];
  OPERATOR_DIRECT: Set<string>;
  MATERIAL_FIELDS: Set<string>;
  pauseHandler: (path: string) => HttpHandler;
  resumeHandler: (path: string) => HttpHandler;
  /** The questions per listing, by listing id. */
  listingQuestions: Record<string, MockQuestion[]>;
  /** The listings, as far as these routes read them. */
  mockExperiences: () => {
    id: string;
    status: string;
    publicationState?: string;
    unitPricePaise?: number | null;
    pricingUnitStated?: boolean;
    sellable?: boolean;
    review?: { state: string; since?: string };
    meetingLat?: number | null;
    meetingLng?: number | null;
  }[];
}

export function listingHandlers(deps: ListingMockDeps) {
  const {
    url,
    requireSession,
    requireWritable,
    envelope,
    sessionUser,
    canManage,
    contactRefusal,
    choiceOptionsOf,
    withPin,
    pinRefusal,
    LISTING_FIELDS,
    OPERATOR_DIRECT,
    MATERIAL_FIELDS,
    pauseHandler,
    resumeHandler,
    listingQuestions,
    mockExperiences,
  } = deps;

  return [
    /** The questions a listing asks travellers. */
    http.get(url("/experiences/:id/questions"), async ({ request, params }) => {
      const failed = requireSession(request);
      if (failed) return failed;
      const found = mockExperiences().find((e) => e.id === String(params.id));
      if (!found) return envelope("not_found", "No such listing.", 404);
      return HttpResponse.json({ questions: listingQuestions[found.id] ?? [] });
    }),

    /**
     * Replace them. It is the WHOLE list, in order, and it takes effect at once.
     *
     * "A question sent back with its `id` and the same `text`, `answerType` and
     * `options` keeps that id and every answer to it. Changing its `text`,
     * `answerType` or `options` makes it a new question with a new id." Modelled,
     * because a client that re-sent an id with new wording would keep answers
     * against words nobody saw, and only a mock that reissues the id can catch it.
     */
    http.put(url("/experiences/:id/questions"), async ({ request, params }) => {
      const failed = requireSession(request);
      if (failed) return failed;
      const shut = requireWritable(request);
      if (shut) return shut;
      if (!canManage(sessionUser(request)!)) {
        return envelope(
          "forbidden",
          "only an owner, admin or manager can change the questions",
          403,
        );
      }
      const found = mockExperiences().find((e) => e.id === String(params.id));
      if (!found) return envelope("not_found", "No such listing.", 404);

      const body = (await request.json()) as {
        questions?: Record<string, unknown>[];
      };
      const rows = body.questions ?? [];

      /*
        The API's rules and sentences (`normaliseQuestions`): every refusal at
        once, keyed by the field, each a sentence. Since yuvoy-api#282 item 5 a
        question or a choice holding a phone number, an email address or a
        link is refused like a message, because every traveller reads it.
      */
      const invalid: Record<string, string> = {};
      if (rows.length > 10) {
        invalid.questions = "a listing can ask at most 10 questions";
      }
      const read = rows.map((row, i) => {
        const at = `questions[${i}]`;
        const text = String(row.text ?? "").trim();
        const answerType = String(row.answerType ?? "").trim();
        const length = [...text].length;
        if (length === 0) invalid[`${at}.text`] = "write the question";
        else if (length > 200) {
          invalid[`${at}.text`] = "keep a question to 200 characters";
        } else {
          const why = contactRefusal(text, "a question");
          if (why) invalid[`${at}.text`] = why;
        }
        const sent = Array.isArray(row.options)
          ? (row.options as unknown[]).map((o) => String(o))
          : [];
        let options: string[] = [];
        if (answerType === "choice") {
          const [kept, why] = choiceOptionsOf(sent);
          if (why) invalid[`${at}.options`] = why;
          options = kept;
        } else if (answerType === "short_text" || answerType === "yes_no") {
          if (sent.length > 0) {
            invalid[`${at}.options`] = "only a choice question has options";
          }
        } else {
          invalid[`${at}.answerType`] = "must be short_text, choice or yes_no";
        }
        return { row, text, answerType, options };
      });
      if (Object.keys(invalid).length > 0) {
        return envelope(
          "invalid_input",
          "some of these questions need fixing",
          400,
          invalid,
        );
      }

      const existing = listingQuestions[found.id] ?? [];
      const saved: MockQuestion[] = [];
      for (const { row, text, answerType, options } of read) {
        const sameAsBefore = existing.find(
          (q) =>
            q.id === row.id &&
            q.text === text &&
            q.answerType === answerType &&
            q.options.join("\u0000") === options.join("\u0000"),
        );
        saved.push({
          id: sameAsBefore
            ? sameAsBefore.id
            : `q_${Math.random().toString(36).slice(2, 10)}`,
          text,
          answerType,
          options,
          required: row.required === true,
        });
      }

      listingQuestions[found.id] = saved;
      return HttpResponse.json({ questions: saved });
    }),

    /**
     * What a listing in this category needs the business to hold.
     *
     * `satisfied` is read from the same credential state the account screens use,
     * so the Review step and Verification cannot disagree about whether a
     * document is in place.
     */
    http.get(url("/credential-requirements"), async ({ request }) => {
      const failed = requireSession(request);
      if (failed) return failed;
      const asked = new URL(request.url);
      const category = asked.searchParams.get("category") ?? "";
      if (!category) {
        return envelope("invalid_input", "A category.", 400);
      }
      /*
        Water categories need the documents a boat needs; everything else needs
        the two every business needs. Not a real taxonomy, and not pretending to
        be: what the screen has to render is a list with both states in it.
      */
      const water = category === "adventure" || category === "nature_wildlife";
      const types = water
        ? ["directorate_registration", "insurance", "boat", "oxygen"]
        : ["directorate_registration", "insurance"];
      return HttpResponse.json({
        category,
        ...(asked.searchParams.get("activityType")
          ? { activityType: asked.searchParams.get("activityType") }
          : {}),
        documents: types.map((type) => ({
          type,
          satisfied: type !== "boat" && type !== "oxygen",
        })),
      });
    }),

    http.get(url("/experiences/:id"), async ({ request, params }) => {
      const failed = requireSession(request);
      if (failed) return failed;
      const found = mockExperiences().find((e) => e.id === String(params.id));
      // Gone and belonging-to-somebody-else are one answer, as everywhere else.
      if (!found) return envelope("not_found", "No such listing.", 404);
      return HttpResponse.json(withPin(found));
    }),

    /*
      Pausing and resuming a listing — yuvoy-operator#30 §6, #44. Each is one
      handler under two names, as the API registers it; see the factories above.
    */
    pauseHandler("/experiences/:id/withdraw"),
    pauseHandler("/experiences/:id/pause"),
    resumeHandler("/experiences/:id/resume"),
    resumeHandler("/experiences/:id/relist"),

    /**
     * A change to a listing, in two halves (D-032.3), as `SubmitRevision` and the
     * handler answer it at fb9245e.
     *
     * The fields the operator owns (`OPERATOR_DIRECT`) are written to the
     * listing now. The rest wait for a person: only then is a revision created,
     * and only then does a draft become `in_review` or a published listing
     * `live_changes_in_review`, which KEEPS SELLING. `200` when nothing needed
     * reading, `201` when something did, with `applied` and `inReview` in the
     * order the fields are declared and the API's own `next` and `note`.
     *
     * It used to move `status` on every edit and leave every field alone, which
     * modelled the API before D-032.3: a price change looked queued here while
     * the real API had already put it live, so the portal's "with us" for it
     * was never caught.
     */
    http.post(
      url("/experiences/:id/revisions"),
      async ({ request, params }) => {
        const failed = requireSession(request);
        if (failed) return failed;

        const listing = mockExperiences().find(
          (e) => e.id === String(params.id),
        );
        if (!listing) return envelope("not_found", "No such listing.", 404);

        const body = (await request.json()) as Record<string, unknown>;
        if (!body || Object.keys(body).length === 0) {
          return envelope("invalid_input", "Nothing to change.", 400);
        }

        if (
          listing.status === "in_review" ||
          listing.status === "live_changes_in_review"
        ) {
          return envelope(
            "conflict",
            "There is already a change with us on this listing.",
            409,
          );
        }

        // The schema is closed: every key it does not know, named at once.
        const unknownFields = Object.keys(body)
          .filter(
            (k) => !LISTING_FIELDS.includes(k) && k !== "meetingPointText",
          )
          .sort();
        if (unknownFields.length > 0) {
          return envelope(
            "invalid_input",
            `we do not know how to change that: ${unknownFields.join(", ")}`,
            400,
            { allowed: LISTING_FIELDS, unknownFields },
          );
        }
        const badPin = pinRefusal(body);
        if (badPin) return badPin;
        if (body.meetingPointText !== undefined && !("meetingPoint" in body)) {
          body.meetingPoint = body.meetingPointText;
        }
        delete body.meetingPointText;

        const applied = LISTING_FIELDS.filter(
          (f) => f in body && OPERATOR_DIRECT.has(f),
        );
        const inReview = LISTING_FIELDS.filter(
          (f) => f in body && !OPERATOR_DIRECT.has(f),
        );

        // The operator's half, live now.
        for (const field of applied) {
          const value = body[field];
          (listing as Record<string, unknown>)[field] =
            value === "" ? undefined : value;
        }
        if (applied.includes("pricingUnit") && body.pricingUnit) {
          listing.pricingUnitStated = true;
        }
        if (applied.includes("unitPricePaise")) {
          listing.sellable =
            typeof listing.unitPricePaise === "number" &&
            listing.unitPricePaise > 0;
        }

        const note =
          "Bookings already made are unaffected: they keep the price and terms they were made on.";
        if (inReview.length === 0) {
          return HttpResponse.json({
            applied,
            inReview,
            state: "applied",
            needsReview: false,
            next: "These are live now. Travellers see them on your listing straight away.",
            note,
          });
        }

        // Ours, read before it goes live. The listing keeps selling meanwhile.
        listing.status =
          listing.publicationState === "published"
            ? "live_changes_in_review"
            : "in_review";
        listing.review = {
          state: "submitted",
          since: new Date().toISOString(),
        };

        return HttpResponse.json(
          {
            applied,
            inReview,
            revisionId: `rev_${listing.id}_${Date.now()}`,
            state: "submitted",
            // Over the whole edit, as `RevisionIsMaterial` reads it.
            needsReview: [...applied, ...inReview].some((f) =>
              MATERIAL_FIELDS.has(f),
            ),
            next:
              applied.length === 0
                ? "We read every change to what a listing promises. It stays on sale on the old wording meanwhile."
                : "The first list is live now. We read the second, and the listing keeps selling on the old wording meanwhile.",
            note,
          },
          { status: 201 },
        );
      },
    ),
  ];
}
