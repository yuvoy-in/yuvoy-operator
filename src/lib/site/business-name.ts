import "server-only";
import { cache } from "react";
import { operatorApi } from "@/lib/api/server-client";
import { readShape } from "@/lib/account/read-shape";

/**
 * What the stage and the rail call the business (yuvoy-operator#80 t1).
 *
 * "Use the compact mark with no tagline, at half the height, and put the
 * business name beside it." The name is the business's, never the person
 * holding the phone: `GET /me`'s `name` is the signed-in user, and the join
 * flow already learned what printing it where a business belongs reads like.
 *
 * `displayName` is what travellers see, so it is what an operator recognises
 * as their business; the registered `legalName` stands in only when there is
 * no display name yet. `GET /profile` has no role on it, so every login reads
 * the same name.
 *
 * `null` when neither is there or the read failed, and the stage then draws
 * the mark alone. No stand-in: "Your business" in the chrome of every screen
 * is a placeholder that looks like a bug, and the mark on its own is complete.
 *
 * Read by the root layout the way the badges are, because the chrome is a
 * client component and `/operator/v1` is never called from a browser. It
 * cannot throw: a name is not worth a page.
 */
export const readBusinessName = cache(
  async (token: string): Promise<string | null> => {
    try {
      const { data, error } = await operatorApi(token).GET("/profile", {});
      if (error) return null;
      const profile = readShape(data);
      const display = profile?.displayName?.trim();
      if (display) return display;
      const legal = profile?.legalName?.trim();
      return legal || null;
    } catch {
      return null;
    }
  },
);
