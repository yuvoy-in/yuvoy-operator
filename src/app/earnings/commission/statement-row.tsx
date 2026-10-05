import Link from "next/link";
import { Chip } from "@/components/ui/chip";
import { formatPaise } from "@/lib/format/money";
import { weekLabel } from "@/lib/money/settlements";
import {
  owedOf,
  statementState,
  tripsLabel,
  type CommissionStatement,
} from "@/lib/money/commission-statements";
import { cn } from "@/lib/cn";

/**
 * One weekly commission statement as a row (yuvoy-operator#121): the week,
 * its trips and commission, what is still owed on it, and its state.
 *
 * Shared by the Money tab and the full list, so the two can never describe
 * one statement two ways. A settled one says "Nothing owed" in words: a ₹0 in
 * the column where a bill sits reads as a figure that failed to load.
 */
export function StatementRow({
  statement,
}: {
  statement: CommissionStatement;
}) {
  const state = statementState(statement);
  const owed = owedOf(statement);
  return (
    <Link
      href={`/earnings/commission/${encodeURIComponent(statement.id)}`}
      className="rounded-card border-paper-line bg-paper-deep hover:border-forest/40 ease-interaction flex items-center justify-between gap-4 border p-4 transition-colors duration-200"
    >
      <div className="min-w-0">
        <p className="font-bold text-balance">
          {weekLabel(statement.weekStart, statement.weekEnd)}
        </p>
        <p className="text-forest/70 mt-1 text-sm">
          {tripsLabel(statement.bookings)} ·{" "}
          <span className="tabular-nums">
            {formatPaise(statement.commissionPaise)}
          </span>{" "}
          commission
        </p>
      </div>
      {/*
        The chip and the figure are each a block of their own, so the link's
        accessible name reads "To pay ₹2,250 owed" rather than running the
        two together.
      */}
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        <Chip tone={state.tone}>{state.label}</Chip>
        {owed === null ? null : (
          <p
            className={cn(
              "text-sm tabular-nums",
              owed > 0 ? "font-bold" : "text-forest/70",
            )}
          >
            {owed > 0 ? `${formatPaise(owed)} owed` : "Nothing owed"}
          </p>
        )}
      </div>
    </Link>
  );
}
