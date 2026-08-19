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
import { ProviderUsage } from './ProviderUsage';
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

/**
 * What the monitor managed to learn about a journey this pass.
 *
 * Narrower than the provider's own answer: `REPLAN` has already been resolved
 * into a fresh journey by the time anything here sees it, so the rest of the
 * check reasons about three states rather than four.
 */
type JourneyNow =
    /** The journey in force. Null only for a fixed travel time, which has none. */
    | { status: 'CURRENT'; journey: Journey | null }
    /** The itinerary has stopped existing, so a replacement is needed. */
    | { status: 'GONE' }
    /** A provider could not answer. Nothing may move on a pass that learned nothing. */
    | { status: 'UNAVAILABLE' };

/** What one pass over an occurrence did, for the tick's log line. */
export interface TickResult {
    /** Provider calls in the rate-limit window, and in this pass alone. */
    nsCallsInWindow: number;
    tomtomCallsInWindow: number;
    nsCallsThisTick: number;
    tomtomCallsThisTick: number;
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
        // Taken before anything runs, so the difference afterwards is what this
        // pass cost rather than what the process has spent all night.
        const before = ProviderUsage.snapshot();
        // Before claiming, so anything the sweep promotes is picked up by this
        // same pass rather than waiting a minute for the next one. A
        // cancellation is worth exactly that minute.
        const swept = await this.sweepDisruptions(now);

