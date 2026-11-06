import { http, HttpResponse } from "msw";
import type { components } from "../src/lib/api/schema.gen";
import type { MockTeamMember } from "./fixtures";

type ListingClaim = components["schemas"]["ListingClaim"];
type ProofMethod = components["schemas"]["ListingClaimProofMethod"];

/**
 * The claim routes (yuvoy-operator#388, the web half of yuvoy-mobile#388):
 * the listing's preview, the business's claims, a new claim and the two
 * email-code steps, as the API answers them. Every sentence is the API's
 * own, from the phone's mocks, so the two clients are tested against the
 * same words.
 *
 * Claims are kept per business (`businessOf`), and one claim at a time waits
 * on a listing, whoever made it.
 *
 * The phone picks its edges with a scenario header. This portal's reads run
 * on the server, where a test cannot set one, so the edges are chosen by the
 * listing and the person instead:
 *
 *   - a slug that starts `e2e-` is a listing made the first time it is asked
 *     for, so each test claims its own and parallel workers never meet. Its
 *     ending picks the edge: `-nosite` (no website), `-held` (a business
 *     holds it), `-busy` (another business's claim waits on it), `-limited`
 *     (a new claim is `429`), `-down` (the preview is `503`) and `-off` (the
 *     directory switched off: `404`);
 *   - `WIDE_READ_FAILS_ID`'s list is `503`, and `BANK_UNCONFIRMED_ID`'s is one
 *     claim in every state.
 *
 * There is no daily ceiling on claims here (the API's is five): the fixture
 * business is shared by every spec, and a ceiling would make one spec's
 * claims refuse another's. `-limited` is the `429`.
 */

export interface ClaimMockDeps {
  url: (path: string) => string;
  sessionUser: (request: Request) => MockTeamMember | null;
  businessOf: (request: Request) => string;
  requireSession: (request: Request) => Response | null;
  /** The suspended business's `403`, which the API answers before the role. */
  requireWritable: (request: Request) => Response | null;
  /** The person whose claims list answers `503`. */
  listFailsFor: string;
  /** The person whose claims list is one claim in every state. */
  everyStateFor: string;
}

/** The made-up listings on the mock directory, the phone's test data. */
export const CLAIM_LISTINGS = {
  /** Has a website, `claimtest.yuvoy.in`: every proof works. */
  reef: "example-reef-divers",
  /** No website: `email_domain` is `400 no_website`. */
  shore: "example-shore-cafe",
  /** Another business's claim waits on it: `409 claim_already_open`. */
  waiting: "example-busy-cove",
  /** A business holds it already: `409 already_claimed`. */
  held: "example-held-jetty",
  /** A name long enough to wrap twice on a phone. */
  long: "example-long-name",
} as const;

export const LONG_LISTING_NAME =
  "Example Island Reef, Wreck and Night Dive Centre with Snorkelling, Kayaks and Glass Bottom Boat Trips";

/** The two codes a claim's email step cycles through: only the newest one sent is right. */
export const CLAIM_EMAIL_CODES = ["246810", "135791"] as const;

interface MockListing {
  slug: string;
  subjectId: string;
  name: string;
  websiteHost: string | null;
  /** The business holding it, once a claim on it was approved. */
  heldBy: string | null;
  limited?: boolean;
  down?: boolean;
  off?: boolean;
}

interface Kept {
  business: string;
  claim: ListingClaim;
  slug: string;
  /** The code last sent for it, if any. */
  code: string | null;
  sends: number;
  tries: number;
}

const OTHER = "another business";

const subject = (n: number) =>
  `0b6c7a1e-0000-4000-8000-${String(n).padStart(12, "0")}`;

const fixed = (
  n: number,
  slug: string,
  name: string,
  websiteHost: string | null,
  heldBy: string | null = null,
): MockListing => ({ slug, subjectId: subject(n), name, websiteHost, heldBy });

