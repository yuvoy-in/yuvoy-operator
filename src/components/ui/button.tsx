import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  ReactNode,
  Ref,
} from "react";
import Link from "next/link";
import { BusyButton } from "./busy-button";
import {
  buttonClass,
  type ButtonSize,
  type ButtonVariant,
} from "./button-class";

export { buttonClass, type ButtonSize, type ButtonVariant };

/**
 * The portal's one button, as a pill (v2.7).
 *
 * Sized to `dock-target` (56px) by default rather than the traveller app's
 * 44px. The user of this screen has wet hands, direct sun and eleven people
 * waiting, and a mis-tap here marks the wrong person off a manifest.
 *
 *   primary:   the forest fill, for the one action a screen is for
 *   secondary: a raised paper-deep pill, for the other choice
 *   outline:   a hairline pill, for a quieter action
 *   danger:    the accent hairline. Not red-as-decoration: the destructive
 *               actions here (calling off a departure, stopping a bank
 *               change) should not look like a save button.
 *   danger-quiet:
 *               the same accent as text, with no pill: a destructive action
 *               DEMOTED below the screen's one primary action
 *               (yuvoy-operator#81). Removing somebody from the team or
 *               cancelling a booking must not carry the weight of the safe
 *               action beside it; it always opens a confirm that names what
 *               happens, and that confirm carries the `danger` pill. Pair it
 *               with `size="md"` and `block={false}`, which keep a 44px
 *               target around the words.
 *
 * CTAs stay monochrome, as everywhere in the system: terracotta is never a
 * fill.
 *
 * ## While it works (O04 A, approved 4 Oct 2026)
 *
 * A form's submit passes `pending` while its action runs, and its working
 * words as `pendingLabel`. It used to be `disabled`, which faded the one
 * button the operator just pressed to 55%, the look of a control that is
 * switched off, at the very moment it should look most alive. Now it keeps
 * its full colour and stays focusable, says it is busy (`aria-busy`,
 * `aria-disabled`), refuses a second tap itself, cross-fades its words to the
 * working verb, and shows a 16px ring only if the answer is not back after
 * 300ms. See `BusyButton`.
 */
export function Button({
  variant,
  size,
  block,
  className,
  type = "button",
  pending,
  pendingLabel,
  ...props
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Full width, which on a phone is the default. */
  block?: boolean;
  /** A prop since React 19, passed to the `<button>` with the rest. */
  ref?: Ref<HTMLButtonElement>;
  /**
   * The action this button started is running. A button that can be
   * pending is always given a boolean here, never `undefined` one render
   * and `false` the next: it is drawn by `BusyButton` from its first frame.
   */
  pending?: boolean;
  /** Its words while pending: the working verb, "Saving", with no ellipsis. */
  pendingLabel?: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  if (pending !== undefined) {
    return (
      <BusyButton
        type={type}
        variant={variant}
        size={size}
        block={block}
        className={className}
        pending={pending}
        pendingLabel={pendingLabel}
        {...props}
      />
    );
  }
  return (
    <button
      type={type}
      className={buttonClass({ variant, size, block, className })}
      {...props}
    />
  );
}

/** A `<Link>` styled as a button, for a forward action that is a navigation. */
export function ButtonLink({
  variant,
  size,
  block,
  className,
  href,
  ...props
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  href: string;
} & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href">) {
  return (
    <Link
      href={href}
      className={buttonClass({ variant, size, block, className })}
      {...props}
    />
  );
}
