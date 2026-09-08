import type { OccurrenceResponse } from '@alarm/types';

/**
 * The mornings that are still to come.
 *
 * Small enough to look unnecessary, and the reason it exists is the bug it
 * closes. A morning that had already rung stayed in the server's list, because
 * nothing ever marked it as over. The app saw a non-empty list, so it never
 * re-armed the schedules and tomorrow was never planned; then it tried to arm
 * the stale morning, Android refused a time in the past, and Today announced
 * that this device could not hold an alarm. Every alarm after the first one
 * depended on nobody ever opening the app.
 *
 * The server filters these too. This is the phone's own copy of the rule,
 * because the phone is the last line and has to be right on its own: the
 * server's tick has been down before, and a cached list is exactly as old as
 * whatever wrote it.
 *
 * Boundary is strict. A morning whose wake time is this very second has rung,
 * and the scheduler would refuse it anyway.
 */
export function upcomingOnly<T extends Pick<OccurrenceResponse, 'currentWakeAt'>>(
    occurrences: T[],
    now: Date = new Date(),
): T[] {
    return occurrences.filter(
        (occurrence) => new Date(occurrence.currentWakeAt).getTime() > now.getTime(),
    );
}
