import { describeRejection } from "@/lib/services/listings";

/**
 * A first listing a reviewer sent back: why, and that it is a draft again
 * (yuvoy-operator#44, yuvoy-api#180).
 *
 * `sentBack` is "present while a reviewer has sent this listing back to you
 * before it was ever on sale, and absent otherwise". The reason uses the
 * closed set a rejected edit uses, and a code this build has never met falls
 * back to the reviewer's own note rather than to a guess. Said in one place,
 * for the edit screen and the builder alike.
 */
export function SentBack({
  sentBack,
}: {
  sentBack: { rejectionCode?: string; rejectionNote?: string };
}) {
  const reason = describeRejection(sentBack.rejectionCode);
  return (
    <div className="border-terra-deep/30 mt-3 border-t pt-3">
      <p className="text-terra-deep text-sm font-bold">
        We sent this back to you.{" "}
        {reason ?? sentBack.rejectionNote ?? "Message us and we will say why."}
      </p>
      {/*
        The reviewer's own words, when there are any. Empty when they wrote
        nothing, which the contract states, so this is not a missing-field
        branch.
      */}
      {reason && sentBack.rejectionNote?.trim() ? (
        <p className="text-forest/80 mt-1.5 text-sm">
          {sentBack.rejectionNote}
        </p>
      ) : null}
      <p className="text-forest/70 mt-1.5 text-sm">
        It is a draft again. Change it below and send it to us when you are
        ready.
      </p>
    </div>
  );
}