const FIXED: readonly MockListing[] = [
  fixed(1, CLAIM_LISTINGS.reef, "Example Reef Divers", "claimtest.yuvoy.in"),
  fixed(2, CLAIM_LISTINGS.shore, "Example Shore Cafe", null),
  fixed(3, CLAIM_LISTINGS.waiting, "Example Busy Cove", "busycove.example.com"),
  fixed(
    4,
    CLAIM_LISTINGS.held,
    "Example Held Jetty",
    "www.heldjetty.example.com",
    OTHER,
  ),
  fixed(5, CLAIM_LISTINGS.long, LONG_LISTING_NAME, "longname.example.com"),
];

let listings: MockListing[] = [];
let claims: Kept[] = [];
let serial = 0;

export function resetClaimMocks(): void {
  listings = FIXED.map((l) => ({ ...l }));
  serial = 0;
  // Somebody else's claim waits on the busy cove.
  claims = [];
  waitOn(listings[2]);
}
resetClaimMocks();

function waitOn(listing: MockListing): void {
  serial += 1;
  claims.push({
    business: OTHER,
    slug: listing.slug,
    claim: claimFor(listing, "Another Business", "documents"),
    code: null,
    sends: 0,
    tries: 0,
  });
}

function claimFor(
  listing: MockListing,
  claimantName: string,
  proofMethod: ProofMethod,
): ListingClaim {
  return {
    claimId: `6f1c2b9e-0000-4000-8000-${String(serial).padStart(12, "0")}`,
    subjectKind: "supplier",
    subjectId: listing.subjectId,
    subjectName: listing.name,
    publicContact: null,
    claimantName,
    roleText: null,
    contactEmail: null,
    proofUrl: null,
    note: null,
    state: "waiting",
    decisionCode: null,
    proofMethod,
    proofCode: proofMethod === "public_page_code" ? "YUVOY-7KQ4MX" : null,
    proofEmailVerifiedAt: null,
    websiteHost: listing.websiteHost,
    createdAt: new Date(Date.now() + serial * 1000).toISOString(),
  };
}

/** An `e2e-` listing, made on first sight with the edge its ending names. */
function listingFor(slug: string): MockListing | undefined {
  const found = listings.find((l) => l.slug === slug);
  if (found || !/^e2e-[a-z0-9-]{1,120}$/.test(slug)) return found;
  const ends = (s: string) => slug.endsWith(`-${s}`);
  const words = slug.slice(4).split("-").filter(Boolean);
  const made: MockListing = {
    slug,
    subjectId: subject(listings.length + 1),
    name: `Test ${words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")}`,
    websiteHost: ends("nosite") ? null : "claimtest.yuvoy.in",
    heldBy: ends("held") ? OTHER : null,
    limited: ends("limited"),
    down: ends("down"),
    off: ends("off"),
  };
  listings.push(made);
  if (ends("busy")) waitOn(made);
  return made;
}

/** One claim in every state (the issue's Mocks list), newest first. */
export function everyStateClaims(): ListingClaim[] {
  const reef = FIXED[0];
  const base = (
    tail: string,
    at: string,
    over: Partial<ListingClaim>,
  ): ListingClaim => ({
    ...claimFor(reef, "Reef Divers Havelock", "documents"),
    claimId: `6f1c2b9e-0000-4000-8000-${tail.padStart(12, "e")}`,
    createdAt: at,
    ...over,
  });
  return [
    base("1", "2026-10-21T09:30:00Z", {
      proofMethod: "public_page_code",
      proofCode: "YUVOY-7KQ4MX",
    }),
    base("2", "2026-10-21T09:00:00Z", { proofMethod: "email_domain" }),
    base("3", "2026-10-21T08:30:00Z", {
      proofMethod: "email_domain",
      proofEmailVerifiedAt: "2026-10-21T08:40:00Z",
    }),
    base("4", "2026-10-21T08:00:00Z", {
      proofMethod: "call_to_published_number",
    }),
    base("5", "2026-10-21T07:30:00Z", { proofMethod: "documents" }),
    base("6", "2026-10-20T09:00:00Z", {
      state: "approved",
      decisionCode: "PROOF_CONFIRMED",
      operatorId: "0f0e0d0c-0000-4000-8000-000000000001",
      operatorStatus: "LIVE",
    }),
    base("7", "2026-10-19T09:00:00Z", {
      state: "refused",
      decisionCode: "PROOF_NOT_CONFIRMED",
    }),
    base("8", "2026-10-18T09:00:00Z", {
      state: "refused",
      decisionCode: "NOT_THE_BUSINESS",
    }),
    base("9", "2026-10-17T09:00:00Z", {
      state: "refused",
      decisionCode: "DUPLICATE",
    }),
    base("10", "2026-10-16T09:00:00Z", {
      state: "withdrawn",
      subjectName: "",
      websiteHost: null,
    }),
  ];
}

