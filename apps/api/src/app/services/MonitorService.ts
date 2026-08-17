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
    chooseReplacement,
    computeWakePlan,
    routineDurationMinutes,
    serviceDeparture,
    shouldPushWakeChange,
} from '@alarm/core';
import type { ReplacementResult } from '@alarm/core';

import AlarmEvent from '../models/AlarmEvent.entity';
import Device from '../models/Device.entity';
import Routine from '../models/Routine.entity';
import Schedule from '../models/Schedule.entity';
import ScheduleOccurrence from '../models/ScheduleOccurrence.entity';
import { AppDataSource } from '../../database/typeorm-db';
import { DisruptionSweepService } from './DisruptionSweepService';
import type { SweepResult } from './DisruptionSweepService';
import { OccurrenceService } from './OccurrenceService';
import { SchedulePlanService } from './SchedulePlanService';
import { PushDeliveryService } from './PushDeliveryService';
import { SimulationService } from './SimulationService';
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
    private readonly plans = new SchedulePlanService();
    private readonly delivery = new PushDeliveryService();
    private readonly simulation = new SimulationService();
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
        const live = await this.refresh(previousPlan.journey, schedule.mode);

        // A staged simulation replaces what the provider appears to have said,
        // and nothing else. Everything below this line is the real path: the
        // same engine, the same opt-in settings, the same push, the same rule on
        // the phone. That is the whole point of testing it this way.
        const simulated = this.simulation.apply(occurrence, live, now);
        const refreshed = simulated === undefined ? live : simulated;
        if (simulated !== undefined) {
            // Marked used, and saved with the plan it produced, so a second
            // check plans against reality again. The record stays until it
            // expires, which is what keeps arming from undoing this.
            this.simulation.consume(occurrence, now);
            console.warn(`Occurrence ${occurrence.id} checked against a SIMULATED disruption.`);
        }

        // A trip that can no longer be reconstructed has not been delayed, it
        // has stopped existing, and the useful answer is a different journey to
        // the same deadline. Without this a cancellation left the occurrence
        // with no journey at all: a wake time computed from nothing, and a
        // screen showing a train that vanished with no replacement under it.
        const replacement = await this.replan(schedule, occurrence.date, refreshed, previousPlan);
        const replanned = replacement.found ? replacement.plan : null;

        if (!replacement.found && replacement.reason === 'OUTSIDE_WINDOW') {
            /**
             * A cancellation with nothing acceptable to replace it.
             *
             * The alarm stays exactly where it is and the user is told. Moving
             * it to a train they have said they will not take would be worse
             * than leaving it, and saying nothing would be worse still: they
             * would wake at the usual time for a service that is not running.
             */
            occurrence.lastCheckedAt = now;
            occurrence.nextCheckAt = this.occurrences.nextCheck(
                previousPlan,
                schedule.timezone,
                now,
            );
            await this.delivery.notifyNoReplacement(occurrence, device, simulated !== undefined);
            await occurrence.save();
            return false;
        }

        const routine = await Routine.findOneBy({ id: schedule.routineId });
        const plan = replanned ?? computeWakePlan({
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
        occurrence.nextCheckAt = this.occurrences.nextCheck(plan, schedule.timezone, now);

        const reason = this.reasonFor(previousPlan.journey, refreshed, schedule.mode);
        const held = occurrence.currentWakeAt ?? occurrence.anchorWakeAt ?? now;
        const current = held.toISOString();
        /**
         * Compared as instants, never as strings.
         *
         * The engine writes its times with an offset (`07:20+02:00`) and the
         * database hands back UTC (`05:34Z`). Lexicographically the first looks
         * later than the second, so `<` on the raw strings quietly answered the
         * opposite of the truth, and a cancellation that should have woken
         * somebody fourteen minutes earlier did nothing at all.
         */
        const plannedWake = DateTime.fromISO(plan.wakeUpAt, { setZone: true }).toJSDate();

        /**
         * A cancellation that leaves no way to arrive on time without getting up
         * earlier is the emergency path, and it overrides every opt-in setting.
         *
         * Those settings govern whether somebody may be woken *later*, which is
         * a comfort. Refusing to wake them earlier when their train no longer
         * exists is not caution, it is a guaranteed failure: the alarm rings on
         * time for a journey that cannot be made. Best effort, as the fail-safe
         * section says, since a dropped push here leaves the user exactly where
         * they would be with no app at all.
         */
        const emergencyEarlier =
            reason === WakeChangeReason.CANCELLATION && plannedWake.getTime() < held.getTime();

        const allowed = emergencyEarlier || this.allowedBy(device, reason, schedule.mode);

        const worthMoving =
            allowed &&
            shouldPushWakeChange(current, plan.wakeUpAt, schedule.timezone, {
                // Earlier is routine for traffic, and permitted for a
                // cancellation only because not moving would be worse.
                allowEarlier: reason === WakeChangeReason.TRAFFIC_WORSE || emergencyEarlier,
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

            // And the news itself, which does not depend on the alarm moving.
            // This is the branch that runs when the user has not opted into
            // being woken later: the time stays, and they still get to know
            // their train is cancelled.
            await this.delivery.notify(occurrence, device, refreshed, simulated !== undefined);
            await occurrence.save();
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

        if (reason === WakeChangeReason.CANCELLATION && previousPlan.journey !== null) {
            // Remember what was lost. The new plan is a different train, and a
            // screen that shows only the replacement leaves someone looking for
            // a service that is not coming.
            occurrence.replacedJourney = previousPlan.journey;
        }

        await occurrence.save();

        // Marked in the trail, not only in the log. Someone woken early by a
        // test has to be able to see that is what happened, or a simulation is
        // indistinguishable from the product being wrong.
        const message =
            simulated === undefined
                ? this.describe(reason, plan)
                : `SIMULATED: ${this.describe(reason, plan)}`;
        await AlarmEvent.create({
            occurrenceId: occurrence.id,
            type:
                from !== null && plannedWake.getTime() < from.getTime()
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

        // The reason, separately from the new time. The wake push moves the
        // alarm; this says what happened, and the alarm screen reads it from the
        // device rather than asking the network at 06:00.
        await this.delivery.notify(occurrence, device, refreshed, simulated !== undefined);
        await occurrence.save();

        return true;
    }

    /**
     * A different journey to the same deadline, when the old one is gone.
     *
     * Only for the modes that have a provider to ask. A fixed travel time has
     * nothing to re-plan, and a null refresh there means something else.
     *
     * Returns null when no re-plan is needed, and also when one was needed and
     * failed. That second case matters: an NS outage during a cancellation must
     * leave the alarm on its existing time rather than on a plan computed from
     * nothing, and the next tick will try again.
     */
    private async replan(
        schedule: Schedule,
        date: string,
        refreshed: Journey | null,
        previousPlan: WakePlan,
    ): Promise<ReplacementResult> {
        if (refreshed !== null || schedule.mode === TransportMode.FIXED) {
            return { found: false, reason: 'NOTHING_PLANNED' };
        }

        try {
            const options = await this.plans.optionsForDate(schedule, date);

            /**
             * Which candidate is acceptable is the user's decision, not ours.
             *
             * The rule lives in `@alarm/core` beside the rest of the engine, so
             * the app explains the same choice the server made rather than
             * describing it a second time and drifting. Passing the cancelled
             * departure also stops the planner handing back the very train that
             * is not running: without a reference, "different" has no meaning.
             */
            return chooseReplacement({
                options,
                cancelledDepartureAt: serviceDeparture(previousPlan),
                preference: schedule.replacementPreference,
                windowStart: schedule.travelWindowStart,
                windowEnd: schedule.travelWindowEnd,
                timezone: schedule.timezone,
            });
        } catch (error) {
            console.error(`Re-plan failed for occurrence on ${date}:`, error);
            return { found: false, reason: 'NOTHING_PLANNED' };
        }
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
