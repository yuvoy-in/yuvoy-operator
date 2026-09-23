import type { Metadata } from "next";
import { requireOperator } from "@/lib/auth/session";
import { operatorApi } from "@/lib/api/server-client";
import { toSettings } from "@/lib/account/notifications";
import { Screen } from "@/components/chrome/screen";
import { Problem } from "@/components/ui/states";
import { SwitchList } from "./switch-list";

export const metadata: Metadata = { title: "Notifications" };
export const dynamic = "force-dynamic";

/**
 * Which messages about the business reach you — yuvoy-operator#46 item 5.
 *
 * Reached from Business. #58 moves it under Settings; it lives here until then,
 * beside the other account screens an operator already goes to Business for.
 *
 * Every role, deliberately. "Every person sees every switch", and a staff member
 * reading that a payout summary goes to the owner has learned something true
 * about why they never see one.
 */
export default async function NotificationsPage() {
  const { token, me } = await requireOperator();

  const { data, error } = await operatorApi(token).GET("/me/notifications", {});

  return (
    <Screen nav={{ back: { href: "/account", label: "your business" } }}>
      {/*
        One title, no eyebrow and no stage caption (yuvoy-operator#80 t2). The
        line under it said the title again in a sentence, and every switch
        below carries the API's own description of what it covers, which is
        the part that tells somebody anything.
      */}
      <h1 className="font-display tracking-display text-4xl leading-[1.05]">
        Notifications
      </h1>

      <div className="mt-8">
        {error || !data ? (
          <Problem
            title="Your notification settings did not load"
            body="Nothing has changed. Reload the page and they should come back."
          />
        ) : (
          <SwitchList
            initial={toSettings(data)}
            meId={me.id}
            /*
              `null`, so the action writes to `/me/notifications`. The same
              component drives somebody else's screen with their id.
            */
            memberId={null}
          />
        )}
      </div>
    </Screen>
  );
}
