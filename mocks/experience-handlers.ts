import { http, HttpResponse } from "msw";
import { WIDE_READ_FAILS_ID, type MockTeamMember } from "./fixtures";

/**
 * The operator's listings — one per status the screen has to tell apart.
 *
 * `status` is what a client renders; `publicationState` and `review` are the
 * parts it is derived from, and both are sent so a client that tried to
 * recombine them would get a DIFFERENT answer here than the server's. That is
 * the mistake the contract warns about, and a mock that only sent `status`
 * could not catch it.
 */
export type MockExperience = {
  id: string;
  /**
   * A first listing a reviewer sent back — yuvoy-api#180.
   *
   * Distinct from `review.rejectionCode`, which is a rejected EDIT to
   * something already live. This one has never sold, is a draft again, and
   * before the field existed the operator had no way to learn why.
   */
  sentBack?: { rejectionCode: string; rejectionNote: string; at: string };
  slug?: string;
  title: string;
  summary?: string;
  description?: string;
  category?: string;
  destination?: string;
  status: string;
  publicationState?: string;
  bookingMode?: string;
  durationMinutes?: number;
  maxPartySize?: number;
  unitPricePaise?: number | null;
  pricingUnit?: string;
  meetingPoint?: string;
  /*
    A pin on the meeting point (yuvoy-api#249, yuvoy-operator#113). Null when
    none is set, which every read says out loud: `withPin` below.
  */
  meetingLat?: number | null;
  meetingLng?: number | null;
  /*
    The material fields — yuvoy-operator#30 §5. On the wire since the contract
    was written and settable nowhere in this portal until now, which is why
    they were never in this fixture either.
  */
  inclusions?: string[];
  requirements?: string[];
  safetyNotes?: string;
  activityType?: string;
  activityTypeLabel?: string;
  /*
    The waiver, kept rather than discarded - yuvoy-operator#60. The create
    handler took the whole body and stored none of this, so `GET /experiences/
    {id}` answered without a `screenerKey` whether or not one was sent, and a
    test could not tell the fixed form from the broken one.
  */
  screenerKey?: string;
  /**
   * Whether anybody has SAID what the price means — yuvoy-operator#30 §1.
   *
   * `experiences.pricing_unit` is NOT NULL, so `pricingUnit` alone cannot carry
   * the answer: a listing nobody has asked still has a value in that column.
   * The API records the difference separately and reports it as a publish
   * blocker; this is the mock's version of that column.
   */
  pricingUnitStated?: boolean;
  /*
    The mandatory fields still empty — yuvoy-operator#30 §3. Computed rather
    than stored, so a fixture cannot claim a listing is ready while missing
    something the API would refuse.
  */
  publishBlockers?: string[];
  upcomingDepartures?: number;
  sellable?: boolean;
  /**
   * The weekly schedule the hub edits — yuvoy-operator#56 item 8.
   *
   * `repeatsWeekly` is the half that decides whether an empty save is a
   * question: clearing a schedule that exists closes every departure it made,
   * and clearing one that never existed does nothing.
   */
  schedule?: {
    repeatsWeekly: boolean;
    weekly: { weekday: number; startTime: string; seats: number }[];
  };
  review?: {
    state: string;
    since?: string;
    rejectionCode?: string;
    rejectionNote?: string;
  };
};

/**
 * The listing routes of the mock API: the vocabulary, the list of listings
 * and writing a new one. Moved out of `handlers.ts` as they were
 * (yuvoy-operator#178). The helpers and the state stay there. The listings
 * come in through a getter in `deps`, because `__resetOperatorMocks` replaces
 * them.
 */
export interface ExperienceMockDeps {
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
  withPin: <
    T extends { meetingLat?: number | null; meetingLng?: number | null },
  >(
    listing: T,
  ) => T & { meetingLat: number | null; meetingLng: number | null };
  bookableDatesOf: (e: { id?: string; status?: string }) => number;
  unconfirmedDeparturesOf: (e: { id?: string }) => number;
  draftBlockers: (listing: MockExperience) => string[];
  /** The listings. */
  mockExperiences: () => MockExperience[];
}

