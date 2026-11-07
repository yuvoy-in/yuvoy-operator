import { http, HttpResponse } from "msw";
import { AWAITING_ID, type MockTeamMember } from "./fixtures";
import { MOCK_TUS_PORT, mockDocumentArrived } from "./tus-server";

/**
 * The document file routes of the mock API: signing a URL for the file
 * behind a document, and asking the bucket what arrived. Moved out of
 * `handlers.ts` as they were (yuvoy-operator#178). The helpers and the state
 * stay there. The upload intents and the files on record come in through
 * getters in `deps`, because `__resetOperatorMocks` replaces them; the routes
 * only change what is inside them, so no setter is needed.
 */
export interface DocumentFileMockDeps {
  url: (path: string) => string;
  requireSession: (request: Request) => Response | null;
  envelope: (
    code: string,
    message: string,
    status: number,
    details?: unknown,
  ) => Response;
  sessionUser: (request: Request) => MockTeamMember | null;
  /** One credential by its id, across every account fixture. */
  credentialOf: (
    id: string,
  ) => { id?: string; type?: string; state?: string } | undefined;
  /** Upload intents for a document's file, by intent id. */
  documentIntents: () => Record<
    string,
    {
      credentialId: string;
      filename: string;
      contentType: string;
      sizeBytes: number;
      /** Refused or already used. A closed intent answers `upload_closed`. */
      closed?: boolean;
    }
  >;
  /** Files on record, by credential id. */
  documentFiles: () => Record<
    string,
    { filename: string; sizeBytes: number; contentType: string }
  >;
}

export function documentFileHandlers(deps: DocumentFileMockDeps) {
  const {
    url,
    requireSession,
    envelope,
    sessionUser,
    credentialOf,
    documentIntents,
    documentFiles,
  } = deps;

  return [
    /* ------------------------------------------------- document files ----- */

    /**
     * Sign a URL for the file behind a document — yuvoy-operator#46 item 3.
     *
     * "Only a pending document takes a file", which is the refusal the portal
     * withholds the control for; modelled anyway, because the control is withheld
     * on a render and the decision can change between that and the tap.
     */
    http.post(
      url("/credentials/:id/upload-intents"),
      async ({ request, params }) => {
        const failed = requireSession(request);
        if (failed) return failed;
        /*
          A service with no documents store, which is production today: every
          upload intent answers `503 documents_unavailable` before anything else
          is looked at (yuvoy-operator#93). Stood in for by the business waiting
          on our review, the one identity whose pending document no upload test
          needs to reach the bucket.
        */
        if (sessionUser(request)?.id === AWAITING_ID) {
          return envelope(
            "documents_unavailable",
            "we cannot take documents just yet",
            503,
          );
        }
        /*
          NOT `requireWritable`. A suspended business may still send a document
          (#50), and refusing here would hold an operator at a state they are
          being asked to clear.
        */

        const credentialId = String(params.id);
        const body = (await request.json()) as {
          filename?: string;
          contentType?: string;
          sizeBytes?: number;
        };

        const KINDS = ["application/pdf", "image/jpeg", "image/png"];
        if (!KINDS.includes(String(body.contentType))) {
          return envelope("invalid_input", "PDF, JPEG or PNG.", 400);
        }
        if (
          !Number.isInteger(body.sizeBytes) ||
          (body.sizeBytes ?? 0) <= 0 ||
          (body.sizeBytes ?? 0) > 10 * 1024 * 1024
        ) {
          return envelope("invalid_input", "Up to 10 MB.", 400);
        }

        /*
          A document already verified or rejected is locked, whether it was so
          when the page rendered or became so while the operator was picking a
          file: "a new file behind it would change the evidence under a decision
          nobody re-made."
        */
        const credential = credentialOf(credentialId);
        if (credential && credential.state !== "pending") {
          return envelope(
            "document_locked",
            "This document has already been checked, so its file cannot change. File it again to send a different one.",
            409,
          );
        }

        const intentId = `int_${Math.random().toString(36).slice(2, 10)}`;
        documentIntents()[intentId] = {
          credentialId,
          filename: String(body.filename ?? "document"),
          contentType: String(body.contentType),
          sizeBytes: Number(body.sizeBytes),
        };

        return HttpResponse.json(
          {
            intentId,
            /*
              A DIFFERENT ORIGIN, as production is: "the file never passes through
              this API". MSW runs in the Next process here, so a same-origin URL
              would be intercepted and the browser's cross-origin upload — the
              one the CSP's `connect-src` actually governs — would never happen.
            */
            uploadUrl: `http://127.0.0.1:${MOCK_TUS_PORT}/documents/${intentId}`,
            method: "PUT",
            /*
              Signed headers, sent back "exactly as given". The metadata is what
              `complete` looks for to know a URL minted here signed this file.
            */
            headers: {
              "Content-Type": String(body.contentType),
              "x-amz-meta-intent": intentId,
              "x-amz-meta-credential": credentialId,
            },
            expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
            maxBytes: 10 * 1024 * 1024,
            next: "send_the_file",
          },
          { status: 201 },
        );
      },
    ),

    /**
     * Ask the bucket what actually arrived — yuvoy-operator#46 item 3.
     *
     * Every refusal here is modelled, because each is a different next step on
     * screen and none of them would ever run against a mock that took the
     * browser's word: the file that never arrived, the intent already used, and
     * the file that is not the size it declared.
     */
    http.post(
      url("/credentials/:id/upload-intents/:intentId/complete"),
      async ({ request, params }) => {
        const failed = requireSession(request);
        if (failed) return failed;

        const credentialId = String(params.id);
        const intentId = String(params.intentId);
        const intent = documentIntents()[intentId];
        if (!intent || intent.credentialId !== credentialId) {
          return envelope("not_found", "No such upload.", 404);
        }
        if (intent.closed) {
          return envelope(
            "upload_closed",
            "That upload was refused or replaced. Start a new one.",
            409,
          );
        }

        const arrived = mockDocumentArrived(intentId);
        if (!arrived) {
          // "The file has not reached the bucket yet, so send it first."
          return envelope(
            "upload_not_arrived",
            "The file has not reached us yet.",
            409,
          );
        }
        if (arrived.bytes !== intent.sizeBytes) {
          /*
            Closed, and the retention sweep deletes it: "a file this refuses is
            closed … start a new upload to send another." So the intent cannot be
            completed a second time, which is what makes `upload_closed` reachable.
          */
          intent.closed = true;
          return HttpResponse.json(
            {
              error: {
                code: "document_refused",
                message: "That file is not the size it said it was.",
                details: { reason: "size_mismatch" },
              },
            },
            { status: 400 },
          );
        }

        const replacedPrevious = Boolean(documentFiles()[credentialId]);
        documentFiles()[credentialId] = {
          filename: intent.filename,
          sizeBytes: intent.sizeBytes,
          contentType: intent.contentType,
        };

        /*
          "Called again after it succeeded, it answers the same thing again." The
          intent is NOT closed here, so a retry on a dropped response is answered
          rather than refused.
        */
        return HttpResponse.json({
          credentialId,
          hasFile: true,
          filename: intent.filename,
          sizeBytes: intent.sizeBytes,
          contentType: intent.contentType,
          replacedPrevious,
          next: "we_check_it",
        });
      },
    ),
  ];
}
