import type { Metadata } from "next";
import { operatorApi } from "@/lib/api/server-client";
import { requireOperator } from "@/lib/auth/session";
import { PHOTOS_MAX, toStory } from "@/lib/story/story";
import { operatorPageUrl } from "@/lib/site/traveller-app";
import { Screen } from "@/components/chrome/screen";
import { panelClass } from "@/components/ui/panel";
import { Problem } from "@/components/ui/states";
import { ExternalIcon } from "@/components/ui/icons";
import { PhotoUploader } from "./photo-uploader";
import { RemovePhoto } from "./remove-photo";
import { StoryForm } from "./story-form";

export const metadata: Metadata = { title: "Your story" };
export const dynamic = "force-dynamic";

/**
 * What a traveller reads about the business — yuvoy-operator#41.
 *
 * The product demo's Account → Profile, which is NOT this portal's `/profile`:
 * that screen is the legal identity, and nobody deciding whether to get on a
 * boat ever sees a GSTIN. Three parts, split along the line the API draws:
 *
 *   - **In your words** — `about` and `languages`, the operator's outright.
 *     Saved in place; nothing reviews them.
 *   - **Photographs** — the boat, the shop, the crew. Five at most, and the
 *     API chooses each one's position.
 *   - **Checked by us** — the year and the place, "read as things we checked,
 *     so they change through us rather than in place". Stated as facts with
 *     the way to change them, never as disabled inputs: "a disabled text field
 *     reads as a bug; a stated fact with a way to request a change reads as
 *     deliberate."
 *
 * ## Preview your operator page
 *
 * The preview is the public page itself, addressed by the business's slug.
 * There was no button for a while because no operator endpoint returned that
 * slug, and a button that guessed the address would lead to somebody else's
 * page on the day the guess was wrong. `GET /me` carries `slug` now
 * (yuvoy-api#164), so the address is read rather than constructed.
 *
 * Still guarded on the field being there. Required in a pinned contract is a
 * promise about master, not about the deployed API, and no button at all beats
 * one pointing at `/o/undefined`.
 *
 * A focused screen behind Business, like the logo beside it.
 */
export default async function StoryPage() {
  const { token, me } = await requireOperator();
  const publicPage = operatorPageUrl(me.slug);

  /*
    NOT soft-failing, unlike the logo. `PUT /story` writes `about` and
    `languages` whole, so a form drawn over a failed read would open empty and
    one tap on Save would wipe what travellers already see. A failed read shows
    the problem and no form.
  */
  const story = await operatorApi(token)
    .GET("/story", {})
    .then((r) => (r.error ? null : toStory(r.data)))
    .catch(() => null);

  return (
    <Screen
      nav={{ back: { href: "/account", label: "your business" } }}
      stageLabel="Your story"
    >
      <p className="eyebrow text-terra-deep">Your account</p>
      <h1 className="font-display tracking-display mt-3 text-4xl leading-[1.05]">
        Your story
      </h1>
      <p className="text-forest/70 mt-3 text-base">
        What a traveller reads about your business before deciding to get on
        your boat. Your registered name and address are separate, under Business
        details, and travellers never see those.
      </p>

      {/*
        The page itself, as travellers see it. Opened in a new tab rather than
        navigated to: it is a different origin and a different product, and an
        operator halfway through writing their story should come back to a form
        they have not lost. `rel="noreferrer"` with it, as everywhere.
      */}
      {publicPage ? (
        <a
          href={publicPage}
          target="_blank"
          rel="noreferrer"
          className="text-terra-deep hover:text-forest ease-interaction mt-4 inline-flex min-h-11 items-center gap-2 text-sm underline underline-offset-4 transition-colors duration-200"
        >
          Preview your operator page
          <ExternalIcon className="size-4" />
        </a>
      ) : null}

      {story === null ? (
        <div className="mt-8">
          <Problem
            title="Your story did not load"
            body="Nothing has changed. Try again in a moment. A blank form here could save over what travellers already see."
          />
        </div>
      ) : (
        <>
          <section className="mt-10" aria-labelledby="in-your-words">
            <h2 id="in-your-words" className="font-display text-2xl">
              In your words
            </h2>
            <StoryForm about={story.about} languages={story.languages} />
          </section>

          <section className="mt-12" aria-labelledby="photographs">
            <h2 id="photographs" className="font-display text-2xl">
              Photographs
            </h2>
            {/*
              The helper text the issue asks for, because "the natural instinct
              is to upload the prettiest underwater shot, and a gallery standing
              in for footage is exactly what a video-first feed exists to
              prevent."
            */}
            <p className="text-forest/70 mt-2 text-sm">
              {
                "The boat, the shop, the crew. Not the trip itself. Footage of the experience belongs on a listing's reel, which is where travellers look for it."
              }
            </p>

            {story.photos.length > 0 ? (
              <ul className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {story.photos.map((photo) => (
                  <li key={photo.id} className={panelClass("raised", "p-3")}>
                    <div className="rounded-tile bg-forest/10 aspect-4/3 overflow-hidden">
                      {photo.url ? (
                        /*
                          A plain `<img>`, as on the logo screen: the card
                          variant is already sized by the image host, and its
                          host is in the CSP's `img-src`.
                        */
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={photo.url}
                          alt={`Photograph ${photo.position}`}
                          className="size-full object-cover"
                          loading="lazy"
                          decoding="async"
                        />
                      ) : (
                        /*
                          The contract's second absence: we hold the picture
                          and hosting cannot show it. Said as a fact about us,
                          not a doubt about their file.
                        */
                        <p className="text-forest/70 flex h-full items-center justify-center p-2 text-center text-xs">
                          We cannot show it just now. Nothing is wrong with it.
                        </p>
                      )}
                    </div>
                    <div className="mt-3">
                      <RemovePhoto
                        photoId={photo.id}
                        position={photo.position}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-forest/70 mt-5 text-sm">
                None yet. Your page shows no photographs until you add one.
              </p>
            )}

            <div className="mt-6">
              {story.photos.length >= PHOTOS_MAX ? (
                /*
                  Said before a sixth is chosen, rather than after it has
                  uploaded and the API has answered 409.
                */
                <p className="text-forest/80 text-sm font-bold">
                  That is five, the most your page shows. Remove one to add
                  another.
                </p>
              ) : (
                <PhotoUploader remaining={PHOTOS_MAX - story.photos.length} />
              )}
            </div>
          </section>

          <section className="mt-12" aria-labelledby="checked-by-us">
            <h2 id="checked-by-us" className="font-display text-2xl">
              Checked by us
            </h2>
            {/* The API's own reason, verbatim — "the `why` string is there to
                be shown". */}
            {story.reviewed.why ? (
              <p className="text-forest/70 mt-2 text-sm">
                {story.reviewed.why}
              </p>
            ) : null}
            <dl className={panelClass("raised", "mt-5 space-y-4")}>
              <Fact
                label="Running since"
                value={
                  story.reviewed.operatingSince === null
                    ? null
                    : String(story.reviewed.operatingSince)
                }
              />
              <Fact
                label="Where travellers find you"
                value={story.reviewed.findThemAt}
              />
            </dl>
            <p className="text-forest/70 mt-4 text-sm">
              To change either, message us. A person checks the new one before
              travellers see it.
            </p>
          </section>
        </>
      )}
    </Screen>
  );
}

/** A reviewed fact, or the plain statement that there is none yet. */
function Fact({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="label text-forest/70">{label}</dt>
      <dd className="mt-1 text-base">
        {value ?? (
          <span className="text-forest/70 text-sm">Not on your page yet</span>
        )}
      </dd>
    </div>
  );
}
