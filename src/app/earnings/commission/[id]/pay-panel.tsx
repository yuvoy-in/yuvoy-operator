import { buttonClass } from "@/components/ui/button-class";
import { Panel } from "@/components/ui/panel";
import { formatPaise } from "@/lib/format/money";
import { SUPPORT_PHONE, SUPPORT_PHONE_HREF } from "@/lib/site/contact";
import { CopyValue } from "./copy-value";

/**
 * How to pay what is still owed on one statement (yuvoy-operator#121, D-043).
 *
 * ## The button, and why the details stay beside it
 *
 * "Pay ₹X by UPI" opens `payTo.upiLink`, a `upi://pay` link carrying Yuvoy's
 * UPI ID, the amount owed and the statement's reference as the note. It does
 * nothing on a computer, and not every phone hands a `upi://` link to an app,
 * so the UPI ID and payee are always shown as text beside it, each with a way
 * to copy it: that is how somebody paying from another phone pays.
 *
 * ## The reference
 *
 * Yuvoy's staff match a payment to a statement by the note on it. A payment
 * without the reference is money nobody can attribute, so the line asking for
 * it is not optional copy.
 *
 * ## Nothing here posts anything
 *
 * The money moves in the operator's own UPI app. A payment appears on the
 * statement once Yuvoy has received it and recorded it, so the screen says
 * that rather than promise anything the moment somebody taps.
 */
export function PayPanel({
  owedPaise,
  reference,
  link,
  to,
  message,
}: {
  owedPaise: number;
  reference: string;
  /** A `upi://pay` link already checked by `upiPayLink`, or `null`. */
  link: string | null;
  /** Yuvoy's UPI ID and payee, or `null` when paying is not set up. */
  to: { upiId: string; name: string } | null;
  /** The API's sentence when paying is not set up, de-dashed, or `null`. */
  message: string | null;
}) {
  const amount = formatPaise(owedPaise);

  return (
    <Panel className="mt-4" role="region" aria-labelledby="pay-statement">
      <h2 id="pay-statement" className="label text-forest/75">
        Pay this statement
      </h2>

      {to === null ? (
        /*
          Not set up yet: "`payTo.message` says so in a sentence to show as it
          is". Our own words stand in only when it sent none.
        */
        <>
          <p className="leading-body mt-3 text-base text-pretty">
            {message ?? "Paying by UPI is not set up yet."}
          </p>
          <p className="text-forest/80 leading-body mt-2 text-sm text-pretty">
            Questions about this statement? Call us on{" "}
            <a
              href={SUPPORT_PHONE_HREF}
              className="text-terra-deep tap-target whitespace-nowrap underline underline-offset-4"
            >
              {SUPPORT_PHONE}
            </a>{" "}
            with its reference,{" "}
            <span className="tracking-ref slashed-zero tabular-nums">
              {reference}
            </span>
            .
          </p>
        </>
      ) : (
        <>
          {link ? (
            <>
              <a href={link} className={buttonClass({ className: "mt-4" })}>
                {`Pay ${amount} by UPI`}
              </a>
              <p className="text-forest/70 mt-2 text-sm">
                Opens your UPI app with the amount and the reference filled in.
              </p>
            </>
          ) : null}

          <dl className="mt-5 space-y-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-forest/75 shrink-0">UPI ID</dt>
              <dd className="flex min-w-0 items-center gap-3">
                <span className="min-w-0 font-bold break-all select-all">
                  {to.upiId}
                </span>
                <CopyValue value={to.upiId} what="the UPI ID" />
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-forest/75 shrink-0">Payee</dt>
              <dd className="min-w-0 text-right font-bold">{to.name}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-forest/75 shrink-0">Amount</dt>
              <dd className="font-bold tabular-nums">{amount}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-forest/75 shrink-0">Reference</dt>
              <dd className="flex min-w-0 items-center gap-3">
                <span className="tracking-ref font-bold slashed-zero tabular-nums select-all">
                  {reference}
                </span>
                <CopyValue value={reference} what="the reference" />
              </dd>
            </div>
          </dl>

          <p className="mt-5 text-sm font-bold">
            Keep{" "}
            {/*
              The reference as it is typed into the note: set as every
              reference is, so each character can be checked (v3.2).
            */}
            <span className="tracking-ref slashed-zero tabular-nums">
              {reference}
            </span>{" "}
            in the payment note, so we can match your payment to this statement.
          </p>
          <p className="text-forest/70 leading-body mt-2 text-sm text-pretty">
            {link
              ? `Paying from another phone or a computer? Send ${amount} to the UPI ID above from any UPI app, with the reference in the note.`
              : `Send ${amount} to the UPI ID above from any UPI app, with the reference in the note.`}{" "}
            A payment shows here once it reaches Yuvoy and is recorded.
          </p>
        </>
      )}
    </Panel>
  );
}
