import { http, HttpResponse } from "msw";
import {
  CONTENDED_ID,
  DROPPING_ID,
  REFUSED_ID,
  type MockTeamMember,
} from "./fixtures";
import { createMockUpload, mockUploadDone } from "./tus-server";

/** Assets that finished processing, and what has been attested about them. */
export type MockMediaAsset = {
  attested: boolean;
  /**
   * `video` or `image` — yuvoy-api#119.
   *
   * Every asset carries one, because the API does. A fixture that left it off
   * would exercise only the unnamed-kind fallback and never the labelling this
   * screen exists for.
   */
  kind: "video" | "image";
  state: string;
  durationSeconds?: number;
  /**
   * The picture for this row, and it is ABSENT far more often than present.
   *
   * "Absent on most clips today" — a poster is only stored once the provider
   * has produced one, and an unpublished clip has no public URL: 270 of 342
   * clips had none when this was written (yuvoy-api#121). For a photograph the
   * picture IS the poster and the API builds the URL at read time, so a
   * photograph has one in every state.
   *
   * The fixture mirrors that distribution rather than giving everything a
   * poster, because a row with no picture is the common case and has to render
   * as something.
   */
  posterUrl?: string;
  listing?: {
    experienceId: string;
    title: string;
    state: string;
    /**
     * Whether this media is that listing's COVER — yuvoy-api#191.
     *
     * On the pairing rather than the asset, because that is where it lives: the
     * same asset can be a cover on one listing and a gallery item on another.
     * `null` is a real value and means "no role is known"; the portal keeps both
     * buttons for it rather than guessing.
     */
    role?: "hero" | "gallery" | null;
  };
  rejection?: { code: string; note?: string };
};

/**
 * The media library routes of the mock API: the list, upload intents and
 * completing one, rights, withdrawing and publishing. Moved out of
 * `handlers.ts` as they were (yuvoy-operator#178). The helpers and the state
 * stay there. The state comes in through getters in `deps`, because
 * `__resetOperatorMocks` replaces it.
 */
export interface MediaMockDeps {
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
  situationOf: (asset: MockMediaAsset) => string;
  uploadIntent: (id: string, uploadId: string, sizeBytes: number) => Response;
  /** Assets by id. */
  mediaAssets: () => Record<string, MockMediaAsset>;
  /** Upload intents in flight, by operator. */
  uploadIntents: () => Record<
    string,
    { id: string; uploadId: string; sizeBytes: number; confirmedAt?: number }
  >;
  /** The listings, as far as these routes read them. */
  mockExperiences: () => { id: string; title: string }[];
}

