import { http, HttpResponse } from "msw";
import {
  COMMISSION_OWED,
  COMMISSION_PAY_TO,
  COMMISSION_STATEMENTS,
  SETTLEMENT_SENT,
  SETTLEMENT_APPROVED,
  SETTLEMENT_OWED_BACK,
  STATEMENT_CSV,
  type MockTeamMember,
} from "./fixtures";

/**
 * The money routes of the mock API: settlements, commission owed, commission
 * statements and the list of change requests. Moved out of `handlers.ts`
 * as they were (yuvoy-operator#178). The helpers and the change-request
 * state stay there and come in through `deps`.
 */
export interface MoneyMockDeps {
  url: (path: string) => string;
  requireManager: (request: Request, refusal: string) => Response | null;
  requireSession: (request: Request) => Response | null;
  envelope: (
    code: string,
    message: string,
    status: number,
    details?: unknown,
  ) => Response;
  sessionUser: (request: Request) => MockTeamMember | null;
  isNewBusiness: (request: Request) => boolean;
  ownsNoStatements: (request: Request) => boolean;
  changesFor: (request: Request) => Record<string, unknown>[];
  sha256Hex: (text: string) => Promise<string>;
  /** The ids of the changes somebody stopped. A getter: the reset replaces it. */
  stoppedChanges: () => string[];
}

