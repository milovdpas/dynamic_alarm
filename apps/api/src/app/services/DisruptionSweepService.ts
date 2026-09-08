import { OccurrenceState } from '@alarm/types';

import ScheduleOccurrence from '../models/ScheduleOccurrence.entity';
import { NsModule } from '../modules/NsModule';

/** What one sweep saw and what it did about it. */
export interface SweepResult {
    /** Active disruptions returned by NS. Zero is a normal, quiet answer. */
    disruptions: number;
    /** Occurrences moved to the front of the queue. */
    promoted: number;
}

/**
 * One disruption feed for everybody, instead of polling per user.
 *
 * The cadence ladder is deliberately slow far from the alarm: an occurrence six
 * hours out is checked every thirty minutes, because checking it more often
 * would spend NS requests on a timetable that has not changed. The gap that
 * leaves is a cancellation announced at 04:10 for an alarm being checked at
 * 04:00 and 04:30, which is exactly the case the product exists for.
 *
 * This closes it without touching the cadence. NS publishes every active
 * disruption in one call, so **one request per tick covers every user**: a flat
 * 1440 a day whether there is one occurrence or ten thousand. Anything touching
 * a station an armed occurrence travels through is promoted to an immediate
 * re-check, so a cancellation is noticed within about a minute even for an alarm
 * sitting in the widest band.
 *
 * The subtlety is not the matching, it is knowing when to stop. A disruption
 * lasting six hours would otherwise promote the same occurrence every single
 * minute, turning the 35 calls a night this design is built around into 360 for
 * one alarm. So promotion is tied to the disruption's own publication time: an
 * occurrence is promoted only if it has not been checked since the disruption
 * was last published. Each announcement costs one extra check, an update to it
 * costs one more, and a disruption that sits unchanged costs nothing at all.
 */
export class DisruptionSweepService {
    /**
     * Injected so a test can hand it a recorded feed. A suite that called NS
     * would assert against whichever trains happen to be late today, and would
     * spend a request budget the whole deployment shares.
     */
    constructor(private readonly ns: NsModule = new NsModule()) {}

    async sweep(now: Date): Promise<SweepResult> {
        /**
         * Nothing armed, nothing to sweep for.
         *
         * The feed is one call per tick whatever the user count, which made it
         * look free, but it was being spent every minute of the day including
         * the sixteen hours when no alarm is armed at all. For a single user
         * that is roughly a thousand NS requests a day answering a question
         * nobody asked.
         *
         * A count against an indexed column costs a query the database was
         * already going to serve. Occurrences without watched stations are
         * excluded because a car journey has no station a rail disruption could
         * touch.
         */
        const watching = await ScheduleOccurrence.createQueryBuilder('occurrence')
            .where('occurrence.state IN (:...states)', { states: WATCHED })
            .andWhere('occurrence.watchedStationCodes IS NOT NULL')
            .getCount();

        if (watching === 0) {
            return { disruptions: 0, promoted: 0 };
        }

        const disruptions = await this.ns.disruptions();
        if (disruptions.length === 0) {
            return { disruptions: 0, promoted: 0 };
        }

        const published = this.publishedByStation(disruptions);
        if (published.size === 0) {
            // Disruptions with no station attached, such as a national notice.
            // Nothing to match against, and guessing which journeys they affect
            // would promote everything.
            return { disruptions: disruptions.length, promoted: 0 };
        }

        // Only occurrences that are armed and not already due. One that is
        // already due will be claimed by this same tick anyway, and rewriting
        // its `nextCheckAt` would be a promotion that changes nothing.
        const candidates = await ScheduleOccurrence.createQueryBuilder('occurrence')
            .where('occurrence.state IN (:...states)', { states: WATCHED })
            .andWhere('occurrence.nextCheckAt > :now', { now })
            .getMany();

        const due = candidates.filter((occurrence) =>
            this.affected(occurrence, published),
        );
        if (due.length === 0) {
            return { disruptions: disruptions.length, promoted: 0 };
        }

        await ScheduleOccurrence.createQueryBuilder()
            .update()
            .set({ nextCheckAt: now })
            .whereInIds(due.map((occurrence) => occurrence.id))
            .execute();

        return { disruptions: disruptions.length, promoted: due.length };
    }