const NO_LISTING = "There is no listing to claim here.";

function refuse(
  status: number,
  code: string,
  message: string,
  details?: Record<string, string>,
  headers?: Record<string, string>,
) {
  return HttpResponse.json(
    { error: { code, message, ...(details ? { details } : {}) } },
    { status, headers },
  );
}

const ownerOrAdmin = (roles: readonly string[]) =>
  roles.includes("OWNER") || roles.includes("ADMIN");

const claimable = (l: MockListing) =>
  l.heldBy === null &&
  !claims.some((k) => k.slug === l.slug && k.claim.state === "waiting");

/** An address at the host or any parent of it short of the bare top-level name. */
function atHost(email: string, host: string): boolean {
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  if (!domain.includes(".")) return false;
  const h = host.toLowerCase();
  return h === domain || h.endsWith(`.${domain}`);
}

/** A waiting email claim of this business, or the answer that says why not. */
function emailClaim(id: string, business: string): Kept | Response {
  const kept = claims.find(
    (k) => k.claim.claimId === id && k.business === business,
  );
  if (!kept) return refuse(404, "not_found", "There is no such claim.");
  if (kept.claim.proofMethod !== "email_domain") {
    return refuse(
      409,
      "proof_method_not_email",
      "This claim is not proven by email.",
    );
  }
  if (kept.claim.state !== "waiting") {
    return refuse(409, "conflict", "This claim is decided already.", {
      reason: "not_waiting",
    });
  }
  return kept;
}