export function experienceHandlers(deps: ExperienceMockDeps) {
  const {
    url,
    requireSession,
    requireWritable,
    envelope,
    sessionUser,
    isNewBusiness,
    withPin,
    bookableDatesOf,
    unconfirmedDeparturesOf,
    draftBlockers,
    mockExperiences,
  } = deps;

  return [
    /* ------------------------------------------------------ vocabulary ---- */

    /**
     * What may go in a listing's category and destination — yuvoy-api#113.
     *
     * Scoped to the operator's own market with no market parameter, exactly as
     * the contract describes: "destinations from another market are refused on
     * create, so offering them would be offering a choice that cannot work."
     *
     * Every key here is one `POST /experiences` accepts, and the destinations
     * match the prefix that endpoint validates — a mock offering a value its own
     * create would reject is worse than no mock at all.
     */
    http.get(url("/catalog/vocabulary"), async ({ request }) => {
      const failed = requireSession(request);
      if (failed) return failed;

      return HttpResponse.json({
        market: { key: "andaman", name: "Andaman Islands" },
        /*
          The health screeners a listing's `screenerKey` may name — yuvoy-api#180.
          One today, and the set grows by INSERT: "the same read decides which
          keys a listing write accepts, so every key offered here is accepted and
          any other key is a 400."
        */
        screeners: [
          { key: "diving_rstc", label: "Diving health check (RSTC)" },
        ],
        categories: [
          { key: "adventure", label: "Adventure" },
          { key: "nature_wildlife", label: "Nature & wildlife" },
          { key: "food_drink", label: "Food & drink" },
          { key: "arts_creativity", label: "Arts & creativity" },
          { key: "learning", label: "Learning" },
          { key: "culture_heritage", label: "Culture & heritage" },
          { key: "wellness", label: "Wellness" },
          { key: "entertainment", label: "Entertainment" },
          { key: "community", label: "Community" },
          { key: "sports", label: "Sports" },
          { key: "local_life", label: "Local life" },
          { key: "events", label: "Events" },
        ],
        /*
          What a listing IS, narrowed per market — yuvoy-operator#30 §2. Each
          carries its parent category, and the pair is enforced by a composite
          foreign key upstream, so a picker MUST filter by the chosen category:
          `scuba` under `food_drink` is a 400.
        */
        activityTypes: [
          { key: "scuba", label: "Scuba diving", category: "adventure" },
          { key: "snorkelling", label: "Snorkelling", category: "adventure" },
          {
            key: "private_charter",
            label: "Private charter",
            category: "adventure",
          },
          {
            key: "birdwatching",
            label: "Birdwatching",
            category: "nature_wildlife",
          },
          {
            key: "mangrove_kayak",
            label: "Mangrove kayaking",
            category: "nature_wildlife",
          },
        ],
        destinations: [
          { key: "andaman/havelock", label: "Havelock (Swaraj Dweep)" },
          { key: "andaman/neil", label: "Neil (Shaheed Dweep)" },
          { key: "andaman/port_blair", label: "Port Blair" },
        ],
      });
    }),

    http.get(url("/experiences"), async ({ request }) => {
      const failed = requireSession(request);
      if (failed) return failed;

      /*
        ONE IDENTITY MAKES THIS CALL FAIL — yuvoy-operator#32.

        `/calendar` reads two endpoints: `GET /slots` for the fortnight it edits,
        and this one for the departure picker's listings. The interesting failure
        is not "the API is down", which takes both with it: it is ONE call
        failing while the other works, which is the case that decides whether the
        screen degrades or disappears.

        The refusal used to sit on a ±120-day `GET /slots` read, because that is
        where the listings came from before this issue. The endpoint moved and
        the fixture moved with it; what is being modelled is unchanged.
      */
      if (sessionUser(request)?.id === WIDE_READ_FAILS_ID) {
        return envelope("internal_error", "Something went wrong.", 500);
      }
      if (isNewBusiness(request)) return HttpResponse.json({ experiences: [] });
      return HttpResponse.json({
        experiences: mockExperiences().map((e) => ({
          ...withPin(e),
          bookableDatesNext30Days: bookableDatesOf(e),
          departuresNotOnSale: unconfirmedDeparturesOf(e),
          departuresGoingOffSaleSoon: 0,
        })),
      });
    }),

    /**
     * Write a new listing. Lands as a DRAFT and reaches nobody.
     *
     * The defaults are the API's, not the form's — "party size 6, `per_person`,
     * `request` mode, 120 minutes" — so a minimal create here produces the same
     * listing the real one would, and a form that quietly re-sent its own
     * defaults would show up as a difference.
     */
    http.post(url("/experiences"), async ({ request }) => {
      const failed = requireSession(request);
      if (failed) return failed;
      const shut = requireWritable(request);
      if (shut) return shut;

      const body = (await request.json()) as Record<string, unknown>;
      const title = String(body.title ?? "").trim();
      const category = String(body.category ?? "").trim();
      const destination = String(body.destination ?? "").trim();

      if (!title || !category || !destination) {
        return envelope(
          "invalid_input",
          "A title, a category and a destination.",
          400,
        );
      }

      /*
        "A destination key in your own market. One belonging to another market is
        refused." Modelled, because it is the single most likely 400 an operator
        will meet — the portal cannot enumerate destinations, so they type one —
        and the screen renders the API's own sentence for exactly this case.
      */
      if (!destination.startsWith("andaman/")) {
        return envelope(
          "invalid_input",
          `"${destination}" is not a place in your market. Yours all start with "andaman/".`,
          400,
        );
      }

      const slug =
        String(body.slug ?? "").trim() ||
        title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "");

      if (mockExperiences().some((e) => e.slug === slug)) {
        return envelope("conflict", "That slug is taken.", 409);
      }

      const priceRaw = body.unitPricePaise;
      const unitPricePaise =
        typeof priceRaw === "number" && priceRaw > 0 ? priceRaw : null;

      const created: MockExperience = {
        id: `exp_${Math.random().toString(36).slice(2, 10)}`,
        slug,
        title,
        category,
        destination,
        summary: body.summary ? String(body.summary) : undefined,
        description: body.description ? String(body.description) : undefined,
        /*
          Stored, which it was not. The create form has sent `activityType` since
          yuvoy-operator#30 §2 and this handler dropped it on the floor, so a
          listing created here came back without one and `publishBlockers` named
          it forever. Invisible until the builder started deriving which step to
          open from that list, and then it opened Basics over a field the operator
          had already answered.
        */
        activityType: body.activityType ? String(body.activityType) : undefined,
        status: "draft",
        publicationState: "draft",
        bookingMode: String(body.bookingMode ?? "request"),
        durationMinutes: Number(body.durationMinutes ?? 120),
        maxPartySize: Number(body.maxPartySize ?? 6),
        unitPricePaise,
        pricingUnit: String(body.pricingUnit ?? "per_person"),
        // Stated only when somebody said so. The column has a default; the answer
        // does not.
        pricingUnitStated:
          typeof body.pricingUnit === "string" && !!body.pricingUnit,
        inclusions: Array.isArray(body.inclusions)
          ? (body.inclusions as string[])
          : undefined,
        requirements: Array.isArray(body.requirements)
          ? (body.requirements as string[])
          : undefined,
        safetyNotes: body.safetyNotes ? String(body.safetyNotes) : undefined,
        /*
          Absent and empty are one thing, as they are to the API: "an absent key
          and an empty string mean the same thing", so an omitted key stores
          undefined rather than "".
        */
        screenerKey: body.screenerKey ? String(body.screenerKey) : undefined,
        upcomingDepartures: 0,
        // "A listing without `unitPricePaise` can be saved but cannot be
        // approved, which the response reports as `sellable: false`."
        sellable: unitPricePaise !== null,
      };
      /*
        What it is still missing, from the moment it exists. It was left off, and
        the consequence was invisible until the builder read it: a brand-new draft
        reported nothing outstanding, so reopening it landed on Review with five
        mandatory fields empty.
      */
      created.publishBlockers = draftBlockers(created);
      mockExperiences().push(created);

      return HttpResponse.json(
        { id: created.id, status: "draft", next: "submit_for_review" },
        { status: 201 },
      );
    }),
  ];
}
