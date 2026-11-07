import { http, HttpResponse } from "msw";
import type { MockTeamMember } from "./fixtures";
import { mockPhotoArrived } from "./tus-server";

export interface MockStoryPhoto {
  id: string;
  imageId: string;
  position: number;
}

export interface MockStory {
  about: string;
  languages: string[];
  photos: MockStoryPhoto[];
}

/**
 * The story, reviews and logo routes of the mock API: the business's story
 * and its photographs, what travellers said, and the logo. Moved out of
 * `handlers.ts` as they were (yuvoy-operator#178). The helpers and the state
 * stay there. The story and the logo come in through getters in `deps`,
 * because `__resetOperatorMocks` replaces them, and a new logo goes back
 * through `setLogo`.
 */
export interface StoryMockDeps {
  url: (path: string) => string;
  requireSession: (request: Request) => Response | null;
  /** The suspended business's `403`, which the API answers before the role. */
  requireWritable: (request: Request) => Response | null;
  /** Owner, admin or manager, else `403` with this refusal. */
  requireManager: (request: Request, refusal: string) => Response | null;
  envelope: (
    code: string,
    message: string,
    status: number,
    details?: unknown,
  ) => Response;
  sessionUser: (request: Request) => MockTeamMember | null;
  isLiveBusiness: (me: { id: string }) => boolean;
  fileForReview: (
    request: Request,
    kind: "logo" | "profile",
    summary: string,
  ) => void;
  imageIntent: () => {
    imageId: string;
    uploadUrl: string;
    expiresAt: string;
    maxBytes: number;
    next: string;
  };
  storyResponse: () => Record<string, unknown>;
  storyPhotoJson: (photo: MockStoryPhoto) => {
    id: string;
    position: number;
    url: string;
  };
  mockLogoUrl: (imageId: string) => string;
  /** The business's story. */
  story: () => MockStory;
  /** The logo in use, or null for none. */
  currentLogo: () => { imageId: string; uploadedAt: string } | null;
  /** Puts a new logo in use. */
  setLogo: (logo: { imageId: string; uploadedAt: string }) => void;
}

