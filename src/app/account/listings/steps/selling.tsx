"use client";

import { useActionState, useState } from "react";
import { saveSelling, type StepState } from "../builder-actions";
import { PRICING_UNITS } from "@/lib/services/listings";
import { commissionPreview, formatRate } from "@/lib/services/commission";
import { formatPaise } from "@/lib/format/money";
import { fieldLabelClass, inputClass } from "@/components/ui/input";
import { StepShell } from "./step-shell";
import { fieldMarks } from "./field-marks";

/**
 * Step 2 — what it costs, and what the business receives.
 *
 * The "you receive" line follows the price as it is typed, in integer paise
 * rounded once, because a preview that disagrees with the settlement by a
 * paisa invites a conversation about whether we can count. It is drawn only
 * when the rate is known: hardcoding 15% was refused on 11 September, since a
 * business on its own negotiated rate would be shown a figure that is wrong
 * about its own money.
 */
export function SellingStep({
  id,
  listing,
  commissionRateBps,
  back,
  flagged,
}: {
  id: string;
  listing: {
    unitPricePaise?: number | null;
    /**
     * Always present on the wire, and that is exactly why it cannot be trusted
     * on its own. See `stated` below.
     */
    pricingUnit?: string;
    maxPartySize?: number;
    durationMinutes?: number;
    bookingMode?: string;
    publishBlockers?: string[];
  };
  commissionRateBps: number | null;
  back: string;
  /** The field Edit was opened for, still needed: marked in place (O12). */
  flagged?: string;
}) {
  const [state, act, pending] = useActionState<StepState, FormData>(
    saveSelling,
    {},
  );
  const [price, setPrice] = useState(
    typeof listing.unitPricePaise === "number" && listing.unitPricePaise > 0
      ? String(Math.round(listing.unitPricePaise / 100))
      : "",
  );
  const rupees = Number(price.replace(/[^\d.]/g, ""));
  const split = commissionPreview(
    Number.isFinite(rupees) && rupees > 0 ? Math.round(rupees * 100) : null,
    commissionRateBps,
  );
  const { marked, describedBy, needed } = fieldMarks(state.fields, flagged);

  /*
    WHETHER ANYBODY HAS SAID IT, which the value cannot answer.

    `experiences.pricing_unit` is NOT NULL, so every listing has one whether or
    not a person chose it, and the API reports the difference the only way it
    can: by naming `pricingUnit` in `publishBlockers`. Reading the value alone
    would tick "Per person" on a listing nobody has asked, which is precisely the
    misstatement yuvoy-operator#30 §1 exists to stop.
  */
  const stated = !(listing.publishBlockers ?? []).includes("pricingUnit");

  return (
    <StepShell
      title="Selling"
      blurb="The price, how it is charged, and how many people can book at once."
      action={act}
      pending={pending}
      message={state.message}
      back={back}
    >
      <input type="hidden" name="id" value={id} />

      <div>
        <label htmlFor="s-price" className={fieldLabelClass()}>
          Price
        </label>
        {needed("unitPrice", "s-price")}
        <input
          id="s-price"
          name="unitPrice"
          inputMode="decimal"
          required
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          className={inputClass("mt-2")}
          aria-invalid={marked("unitPrice")}
          aria-describedby={describedBy("unitPrice", "s-price")}
        />
        {split ? (
          <p className="text-forest/70 mt-1.5 text-xs">
            You receive {formatPaise(split.receivePaise)}. Yuvoy keeps{" "}
            {formatPaise(split.feePaise)}, which is{" "}
            {formatRate(commissionRateBps ?? 0)}.
          </p>
        ) : null}
      </div>

      <fieldset
        id="s-unit"
        aria-describedby={describedBy("pricingUnit", "s-unit")}
      >
        <legend className={fieldLabelClass()}>How it is charged</legend>
        {needed("pricingUnit", "s-unit")}
        <div className="mt-2 flex flex-wrap gap-5 text-sm">
          {PRICING_UNITS.map((unit) => (
            <label key={unit.value} className="flex items-center gap-2">
              {/*
                NEITHER is preselected when the listing has not stated one —
                yuvoy-operator#30 §1. `experiences.pricing_unit` is NOT NULL, so
                a value cannot say whether anybody chose it, and a form that
                quietly sent `per_person` would put the misstatement back with
                our authority behind it on the traveller's card: a ₹12,000
                charter for six reading "₹12,000 per person".
              */}
              <input
                type="radio"
                name="pricingUnit"
                value={unit.value}
                defaultChecked={stated && listing.pricingUnit === unit.value}
              />
              {unit.label}
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <label htmlFor="s-party" className={fieldLabelClass()}>
          Most people per booking
        </label>
        {needed("maxPartySize", "s-party")}
        <input
          id="s-party"
          name="maxPartySize"
          type="number"
          min={1}
          required
          defaultValue={listing.maxPartySize ?? 6}
          className={inputClass("mt-2")}
          aria-invalid={marked("maxPartySize")}
          aria-describedby={describedBy("maxPartySize", "s-party")}
        />
      </div>

      <div>
        <label htmlFor="s-duration" className={fieldLabelClass()}>
          How long
        </label>
        {needed("durationMinutes", "s-duration")}
        <input
          id="s-duration"
          name="durationMinutes"
          type="number"
          min={1}
          required
          defaultValue={listing.durationMinutes ?? 120}
          className={inputClass("mt-2")}
          aria-describedby={describedBy(
            "durationMinutes",
            "s-duration",
            "s-duration-help",
          )}
          aria-invalid={marked("durationMinutes")}
        />
        <p id="s-duration-help" className="text-forest/70 mt-1.5 text-xs">
          In minutes.
        </p>
      </div>

      <fieldset>
        <legend className={fieldLabelClass()}>How it sells</legend>
        <div className="mt-2 space-y-2 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="bookingMode"
              value="allotment"
              defaultChecked={
                (listing.bookingMode ?? "allotment") !== "request"
              }
            />
            Instant booking
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="bookingMode"
              value="request"
              defaultChecked={listing.bookingMode === "request"}
            />
            I answer each request
          </label>
        </div>
        {/*
          The consequence nobody expects: departures keep the mode they were
          created with, so switching changes nothing a traveller sees until new
          departures are added.
        */}
        <p className="text-forest/70 mt-2 text-xs">
          Departures that already exist keep the way they were set up. This
          decides how new ones sell.
        </p>
      </fieldset>
    </StepShell>
  );
}