export function mediaHandlers(deps: MediaMockDeps) {
  const {
    url,
    requireSession,
    requireWritable,
    envelope,
    sessionUser,
    isNewBusiness,
    situationOf,
    uploadIntent,
    mediaAssets,
    uploadIntents,
    mockExperiences,
  } = deps;

  return [
    /*
      Paged, as the API pages it since yuvoy-api#204: `limit` (1 to 200, 50 when
      absent or unreadable) and an opaque `cursor` in, `complete` and
      `nextCursor` out. A cursor this list did not issue is a 400. The cursor
      here is an offset in a costume, which is fine for a mock and exactly what
      a client must never construct itself.
    */
    http.get(url("/media"), async ({ request }) => {
      const failed = requireSession(request);
      if (failed) return failed;
      if (isNewBusiness(request)) {
        return HttpResponse.json({ items: [], complete: true });
      }

      const query = new URL(request.url).searchParams;
      const asked = Number(query.get("limit"));
      const limit =
        Number.isInteger(asked) && asked > 0 ? Math.min(asked, 200) : 50;
      const cursor = query.get("cursor");
      let offset = 0;
      if (cursor !== null) {
        const match = /^mc_(\d+)$/.exec(cursor);
        if (!match) {
          return envelope("invalid_input", "that cursor is not ours", 400);
        }
        offset = Number(match[1]);
      }

      const all = Object.entries(mediaAssets()).map(([id, asset]) => ({
        id,
        kind: asset.kind,
        state: asset.state,
        // Omitted, never null, when there is none, which is most clips.
        ...(asset.posterUrl ? { posterUrl: asset.posterUrl } : {}),
        durationSeconds: asset.durationSeconds,
        listing: asset.listing,
        rejection: asset.rejection,
        situation: situationOf(asset),
        createdAt: new Date().toISOString(),
      }));
      const items = all.slice(offset, offset + limit);
      const next = offset + limit;
      return HttpResponse.json({
        items,
        complete: next >= all.length,
        ...(next < all.length ? { nextCursor: `mc_${next}` } : {}),
      });
    }),

    /**
     * An upload slot — or the one already in flight, handed back.
     *
     * The `uploadUrl` points at a DIFFERENT ORIGIN, because in production it
     * does: "bytes never pass through this API", the browser talks straight to
     * the video provider, and that is the one request in this portal MSW cannot
     * intercept. `mocks/tus-server.ts` is that origin.
     *
     * **Asking again while an upload is in flight resumes it** — yuvoy-api#66 §3,
     * PR #85. The same `intentId`, over the same tus resource, with a fresh URL:
     * not a 409, and deliberately not a new slot, because a new slot would also
     * stop the 409 while silently abandoning the bytes the provider already
     * holds. The mock returns the SAME id for the same reason the API's own
     * tests assert it — handing back a different one would make a reload look
     * recovered while the bytes it recovered belonged to nothing.
     *
     * The 409 is still declared in the contract and is still modelled, on one
     * fixture identity, because one reachable cause is left: a second person at
     * the same business, if the quota is per operator rather than per user.
     * That question is open on yuvoy-api#66 and `/reels`' copy hedges to match.
     */
    http.post(url("/media/upload-intents"), async ({ request }) => {
      const failed = requireSession(request);
      if (failed) return failed;
      const me = sessionUser(request)!;

      if (me.id === CONTENDED_ID) {
        /*
          A colleague at this business got there first, so there is nothing of
          OURS to resume — the only 409 the endpoint can still produce, and only
          if the quota is per operator rather than per user. Refused on the first
          ask rather than the second, because that is what "somebody else already
          has it" means; a 409 that only arrives after you have held the slot
          yourself is modelling a different thing.
        */
        return envelope(
          "conflict",
          "An upload is already in progress for this operator.",
          409,
        );
      }

      const body = (await request.json()) as { sizeBytes?: number };
      if (
        !Number.isInteger(body.sizeBytes) ||
        (body.sizeBytes ?? 0) <= 0 ||
        (body.sizeBytes ?? 0) > 200 * 1024 * 1024
      ) {
        return envelope("invalid_input", "A valid file size is required.", 400);
      }

      const open = uploadIntents()[me.id];
      if (open && !open.confirmedAt) {
        return uploadIntent(open.id, open.uploadId, open.sizeBytes);
      }

      const id = `upi_${Math.random().toString(36).slice(2, 10)}`;
      /*
        A dropping upload for one fixture identity, so the resume path is
        exercised end to end rather than only in unit tests. A resumable uploader
        that has never been interrupted is an uploader whose resume path has
        never run.
      */
      const uploadId = `${id}${me.id === DROPPING_ID ? "-drop" : ""}`;
      /*
        Opened AT the size just asked for, as production does — "tus fixes the
        upload length when the slot is created". That is what makes a `HEAD`
        report no `Upload-Defer-Length`, which is what tells the client not to
        declare a length it would be refused for.
      */
      createMockUpload(uploadId, body.sizeBytes!);
      uploadIntents()[me.id] = { id, uploadId, sizeBytes: body.sizeBytes! };

      return uploadIntent(id, uploadId, body.sizeBytes!);
    }),

    /**
     * "A hint that it is worth polling, nothing more — the client's claim is
     * never trusted. What decides is whether the provider has an asset."
     *
     * So this checks the tus server's real offset rather than believing the
     * caller: a client that says it finished at 40% is told to keep waiting, and
     * a portal built against a mock that took its word would ship a flow that
     * marks half-uploaded clips ready.
     */
    http.post(
      url("/media/upload-intents/:id/complete"),
      async ({ request, params }) => {
        const failed = requireSession(request);
        if (failed) return failed;
        const me = sessionUser(request)!;

        const intent = uploadIntents()[me.id];
        if (!intent || intent.id !== String(params.id)) {
          return envelope("not_found", "No such upload.", 404);
        }

        if (!mockUploadDone(intent.uploadId)) {
          // Not an error: still processing, from the caller's point of view.
          return HttpResponse.json({ ready: false }, { status: 202 });
        }

        /*
          One poll of latency before ready, because 202 is the normal first
          answer and a client that only ever sees 200 has never rendered its own
          waiting state.
        */
        if (!intent.confirmedAt) {
          intent.confirmedAt = Date.now();
          return HttpResponse.json({ ready: false }, { status: 202 });
        }

        /*
          The host's last word on a clip it will never make (yuvoy-api#286).
          Final: the same answer on every later call, nothing reaches the reel
          list, and asking for an upload again mints a new one, which
          `confirmedAt` above already makes this mock do. The message is the
          API's own, "a sentence to show as it is".
        */
        if (me.id === REFUSED_ID) {
          return envelope(
            "media_refused",
            "That clip was refused, so it will not be in your reels. Choose another.",
            422,
            { reason: "malformed_video" },
          );
        }

        const mediaAssetId = `med_${intent.id.slice(4)}`;
        /*
          No `posterUrl`, deliberately. A clip has no still until the provider
          has produced one and no public URL until it is published — so the row
          an operator sees immediately after uploading is precisely the
          no-preview case, and the screen has to render it as something.
        */
        mediaAssets()[mediaAssetId] = {
          attested: false,
          kind: "video",
          state: "ready",
        };
        return HttpResponse.json({ ready: true, mediaAssetId });
      },
    ),

    http.post(url("/media/:id/rights"), async ({ request, params }) => {
      const failed = requireSession(request);
      if (failed) return failed;
      /*
        `403 account_suspended`, which this write declares: a suspended business
        reads its story and its clips and may not change them (yuvoy-operator#90
        f13). Modelled so the portal's answer to it runs.
      */
      const shut = requireWritable(request);
      if (shut) return shut;

      const asset = mediaAssets()[String(params.id)];
      if (!asset) return envelope("not_found", "No such clip.", 404);

      const body = (await request.json()) as Record<string, unknown>;

      /*
        The contract's required four, enforced. `peopleConsentConfirmed` is
        checked for being a BOOLEAN rather than for being truthy: "never
        defaulted and never omitted" means an absent field is a 400, and a mock
        that accepted `undefined` would let the client ship a quiet `false`.
      */
      if (
        typeof body.statementVersion !== "number" ||
        typeof body.peopleConsentConfirmed !== "boolean" ||
        typeof body.rightsType !== "string"
      ) {
        return envelope("invalid_input", "Missing an attestation field.", 400);
      }
      if (!/^[a-f0-9]{64}$/.test(String(body.statementSha256 ?? ""))) {
        return envelope(
          "invalid_input",
          "statementSha256 must be 64 lower-case hex characters.",
          400,
        );
      }

      asset.attested = true;
      asset.state = "attested";
      return HttpResponse.json(
        {
          attestationId: `att_${Math.random().toString(36).slice(2, 10)}`,
          state: "queued_for_review",
          note: "A person at Yuvoy checks this before the clip can appear anywhere.",
        },
        { status: 201 },
      );
    }),

    http.post(url("/media/:id/withdraw"), async ({ request, params }) => {
      const failed = requireSession(request);
      if (failed) return failed;
      /*
        `403 account_suspended`, which this write declares: a suspended business
        reads its story and its clips and may not change them (yuvoy-operator#90
        f13). Modelled so the portal's answer to it runs.
      */
      const shut = requireWritable(request);
      if (shut) return shut;

      const id = String(params.id);
      const body = (await request.json()) as { reason?: string };
      const REASONS = [
        "operator_request",
        "people_in_it_objected",
        "no_longer_accurate",
        "rights_lapsed",
      ];
      if (!REASONS.includes(body.reason ?? "")) {
        return envelope(
          "invalid_input",
          "That is not a withdrawal reason.",
          400,
        );
      }

      const asset = mediaAssets()[id];
      if (!asset) return envelope("not_found", "No such clip.", 404);

      /*
        "Asking twice succeeds: somebody requesting a clip come down that is
        already down should be told it is down, not told they did something
        wrong." Modelled, because a client built against a mock that 409s the
        second attempt would grow an error path the API does not have — and it
        would fire on the wet-hands double tap this portal is designed around.
      */
      asset.state = "withdrawn";
      return HttpResponse.json({
        withdrawn: true,
        note: "It is off Yuvoy now. The original is deleted at the video provider shortly afterwards.",
      });
    }),

    http.post(url("/media/:id/publish"), async ({ request, params }) => {
      const failed = requireSession(request);
      if (failed) return failed;
      /*
        `403 account_suspended`, which this write declares: a suspended business
        reads its story and its clips and may not change them (yuvoy-operator#90
        f13). Modelled so the portal's answer to it runs.
      */
      const shut = requireWritable(request);
      if (shut) return shut;

      const asset = mediaAssets()[String(params.id)];
      /*
        `published` is allowed as well as `approved`, since yuvoy-api#191: "`role`
        is also how an existing pairing's role is changed", and an already
        published item is exactly what a role change acts on. The guard refused
        it, which made every promotion and demotion answer 404 and the portal say
        "this one is not approved yet" about a reel a traveller could see.
      */
      if (
        !asset ||
        (asset.state !== "approved" && asset.state !== "published")
      ) {
        return envelope("not_found", "No approved clip.", 404);
      }
      const body = (await request.json()) as {
        experienceId?: string;
        role?: string;
      };
      const listing = mockExperiences().find(
        (item) => item.id === body.experienceId,
      );
      if (!listing || !["hero", "gallery"].includes(body.role ?? "gallery")) {
        return envelope("not_found", "No such listing.", 404);
      }
      const wanted = (body.role ?? "gallery") as "hero" | "gallery";

      /*
        ONE PAIRING PER LISTING, and `role` changes it rather than adding a second
        — yuvoy-api#191. Publishing with the role it already has changes nothing.

        `hero` while a DIFFERENT item is the cover is `409 hero_taken`, and the
        refused request changes nothing. Modelled because it is the refusal the
        sheet has a sentence for, and a mock that let two heroes exist would make
        that sentence unreachable.
      */
      if (wanted === "hero") {
        const currentCover = Object.entries(mediaAssets()).find(
          ([otherId, other]) =>
            otherId !== String(params.id) &&
            other.listing?.experienceId === listing.id &&
            other.listing?.role === "hero",
        );
        if (currentCover) {
          return envelope(
            "hero_taken",
            "This listing already has a cover. Make that one a gallery item first, then try again.",
            409,
            { role: "hero" },
          );
        }
      }

      asset.state = "published";
      asset.listing = {
        experienceId: listing.id,
        title: listing.title,
        state: "published",
        /*
          Demoting the cover leaves the listing with NO cover: "this reads
          `gallery` afterwards and the listing has no cover until another item is
          published as `hero`." Nothing is promoted in its place, which is the
          half an operator has to be warned about before they tap.
        */
        role: wanted,
      };
      return new HttpResponse(null, { status: 204 });
    }),
  ];
}