        const ids = await this.claim(now);
        const result: TickResult = {
            nsCallsInWindow: 0,
            tomtomCallsInWindow: 0,
            nsCallsThisTick: 0,
            tomtomCallsThisTick: 0,
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

        const after = ProviderUsage.snapshot();
        const spent = ProviderUsage.totalsSince(before);
        result.nsCallsInWindow = after.ns;
        result.tomtomCallsInWindow = after.tomtom;
        result.nsCallsThisTick = spent.ns;
        result.tomtomCallsThisTick = spent.tomtom;

        if (after.nsPressure) {
            // Before the 429 rather than after it. By the time NS refuses, an
            // alarm has already gone unchecked.
            console.warn(
                `NS budget is filling up: ${String(after.ns)} of ${String(after.nsLimit)} ` +
                    `calls in the last ${String(after.windowMinutes)} minutes.`,
            );
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
     * The journey as it stands now, or why it cannot be known.
     *
     * Three answers rather than a nullable journey, because the providers give
     * three and two of them used to collapse into null. Rail can say a trip has
     * stopped existing; the car provider can only ever say "route it again"; a
     * fixed travel time has nothing to ask anyone. Reading all three as
     * "cancelled" is what told car and fixed-time users their service had been
     * cancelled on the first check of every night.
     */
    private async currentJourney(
        schedule: Schedule,
        date: string,
        previousPlan: WakePlan,
    ): Promise<JourneyNow> {
        const journey = previousPlan.journey;
        if (journey === null) {
            // A fixed travel time. There is no itinerary to be delayed and no
            // provider to ask, so nothing about the travel time has changed.
            return { status: 'CURRENT', journey: null };
        }

        const provider = TransportProviderFactory.forMode(schedule.mode);
        if (provider === null) {
            return { status: 'CURRENT', journey };
        }

        const result = await provider.refresh(journey);
        if (result.status === 'CURRENT') {
            return { status: 'CURRENT', journey: result.journey };
        }
        if (result.status === 'GONE') {
            return { status: 'GONE' };
        }

        /**
         * `REPLAN`: the provider has no handle on one particular trip, which is
         * the road. Routing it again is the only way to learn anything, and what
         * comes back is an ordinary current journey rather than a replacement
         * for a cancelled one.
         */
        try {
            const planned = await this.plans.forDate(schedule, date);
            if (!planned.ok) {
                console.error(`Re-route for ${date} could not be planned: ${planned.problem}`);
                return { status: 'UNAVAILABLE' };
            }
            return { status: 'CURRENT', journey: planned.response.plan.journey };
        } catch (error) {
            // A provider outage. The alarm keeps the time it has, which came
            // from the last answer that worked, and the next tick tries again.
            console.error(`Re-route failed for ${date}:`, error);
            return { status: 'UNAVAILABLE' };
        }
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
        if (occurrence === null) {
            return false;
        }

        if (occurrence.planSnapshot === null) {
            /**
             * Armed with nothing to keep current, which every path that arms an
             * occurrence makes impossible. Worth stopping rather than skipping:
             * claiming had already pushed this row five minutes out on a lease,
             * so returning here left it due again five minutes later, and again,
             * all night. One impossible row took a claim slot on every tick.
             */
            console.error(`Occurrence ${occurrence.id} is armed with no plan. Cancelling it.`);
            return this.abandon(occurrence);
        }

        const schedule = await Schedule.findOneBy({ id: occurrence.scheduleId });
        const device = await Device.findOneBy({ id: occurrence.deviceId });
        if (schedule === null || device === null) {
            // The schedule was deleted under us. Nothing left to keep current.
            return this.abandon(occurrence);
        }

        const previousPlan = occurrence.planSnapshot;
        const live = await this.currentJourney(schedule, occurrence.date, previousPlan);

        if (live.status === 'UNAVAILABLE') {
            // Nothing was learned, so nothing may change. Re-checked on the
            // cadence the existing plan implies, which keeps a provider outage
            // from either moving an alarm or stranding the row on its lease.
            occurrence.lastCheckedAt = now;
            occurrence.nextCheckAt = this.occurrences.nextCheck(
                previousPlan,
                schedule.timezone,
                now,
            );
            await occurrence.save();
            return false;
        }

        // A staged simulation replaces what the provider appears to have said,
        // and nothing else. Everything below this line is the real path: the
        // same engine, the same opt-in settings, the same push, the same rule on
        // the phone. That is the whole point of testing it this way.
        const seen = live.status === 'GONE' ? null : live.journey;
        const simulated = this.simulation.apply(occurrence, seen, now);
        if (simulated !== undefined) {
            // Marked used, and saved with the plan it produced, so a second
            // check plans against reality again. The record stays until it
            // expires, which is what keeps arming from undoing this.
            this.simulation.consume(occurrence, now);
            console.warn(`Occurrence ${occurrence.id} checked against a SIMULATED disruption.`);
        }

        /**
         * Whether the trip has stopped existing, which is the one thing worth
         * reporting as a cancellation.
         *
         * A simulated cancellation produces the same null the provider would, so
         * a test drives this branch rather than a shortcut around it.
         */
        const gone = simulated === undefined ? live.status === 'GONE' : simulated === null;
        const refreshed = simulated === undefined ? seen : simulated;

        // A trip that can no longer be reconstructed has not been delayed, it
        // has stopped existing, and the useful answer is a different journey to
        // the same deadline. Without this a cancellation left the occurrence
        // with no journey at all: a wake time computed from nothing, and a
        // screen showing a train that vanished with no replacement under it.
        const replacement: ReplacementResult = gone
            ? await this.replan(schedule, occurrence.date, previousPlan)
            : { found: false, reason: 'NOTHING_PLANNED' };
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

        const detected = this.reasonFor(previousPlan.journey, refreshed, schedule.mode, gone);
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
            detected === WakeChangeReason.CANCELLATION && plannedWake.getTime() < held.getTime();

        const optedIn = emergencyEarlier || this.allowedBy(device, detected, schedule.mode);

        /**
         * The alarm may always move back towards the anchor, never past it.
         *
         * Every comparison here is against `held`, wherever the alarm is now,
         * and that left the emergency path one-directional: it overrides every
         * opt-in to drag somebody earlier, and nothing could put them back.
         * A cancellation moved an alarm from 07:43 to 07:29, the cancellation
         * cleared, and 07:43 then read as a *later* move and was refused by the
         * very setting that had just been overridden. The user was woken
         * fourteen minutes early every morning until the row was re-armed by
         * hand.
         *
         * The opt-in was never a promise about `currentWakeAt`. It is a promise
         * about the **anchor**: you will not be woken later than the time you
         * agreed to without saying so. Anything at or below the anchor is
         * ground the user accepted when the morning was armed, so giving it
         * back is not moving them later, it is releasing an emergency that no
         * longer applies.
         *
         * **Clamped, not gated.** A `target <= anchor` test would be brittle in
         * exactly the common case: the anchor is a pessimistic estimate, so a
         * recompute landing a minute past it is ordinary, and a gate would
         * leave the alarm stuck at 07:29 over one minute. Clamping reproduces
         * the counterfactual instead, the time they would have had if the
         * cancellation had never happened.
         *
         * In the steady state `held` **is** the anchor, so the clamp equals
         * `held` and nothing moves. This branch is unreachable unless the
         * server itself has pulled the alarm below its anchor, which is what
         * makes it incapable of changing any behaviour that is already right.
         */
        const anchor = occurrence.anchorWakeAt;
        const returning =
            !optedIn &&
            anchor !== null &&
            Math.min(plannedWake.getTime(), anchor.getTime()) > held.getTime();

        const targetAt =
            returning && anchor !== null
                ? new Date(Math.min(plannedWake.getTime(), anchor.getTime()))
                : plannedWake;

        /**
         * What the trail and the phone are told.
         *
         * A return is named for what it is rather than borrowing whatever the
         * timetable happened to be doing, because "the delay cleared" is not
         * what happened to this alarm. `detected` stays the truth about the
         * journey and is still what decides the settings and the replacement
         * below.
         */
        const reason = returning ? WakeChangeReason.RETURNED_TO_ANCHOR : detected;

        const worthMoving =
            (optedIn || returning) &&
            shouldPushWakeChange(current, targetAt.toISOString(), schedule.timezone, {
                // Earlier is routine for traffic, and permitted for a
                // cancellation only because not moving would be worse.
                //
                // A recomputed fixed-travel morning may also move earlier. It
                // has no disruption to be careful about, and refusing would mean
                // an alarm that knows it should ring sooner and does not.
                //
                // Never for a return, which only ever moves later by
                // definition, so it needs no permission in this direction.
                allowEarlier:
                    detected === WakeChangeReason.TRAFFIC_WORSE ||
                    detected === WakeChangeReason.ROUTE_CHANGED ||
                    emergencyEarlier,
            });

        if (!worthMoving) {
            // The plan is still stored, so the breakdown the user sees stays
            // current even when the wake time itself did not move.
            occurrence.planSnapshot = plan;

            // A time that moved on an earlier tick may still not have reached
            // the phone. Nothing new was computed here, so this is the only
            // place that retry can happen.
            await this.delivery.deliver(occurrence, device, schedule.timezone, null, now);

            // And the news itself, which does not depend on the alarm moving.
            // This is the branch that runs when the user has not opted into
            // being woken later: the time stays, and they still get to know
            // their train is cancelled.
            await this.delivery.notify(occurrence, device, refreshed, gone, simulated !== undefined);

            // One write covering everything above. This used to be two saves
            // with a third inside `deliver`, three writes to record one
            // decision about one row.
            await occurrence.save();
            return false;
        }

        const from = occurrence.currentWakeAt;
        /*
         * The clamped time, which is the plan's own except on a return.
         *
         * `departHomeAt` and the snapshot keep the plan's values either way.
         * They describe the journey, and the journey has not been clamped: only
         * the moment somebody is woken has, deliberately on the early side. The
         * two disagreeing by a minute or two is not new either, it is what
         * already happens every night to anyone whose live plan drifts later
         * than a wake time they did not opt into moving.
         */
        occurrence.currentWakeAt = targetAt;
        occurrence.departHomeAt = DateTime.fromISO(plan.departHomeAt, {
            setZone: true,
        }).toJSDate();
        occurrence.planSnapshot = plan;
        occurrence.ctxRecon = plan.journey?.ctxRecon ?? null;
        occurrence.watchedStationCodes = plan.journey?.watchedStationCodes ?? null;

        // `detected`, not `reason`: a return that happens to be a cancellation
        // still has a train nobody should be left waiting for.
        if (detected === WakeChangeReason.CANCELLATION && previousPlan.journey !== null) {
            // Remember what was lost. The new plan is a different train, and a
            // screen that shows only the replacement leaves someone looking for
            // a service that is not coming.
            occurrence.replacedJourney = previousPlan.journey;
        }

        await occurrence.save();

        // Marked in the trail, not only in the log. Someone woken early by a
        // test has to be able to see that is what happened, or a simulation is
        // indistinguishable from the product being wrong.
        await AlarmEvent.create({
            occurrenceId: occurrence.id,
            // The time actually written, not the one the plan asked for. On a
            // return those differ, and the trail has to record the move that
            // happened rather than the one that was proposed.
            type:
                from !== null && targetAt.getTime() < from.getTime()
                    ? AlarmEventType.MOVED_EARLIER
                    : AlarmEventType.MOVED_LATER,
            fromAt: from,
            toAt: occurrence.currentWakeAt,
            reason,
            simulated: simulated !== undefined,
            message: this.describe(reason, targetAt, schedule.timezone, simulated !== undefined),
        }).save();

        // After the event, deliberately. The trail is what makes a wrong wake
        // time explainable in the morning, and it must survive a push that
        // fails.
        await this.delivery.deliver(
            occurrence,
            device,
            schedule.timezone,
            { reason, simulated: simulated !== undefined },
            now,
        );

        // The reason, separately from the new time. The wake push moves the
        // alarm; this says what happened, and the alarm screen reads it from the
        // device rather than asking the network at 06:00.
        await this.delivery.notify(occurrence, device, refreshed, gone, simulated !== undefined);
        await occurrence.save();

        return true;
    }

    /**
     * Stops monitoring a row there is nothing left to do for.
     *
     * `nextCheckAt` is cleared as well as the state, because the claim query
     * filters on both and a row left due is a row claimed for ever.
     */
    private async abandon(occurrence: ScheduleOccurrence): Promise<boolean> {
        occurrence.state = OccurrenceState.CANCELLED;
        occurrence.nextCheckAt = null;
        await occurrence.save();
        return false;
    }

    /**
     * A different journey to the same deadline, when the old one is gone.
     *
     * Only reached for a genuine cancellation, which in practice means rail: a
     * road route has no identity to lose and a fixed travel time has no
     * itinerary at all, so neither arrives here.
     *
     * Returns `NOTHING_PLANNED` when a re-plan was needed and failed. That case
     * matters: an NS outage during a cancellation must leave the alarm on its
     * existing time rather than on a plan computed from nothing, and the next
     * tick will try again.
     */
    private async replan(
        schedule: Schedule,
        date: string,
        previousPlan: WakePlan,
    ): Promise<ReplacementResult> {
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
     * What changed, in the terms the user's settings are written in.
     *
     * `gone` is passed rather than inferred from a null journey. Those were the
     * same thing until the car provider turned out to answer null for "ask me
     * again" and a fixed travel time to have no journey at all, at which point
     * inferring it reported both as cancellations.
     */
    private reasonFor(
        before: Journey | null,
        after: Journey | null,
        mode: TransportMode,
        gone: boolean,
    ): WakeChangeReason {
        if (gone) {
            // Unreconstructable, which is what a cancellation looks like from
            // here: the itinerary no longer exists to be delayed.
            return WakeChangeReason.CANCELLATION;
        }
        if (mode === TransportMode.CAR) {
            return WakeChangeReason.TRAFFIC_WORSE;
        }
        if (after === null) {
            // A fixed travel time. Nothing on the road or the rails can have
            // moved this, so whatever did came from the schedule or the routine.
            return WakeChangeReason.ROUTE_CHANGED;
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
        if (reason === WakeChangeReason.ROUTE_CHANGED) {
            /**
             * A fixed travel time, recomputed and different.
             *
             * The three settings govern whether a **disruption** may move an
             * alarm, and this mode has none: no provider, no timetable, nothing
             * outside the user's own schedule and routine that could change. A
             * difference here is arithmetic on their own data, so gating it on
             * an opt-in about trains would leave the plan on screen and the time
             * the alarm actually rings disagreeing about the same morning.
             *
             * Before this, a fixed-travel morning was reported as a cancellation
             * and gated on the cancellation opt-in, which was wrong for a
             * different reason. Naming the reason honestly moved it onto the
             * delay opt-in, which was wrong too, and quietly: a fixed-travel
             * alarm that needed to ring earlier was refused and said nothing.
             */
            return true;
        }
        if (mode === TransportMode.CAR) {
            return device.allowEarlierWakeOnTraffic;
        }
        if (reason === WakeChangeReason.CANCELLATION) {
            return device.allowLaterWakeOnCancellation;
        }
        return device.allowLaterWakeOnDelay;
    }

    /**
     * The operator's line in the event row, which never leaves the server.
     *
     * The app builds its own sentence from `reason` and `toAt`, because copy
     * belongs in its translations and a sentence written here would arrive in
     * English whatever language its reader chose. This one exists for whoever is
     * reading the table at 09:00 trying to explain a wake time.
     */
    private describe(
        reason: WakeChangeReason,
        wakeAt: Date,
        timezone: string,
        simulated: boolean,
    ): string {
        // The time the alarm was actually set to. Taking it from the plan was
        // right until the anchor clamp existed, and would now report a time
        // nothing is holding on exactly the moves that need explaining most.
        //
        // Zoned explicitly. The plan carried its own offset, a `Date` does not,
        // and a server in UTC would otherwise write "05:43" into the one line
        // somebody reads to explain a 07:43 alarm.
        const at = DateTime.fromJSDate(wakeAt).setZone(timezone).toFormat('HH:mm');
        const prefix = simulated ? 'SIMULATED: ' : '';
        switch (reason) {
            case WakeChangeReason.CANCELLATION:
                return `${prefix}A service was cancelled, so the alarm moved to ${at}.`;
            case WakeChangeReason.TRAFFIC_WORSE:
                return `${prefix}Traffic is heavier than planned, so the alarm moved to ${at}.`;
            case WakeChangeReason.DELAY_RESOLVED:
                return `${prefix}The delay cleared, so the alarm moved to ${at}.`;
            case WakeChangeReason.RETURNED_TO_ANCHOR:
                return `${prefix}The earlier wake-up is no longer needed, so the alarm went back to ${at}.`;
            case WakeChangeReason.ROUTE_CHANGED:
                return `${prefix}The plan was recomputed, so the alarm moved to ${at}.`;
            default:
                return `${prefix}A service is delayed, so the alarm moved to ${at}.`;
        }
    }
}