export function moneyHandlers(deps: MoneyMockDeps) {
  const {
    url,
    requireManager,
    requireSession,
    envelope,
    sessionUser,
    isNewBusiness,
    ownsNoStatements,
    changesFor,
    sha256Hex,
    stoppedChanges,
  } = deps;

  return [
    /* -------------------------------------------------------------- money - */

    /*
      SETTLEMENTS — yuvoy-operator#47.

      `GET /earnings` and its month picker are gone: a calendar month was never
      the unit money moves in, so every figure it derived was one no transfer ever
      matched. These four fixtures are shaped to exercise the cases that are
      easy to get wrong rather than the happy one.

      `nextSettlement` carries a CORRECTION, because a settlement whose
      adjustment is zero never shows the row that explains why the rows do not add
      up to the total.

      `pipeline` and `paidAtCounter` are non-zero and deliberately NOT summable
      into anything: the contract says the pipeline "is never part of anything
      earned", and a fixture of zeros would let a screen add them in and still
      look right.
    */
    http.get(url("/settlements/overview"), async ({ request }) => {
      const failed = requireManager(
        request,
        "Requires OWNER, ADMIN or MANAGER.",
      );
      if (failed) return failed;

      return HttpResponse.json({
        nextSettlement: {
          periodStart: "2026-09-07",
          periodEnd: "2026-09-13",
          settlesFrom: "2026-09-14",
          bookings: 6,
          grossPaise: 5400000,
          commissionPaise: 810000,
          refundsPaise: 450000,
          adjustmentsPaise: -125000,
          netPaise: 4015000,
        },
        pipeline: {
          bookings: 4,
          grossPaise: 3600000,
          commissionPaise: 540000,
          refundsPaise: 0,
          netPaise: 3060000,
        },
        paidAtCounter: {
          bookings: 3,
          farePaise: 2700000,
          commissionPaise: 405000,
          netPaise: 2295000,
          // The same held and unrecorded figures `/commission-owed` sends, so
          // Earnings and Cash agree, as the contract promises.
          heldBookings: COMMISSION_OWED.heldBookings,
          heldCollectedPaise: COMMISSION_OWED.heldCollectedPaise,
          unrecordedBookings: COMMISSION_OWED.unrecordedBookings,
          unrecordedFarePaise: COMMISSION_OWED.unrecordedFarePaise,
          unrecordedLines: COMMISSION_OWED.unrecordedLines,
        },
        seasonToDate: {
          from: "2026-04-01",
          settlements: 18,
          bookings: 214,
          grossPaise: 192600000,
          commissionPaise: 28890000,
          refundsPaise: 7200000,
          adjustmentsPaise: -340000,
          netPaise: 156170000,
        },
      });
    }),

    /*
      Past weeks, one of each state, most recent first.

      `complete: true` and no cursor: paging is exercised by the unit tests rather
      than by a fixture that would make every e2e read two pages.

      The oldest week is NEGATIVE. A correction larger than what a week pays makes
      the net below zero, and the contract says that week "is not paid until
      somebody at Yuvoy decides how to recover it". A fixture without one would
      let a screen render an absolute value and pass.
    */
    http.get(url("/settlements"), async ({ request }) => {
      const failed = requireManager(
        request,
        "Requires OWNER, ADMIN or MANAGER.",
      );
      if (failed) return failed;

      return HttpResponse.json({
        items: [SETTLEMENT_SENT, SETTLEMENT_APPROVED, SETTLEMENT_OWED_BACK],
        complete: true,
        nextCursor: null,
      });
    }),

    http.get(url("/settlements/:id"), async ({ request, params }) => {
      const failed = requireManager(
        request,
        "Requires OWNER, ADMIN or MANAGER.",
      );
      if (failed) return failed;

      const found = [
        SETTLEMENT_SENT,
        SETTLEMENT_APPROVED,
        SETTLEMENT_OWED_BACK,
      ].find((x) => x.id === params.id);
      if (!found) return envelope("not_found", "No such settlement.", 404);

      return HttpResponse.json({
        ...found,
        /*
          Two lines, and their nets deliberately do NOT add up to the
          settlement's: the difference is exactly `adjustmentsPaise`, which is on
          the settlement and on no line. That gap is the thing the screen has to
          explain, so the fixture has to contain it.

          The second line is a cancelled booking the operator kept money on: a
          commission of 0, because we take none on a booking that did not happen.
        */
        lines: [
          {
            bookingId: "bk_stl_1",
            reference: "YV-7KJ2MQ",
            tripDate: "2026-09-09",
            guests: 2,
            grossPaise: 3600000,
            commissionPaise: 540000,
            refundedPaise: 0,
            netPaise: 3060000,
          },
          {
            bookingId: "bk_stl_2",
            reference: "YV-9PL4XR",
            tripDate: "2026-09-11",
            guests: 1,
            grossPaise: 1800000,
            commissionPaise: 0,
            refundedPaise: 900000,
            netPaise: 900000,
          },
        ],
      });
    }),

    /*
      The statement, with the header that lets an operator prove they hold the
      same file we do. The sha256 is COMPUTED from the body rather than
      hardcoded, so the fixture cannot drift out of agreement with itself and
      silently make the integrity check look broken.
    */
    http.get(url("/settlements/:id/statement"), async ({ request, params }) => {
      const failed = requireManager(
        request,
        "Requires OWNER, ADMIN or MANAGER.",
      );
      if (failed) return failed;

      if (params.id !== SETTLEMENT_SENT.id) {
        return envelope(
          "not_settled",
          "This payout has not been sent yet.",
          409,
        );
      }

      const csv = STATEMENT_CSV;
      const digest = await sha256Hex(csv);
      return new HttpResponse(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv",
          "X-Payout-Sha256": digest,
          "Content-Disposition": `attachment; filename="yuvoy-statement-${SETTLEMENT_SENT.periodStart}-to-${SETTLEMENT_SENT.periodEnd}.csv"`,
        },
      });
    }),

    /*
      WHAT IS OWED ON CASH — yuvoy-operator#40 §2.

      Three completed cash trips, because the screen's whole argument is that
      every line is checkable — a single-line fixture would let the list be
      rendered as a total and still pass. The third line carries a SHORTFALL:
      the operator took less than the fare, and our share is owed on the fare
      regardless ("a discount you gave is yours to have given"), which is the
      one row on this screen whose arithmetic looks wrong until it is explained.

      The MANAGER identity owes nothing, which is the zero case — real, common,
      and a sentence rather than a table of ₹0.
    */
    http.get(url("/commission-owed"), async ({ request }) => {
      const failed = requireManager(
        request,
        "Requires OWNER, ADMIN or MANAGER.",
      );
      if (failed) return failed;

      /*
        Dev Kapoor (MANAGER) owes nothing; the owner owes for three trips. Keyed
        on identity because that is how every other branch in these mocks varies
        — this repo has no scenario switch — and it buys the zero case a real
        screen to be rendered on. `bookings: 0` is not an error and not a
        spinner, and it is common: every cash trip settled, or none taken yet.

        The business with nothing on it yet answers the same way, and has to:
        it has no listings and no departures, so it can have taken no cash and
        left no past trip unrecorded. Without this it read the fixture dive
        shop's figures and Home put "1 past cash trip has no payment recorded"
        in front of an operator who has never sold anything (yuvoy-operator#96).
      */
      if (
        sessionUser(request)!.id === "usr_manager_dev" ||
        isNewBusiness(request)
      ) {
        return HttpResponse.json({
          bookings: 0,
          farePaise: 0,
          collectedPaise: 0,
          commissionPaise: 0,
          lines: [],
          heldBookings: 0,
          heldFarePaise: 0,
          heldCollectedPaise: 0,
          heldCommissionPaise: 0,
          heldLines: [],
          unrecordedBookings: 0,
          unrecordedFarePaise: 0,
          unrecordedLines: [],
        });
      }

      return HttpResponse.json(COMMISSION_OWED);
    }),

    /*
      THE WEEKLY COMMISSION STATEMENTS (yuvoy-operator#121, D-043).

      Reef Divers has four, one in each state (see `COMMISSION_STATEMENTS`).
      Dev Kapoor (MANAGER) and the business with nothing on it yet have none,
      as they owe nothing on `/commission-owed`: the zero case, which the Money
      tab must draw as no commission block at all rather than a ₹0.

      `complete: true` and no cursor: paging is exercised by the unit tests
      rather than by a fixture that would make every e2e read two pages.
    */
    http.get(url("/commission-statements"), async ({ request }) => {
      const failed = requireManager(
        request,
        "Requires OWNER, ADMIN or MANAGER.",
      );
      if (failed) return failed;

      const items = ownsNoStatements(request)
        ? []
        : COMMISSION_STATEMENTS.map((s) => {
            /* The list carries no trips or payments; one statement's read does. */
            const statement: Record<string, unknown> = { ...s };
            delete statement.lines;
            delete statement.payments;
            return statement;
          });
      return HttpResponse.json({
        items,
        complete: true,
        nextCursor: null,
        payTo: COMMISSION_PAY_TO,
      });
    }),

    /*
      One statement. Another business's answers 404 exactly as one that does
      not exist, which is what the screen's `notFound()` is tested against.

      `upiLink` only while something is owed, as the contract says, with the
      amount in rupees and the reference as the note: built here from the
      statement, so the button's amount and the link's can never drift apart in
      a fixture. Encoded as the API's `upiLink` encodes it (yuvoy-api
      internal/handler/commission_statements.go): escaped, spaces as `%20`.
    */
    http.get(url("/commission-statements/:id"), async ({ request, params }) => {
      const failed = requireManager(
        request,
        "Requires OWNER, ADMIN or MANAGER.",
      );
      if (failed) return failed;

      const found = ownsNoStatements(request)
        ? undefined
        : COMMISSION_STATEMENTS.find((s) => s.id === params.id);
      if (!found) return envelope("not_found", "No such statement.", 404);

      const rupees = (found.owedPaise / 100).toFixed(2);
      /* `url.QueryEscape` escapes !'()* too, which `encodeURIComponent` leaves bare. */
      const enc = (value: string) =>
        encodeURIComponent(value).replace(
          /[!'()*]/g,
          (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
        );
      const upiLink =
        found.owedPaise > 0
          ? `upi://pay?pa=${enc(COMMISSION_PAY_TO.upiId)}` +
            `&pn=${enc(COMMISSION_PAY_TO.payee)}&am=${rupees}` +
            `&cu=INR&tn=${enc(found.reference)}`
          : undefined;
      return HttpResponse.json({
        ...found,
        payTo: { ...COMMISSION_PAY_TO, ...(upiLink ? { upiLink } : {}) },
      });
    }),

    /*
      One business's changes, and only that business's.

      `CHANGE_REQUESTS` is Reef Divers' history and `bankChanges` records who
      raised each one, so a signup identity sees an empty list until it raises
      something of its own. Before this, every identity in the mock saw Reef
      Divers' open change — which made a brand-new account's Payout screen say
      "there is already a change in progress" before it had ever had a bank
      account, and made any test on a second identity depend on whether another
      spec had raised one first.

      `raisedFor` is stripped on the way out: it is bookkeeping this mock needs
      and not a field the API sends.
    */
    http.get(url("/change-requests"), async ({ request }) => {
      const failed = requireSession(request);
      if (failed) return failed;
      const live = changesFor(request).map((r) =>
        stoppedChanges().includes(String((r as { id?: string }).id))
          ? { ...r, state: "withdrawn" }
          : r,
      );
      return HttpResponse.json({ requests: live });
    }),
  ];
}