    /**
     * Whether this occurrence should look again because of something published
     * since it last did.
     *
     * `lastCheckedAt` null means it has never been checked, which is worth a
     * look. Otherwise the comparison is against the newest publication touching
     * a station it travels through, so a disruption that has not changed since
     * the last check is silently ignored rather than promoted forever.
     */
    /**
     * Whether a disruption touching one of this morning's stations is news to it.
     *
     * Two tests. The station has to match, and the disruption has to be about
     * this morning: an active one with no window is, and announced works are
     * only if their window reaches the morning. Works next month must not
     * promote every morning this week, one extra check each, every day.
     *
     * Then the publication rule: promoted only if the morning has not been
     * checked since the disruption was published, which is what stops a six
     * hour disruption promoting the same morning every minute.
     */
    private affected(occurrence: ScheduleOccurrence, published: Map<string, Published[]>): boolean {
        const codes = occurrence.watchedStationCodes;
        if (codes === null || codes.length === 0) {
            return false;
        }

        const wake = occurrence.currentWakeAt?.getTime() ?? null;
        let newest = 0;
        for (const code of codes) {
            for (const entry of published.get(code) ?? []) {
                if (entry.start !== null && entry.end !== null) {
                    if (wake === null) {
                        continue;
                    }
                    const touches =
                        entry.start <= wake + HALF_DAY_MS && entry.end >= wake - HALF_DAY_MS;
                    if (!touches) {
                        continue;
                    }
                }
                newest = Math.max(newest, entry.at);
            }
        }
        if (newest === 0) {
            return false;
        }

        return occurrence.lastCheckedAt === null || occurrence.lastCheckedAt.getTime() < newest;
    }

    /**
     * Every disruption, by the stations it touches.
     *
     * Each entry carries its publication time and, for announced works, the
     * window it applies to. An active disruption has no window: it is about
     * now, and now is when the morning inside the eight hour ladder is.
     */
    private publishedByStation(disruptions: unknown[]): Map<string, Published[]> {
        const published = new Map<string, Published[]>();
        for (const entry of disruptions) {
            if (typeof entry !== 'object' || entry === null) {
                continue;
            }
            const record = entry as NsDisruption;
            const at = Date.parse(record.releaseTime ?? record.registrationTime ?? '');
            if (Number.isNaN(at)) {
                continue;
            }

            const windows = (record.timespans ?? [])
                .map((span) => ({ start: Date.parse(span.start ?? ''), end: Date.parse(span.end ?? '') }))
                .filter((span) => !Number.isNaN(span.start) && !Number.isNaN(span.end));
            const shapes: Published[] =
                windows.length === 0
                    ? [{ at, start: null, end: null }]
                    : windows.map((span) => ({ at, start: span.start, end: span.end }));

            for (const section of record.publicationSections ?? []) {
                for (const station of section.section?.stations ?? []) {
                    const code = station.stationCode;
                    if (typeof code !== 'string') {
                        continue;
                    }
                    const list = published.get(code) ?? [];
                    list.push(...shapes);
                    published.set(code, list);
                }
            }
        }
        return published;
    }
}

/** A morning is touched by works whose window comes within this of its wake time. */
const HALF_DAY_MS = 12 * 60 * 60 * 1000;

/** The states the sweep may promote: on the ladder, or planned and waiting. */
const WATCHED = [OccurrenceState.ARMED, OccurrenceState.PENDING];

/** One disruption as it bears on one station. */
interface Published {
    /** When NS published it, epoch milliseconds. */
    at: number;
    /** The window announced works apply to. Null for an active disruption. */
    start: number | null;
    end: number | null;
}

interface NsDisruption {
    releaseTime?: string;
    registrationTime?: string;
    /** Announced works carry the period they apply to. */
    timespans?: { start?: string; end?: string }[];
    publicationSections?: {
        section?: { stations?: { stationCode?: string }[] };
    }[];
}
