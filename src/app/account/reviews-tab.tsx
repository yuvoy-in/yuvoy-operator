import { readSessionToken } from "@/lib/auth/session";
import { operatorApi } from "@/lib/api/server-client";
import {
  TAG_LABEL,
  reviewSummaryLine,
  reviewerName,
  tagLine,
} from "@/lib/account/profile";
import { marketDateLabel } from "@/lib/format/market-time";
import { Chip } from "@/components/ui/chip";
import { Panel } from "@/components/ui/panel";

/**
 * What travellers said — yuvoy-operator#58 item 11.
 *
 * ## Published only, which is why the two numbers agree
 *
 * "A review is shown to nobody, you included, until a person here has read it",
 * so `summary` and the header's `stats.rating` count the same set. A tab that
 * counted something else would make an operator doubt both.
 *
 * ## A first name, or nobody
 *
 * D-018. `travellerName` is a first name when it is present and null when it is
 * not, and this renders "A traveller" for the second rather than a blank: a
 * review with no name above it reads as a review the portal failed to load.
 */
export async function ReviewsTab() {
  const token = await readSessionToken();
  if (!token) return null;

  const result = await operatorApi(token)
    .GET("/reviews", { params: { query: { limit: 50 } } })
    .catch(() => null);

  if (!result || result.error || !result.data) {
    return (
      <p className="text-terra-deep mt-6 text-base font-bold">
        Reviews did not load. Try again.
      </p>
    );
  }

  const { summary, items } = result.data;
  const tags = tagLine(summary?.tags as Record<string, number> | undefined);
  const count = summary?.count ?? 0;

  return (
    <div className="mt-6">
      <p className="text-base font-bold">{reviewSummaryLine(summary ?? {})}</p>
      {tags ? <p className="text-forest/70 mt-1 text-sm">{tags}</p> : null}

      {count === 0 ? null : (
        <ul className="mt-4 space-y-3">
          {(items ?? []).map((review) => (
            <li key={review.id}>
              <Panel className="p-4">
                <p className="text-sm font-bold">
                  {/*
                    Read aloud as "4 out of 5". Stars alone are a picture, and a
                    screen reader announces nothing useful from a row of glyphs.
                  */}
                  <span aria-hidden>{"★".repeat(review.rating ?? 0)}</span>
                  <span className="sr-only">{review.rating} out of 5</span>
                  <span className="text-forest/75 font-normal">
                    {" · "}
                    {reviewerName(review.travellerName)}
                  </span>
                </p>
                <p className="text-forest/70 mt-1 text-sm">
                  {review.experienceTitle}
                  {review.tripDate
                    ? ` · ${marketDateLabel(review.tripDate)}`
                    : null}
                </p>
                {review.comment ? (
                  <p className="mt-2 text-sm">{review.comment}</p>
                ) : null}
                {(review.tags ?? []).length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {(review.tags ?? []).map((tag) => (
                      <Chip key={tag}>{TAG_LABEL[tag] ?? tag}</Chip>
                    ))}
                  </div>
                ) : null}
              </Panel>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
