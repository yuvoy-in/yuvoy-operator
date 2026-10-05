/**
 * One polite live region for what changed on a screen that the operator did
 * not do themselves (O01 A, O03 A): a request arriving, one answered on
 * another phone, a party checked in somewhere else.
 *
 * Always in the page, because a region inserted with its words already in it
 * is announced by some screen readers and not others. Each sentence is a new
 * node (`said.n`), so the same words said twice in a row are still said
 * twice. The marks those changes carry on screen are `aria-hidden`; this is
 * where they are said.
 */
export function Announcer({ said }: { said: { text: string; n: number } }) {
  return (
    <p className="sr-only" aria-live="polite" aria-atomic="true">
      {said.text ? <span key={said.n}>{said.text}</span> : null}
    </p>
  );
}
