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
            .where('occurrence.state = :state', { state: OccurrenceState.ARMED })
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
    private affected(occurrence: ScheduleOccurrence, published: Map<string, number>): boolean {
        const codes = occurrence.watchedStationCodes;
        if (codes === null || codes.length === 0) {
            // A car journey, or a fixed travel time. Neither has stations, and
            // neither is affected by a rail disruption.
            return false;
        }

        let newest = 0;
        for (const code of codes) {
            newest = Math.max(newest, published.get(code) ?? 0);
        }
        if (newest === 0) {
            return false;
        }

        return occurrence.lastCheckedAt === null || occurrence.lastCheckedAt.getTime() < newest;
    }

    /**
     * Station code to the newest moment a disruption touching it was published.
     *
     * `releaseTime` moves when NS updates a disruption, which is what makes it
     * the right value to compare against: an update is new information and
     * deserves a re-check, while a disruption that only continues existing does
     * not.
     *
     * The walk is defensive rather than typed against a schema. This feed is
     * read only to decide whether to look again, so an unfamiliar shape should
     * cost a missed promotion at worst, never a failed tick.
     */
    private publishedByStation(disruptions: unknown[]): Map<string, number> {
        const published = new Map<string, number>();

        for (const entry of disruptions) {
            if (typeof entry !== 'object' || entry === null) {
                continue;
            }
            const record = entry as NsDisruption;
            const at = Date.parse(record.releaseTime ?? record.registrationTime ?? '');
            if (Number.isNaN(at)) {
                continue;
            }

            for (const section of record.publicationSections ?? []) {
                for (const station of section.section?.stations ?? []) {
                    const code = station.stationCode;
                    if (typeof code !== 'string') {
                        continue;
                    }
                    published.set(code, Math.max(published.get(code) ?? 0, at));
                }
            }
        }

        return published;
    }
}

/** Only the fields the sweep reads. NS returns a great deal more. */
interface NsDisruption {
    releaseTime?: string;
    registrationTime?: string;
    publicationSections?: {
        section?: { stations?: { stationCode?: string }[] };
    }[];
}
