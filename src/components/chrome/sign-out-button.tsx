import { signOut } from "@/app/sign-in/actions";
import { Button } from "@/components/ui/button";

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
      <Button type="submit" variant="outline" size="md" block={false}>
        Sign out
      </Button>
    </form>
  );
}
