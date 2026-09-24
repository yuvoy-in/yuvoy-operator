import Link from "next/link";
import { draftSections, type DraftListing } from "@/lib/services/draft";
import { Panel } from "@/components/ui/panel";
import { ChevronRightIcon } from "@/components/ui/icons";

/**
 * A draft listing, as it stands — yuvoy-operator#85 s10.
 *
 * "Still missing: a short summary, a price, where to meet" was the whole of
 * what a draft told its operator. It named what was absent and nothing that
 * was there, so the screen could not answer what the listing says, what it
 * costs, or what a traveller would meet.
 *
 * Every field is drawn where it belongs, and a field the API says is missing
 * is marked on its own row rather than in a sentence somewhere else. Each row
 * is a link to the builder step that answers it, so the mark and the control
 * are one tap apart.
 *
 * The rows are read-only on purpose: this screen is where a listing is looked
 * at, and the builder is where it is written. Two places to type the same
 * field is two places for it to be half saved.
 */
export function DraftReadback({
  id,
  listing,
  mediaCount,
  editable,
  categoryLabel,
  destinationLabel,
}: {
  id: string;
  listing: DraftListing;
  mediaCount: number;
  /**
   * Whether this login may open the builder. A staff login is refused there
   * (#58), so its rows are read back as rows rather than as links into a
   * screen that turns them away.
   */
  editable: boolean;
  /** The vocabulary's word for the code, when the read gave one. */
  categoryLabel?: string;
  destinationLabel?: string;
}) {
  const sections = draftSections(listing, {
    mediaCount,
    ...(categoryLabel ? { categoryLabel } : {}),
    ...(destinationLabel ? { destinationLabel } : {}),
  });

  return (
    <div className="mt-8 space-y-8">
      {sections.map((section) => (
        <section key={section.id} aria-labelledby={section.id}>
          <h2 id={section.id} className="label text-forest/75">
            {section.heading}
          </h2>
          <Panel className="mt-2">
            <ul>
              {section.fields.map((field) => {
                const said = (
                  <span className="min-w-0">
                    <span className="text-forest/75 block text-sm">
                      {field.label}
                    </span>
                    {field.missing ? (
                      <span className="text-terra-deep mt-0.5 block text-base font-bold">
                        Still needed
                      </span>
                    ) : field.value ? (
                      <span className="mt-0.5 block text-base wrap-break-word">
                        {field.value}
                      </span>
                    ) : (
                      /*
                        Empty and not stopping anything: a description nobody
                        wrote is a worse listing, not an unpublishable one, so
                        it says so without the warning colour.
                      */
                      <span className="text-forest/70 mt-0.5 block text-base">
                        Nothing yet
                      </span>
                    )}
                  </span>
                );
                return (
                  <li
                    key={field.key}
                    className="border-paper-line border-t first:border-t-0"
                  >
                    {editable ? (
                      <Link
                        href={
                          field.step
                            ? `/account/listings/${id}/edit?step=${field.step}&field=${field.key}`
                            : `/account/listings/${id}/edit`
                        }
                        className="hover:bg-paper-deep flex min-h-14 items-center justify-between gap-3 py-3 transition-colors duration-200"
                      >
                        {said}
                        <ChevronRightIcon className="text-forest/70 size-4 shrink-0" />
                      </Link>
                    ) : (
                      <div className="flex min-h-14 items-center py-3">
                        {said}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </Panel>
        </section>
      ))}
    </div>
  );
}
