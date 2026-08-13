import { DateTime } from 'luxon';
import { APP_CONSTANTS, AlarmEventType, OccurrenceState, WakeChangeReason } from '@alarm/types';
import type { WakePlan } from '@alarm/types';
import { computeNextCheckAt } from '@alarm/core';

import AlarmEvent from '../models/AlarmEvent.entity';
import type Schedule from '../models/Schedule.entity';
import ScheduleOccurrence from '../models/ScheduleOccurrence.entity';
import { SchedulePlanService } from './SchedulePlanService';
import type { SchedulePlanProblem } from './SchedulePlanService';

export type ArmResult =
    | { ok: true; occurrence: ScheduleOccurrence; scheduleName: string }
    | { ok: false; problem: SchedulePlanProblem };

/**
 * Turns a schedule into one morning's armed occurrence.
 *
 * This is where the two wake times first differ, and the difference is the
 * safety core of the product:
 *
 *   anchorWakeAt   the time computed here, and the one the device actually
 *                  arms as an OS-held exact alarm. Set once and never moved.
 *   currentWakeAt  the latest recomputation. Starts equal to the anchor and is
 *                  what the monitor updates.
 *
 * Keeping the anchor fixed is what makes a dropped push, airplane mode or a dead
 * backend harmless: the device wakes on a time it already holds, slightly early,
 * and still gets there. The alarm is never late because of an infrastructure
 * failure.
 *
 * Arming is idempotent per morning. The unique key on (schedule, date) means two
 * ticks, or two API instances, cannot produce two alarms for one Thursday, and
 * re-arming an existing occurrence refreshes the live side without touching the
 * anchor the device is holding.
 */
export class OccurrenceService {
    private readonly plans = new SchedulePlanService();

    async arm(schedule: Schedule): Promise<ArmResult> {
        const planned = await this.plans.forSchedule(schedule);
        if (!planned.ok) {
            return { ok: false, problem: planned.problem };
        }

        const { date, plan } = planned.response;
        const existing = await ScheduleOccurrence.findOneBy({
            scheduleId: schedule.id,
            date,
        });

        const occurrence = existing ?? ScheduleOccurrence.create({
            scheduleId: schedule.id,
            deviceId: schedule.deviceId,
            date,
            // The anchor is written once, on the row that did not exist before.
            // Re-arming must never move it, or the guarantee it provides is
            // exactly as strong as the last network call.
            anchorWakeAt: instant(plan.wakeUpAt),
        });

        // Coalesced, not compared to null. A newly created entity has never
        // been through the database, so TypeORM leaves unset columns as
        // `undefined` even where the type says `Date | null`, and the first
        // arming of a morning would otherwise crash reading `.getTime()`.
        const previous = occurrence.currentWakeAt ?? null;

        occurrence.state = OccurrenceState.ARMED;
        occurrence.currentWakeAt = instant(plan.wakeUpAt);
        occurrence.departHomeAt = instant(plan.departHomeAt);
        occurrence.planSnapshot = plan;
        occurrence.ctxRecon = plan.journey?.ctxRecon ?? null;
        occurrence.watchedStationCodes = plan.journey?.watchedStationCodes ?? null;
        occurrence.lastCheckedAt = new Date();
        occurrence.nextCheckAt = this.nextCheck(plan, schedule.timezone);

        await occurrence.save();

        await this.record(occurrence, previous, plan);

        return { ok: true, occurrence, scheduleName: planned.response.scheduleName };
    }

    /**
     * The soonest armed occurrence for this device.
     *
     * A pure read. Nothing here spends a provider call, because the plan was
     * stored when the occurrence was armed, so opening the app repeatedly costs
     * one query rather than one NS request each time.
     */
    async findNext(deviceId: string): Promise<ScheduleOccurrence | null> {
        return ScheduleOccurrence.findOne({
            where: { deviceId, state: OccurrenceState.ARMED },
            order: { currentWakeAt: 'ASC' },
        });
    }

