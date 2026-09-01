import { signOut } from "@/app/sign-in/actions";

/**
 * Sign out, as a form rather than a link.
 *
 * A GET that ends a session is a session anybody can end with an `<img>` tag.
 * This posts, and Next's Server Actions carry their own origin check on top of
 * the cookie's SameSite.
 */
export function SignOutButton() {
  return (
    <form action={signOut}>
      <button
        type="submit"
        className="label text-forest/70 hover:text-forest tap-target underline underline-offset-4"
      >
        Sign out
      </button>
    </form>
  );
}
