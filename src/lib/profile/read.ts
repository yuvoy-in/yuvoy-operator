import "server-only";
import { cache } from "react";
import { operatorApi } from "@/lib/api/server-client";

/**
 * `GET /profile`, read once per render.
 *
 * The root layout reads it for the business's name on the stage, and the
 * profile tab and Business details read it again for the whole record. A read
 * with a deadline is not memoised by Next (`lib/api/deadline.ts`), so without
 * this those screens asked the API twice (production readiness, 6 Oct 2026).
 *
 * Errors are thrown, not returned, as `readMe` throws them: the error
 * middleware in `server-client` raises them, and each caller decides what a
 * failure costs it.
 */
export const readProfile = cache(async (token: string) => {
  const { data, error } = await operatorApi(token).GET("/profile", {});
  if (error) throw error;
  return data;
});