export function storyHandlers(deps: StoryMockDeps) {
  const {
    url,
    requireSession,
    requireWritable,
    requireManager,
    envelope,
    sessionUser,
    isLiveBusiness,
    fileForReview,
    imageIntent,
    storyResponse,
    storyPhotoJson,
    mockLogoUrl,
    story,
    currentLogo,
    setLogo,
  } = deps;

  return [
    /* ------------------------------------------------------------ story --- */

    /**
     * The business's own story — yuvoy-operator#41. The API's shapes, and its
     * lower-case sentences, so the screen's reading of both is exercised.
     */
    http.get(url("/story"), async ({ request }) => {
      const failed = requireSession(request);
      if (failed) return failed;
      return HttpResponse.json(storyResponse());
    }),

    /**
     * What travellers said (yuvoy-api#185). Nothing has been published, which
     * agrees with the `stats.rating` above: "published reviews only, so
     * `summary` and `stats.rating` always agree". Unmocked, the Reviews tab had
     * only ever said it did not load.
     */
    http.get(url("/reviews"), async ({ request }) => {
      const failed = requireSession(request);
      if (failed) return failed;
      return HttpResponse.json({
        summary: {
          averageRating: null,
          count: 0,
          tags: {
            guide: 0,
            safety: 0,
            value: 0,
            organisation: 0,
            punctuality: 0,
            equipment: 0,
          },
        },
        items: [],
        complete: true,
      });
    }),

    http.put(url("/story"), async ({ request }) => {
      const failed = requireSession(request);
      if (failed) return failed;
      /*
        `403 account_suspended`, which this write declares: a suspended business
        reads its story and its clips and may not change them (yuvoy-operator#90
        f13). Modelled so the portal's answer to it runs.
      */
      const shut = requireWritable(request);
      if (shut) return shut;

      const body = (await request.json().catch(() => null)) as {
        about?: unknown;
        languages?: unknown;
      } | null;
      if (!body || typeof body !== "object") {
        return envelope("invalid_input", "we could not read that", 400);
      }

      /*
        The API's order and the API's arithmetic: trim, then Go's `len`, which
        counts bytes. A mock that counted characters would pass a paragraph
        production refuses, and the screen's own count would never meet it.
      */
      const about = typeof body.about === "string" ? body.about.trim() : "";
      const size = new TextEncoder().encode(about).length;
      if (about !== "" && (size < 40 || size > 600)) {
        return envelope(
          "invalid_input",
          "we cannot use that: tell them 40 to 600 characters about the business",
          400,
        );
      }
      const languages = Array.isArray(body.languages)
        ? body.languages.map((l) => String(l))
        : [];
      // Counted BEFORE blanks and repeats go — the API's own order.
      if (languages.length > 8) {
        return envelope(
          "invalid_input",
          "we cannot use that: at most eight languages",
          400,
        );
      }
      const seen = new Set<string>();
      story().about = about;
      story().languages = languages
        .map((l) => l.trim())
        .filter((l) => {
          if (!l || seen.has(l)) return false;
          seen.add(l);
          return true;
        });
      return HttpResponse.json(storyResponse());
    }),

    /**
     * The LOGO's upload slot. Owner and manager only, because a logo is the
     * business's mark.
     *
     * A story photograph used to ride this one, on the issue's original
     * instruction. It is gated differently and that gate is modelled here, so a
     * portal that went back to using it for photographs would fail a staff
     * member's test rather than a staff member (yuvoy-operator#41).
     */
    http.post(url("/logo/upload-intents"), async ({ request }) => {
      const failed = requireSession(request);
      if (failed) return failed;
      const denied = requireManager(
        request,
        "Only an owner, admin or manager can change the logo.",
      );
      if (denied) return denied;

      return HttpResponse.json(imageIntent(), { status: 201 });
    }),

    /**
     * The mark in use. `logoUrl` absent when there is none, as the contract
     * says; never the pending one, which is not up yet.
     */
    http.get(url("/logo"), async ({ request }) => {
      const failed = requireSession(request);
      if (failed) return failed;
      const logo = currentLogo();
      if (!logo) return HttpResponse.json({});
      return HttpResponse.json({
        imageId: logo.imageId,
        logoUrl: mockLogoUrl(logo.imageId),
        uploadedAt: logo.uploadedAt,
      });
    }),

    /**
     * Set the logo, the way the API does (`operator_logo.go` at e7291e3):
     *
     *   - OWNER, ADMIN or MANAGER only.
     *   - The HOST is asked whether the file arrived, not the browser: an id the
     *     mock image host never received is a 400.
     *   - A LIVE business's new mark is RECORDED FOR REVIEW: `202 { state:
     *     "in_review", next }` and deliberately no `logoUrl`, because the old
     *     logo is still the live one (D-032.3). `GET /logo` goes on answering
     *     with the old mark, and the new one is listed on `GET
     *     /change-requests` as `logo`, pending. Declared under this `PUT` in
     *     the contract since yuvoy-api#222.
     *   - Anybody else's is applied: `200 { logoUrl }`.
     */
    http.put(url("/logo"), async ({ request }) => {
      const denied = requireManager(
        request,
        "only an owner, admin or manager can change the logo",
      );
      if (denied) return denied;

      const body = (await request.json().catch(() => ({}))) as {
        imageId?: unknown;
      };
      const imageId =
        typeof body.imageId === "string" ? body.imageId.trim() : "";
      if (!imageId) return envelope("invalid_input", "which image?", 400);
      if (!mockPhotoArrived(imageId)) {
        return envelope(
          "invalid_input",
          "that upload has not arrived. Post the file to the upload URL first",
          400,
        );
      }

      if (isLiveBusiness(sessionUser(request)!)) {
        fileForReview(request, "logo", "New logo");
        return HttpResponse.json(
          {
            state: "in_review",
            next: "We look at a new logo before it appears on your reels and listings. Your current one stays up until we do.",
          },
          { status: 202 },
        );
      }

      setLogo({ imageId, uploadedAt: new Date().toISOString() });
      return HttpResponse.json({ logoUrl: mockLogoUrl(imageId) });
    }),

    /**
     * The STORY's own upload slot — yuvoy-api#161.
     *
     * Open to every operator role, which is the same set that may edit the
     * story. Session only, and deliberately no `requireManage`: that difference
     * from the logo's slot above is the whole reason this endpoint exists.
     */
    http.post(url("/story/photos/upload-intents"), async ({ request }) => {
      const failed = requireSession(request);
      if (failed) return failed;
      /*
        `403 account_suspended`, which this write declares: a suspended business
        reads its story and its clips and may not change them (yuvoy-operator#90
        f13). Modelled so the portal's answer to it runs.
      */
      const shut = requireWritable(request);
      if (shut) return shut;

      return HttpResponse.json(imageIntent(), { status: 201 });
    }),

    http.post(url("/story/photos"), async ({ request }) => {
      const failed = requireSession(request);
      if (failed) return failed;
      /*
        `403 account_suspended`, which this write declares: a suspended business
        reads its story and its clips and may not change them (yuvoy-operator#90
        f13). Modelled so the portal's answer to it runs.
      */
      const shut = requireWritable(request);
      if (shut) return shut;

      const body = (await request.json().catch(() => ({}))) as {
        imageId?: unknown;
      };
      const imageId =
        typeof body.imageId === "string" ? body.imageId.trim() : "";
      if (!imageId) {
        return envelope("invalid_input", "we could not read that image", 400);
      }

      /*
        Already theirs? The same photograph back, BEFORE looking for a slot —
        otherwise "a double tap on a wet phone would be told the gallery is
        full". And, like the API, nothing here asks the host whether the file
        arrived; that is the uploader's job until the API does it.
      */
      const existing = story().photos.find((p) => p.imageId === imageId);
      if (existing) {
        return HttpResponse.json(storyPhotoJson(existing), { status: 201 });
      }

      // The lowest free slot, so removing the third and adding one fills it.
      const taken = new Set(story().photos.map((p) => p.position));
      const position = [1, 2, 3, 4, 5].find((n) => !taken.has(n));
      if (position === undefined) {
        return envelope(
          "conflict",
          "you already have five photographs — remove one first",
          409,
        );
      }

      const photo: MockStoryPhoto = {
        id: `sph_${Math.random().toString(36).slice(2, 10)}`,
        imageId,
        position,
      };
      story().photos = [...story().photos, photo].sort(
        (a, b) => a.position - b.position,
      );
      return HttpResponse.json(storyPhotoJson(photo), { status: 201 });
    }),

    http.delete(url("/story/photos/:id"), async ({ request, params }) => {
      const failed = requireSession(request);
      if (failed) return failed;
      /*
        `403 account_suspended`, which this write declares: a suspended business
        reads its story and its clips and may not change them (yuvoy-operator#90
        f13). Modelled so the portal's answer to it runs.
      */
      const shut = requireWritable(request);
      if (shut) return shut;

      // Another business's photograph answers exactly as one that does not
      // exist; here there is only one business, so absent is the whole test.
      const id = String(params.id);
      if (!story().photos.some((p) => p.id === id)) {
        return envelope("not_found", "we could not find that photograph", 404);
      }
      story().photos = story().photos.filter((p) => p.id !== id);
      return new HttpResponse(null, { status: 204 });
    }),
  ];
}
