import { http, HttpResponse } from "msw";
import { OPERATOR } from "./fixtures";
import type { MockMediaAsset } from "./media-handlers";
import { MOCK_TUS_PORT, mockPhotoArrived } from "./tus-server";

/**
 * The photograph routes of the mock API: a slot to upload a photograph into,
 * and completing it. Moved out of `handlers.ts` as they were
 * (yuvoy-operator#178). The helpers and the state stay there. The state comes
 * in through getters in `deps`, because `__resetOperatorMocks` replaces it.
 */
export interface PhotoMockDeps {
  url: (path: string) => string;
  requireSession: (request: Request) => Response | null;
  envelope: (
    code: string,
    message: string,
    status: number,
    details?: unknown,
  ) => Response;
  FIXTURE_POSTER: string;
  /** The listings, as far as these routes read them. */
  mockExperiences: () => { id: string }[];
  /** Photograph slots minted this session, by image id. */
  photoIntents: () => Record<string, { operatorId: string }>;
  /** Intent id to the image it minted. */
  photoIntentsById: () => Record<string, { imageId: string }>;
  /** The media library, by id. */
  mediaAssets: () => Record<string, MockMediaAsset>;
}

export function photoHandlers(deps: PhotoMockDeps) {
  const {
    url,
    requireSession,
    envelope,
    FIXTURE_POSTER,
    mockExperiences,
    photoIntents,
    photoIntentsById,
    mediaAssets,
  } = deps;

  return [
    /* ------------------------------------------------------ photographs --- */

    /**
     * A slot to upload a photograph into.
     *
     * **No single-slot quota**, unlike the clip intent: the contract declares no
     * `409` here, so an operator adding a row of photographs is not fighting
     * their own uploads. A mock that borrowed the clip's slot rule would make
     * the screen build a queue nobody asked for.
     *
     * `maxBytes` is 5 MB where the host allows 10 — ours, deliberately, because
     * "a 10 MB photograph on a listing costs the traveller the download on
     * island 4G". The client reads it off this response rather than hardcoding.
     */
    http.post(url("/media/photo-intents"), async ({ request }) => {
      const failed = requireSession(request);
      if (failed) return failed;

      /*
        `experienceId` is REQUIRED here, unlike the clip route — migration 0058.
        Modelled rather than waved through: a mock that accepts a body the API
        refuses lets a client ship without ever sending the field, and the first
        anybody would learn of it is a 400 in production.

        A listing that is not this operator's answers 404, indistinguishable
        from one that does not exist.
      */
      const body = (await request.json().catch(() => ({}))) as {
        experienceId?: string;
        role?: string;
      };
      const experienceId = String(body.experienceId ?? "");
      if (!experienceId) {
        return envelope("invalid_input", "Name the listing first.", 400);
      }
      if (!mockExperiences().some((e) => e.id === experienceId)) {
        return envelope("not_found", "No such listing.", 404);
      }
      if (body.role && body.role !== "hero" && body.role !== "gallery") {
        return envelope("invalid_input", "role is hero or gallery.", 400);
      }

      /*
        Keyed by the BUSINESS, not the user. The 404 this protects is about one
        operator finishing another's upload, and every fixture user here belongs
        to the same business — so the check is modelled against the one operator
        id the mock has rather than invented per user.
      */
      const imageId = `img_${Math.random().toString(36).slice(2, 10)}`;
      const intentId = `pin_${Math.random().toString(36).slice(2, 10)}`;
      photoIntents()[imageId] = { operatorId: OPERATOR.operatorId };
      photoIntentsById()[intentId] = { imageId };

      return HttpResponse.json(
        {
          // The row recording WHICH LISTING this upload is for. It is what
          // carries the listing across the upload; `imageId` names none.
          intentId,
          imageId,
          // A DIFFERENT ORIGIN. Bytes never pass through this API.
          uploadUrl: `http://127.0.0.1:${MOCK_TUS_PORT}/photos/${imageId}`,
          expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
          maxBytes: 5 * 1024 * 1024,
          next: "upload_then_complete",
        },
        { status: 201 },
      );
    }),

    /**
     * Confirm the photograph arrived — by asking the HOST, not the client.
     *
     * "The host is asked whether the file arrived and who it belongs to; the
     * client is not believed about either." Both halves are modelled:
     *
     *   - the file must actually be at the mock image host (`mockPhotoArrived`),
     *     or this answers `400` — a browser that says it finished cannot mint a
     *     media asset out of a failed upload;
     *   - an id minted for another operator answers `404`, the SAME as one that
     *     does not exist, because "telling somebody that image exists but is not
     *     yours confirms it exists."
     */
    http.post(url("/media/photo-intents/complete"), async ({ request }) => {
      const failed = requireSession(request);
      if (failed) return failed;

      /*
        "One of the two. `intentId` is the form to use: it names the row carrying
        which listing this photograph is for." `imageId` is the compatibility
        form the contract keeps permanently, for a photograph minted before the
        listing was chosen at upload.
      */
      const completeBody = (await request.json()) as {
        imageId?: string;
        intentId?: string;
      };
      const imageId = String(
        completeBody.intentId
          ? (photoIntentsById()[completeBody.intentId]?.imageId ?? "")
          : (completeBody.imageId ?? ""),
      );

      const slot = photoIntents()[imageId];
      const mine = slot && slot.operatorId === OPERATOR.operatorId;
      if (!slot || !mine) {
        return envelope("not_found", "No such upload.", 404);
      }

      if (!mockPhotoArrived(imageId)) {
        return envelope(
          "invalid_input",
          "The upload has not arrived at the host yet.",
          400,
        );
      }

      /*
        From here it is an ordinary media asset — it "appears in `GET /media`
        like any other". `ready` rather than `attested`: the rights attestation
        is the operator's next act, exactly as it is for a clip, and a mock that
        skipped it would let a screen ship that skips it too.
      */
      const mediaAssetId = `med_${Math.random().toString(36).slice(2, 10)}`;
      mediaAssets()[mediaAssetId] = {
        attested: false,
        kind: "image",
        state: "ready",
        // A photograph HAS a picture from the moment it arrives: the API builds
        // the URL from configuration at read time rather than storing one, so
        // there is no state in which an image row is missing its own picture.
        posterUrl: FIXTURE_POSTER,
      };
      delete photoIntents()[imageId];

      return HttpResponse.json({ mediaAssetId, next: "attest_rights" });
    }),
  ];
}
