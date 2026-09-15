import Link from "next/link";
import { ScheduleForm } from "@/app/today/listing/[id]/schedule-form";
import { Panel } from "@/components/ui/panel";

/**
 * Step 3 — the week this listing runs.
 *
 * `ScheduleForm` is the one the listing hub uses (#56 item 8), unchanged. It
 * already carries the dangerous half: `PUT /experiences/{id}/schedule` replaces
 * what is there, so clearing it closes every departure it made, and the form
 * asks before doing that. A second schedule editor would be a second place for
 * that question to be forgotten.
 *
 * ## Departures on a draft do not sell
 *
 * Said here rather than left to be discovered. An operator who builds a week of
 * departures on a draft and waits for bookings is waiting for nothing: the
 * listing has not been published, so none of them are on sale.
 */
export function ScheduleStep({
  id,
  repeatsWeekly,
  weekly,
  back,
  next,
}: {
  id: string;
  repeatsWeekly: boolean;
  weekly: { weekday: number; startTime: string; seats: number }[];
  back: string;
  next: string;
}) {
  return (
    <Panel className="mt-6">
      <h2 className="font-display text-2xl">Schedule</h2>
      <p className="text-forest/70 mt-2 text-sm">
        The days and times it runs each week. You can leave this until later.
      </p>
      <p className="text-forest/70 mt-2 text-sm">
        Departures made on a draft do not sell. They go on sale with the listing
        when it is published.
      </p>

      <div className="mt-5">
        <ScheduleForm
          experienceId={id}
          repeatsWeekly={repeatsWeekly}
          weekly={weekly}
        />
      </div>

      {/*
        Next is a LINK here, not a submit. The schedule has its own save, and a
        Next that also saved would send an empty week from somebody who only
        wanted to move on: "Next with no rows while `repeatsWeekly` is false
        sends nothing", and the simplest way to send nothing is not to call it.
      */}
      <div className="border-cream-line mt-6 flex items-center gap-4 border-t pt-4">
        <Link
          href={next}
          className="text-forest tap-target text-sm font-bold underline underline-offset-4"
        >
          Next
        </Link>
        <Link
          href={back}
          className="text-forest/75 tap-target text-sm underline underline-offset-4"
        >
          Back
        </Link>
      </div>
    </Panel>
  );
}
