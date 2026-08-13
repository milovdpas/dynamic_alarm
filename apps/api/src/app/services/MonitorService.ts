import { DateTime } from 'luxon';
import {
    APP_CONSTANTS,
    AlarmEventType,
    JourneyStatus,
    OccurrenceState,
    REPLAN_REQUIRED_STATUSES,
    TransportMode,
    WakeChangeReason,
} from '@alarm/types';
import type { Journey, WakePlan } from '@alarm/types';
import {
    computeNextCheckAt,
    computeWakePlan,
    routineDurationMinutes,
    shouldPushWakeChange,
} from '@alarm/core';

import AlarmEvent from '../models/AlarmEvent.entity';
import Device from '../models/Device.entity';
import Routine from '../models/Routine.entity';
import Schedule from '../models/Schedule.entity';
import ScheduleOccurrence from '../models/ScheduleOccurrence.entity';
import { AppDataSource } from '../../database/typeorm-db';
import { DisruptionSweepService } from './DisruptionSweepService';
import type { SweepResult } from './DisruptionSweepService';
import { OccurrenceService } from './OccurrenceService';
import { PushDeliveryService } from './PushDeliveryService';
import { TransportProviderFactory } from './TransportProviderFactory';

/**
 * How long a claimed row stays claimed while it is being worked on.
 *
 * Long enough that a slow provider call cannot let a second worker pick up the
 * same occurrence, short enough that a crashed worker's rows come back within a
 * cadence band rather than being stranded until morning.
 */
const CLAIM_LEASE_MINUTES = 5;

/** What one pass over an occurrence did, for the tick's log line. */
export interface TickResult {
    /** Active disruptions NS reported, from the one call that covers everyone. */
    disruptions: number;
    /** Occurrences the sweep pulled forward to be checked now. */
    promoted: number;
    claimed: number;
    moved: number;
    unchanged: number;
    failed: number;
}

/**
 * The loop that keeps armed alarms current.
 *
 * Runs every minute but does almost nothing most of the time: it claims only
 * the occurrences whose `nextCheckAt` has arrived, so the cost is proportional
 * to how close alarms are rather than to how many exist. That is what keeps this
 * at roughly 35 provider calls per occurrence per night instead of 480.
 *
 * Claiming uses `FOR UPDATE SKIP LOCKED`, so a second API instance running the
 * same loop is safe: each row is worked by exactly one of them, and neither
 * waits on the other. A crash mid-pass releases the claim by lease rather than
 * stranding the row.
 *
 * Each pass recomputes, records the change, and only then tells the phone. That
 * order matters: the trail is what makes a wrong wake time explainable in the
 * morning, and it has to survive a push that fails.
 */
export class MonitorService {
    private readonly occurrences = new OccurrenceService();
    private readonly delivery = new PushDeliveryService();
    private readonly sweep: DisruptionSweepService;

    /**
     * Both collaborators are injected so a test can drive a tick without an NS
     * request or an Expo call. Neither branch is otherwise reachable in
     * development: the feed is live, and no development device has a push token.
     */
    constructor(sweep: DisruptionSweepService = new DisruptionSweepService()) {
        this.sweep = sweep;
    }

    async tick(now = new Date()): Promise<TickResult> {
        // Before claiming, so anything the sweep promotes is picked up by this
        // same pass rather than waiting a minute for the next one. A
        // cancellation is worth exactly that minute.
        const swept = await this.sweepDisruptions(now);

        const ids = await this.claim(now);
        const result: TickResult = {
            disruptions: swept.disruptions,
            promoted: swept.promoted,
            claimed: ids.length,
            moved: 0,
            unchanged: 0,
            failed: 0,
        };

        for (const id of ids) {
            try {
                const moved = await this.check(id, now);
                if (moved) {
                    result.moved += 1;
                } else {
                    result.unchanged += 1;
                }
            } catch (error) {
                // One bad occurrence must not stop the others. It keeps its
                // lease and comes back on a later tick.
                result.failed += 1;
                console.error(`Monitor failed on occurrence ${id}:`, error);
            }
        }

        return result;
    }

    /**
     * The global disruption sweep, which must never take the tick down with it.
     *
     * One NS call covers every user, so a failure here costs visibility into
     * disruptions for a minute and nothing else: the cadence ladder still
     * re-checks every armed occurrence on its own schedule. Aborting the pass
     * over it would trade a delayed notice for no notice at all.
     */
    private async sweepDisruptions(now: Date): Promise<SweepResult> {
        try {
            return await this.sweep.sweep(now);
        } catch (error) {
            console.error('Disruption sweep failed:', error);
            return { disruptions: 0, promoted: 0 };
        }
    }

