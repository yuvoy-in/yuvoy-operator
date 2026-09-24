import { describe, expect, it } from "vitest";
import { countBadges } from "@/lib/site/badge-counts";
import type { Blocker } from "./standing";
import { waitingItems } from "./waiting";

/*
  The strip on the business profile (yuvoy-operator#86 s9): "'2 things
  waiting on you' does not say what they are ... Name the two things in the
  strip: 'Add your logo · Complete business details'."
*/

const blocker = (
  code: Blocker["code"],
  label: string,
  waitingOn: Blocker["waitingOn"] = "operator",
): Blocker => ({ code, label, waitingOn, gates: false });

/** Production's own business on the day of the review, in the API's words. */
const HC_DIVING: Blocker[] = [
  blocker(
    "BUSINESS_DETAILS_INCOMPLETE",
    "We still need your registered business name and address",
  ),
  blocker(
    "LOGO_MISSING",
    "We still need your logo: it appears on every reel and listing",
  ),
];

describe("what is waiting on the operator", () => {
  it("names each thing and links it to where it is fixed", () => {
    expect(waitingItems(HC_DIVING, true)).toEqual([
      { text: "Complete your details", href: "/profile" },
      { text: "Add your logo", href: "/logo" },
    ]);
  });

  it("names a document from the API's own sentence", () => {
    expect(
      waitingItems(
        [
          blocker(
            "CREDENTIAL_MISSING",
            "We still need your insurance certificate",
          ),
          blocker("CREDENTIAL_EXPIRED", "boat registration has expired"),
          blocker("CREDENTIAL_REJECTED", "GST registration was not accepted"),
        ],
        true,
      ),
    ).toEqual([
      {
        text: "Send your insurance certificate",
        href: "/profile#documents",
      },
      { text: "Send a new boat registration", href: "/profile#documents" },
      // An acronym keeps its capitals.
      { text: "Send a new GST registration", href: "/profile#documents" },
    ]);
  });

  it("says the API's sentence when it cannot read the document out of it", () => {
    // The contract: render `label` for anything you do not recognise.
    expect(
      waitingItems(
        [
          blocker(
            "CREDENTIAL_MISSING",
            "We have no equipment inspection on file.",
          ),
          blocker("OTHER", "Sign the updated terms"),
        ],
        true,
      ),
    ).toEqual([
      {
        text: "We have no equipment inspection on file.",
        href: "/profile#documents",
      },
      // Nothing to fix it on its own screen, so the list that explains it.
      { text: "Sign the updated terms", href: "/account/verification" },
    ]);
  });

  it("leaves out what is waiting on Yuvoy, which is not the operator's to do", () => {
    expect(
      waitingItems(
        [
          ...HC_DIVING,
          blocker(
            "AWAITING_REVIEW",
            "Everything is with us: we are reviewing your account",
            "yuvoy",
          ),
        ],
        true,
      ),
    ).toHaveLength(2);
  });

  it("names every item the Business badge counts, and the ones it does not", () => {
    /*
      The badge counts only what stops the business selling (yuvoy-operator
      #96 item 6: a "2" for two items that stop nothing does not scan), and
      the strip names everything waiting on the operator. So every badged item
      is named here, and a selling business's outstanding items are named with
      no number on the bar.
    */
    const blocking = [
      ...HC_DIVING,
      {
        ...blocker(
          "CREDENTIAL_MISSING",
          "We still need your insurance certificate",
        ),
        gates: true,
      },
      blocker(
        "CREDENTIAL_UNVERIFIED",
        "We are checking your oxygen record",
        "yuvoy",
      ),
    ];
    const badge = (bookable: boolean) =>
      countBadges({
        account: {
          state: bookable ? "LIVE" : "PROSPECT",
          bookable,
          blocking,
          credentials: [],
          requiredDocuments: [],
        },
        canManage: true,
        requests: [],
      }).business;
    const items = waitingItems(blocking, true);
    expect(items).toHaveLength(3);
    expect(badge(true)).toBe(0);
    // Not selling: the insurance stops sales; the logo and details do not.
    expect(badge(false)).toBe(1);
    expect(items.map((i) => i.text)).toContain(
      "Send your insurance certificate",
    );
  });
});

describe("what a staff phone is told", () => {
  /*
    The audit before release (M10): "Add your logo" and "Complete your
    details" were links for a staff login, into screens that then said only
    an owner, admin or manager can. A document is anybody's to send.
  */
  it("names the logo and the details without a link, and keeps documents linked", () => {
    const items = waitingItems(
      [
        { code: "LOGO_MISSING", waitingOn: "operator", label: "Add your logo" },
        {
          code: "BUSINESS_DETAILS_INCOMPLETE",
          waitingOn: "operator",
          label: "Your registered business details are not complete",
        },
        {
          code: "CREDENTIAL_MISSING",
          waitingOn: "operator",
          label: "We still need your insurance certificate",
        },
      ] as never,
      false,
    );
    expect(items[0].href).toBeUndefined();
    expect(items[1].href).toBeUndefined();
    expect(items[2].href).toBeDefined();
    expect(items[2].text).toBe("Send your insurance certificate");
  });
});
