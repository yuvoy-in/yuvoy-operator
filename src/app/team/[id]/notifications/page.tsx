import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireOperator } from "@/lib/auth/session";
import { operatorApi } from "@/lib/api/server-client";
import { OperatorApiError } from "@/lib/api/errors";
import { toSettings } from "@/lib/account/notifications";
import { canManageAccess } from "@/lib/team/access";
import { Screen } from "@/components/chrome/screen";
import { Problem } from "@/components/ui/states";
import { SwitchList } from "@/app/notifications/switch-list";

export const metadata: Metadata = { title: "Their notifications" };
export const dynamic = "force-dynamic";

/**
 * Somebody else's switches — yuvoy-operator#46 item 6.
 *
 * ## OWNER or ADMIN, and NOT `canManage`
 *
 * The narrowest gate on the team screens: a MANAGER has `canManage` and gets a
 * `403` here. The owner decided it in those terms — "an owner and an admin
 * control everybody's switches, and each person controls their own" — which is
 * wider than the access routes beside it in one direction and narrower than
 * `canManage` in the other.
 *
 * ## Nothing here grants or removes access
 *
 * Worth saying because the route sits under `/team`: "no switch exists that
 * could silence a security warning." Turning one off changes who hears about a
 * booking, not who can get in.
 */
export default async function TeamNotificationsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { token, me } = await requireOperator();

  if (!canManageAccess(me.roles)) {
    return (
      <Screen
        nav={{ back: { href: "/team", label: "team access" } }}
        stageLabel="Their notifications"
      >
        <h1 className="font-display tracking-display text-3xl leading-tight">
          Notifications
        </h1>
        <div className="mt-6">
          <Problem
            title="Only an owner or an admin can change somebody else's notifications"
            body="You can change your own from Business."
          />
        </div>
      </Screen>
    );
  }

  let data;
  try {
    const result = await operatorApi(token).GET("/team/{id}/notifications", {
      params: { path: { id } },
    });
    if (result.error) throw result.error;
    data = result.data;
  } catch (err) {
    /*
      A person who is not on this team, and another operator's, answer the same
      404. `notFound()` rather than the error boundary: it is not a fault
      anybody can retry, and "try again" would send them round a loop.
    */
    if (err instanceof OperatorApiError && err.isNotFound) notFound();
    throw err;
  }

  const settings = toSettings(data);

  return (
    <Screen
      nav={{ back: { href: "/team", label: "team access" } }}
      stageLabel="Their notifications"
    >
      <p className="eyebrow text-terra-deep">Team access</p>
      <h1 className="font-display tracking-display mt-3 text-4xl leading-[1.05]">
        {settings.name || "Notifications"}
      </h1>
      <p className="text-forest/70 mt-3 text-base">
        Which messages about the business reach them. Changing a switch here
        does not change what they can do.
      </p>

      <div className="mt-8">
        <SwitchList initial={settings} meId={me.id} memberId={id} />
      </div>
    </Screen>
  );
}