    /**
     * Takes ownership of the occurrences that are due.
     *
     * The lease is written inside the same transaction as the select, so a row
     * cannot be claimed twice even if the work that follows is slow. Without it,
     * a provider call lasting longer than the tick interval would let the next
     * tick pick up the same row and spend the request again.
     */
    private async claim(now: Date): Promise<string[]> {
        return AppDataSource.transaction(async (manager) => {
            const rows: { id: string }[] = await manager.query(
                `SELECT id FROM schedule_occurrences
                 WHERE state = ? AND next_check_at IS NOT NULL AND next_check_at <= ?
                 ORDER BY next_check_at
                 LIMIT ?
                 FOR UPDATE SKIP LOCKED`,
                [OccurrenceState.ARMED, now, APP_CONSTANTS.MONITOR.BATCH_SIZE],
            );

            if (rows.length === 0) {
                return [];
            }

            const ids = rows.map((row) => row.id);
            const lease = DateTime.fromJSDate(now)
                .plus({ minutes: CLAIM_LEASE_MINUTES })
                .toJSDate();

            await manager.query(
                `UPDATE schedule_occurrences SET next_check_at = ? WHERE id IN (?)`,
                [lease, ids],
            );

            return ids;
        });
    }

    /**
     * Re-checks one occurrence, and returns whether its wake time moved.
     *
     * The refresh asks the provider to reconstruct *this* itinerary with current
     * data rather than adding a reported delay to a stored plan. Those differ in
     * the case that matters: a delay that breaks a connection changes the whole
     * journey, and arithmetic on the old one would not notice.
     */
    private async check(id: string, now: Date): Promise<boolean> {
        const occurrence = await ScheduleOccurrence.findOneBy({ id });
        if (occurrence === null || occurrence.planSnapshot === null) {
            return false;
        }

        const schedule = await Schedule.findOneBy({ id: occurrence.scheduleId });
        const device = await Device.findOneBy({ id: occurrence.deviceId });
        if (schedule === null || device === null) {
            // The schedule was deleted under us. Nothing left to keep current.
            occurrence.state = OccurrenceState.CANCELLED;
            occurrence.nextCheckAt = null;
            await occurrence.save();
            return false;
        }

        const previousPlan = occurrence.planSnapshot;
        const refreshed = await this.refresh(previousPlan.journey, schedule.mode);

        const routine = await Routine.findOneBy({ id: schedule.routineId });
        const plan = computeWakePlan({
            requiredArrivalAt: previousPlan.breakdown.requiredArrivalAt,
            mode: schedule.mode,
            journey: refreshed,
            fixedTravelMinutes: schedule.fixedTravelMinutes ?? undefined,
            // Re-read rather than reused: the user may have edited their
            // routine since this occurrence was armed, and the stored breakdown
            // would keep waking them for a morning they no longer have.
            routineMinutes:
                routine === null
                    ? previousPlan.breakdown.routineMinutes
                    : routineDurationMinutes(routine),
            buffers: schedule.buffers,
            timezone: schedule.timezone,
            now: DateTime.fromJSDate(now).toISO() ?? undefined,
        });

        occurrence.lastCheckedAt = now;
        occurrence.nextCheckAt = this.nextCheck(plan, schedule.timezone, now);

        const reason = this.reasonFor(previousPlan.journey, refreshed, schedule.mode);
        const allowed = this.allowedBy(device, reason, schedule.mode);
        const current = (occurrence.currentWakeAt ?? occurrence.anchorWakeAt ?? now).toISOString();

        const worthMoving =
            allowed &&
            shouldPushWakeChange(current, plan.wakeUpAt, schedule.timezone, {
                // Earlier is only ever routine for traffic. Everything else
                // moving earlier is the emergency path, which this pass does not
                // own.
                allowEarlier: reason === WakeChangeReason.TRAFFIC_WORSE,
            });

        if (!worthMoving) {
            // The plan is still stored, so the breakdown the user sees stays
            // current even when the wake time itself did not move.
            occurrence.planSnapshot = plan;
            await occurrence.save();

            // A time that moved on an earlier tick may still not have reached
            // the phone. Nothing new was computed here, so this is the only
            // place that retry can happen.
            await this.delivery.deliver(occurrence, device, schedule.timezone, null, now);
            return false;
        }

        const from = occurrence.currentWakeAt;
        occurrence.currentWakeAt = DateTime.fromISO(plan.wakeUpAt, { setZone: true }).toJSDate();
        occurrence.departHomeAt = DateTime.fromISO(plan.departHomeAt, {
            setZone: true,
        }).toJSDate();
        occurrence.planSnapshot = plan;
        occurrence.ctxRecon = plan.journey?.ctxRecon ?? null;
        occurrence.watchedStationCodes = plan.journey?.watchedStationCodes ?? null;
        await occurrence.save();

        const message = this.describe(reason, plan);
        await AlarmEvent.create({
            occurrenceId: occurrence.id,
            type:
                from !== null && plan.wakeUpAt < from.toISOString()
                    ? AlarmEventType.MOVED_EARLIER
                    : AlarmEventType.MOVED_LATER,
            fromAt: from,
            toAt: occurrence.currentWakeAt,
            reason,
            message,
        }).save();

        // After the event, deliberately. The trail is what makes a wrong wake
        // time explainable in the morning, and it must survive a push that
        // fails.
        await this.delivery.deliver(occurrence, device, schedule.timezone, { reason, message }, now);

        return true;
    }

