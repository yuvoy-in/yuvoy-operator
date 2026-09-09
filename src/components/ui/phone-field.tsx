"use client";

import { useEffect, useId, useState } from "react";
import {
  COUNTRY,
  isCompleteNational,
  toE164,
  toNationalDigits,
} from "@/lib/auth/phone";
import { cn } from "@/lib/cn";

/**
 * The portal's phone field. One component, three forms — sign in, create an
 * account, accept an invitation.
 *
 * ## What the operator sees, and what the server gets
 *
 * `+91` is fixed furniture inside the field: not editable, not deletable, not
 * something to remember. They type ten digits. What posts is E.164, from a
 * hidden input, because the API's pattern (`^\+[1-9][0-9]{7,14}$`) rejects a
 * bare national number — so the visible field and the wire value are
 * deliberately different things and neither is derived at submit time.
 *
 * ## Why the digits are normalised on every change rather than on submit
 *
 * "Every variation somebody naturally types is a rejection at the one moment
 * they are trusting the form." A leading zero, a pasted `+91…`, spaces from a
 * contacts app — all of it becomes ten digits as it arrives, so the error
 * state mostly never happens. `toNationalDigits` is pure and separately
 * tested; every case it decides is one somebody actually types.
 *
 * ## Why submit is disabled rather than validating on press
 *
 * Ten digits is a fact the field can see. Refusing a press and then explaining
 * is a round trip through a red message for something the form already knew —
 * so the button waits, and the hint below counts up so the wait is never a
 * mystery. `aria-describedby` ties the two together, because a disabled button
 * with no announced reason is its own dead end.
 *
 * Raised as yuvoy-operator#19.
 */
export function PhoneField({
  id = "phone",
  name = "phone",
  label = "Your phone number",
  hint,
  defaultValue = "",
  autoFocus,
  invalid,
  onCompleteChange,
  className,
}: {
  id?: string;
  /** The hidden input's name — what the Server Action reads. */
  name?: string;
  label?: string;
  /** Replaces the default "ten digits" line once the number is complete. */
  hint?: string;
  /** E.164 or national; normalised either way, so a refusal can re-seed it. */
  defaultValue?: string;
  autoFocus?: boolean;
  invalid?: boolean;
  /** Lets a form disable its own submit buttons. See `usePhoneComplete`. */
  onCompleteChange?: (complete: boolean) => void;
  className?: string;
}) {
  const [digits, setDigits] = useState(() => toNationalDigits(defaultValue));
  const hintId = useId();
  const complete = isCompleteNational(digits);

  const change = (raw: string) => setDigits(toNationalDigits(raw));

  /*
    Reported from the value rather than from the keystroke.

    Announcing it only in `onChange` made the parent's flag depend on an
    invariant across two components: this field is remounted after a refusal
    (the form's `key`) and re-seeds itself from `defaultValue`, but a parent
    that only ever hears about changes would keep whatever it last believed.
    That happened to be right in every path — a refusal always follows a
    complete number — and "right by coincidence" is the kind of thing that
    stops being right when a fifth field is added. Driven by the value, the two
    cannot disagree.
  */
  useEffect(() => {
    onCompleteChange?.(complete);
  }, [complete, onCompleteChange]);

  const remaining = COUNTRY.nationalDigits - digits.length;

  return (
    <div className={className}>
      <label htmlFor={id} className="label text-forest/75">
        {label}
      </label>

      <div
        className={cn(
          "rounded-control border-cream-line bg-cream-deep mt-2 flex h-14 items-center border",
          "ease-interaction transition-[border-color,background-color] duration-200",
          "focus-within:border-forest/60 focus-within:bg-cream",
          invalid && "border-terra-deep",
        )}
      >
        {/*
          Part of the field, not a label beside it — and `aria-hidden` because
          the input's own accessible name already carries the country. A screen
          reader announcing "+91" as loose text before an unlabelled box is
          worse than not announcing it.
        */}
        <span
          aria-hidden="true"
          className="border-cream-line text-forest/75 flex h-full shrink-0 items-center border-r px-3 text-base tabular-nums select-none"
        >
          {COUNTRY.dialCode}
        </span>
        <input
          id={id}
          type="tel"
          /*
            `numeric`, not `tel`. The tel keypad carries `+`, `*` and `#` —
            none of which this field accepts — and on a jetty the smaller,
            unambiguous keypad is the one that gets ten digits in right.
          */
          inputMode="numeric"
          autoComplete="tel-national"
          /*
            NOT `pattern` or `required`. Native constraint validation blocks
            the submit behind a browser tooltip, and this form's own hint says
            more than the tooltip would — the same call `/calendar` makes about
            `min` and `/signup` makes about `type="email"`.
          */
          /*
            Raw digits, deliberately NOT grouped as `99664 40677`.

            Grouping reads better and cannot be done here: this is a controlled
            input, so re-inserting a space on every keystroke rewrites the value
            under the caret, and any edit that is not at the end sends the caret
            to the end. Deleting one digit from the middle of a number would
            move the cursor away from where the operator was working, on a
            phone, one-handed. `formatNational` exists for reading a number back
            somewhere else on screen, which is where grouping is free.
          */
          value={digits}
          onChange={(e) => change(e.target.value)}
          autoFocus={autoFocus}
          aria-describedby={hintId}
          aria-invalid={invalid || undefined}
          /*
            No `maxLength`, and that is not an oversight.

            It amputates the RAW input before `toNationalDigits` ever sees it:
            `maxLength={10}` turns a pasted `+91 99664 40677` into `+91 99664 `
            and `09966440677` into `0996644067`, which then normalises to nine
            digits and a disabled button. The normaliser already caps the value
            at ten, so the attribute bought nothing and broke the two cases the
            field exists to handle. Caught by an e2e that pasted a real number.
          */
          placeholder={COUNTRY.example}
          className="text-forest placeholder:text-forest/70 h-full w-full bg-transparent px-3 text-lg outline-none"
        />
      </div>

      {/*
        The hidden field is what the Server Action reads, and it is the only
        place E.164 exists on this screen. Empty until the number is whole, so
        a half-typed number is never posted as a short one.
      */}
      <input type="hidden" name={name} value={complete ? toE164(digits) : ""} />

      <p id={hintId} className="text-forest/70 mt-2 text-sm">
        {complete
          ? (hint ?? "Ten digits, no country code needed.")
          : digits.length === 0
            ? (hint ??
              `${COUNTRY.nationalDigits} digits, without ${COUNTRY.dialCode}.`)
            : `${remaining} more ${remaining === 1 ? "digit" : "digits"}.`}
      </p>
    </div>
  );
}