    async findOwned(deviceId: string, id: string): Promise<ScheduleOccurrence | null> {
        return ScheduleOccurrence.findOneBy({ id, deviceId });
    }

    /**
     * Records that the device has actually armed a time.
     *
     * Without this the server cannot tell "pushed" from "armed" and would
     * re-push the same change forever. The value is what the device says it
     * holds, not what the server hoped it would: those differ whenever a push
     * was dropped, and the difference is the thing worth knowing.
     */
    async acknowledge(
        occurrence: ScheduleOccurrence,
        ackedWakeAt: string,
    ): Promise<ScheduleOccurrence> {
        occurrence.deviceAckedWakeAt = instant(ackedWakeAt);
        return occurrence.save();
    }

    /**
     * When to look at this occurrence again.
     *
     * The cadence tightens as the alarm approaches, because a delay six hours
     * out is noise and one twenty minutes out is the entire product. The bands
     * live in `@alarm/core` beside the test that asserts the per-night call
     * count, so changing them cannot quietly multiply the API bill.
     *
     * `computeNextCheckAt` returns null in two different situations, and they
     * need opposite answers. Past the wake time there is nothing left to decide,
     * so the row stops being claimed. Beyond the arming window there is plenty
     * to decide, just not yet, so the next check is set to the moment that
     * window opens. That keeps the monitor to a single claim query instead of
     * needing a second pass to notice occurrences becoming eligible.
     */
    private nextCheck(plan: WakePlan, timezone: string): Date | null {
        const now = DateTime.now().setZone(timezone);
        const wakeAt = DateTime.fromISO(plan.wakeUpAt, { setZone: true }).setZone(timezone);

        const next = computeNextCheckAt({
            wakeAt: plan.wakeUpAt,
            now: now.toISO() ?? '',
            timezone,
        });
        if (next !== null) {
            return DateTime.fromISO(next, { setZone: true }).toJSDate();
        }

        const armsAt = wakeAt.minus({ minutes: APP_CONSTANTS.MONITOR.ARM_LEAD_MINUTES });
        return armsAt > now ? armsAt.toJSDate() : null;
    }

    /**
     * The trail behind every alarm time.
     *
     * Written on arming as well as on changes, so the first entry says where the
     * time came from. Without a starting point, a later "moved 12 minutes later"
     * has nothing to be relative to.
     */
    private async record(
        occurrence: ScheduleOccurrence,
        previous: Date | null,
        plan: WakePlan,
    ): Promise<void> {
        const to = instant(plan.wakeUpAt);

        if (previous === null) {
            await AlarmEvent.create({
                occurrenceId: occurrence.id,
                type: AlarmEventType.SCHEDULED,
                fromAt: null,
                toAt: to,
                reason: WakeChangeReason.INITIAL_PLAN,
                message: `Alarm set for ${clock(plan.wakeUpAt)}.`,
            }).save();
            return;
        }

        if (previous.getTime() === to.getTime()) {
            // Nothing moved, so there is nothing to explain. Recording every
            // re-check would bury the entries that matter.
            return;
        }

        const later = to.getTime() > previous.getTime();
        await AlarmEvent.create({
            occurrenceId: occurrence.id,
            type: later ? AlarmEventType.MOVED_LATER : AlarmEventType.MOVED_EARLIER,
            fromAt: previous,
            toAt: to,
            reason: WakeChangeReason.ROUTE_CHANGED,
            message: `Alarm moved to ${clock(plan.wakeUpAt)}.`,
        }).save();
    }
}

function instant(iso: string): Date {
    return DateTime.fromISO(iso, { setZone: true }).toJSDate();
}

/** For the event message, which is written once and read much later. */
function clock(iso: string): string {
    return DateTime.fromISO(iso, { setZone: true }).toFormat('HH:mm');
}