    /**
     * The same itinerary with current data, or a fresh plan when it is gone.
     *
     * A null refresh means the trip can no longer be reconstructed, which is the
     * provider's way of saying "re-plan" rather than "no change". Treating it as
     * no change is the failure that leaves someone asleep while their train is
     * cancelled.
     */
    private async refresh(journey: Journey | null, mode: TransportMode): Promise<Journey | null> {
        if (journey === null) {
            return null;
        }

        const provider = TransportProviderFactory.forMode(mode);
        if (provider === null) {
            // FIXED mode has nothing to ask anyone about.
            return journey;
        }

        return provider.refresh(journey);
    }

    /** What changed, in the terms the user's settings are written in. */
    private reasonFor(
        before: Journey | null,
        after: Journey | null,
        mode: TransportMode,
    ): WakeChangeReason {
        if (mode === TransportMode.CAR) {
            return WakeChangeReason.TRAFFIC_WORSE;
        }
        if (after === null) {
            // Unreconstructable, which is what a cancellation looks like from
            // here: the itinerary no longer exists to be delayed.
            return WakeChangeReason.CANCELLATION;
        }
        if (REPLAN_REQUIRED_STATUSES.includes(after.status)) {
            return WakeChangeReason.CANCELLATION;
        }
        if (
            after.status === JourneyStatus.NORMAL &&
            (before?.status ?? JourneyStatus.NORMAL) !== JourneyStatus.NORMAL
        ) {
            return WakeChangeReason.DELAY_RESOLVED;
        }
        return WakeChangeReason.DELAY;
    }

    /**
     * Whether the device asked for this kind of change to move its alarm.
     *
     * All three settings are opt in, so a device that never answered keeps the
     * time it was given. Moving somebody's alarm because nobody objected is the
     * wrong way round, and the settings screen is where they say otherwise.
     */
    private allowedBy(device: Device, reason: WakeChangeReason, mode: TransportMode): boolean {
        if (mode === TransportMode.CAR) {
            return device.allowEarlierWakeOnTraffic;
        }
        if (reason === WakeChangeReason.CANCELLATION) {
            return device.allowLaterWakeOnCancellation;
        }
        return device.allowLaterWakeOnDelay;
    }

    private nextCheck(plan: WakePlan, timezone: string, now: Date): Date | null {
        const next = computeNextCheckAt({
            wakeAt: plan.wakeUpAt,
            now: DateTime.fromJSDate(now).setZone(timezone).toISO() ?? '',
            timezone,
        });
        return next === null ? null : DateTime.fromISO(next, { setZone: true }).toJSDate();
    }

    /**
     * The sentence stored with the event.
     *
     * Written now rather than rendered later, because it depends on data that
     * has already changed by the time anyone reads it.
     */
    private describe(reason: WakeChangeReason, plan: WakePlan): string {
        const at = DateTime.fromISO(plan.wakeUpAt, { setZone: true }).toFormat('HH:mm');
        switch (reason) {
            case WakeChangeReason.CANCELLATION:
                return `A service was cancelled, so the alarm moved to ${at}.`;
            case WakeChangeReason.TRAFFIC_WORSE:
                return `Traffic is heavier than planned, so the alarm moved to ${at}.`;
            case WakeChangeReason.DELAY_RESOLVED:
                return `The delay cleared, so the alarm moved to ${at}.`;
            default:
                return `A service is delayed, so the alarm moved to ${at}.`;
        }
    }
}
