import { redirect } from "next/navigation";

/**
 * The portal has no landing page.
 *
 * There is nothing to say to a signed-out stranger that the sign-in screen
 * does not already say, and an operator opening this at 6am wants the day, not
 * a welcome. `requireOperator` on /today sends them to sign-in if they need it.
 */
export default function RootPage() {
  redirect("/today");
}