export function claimHandlers(deps: ClaimMockDeps) {
  const { url } = deps;

  /** The API's order: the session, then a suspension, then the role. */
  const writer = (request: Request): Response | null => {
    const shut = deps.requireSession(request) ?? deps.requireWritable(request);
    if (shut) return shut;
    if (!ownerOrAdmin(deps.sessionUser(request)?.roles ?? [])) {
      return refuse(403, "forbidden", "your role does not allow this");
    }
    return null;
  };

  return [
    http.get(url("/listing-claims/preview"), ({ request }) => {
      const shut = deps.requireSession(request);
      if (shut) return shut;
      const slug = new URL(request.url).searchParams.get("slug") ?? "";
      if (!slug || slug.length > 200) {
        return refuse(400, "invalid_input", "Name the listing.", {
          slug: "required",
        });
      }
      const listing = listingFor(slug);
      if (listing?.down) {
        return refuse(
          503,
          "internal_error",
          "We could not read that just now. Try again.",
        );
      }
      if (!listing || listing.off) return refuse(404, "not_found", NO_LISTING);
      return HttpResponse.json({
        name: listing.name,
        websiteHost: listing.websiteHost,
        claimable: claimable(listing),
      });
    }),

    http.get(url("/listing-claims"), ({ request }) => {
      const shut = deps.requireSession(request);
      if (shut) return shut;
      const me = deps.sessionUser(request)?.id;
      if (me === deps.listFailsFor) {
        return refuse(
          503,
          "internal_error",
          "We could not read that just now. Try again.",
        );
      }
      if (me === deps.everyStateFor) {
        return HttpResponse.json({ items: everyStateClaims() });
      }
      const business = deps.businessOf(request);
      const items = claims
        .filter((k) => k.business === business)
        .map((k) => k.claim)
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
      return HttpResponse.json({ items });
    }),

    http.post(url("/listing-claims"), async ({ request }) => {
      const shut = writer(request);
      if (shut) return shut;
      const body = (await request.json().catch(() => ({}))) as {
        supplierSlug?: string;
        proofMethod?: ProofMethod;
      };
      const listing = listingFor(body.supplierSlug ?? "");
      if (listing?.limited) {
        return refuse(
          429,
          "rate_limited",
          "You have made a lot of claims today. Try again tomorrow.",
          undefined,
          { "Retry-After": "43200" },
        );
      }
      if (!listing || listing.off) return refuse(404, "not_found", NO_LISTING);
      if (listing.heldBy !== null) {
        return refuse(
          409,
          "already_claimed",
          "A business has claimed this listing already.",
        );
      }
      if (!claimable(listing)) {
        return refuse(
          409,
          "claim_already_open",
          "A claim on this listing is already with our team.",
        );
      }
      const method = body.proofMethod;
      if (!method) {
        return refuse(400, "invalid_input", "Choose a proof.", {
          proofMethod: "required",
        });
      }
      if (method === "email_domain" && listing.websiteHost === null) {
        return refuse(
          400,
          "invalid_input",
          "This listing has no website, so prove it another way.",
          { proofMethod: "no_website" },
        );
      }
      const business = deps.businessOf(request);
      serial += 1;
      const claim = claimFor(
        listing,
        business === "reef"
          ? "Reef Divers Havelock"
          : (deps.sessionUser(request)?.name ?? ""),
        method,
      );
      claims.push({
        business,
        slug: listing.slug,
        claim,
        code: null,
        sends: 0,
        tries: 0,
      });
      return HttpResponse.json(claim, { status: 201 });
    }),

    http.post(
      url("/listing-claims/:id/email-code"),
      async ({ request, params }) => {
        const shut = writer(request);
        if (shut) return shut;
        const kept = emailClaim(String(params.id), deps.businessOf(request));
        if (kept instanceof Response) return kept;
        if (kept.sends >= 3) {
          return refuse(
            429,
            "rate_limited",
            "Too many codes for this claim. Try again in an hour.",
          );
        }
        const { email = "" } = (await request.json().catch(() => ({}))) as {
          email?: string;
        };
        if (!/^[^@\s]+@[^@\s]+$/.test(email.trim())) {
          return refuse(400, "invalid_input", "that is not an email address", {
            email: "not_an_email",
          });
        }
        const host = kept.claim.websiteHost;
        if (!host || !atHost(email.trim(), host)) {
          return refuse(
            400,
            "invalid_input",
            "Use an address at the listing's website.",
            { email: "not_at_website_host" },
          );
        }
        kept.code = CLAIM_EMAIL_CODES[kept.sends % CLAIM_EMAIL_CODES.length];
        kept.sends += 1;
        return new HttpResponse(null, { status: 204 });
      },
    ),

    http.post(
      url("/listing-claims/:id/email-code/verify"),
      async ({ request, params }) => {
        const shut = writer(request);
        if (shut) return shut;
        const kept = emailClaim(String(params.id), deps.businessOf(request));
        if (kept instanceof Response) return kept;
        if (kept.tries >= 10) {
          return refuse(
            429,
            "rate_limited",
            "Too many codes for this claim. Try again in an hour.",
          );
        }
        const { code = "" } = (await request.json().catch(() => ({}))) as {
          code?: string;
        };
        if (!/^[0-9]{6}$/.test(code)) {
          return refuse(400, "invalid_input", "Enter the six digits.", {
            code: "not_six_digits",
          });
        }
        kept.tries += 1;
        if (kept.code === null || code !== kept.code) {
          return refuse(
            400,
            "invalid_code",
            "That code did not work. Ask for a new one.",
          );
        }
        kept.claim = {
          ...kept.claim,
          proofEmailVerifiedAt: new Date().toISOString(),
        };
        kept.code = null;
        return new HttpResponse(null, { status: 204 });
      },
    ),
  ];
}
