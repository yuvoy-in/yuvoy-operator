import type { Metadata } from "next";
import { requireOperator } from "@/lib/auth/session";
import { Uploader } from "./uploader";
import { Screen } from "@/components/chrome/screen";
import { Panel } from "@/components/ui/panel";

export const metadata: Metadata = { title: "Reels" };

export const dynamic = "force-dynamic";

/**
 * O8 — the operator supplies the video the whole traveller feed is made of.
 *
 * ## What this screen is, and what it deliberately is not
 *
 * It is the upload: intent → resumable upload → confirm → attest. All four
 * steps exist in the contract and all four are here, and since yuvoy-api#66 §3
 * "resumable" means what it says: a dropped signal, a closed tab, a restarted
 * phone. Come back, choose the same clip, carry on.
 *
 * It is **not a library of your clips**, because there is no endpoint that
 * lists them. `GET /media` does not exist, so nothing can show what has been
 * uploaded, what is still processing, what a reviewer approved, or what is
 * live. Publishing and taking a clip down are both blocked on the same
 * absence: `POST /media/{id}/publish` needs a media id and an experience id,
 * and there is no way to enumerate either. Raised on yuvoy-api rather than
 * faked with a list held in a page's memory, which would be empty on every
 * refresh and would teach an operator that their clips had vanished.
 */
export default async function ReelsPage() {
  /*
    No role gate, deliberately.

    `POST /media/upload-intents` declares 401 and 409 and **no 403** — the
    contract does not restrict uploading by role, and a first draft of this
    page gated it on `canManage` anyway. That was inventing a permission the
    server does not have, in the direction that matters most: telling a skipper
    they may not do something they may. The person who filmed the dive is
    exactly the person who should be able to send it.
  */
  await requireOperator();

  return (
    <Screen
      nav={{ back: { href: "/account", label: "your business" } }}
      stageLabel="Reels"
    >
      <p className="eyebrow text-terra-deep">Your footage</p>
      <h1 className="font-display tracking-display mt-3 text-4xl leading-[1.05]">
        Add a reel
      </h1>
      <p className="text-forest/70 mt-3 text-base">
        Travellers pick a boat by watching it. One upright clip of the real
        thing does more than a page of description.
      </p>

      <div className="mt-8">
        <Uploader />
      </div>

      {/*
        Stated, not hidden — the same call O11 makes about its per-booking
        gap. An operator who uploads three clips and finds no list would
        reasonably conclude they were lost.
      */}
      <section className="mt-12" aria-labelledby="not-here">
        <h2 id="not-here" className="label text-forest/75">
          What is not here yet
        </h2>
        <Panel className="mt-3">
          <p className="text-sm">
            We cannot yet show you the clips you have already sent, or which
            ones a reviewer has approved. There is no endpoint that lists them.
          </p>
          <p className="text-forest/80 mt-3 text-sm">
            That also means putting a clip on a particular listing is not on
            this screen. You can take a clip down straight after sending it,
            while this page is still open — after that, message us and a person
            will do it.
          </p>
          <p className="text-forest/80 mt-3 text-sm">
            Nothing you upload is lost by this — it is queued for review the
            moment you confirm the rights.
          </p>
        </Panel>
      </section>
    </Screen>
  );
}
