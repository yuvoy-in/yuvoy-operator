import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * Gone to the Reels tab of the business profile — yuvoy-operator#56 and #58.
 *
 * Everything this screen did is there: the library as a grid of tiles badged by
 * `situation`, a sheet per reel carrying rights, publishing, replacing and
 * taking down, and the same two uploaders behind the + on the profile.
 *
 * A redirect rather than a delete: the URL is in operators' history, and the
 * uploaders, `RightsForm`, `AttachForm` and `WithdrawForm` under this folder
 * are still the live ones.
 */
export default function ReelsPage() {
  redirect("/account?tab=reels");
}
