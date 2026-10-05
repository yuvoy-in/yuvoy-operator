/**
 * The account on file, in the words Payout details uses, with its IFSC set as
 * a reference (v3.2): tabular, with a slashed zero. An IFSC mixes letters and
 * digits ("SBIN0RRVLGB"), and it is the code somebody reads out to a bank, so
 * a 0 must never pass for an O.
 *
 * The line is drawn as it came: the IFSC is only set apart when the line opens
 * with it, so the API's own summary for a shape this build does not recognise
 * is never cut up.
 */
export function AccountLine({
  line,
  ifsc,
}: {
  line: string;
  /** The IFSC `line` opens with, or `null` when it is the API's summary. */
  ifsc: string | null;
}) {
  if (!ifsc || !line.startsWith(ifsc)) return line;
  return (
    <>
      <span className="tracking-ref slashed-zero tabular-nums">{ifsc}</span>
      {line.slice(ifsc.length)}
    </>
  );
}
