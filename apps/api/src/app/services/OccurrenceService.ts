import { DateTime } from 'luxon';
import { In, LessThanOrEqual, MoreThan } from 'typeorm';
import { APP_CONSTANTS, AlarmEventType, OccurrenceState, WakeChangeReason } from '@alarm/types';
import type { WakePlan } from '@alarm/types';
import {
    computeNextCheckAt,
    computeWakePlan,
    nextOccurrenceDate,
    routineDurationMinutes,
} from '@alarm/core';

import AlarmEvent from '../models/AlarmEvent.entity';
import Routine from '../models/Routine.entity';
import Schedule from '../models/Schedule.entity';
import ScheduleOccurrence from '../models/ScheduleOccurrence.entity';
import { SchedulePlanService } from './SchedulePlanService';
import type { SchedulePlanProblem } from './SchedulePlanService';

export type ArmResult =
    // The schedule itself rather than only its name: the morning's DTO carries
    // the reminder setting, and the caller that renders it has no other way to
    // reach the schedule this was armed from.
    | { ok: true; occurrence: ScheduleOccurrence; schedule: Schedule }
    | { ok: false; problem: SchedulePlanProblem };

/** States a morning does not come back from. */
const OVER = new Set<OccurrenceState>([OccurrenceState.FIRED, OccurrenceState.DISMISSED]);

/**
 * Whether a morning is finished with.
 *
 * Every edit to a single morning checks this first. Editing a morning that has
 * rung would re-anchor it to a time in the past, write a move into the trail,
 * and set it armed again for the retire sweep to close a minute later.
 */
export function isOver(state: OccurrenceState): boolean {
    return OVER.has(state);
}

export type SetStepsResult =
    | { ok: true; occurrence: ScheduleOccurrence }
    | { ok: false; problem: 'NO_PLAN' | 'ROUTINE_MISSING' | 'UNKNOWN_STEP' | 'OVER' };

export type ApplyPlanResult =
    | { ok: true; occurrence: ScheduleOccurrence }
    | { ok: false; problem: 'NO_PLAN' | 'ALREADY_APPLIED' };

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

    /**
     * Plans every morning this schedule has in the coming week.
     *
     * It used to plan one. A schedule then had a single occurrence, worked out
     * about eight hours ahead, so Thursday did not exist on Tuesday: nothing
     * could notice works announced for it, nothing could be skipped on it, and
     * a calendar had nothing to show. Every matching day inside
     * `PLAN_AHEAD_DAYS` gets a row and a plan now.
     *
     * **What it costs.** One provider call per morning the first time, then one
     * new morning a day as the horizon rolls, which is what one morning cost
     * before. To keep it there, a later morning that already has a plan is left
     * alone; only the soonest is planned again on every call, because arming is
     * also the refresh path and the soonest is the one on screen.
     *
     * Rows are left alone when they are skipped, when a simulation is in force
     * on them, or when they are over. A failure planning a later morning is
     * logged and skipped rather than failing the whole call: the soonest is the
     * alarm somebody is about to sleep on, and Friday can wait for the tick.
     *
     * Returns the soonest, so the endpoint means what it always meant.
     */
    async arm(
        schedule: Schedule,
        now = new Date(),
        options: { refreshSoonest?: boolean } = {},
    ): Promise<ArmResult> {
        const refreshSoonest = options.refreshSoonest ?? true;
        const dates = this.upcomingDates(schedule, now);
        if (dates.length === 0) {
            return { ok: false, problem: 'NO_UPCOMING_OCCURRENCE' };
        }

        const rows = await ScheduleOccurrence.find({
            where: { scheduleId: schedule.id, date: In(dates) },
        });
        const byDate = new Map(rows.map((row) => [row.date, row]));

        const mornings: ScheduleOccurrence[] = [];
        for (const [index, date] of dates.entries()) {
            const current = byDate.get(date) ?? null;

            if (current !== null && this.leaveAlone(current, index === 0 && refreshSoonest, now)) {
                if (!OVER.has(current.state)) {
                    mornings.push(current);
                }
                continue;
            }

            const planned = await this.plans.forDate(
                schedule,
                date,
                undefined,
                current?.disabledStepIds ?? [],
            );
            if (!planned.ok) {
                if (index === 0) {
                    return { ok: false, problem: planned.problem };
                }
                console.warn(
                    `Schedule ${schedule.id}: could not plan ${date} (${planned.problem}); leaving it to the tick.`,
                );
                continue;
            }

            mornings.push(await this.write(schedule, current, date, planned.response.plan, now));
        }

        const soonest = mornings[0];
        if (soonest === undefined) {
            return { ok: false, problem: 'NO_UPCOMING_OCCURRENCE' };
        }
        return { ok: true, occurrence: soonest, schedule };
    }

    /**
     * Keeps every active schedule planned a full week ahead.
     *
     * Only `arm` creates rows, and the phone calls it only when it has nothing
     * listed, so without this the week shrank a day at a time and refilled only
     * once the last morning had passed. By Thursday nothing existed for next
     * Tuesday, which is the morning the horizon was added for.
     *
     * Plans only what is missing: the soonest is not re-planned here, because
     * that is the refresh path's job and this runs unasked. One new morning per
     * schedule per day, in the steady state, which is what a single morning cost
     * before the week existed.
     */
    async topUpWeek(now = new Date()): Promise<number> {
        const schedules = await Schedule.findBy({ active: true });
        let planned = 0;
        for (const schedule of schedules) {
            // Per schedule, so a provider exception for one device costs that
            // device a day of horizon for an hour and nobody else anything. The
            // hourly guard is set before this runs, so an abort here would have
            // skipped every schedule after it until the next hour.
            try {
                const before = await ScheduleOccurrence.countBy({ scheduleId: schedule.id });
                const result = await this.arm(schedule, now, { refreshSoonest: false });
                if (!result.ok) {
                    continue;
                }
                const after = await ScheduleOccurrence.countBy({ scheduleId: schedule.id });
                planned += Math.max(0, after - before);
            } catch (error) {
                console.error(`Week top-up failed for schedule ${schedule.id}:`, error);
            }
        }
        return planned;
    }

    /**
     * Whether an existing row should be kept exactly as it is.
     *
     * Skipped: its owner sat it out, and re-planning would set it `ARMED` and
     * quietly undo that on the next glance at the app. Simulated: re-planning
     * from live data, where nothing is actually delayed, would erase the very
     * thing being tested seconds after the monitor produced it. Over: it rang,
     * or was dismissed. Later and already planned: spending a provider call to
     * arrive at the same answer is the cost this whole method is built to
     * avoid.
     */
    private leaveAlone(row: ScheduleOccurrence, soonest: boolean, now: Date): boolean {
        if (row.state === OccurrenceState.SKIPPED || OVER.has(row.state)) {
            return true;
        }
        const expiresAt = row.simulationExpiresAt;
        if (row.simulationKind !== null && expiresAt !== null && expiresAt.getTime() > now.getTime()) {
            return true;
        }
        return !soonest && row.planSnapshot !== null;
    }

    /** Writes a plan onto a morning, creating the row on its first arming. */
    private async write(
        schedule: Schedule,
        existing: ScheduleOccurrence | null,
        date: string,
        plan: WakePlan,
        now: Date,
    ): Promise<ScheduleOccurrence> {
        const occurrence =
            existing ??
            ScheduleOccurrence.create({
                scheduleId: schedule.id,
                deviceId: schedule.deviceId,
                date,
                // The anchor is written once, on the row that did not exist
                // before. Re-arming must never move it, or the guarantee it
                // provides is exactly as strong as the last network call.
                anchorWakeAt: instant(plan.wakeUpAt),
            });

        // Coalesced, not compared to null. A newly created entity has never
        // been through the database, so TypeORM leaves unset columns as
        // `undefined` even where the type says `Date | null`, and the first
        // arming of a morning would otherwise crash reading `.getTime()`.
        const previous = occurrence.currentWakeAt ?? null;

        occurrence.state = this.armingState(plan.wakeUpAt, now);
        occurrence.currentWakeAt = instant(plan.wakeUpAt);
        occurrence.departHomeAt = instant(plan.departHomeAt);
        occurrence.planSnapshot = plan;
        // Arming computes a morning from scratch, so anything a previous
        // cancellation replaced belongs to a plan that no longer exists, and
        // whatever the device was told about it no longer applies either.
        occurrence.replacedJourney = null;
        occurrence.noticeKey = null;
        occurrence.ctxRecon = plan.journey?.ctxRecon ?? null;
        occurrence.watchedStationCodes = plan.journey?.watchedStationCodes ?? null;
        occurrence.lastCheckedAt = now;
        /**
         * A staged simulation stays due now.
         *
         * Arming recomputes the cadence, and for a morning still beyond the
         * monitoring window that means "look again tomorrow". Anything staged
         * for the next check would sit there until then, which is exactly what
         * happened: a simulation was staged, the home screen re-armed a moment
         * later, and the tick correctly found nothing due.
         */
        occurrence.nextCheckAt =
            occurrence.simulationKind === null
                ? this.nextCheck(plan, schedule.timezone, now)
                : now;

        await occurrence.save();
        await this.record(occurrence, previous, plan);
        return occurrence;
    }

    /**
     * Every date this schedule falls on inside the planning horizon.
     *
     * Walks `nextOccurrenceDate` forward a day at a time from `now`, which is
     * the same rule the single-morning version used, applied repeatedly. Today
     * is included only while its arrival time is still ahead.
     */
    private upcomingDates(schedule: Schedule, now: Date): string[] {
        const zone = schedule.timezone;
        const start = DateTime.fromJSDate(now).setZone(zone);
        const horizon = start.plus({ days: APP_CONSTANTS.MONITOR.PLAN_AHEAD_DAYS });
        const time = schedule.arrivalTime.slice(0, 5);

        const dates: string[] = [];
        let cursor = start;
        for (let guard = 0; guard <= APP_CONSTANTS.MONITOR.PLAN_AHEAD_DAYS; guard += 1) {
            const next = nextOccurrenceDate(schedule.daysOfWeek, time, zone, cursor);
            if (next === null || next > horizon) {
                break;
            }
            const iso = next.toISODate();
            if (iso === null) {
                break;
            }
            dates.push(iso);
            cursor = next.plus({ days: 1 }).startOf('day');
        }
        return dates;
    }

    /**
     * `ARMED` inside the eight hour window, `PENDING` beyond it.
     *
     * The two differ only in cadence. A pending morning is planned, listed, and
     * held by the phone as a fail-safe, but looked at once a day rather than
     * every half hour, because a timetable a week out changes for one reason
     * only and that reason is announced.
     */
    armingState(wakeUpAt: string, now: Date): OccurrenceState {
        const minutesUntilWake = (instant(wakeUpAt).getTime() - now.getTime()) / 60_000;
        return minutesUntilWake > APP_CONSTANTS.MONITOR.ARM_LEAD_MINUTES
            ? OccurrenceState.PENDING
            : OccurrenceState.ARMED;
    }

    /**
     * Leaves routine steps out of this one morning, and moves the alarm to match.
     *
     * "No shower on Thursday." The journey is unchanged; only the minutes before
     * departure are, so the wake time is recomputed from the plan already
     * stored and this costs no provider call. Replaces the whole set, so
     * clearing it is sending an empty list.
     *
     * **Re-anchored.** The anchor exists to stop the alarm moving *silently*:
     * a dropped push must leave somebody with the time they agreed to. This is
     * the opposite case, an explicit edit by the person the anchor protects,
     * so the new time becomes the anchor, exactly as editing the schedule does
     * through `discardUpcoming`. Leaving the old anchor would have the return
     * rule drag the alarm back to a morning with a shower in it.
     *
     * Both directions, for the same reason `applyStoredPlan` allows them. A
     * skipped morning keeps its skip; the steps are recorded for the day it is
     * un-skipped.
     */
    async setDisabledSteps(
        occurrence: ScheduleOccurrence,
        schedule: Schedule,
        disabledStepIds: readonly string[],
        now = new Date(),
    ): Promise<SetStepsResult> {
        if (isOver(occurrence.state)) {
            // Editing a rung morning would re-anchor it to the past, write a
            // move into the trail, and arm it again for the sweep to close.
            return { ok: false, problem: 'OVER' };
        }

        const plan = occurrence.planSnapshot;
        if (plan === null) {
            return { ok: false, problem: 'NO_PLAN' };
        }

        const routine = await Routine.findOneBy({ id: schedule.routineId });
        if (routine === null) {
            return { ok: false, problem: 'ROUTINE_MISSING' };
        }

        const known = new Set(routine.steps.map((step) => step.id));
        const unique = [...new Set(disabledStepIds)];
        if (unique.some((id) => !known.has(id))) {
            return { ok: false, problem: 'UNKNOWN_STEP' };
        }

        const recomputed = computeWakePlan({
            requiredArrivalAt: plan.breakdown.requiredArrivalAt,
            mode: schedule.mode,
            journey: plan.journey,
            fixedTravelMinutes: schedule.fixedTravelMinutes ?? undefined,
            routineMinutes: routineDurationMinutes(routine, unique),
            buffers: schedule.buffers,
            timezone: schedule.timezone,
            now: DateTime.fromJSDate(now).toISO() ?? undefined,
        });

        const from = occurrence.currentWakeAt;
        const to = instant(recomputed.wakeUpAt);

        occurrence.disabledStepIds = unique.length === 0 ? null : unique;
        occurrence.planSnapshot = recomputed;
        occurrence.currentWakeAt = to;
        occurrence.departHomeAt = instant(recomputed.departHomeAt);
        occurrence.anchorWakeAt = to;
        if (occurrence.state !== OccurrenceState.SKIPPED) {
            occurrence.state = this.armingState(recomputed.wakeUpAt, now);
        }
        occurrence.nextCheckAt =
            occurrence.simulationKind === null
                ? this.nextCheck(recomputed, schedule.timezone, now)
                : now;
        await occurrence.save();

        if (from === null || from.getTime() !== to.getTime()) {
            await AlarmEvent.create({
                occurrenceId: occurrence.id,
                type:
                    from !== null && to.getTime() < from.getTime()
                        ? AlarmEventType.MOVED_EARLIER
                        : AlarmEventType.MOVED_LATER,
                fromAt: from,
                toAt: to,
                reason: WakeChangeReason.USER_EDITED,
                simulated: occurrence.simulationKind !== null,
                message:
                    unique.length === 0
                        ? `Every routine step is back for this morning, so the alarm moved to ${clock(recomputed.wakeUpAt)}.`
                        : `${String(unique.length)} routine step(s) left out of this morning, so the alarm moved to ${clock(recomputed.wakeUpAt)}.`,
            }).save();
        }

        return { ok: true, occurrence };
    }

    /**
     * Moves the alarm onto the plan already stored, because its owner asked.
     *
     * The opt-in switches decide what may happen to somebody who is asleep, and
     * that is the only reason they are cautious. Awake and tapping a button is
     * not that situation: the app has already worked the better time out, said
     * so on screen, and been told to go on. Refusing there would be the app
     * knowing the answer and withholding it.
     *
     * **Both directions.** An explicit request is honoured whichever way it
     * points, the same rule the home screen's refresh already follows. The
     * monotonic guarantee protects against silent moves, not against people.
     *
     * Costs no provider call. The plan being applied is the one the last check
     * stored, which is also the one whose breakdown is on screen, so this
     * cannot apply a time the user was not looking at.
     */
    async applyStoredPlan(occurrence: ScheduleOccurrence): Promise<ApplyPlanResult> {
        const plan = occurrence.planSnapshot;
        if (plan === null) {
            return { ok: false, problem: 'NO_PLAN' };
        }

        const from = occurrence.currentWakeAt;
        const to = instant(plan.wakeUpAt);

        // The same floor the monitor pushes under. Below it there is nothing to
        // apply, and a button that reports success while changing nothing is
        // worse than one that says there is nothing to do.
        const minutes = Math.abs(to.getTime() - (from?.getTime() ?? to.getTime())) / 60_000;
        if (from !== null && minutes < APP_CONSTANTS.MONITOR.MIN_PUSH_DELTA_MINUTES) {
            return { ok: false, problem: 'ALREADY_APPLIED' };
        }

        occurrence.currentWakeAt = to;
        occurrence.departHomeAt = instant(plan.departHomeAt);
        await occurrence.save();

        await AlarmEvent.create({
            occurrenceId: occurrence.id,
            type:
                from !== null && to.getTime() < from.getTime()
                    ? AlarmEventType.MOVED_EARLIER
                    : AlarmEventType.MOVED_LATER,
            fromAt: from,
            toAt: to,
            reason: WakeChangeReason.USER_APPLIED,
            // The plan may well have come from a simulation, and the trail has
            // to keep saying so or a test looks like the product being wrong.
            simulated: occurrence.simulationKind !== null,
            message: `Applied by hand, so the alarm moved to ${clock(plan.wakeUpAt)}.`,
        }).save();

        return { ok: true, occurrence };
    }

    /**
     * Sits this one morning out, leaving the schedule itself alone.
     *
     * The difference the alarms list draws: pausing a schedule stops it arming
     * anything, while this is "not tomorrow". The row stays, so the list can
     * show which morning was skipped and what the next real one is, and the
     * plan stays with it so nothing has to be recomputed to change your mind.
     *
     * `nextCheckAt` is cleared along with the state, because the monitor claims
     * on both. A row left due is a row claimed on every tick for a morning that
     * is not happening.
     */
    async skip(occurrence: ScheduleOccurrence): Promise<ScheduleOccurrence> {
        occurrence.state = OccurrenceState.SKIPPED;
        occurrence.nextCheckAt = null;
        return occurrence.save();
    }

    /**
     * Puts a skipped morning back, and asks the monitor to look at it now.
     *
     * Due immediately rather than on the usual ladder: the stored plan is as old
     * as the skip, and somebody undoing one is usually doing it the night
     * before, well inside the window where the timetable matters.
     */
    async unskip(occurrence: ScheduleOccurrence): Promise<ScheduleOccurrence> {
        occurrence.state = OccurrenceState.ARMED;
        occurrence.nextCheckAt = new Date();
        return occurrence.save();
    }

    /**
     * The soonest armed occurrence for this device.
     *
     * A pure read. Nothing here spends a provider call, because the plan was
     * stored when the occurrence was armed, so opening the app repeatedly costs
     * one query rather than one NS request each time.
     */
    async findNext(deviceId: string, now = new Date()): Promise<ScheduleOccurrence | null> {
        return ScheduleOccurrence.findOne({
            // Still to come. See `findArmed` for why this is filtered here as
            // well as retired by the tick.
            where: {
                deviceId,
                state: In([OccurrenceState.ARMED, OccurrenceState.PENDING]),
                currentWakeAt: MoreThan(now),
            },
            order: { currentWakeAt: 'ASC' },
        });
    }

    /**
     * Every armed morning for this device, soonest first.
     *
     * A different question from `findNext`, and the schedules list needs this
     * one: a row saying a schedule is active without saying when it will wake
     * you is half an answer. Also a pure read, so opening the tab costs one
     * query rather than a provider call per schedule.
     */
    async findArmed(deviceId: string, now = new Date()): Promise<ScheduleOccurrence[]> {
        return ScheduleOccurrence.find({
            /*
             * Skipped mornings included, which is why this is not just "armed".
             * The alarms list has to show a skipped row as skipped: dropping it
             * would make the morning vanish from the list entirely, which reads
             * as the schedule having been deleted rather than sat out once.
             *
             * Callers that *act* on these must filter on `state` themselves. The
             * device does, because arming a skipped morning is precisely what
             * the skip is meant to prevent.
             */
            where: {
                deviceId,
                state: In([
                    OccurrenceState.ARMED,
                    OccurrenceState.PENDING,
                    OccurrenceState.SKIPPED,
                ]),
                /*
                 * And still to come. The tick retires passed mornings, but the
                 * tick has been down in production before, and a phone reading a
                 * morning that already rang re-arms a time in the past, which
                 * Android refuses. The phone then said "this device could not
                 * arm an alarm" about a device that could, and never planned the
                 * next morning because this stale one was still in the list.
                 */
                currentWakeAt: MoreThan(now),
            },
            order: { currentWakeAt: 'ASC' },
        });
    }

    /**
     * Closes every morning whose wake time has arrived.
     *
     * `FIRED` here means the moment came, not that a phone was heard ringing:
     * the server cannot know the second thing, and the phone reports it
     * separately through `dismiss` when it can. What this guarantees is that a
     * morning never stays `ARMED` after it is over, which is what left the app
     * re-arming yesterday and never planning tomorrow.
     *
     * Skipped mornings are closed too. They were sat out, and they are equally
     * over.
     *
     * One update, run at the start of every tick before anything is claimed, so
     * a morning is retired within a minute of passing rather than whenever
     * somebody next opens the app.
     */
    async retirePassed(now = new Date()): Promise<number> {
        const result = await ScheduleOccurrence.update(
            {
                state: In([
                    OccurrenceState.ARMED,
                    OccurrenceState.PENDING,
                    OccurrenceState.SKIPPED,
                ]),
                currentWakeAt: LessThanOrEqual(now),
            },
            { state: OccurrenceState.FIRED, nextCheckAt: null },
        );
        return result.affected ?? 0;
    }

    /**
     * The phone saying the final ring was switched off.
     *
     * Recorded rather than relied on. `retirePassed` closes the morning whether
     * or not this arrives, because a phone at 06:00 is as likely to be offline
     * as not. What this adds is the trail: the event says when somebody got
     * up, which is the other half of "why did it wake me at 06:12".
     *
     * Idempotent. Dismiss twice, or dismiss after the tick already retired the
     * row, and the state ends up `DISMISSED` with one event.
     */
    async dismiss(occurrence: ScheduleOccurrence, now = new Date()): Promise<ScheduleOccurrence> {
        if (occurrence.state === OccurrenceState.DISMISSED) {
            return occurrence;
        }

        occurrence.state = OccurrenceState.DISMISSED;
        occurrence.nextCheckAt = null;
        await occurrence.save();

        await AlarmEvent.create({
            occurrenceId: occurrence.id,
            type: AlarmEventType.DISMISSED,
            fromAt: occurrence.currentWakeAt,
            toAt: now,
            reason: WakeChangeReason.USER_EDITED,
            simulated: occurrence.simulationKind !== null,
            message: `Dismissed at ${clock(now.toISOString())}.`,
        }).save();

        return occurrence;
    }

    /**
     * Discards upcoming armed mornings for a schedule, because they describe a
     * plan that no longer exists.
     *
     * Editing a deadline, a routine or a chosen departure invalidates everything
     * already computed from the old answer. Leaving those rows is the bug it
     * looked like from outside: the schedule says 09:00, the list says you are
     * being woken at 05:43, and both report honestly.
     *
     * Deleted rather than recomputed. Recomputing would spend a provider call on
     * every small edit, and it would have to decide what happens to the anchor,
     * which is written once precisely so that nothing can quietly move it. A user
     * changing their own schedule is not a dropped push: the old anchor now
     * guarantees a morning nobody is having, so the honest thing is to let the
     * next arming compute a fresh one.
     *
     * Only future mornings, judged in the schedule's own timezone. A past
     * occurrence records an alarm that already rang, and rewriting that is a
     * different mistake.
     */
    async discardUpcoming(schedule: Pick<Schedule, 'id' | 'timezone'>): Promise<number> {
        /**
         * Today in the schedule's own zone, not the server's.
         *
         * The rows are dated in the schedule's zone, so comparing them against a
         * date computed somewhere else is only correct while the two agree. Near
         * midnight they do not, and the failure is silent in both directions: a
         * morning kept that should have gone, or one deleted that had not
         * happened yet.
         */
        const result = await ScheduleOccurrence.createQueryBuilder()
            .delete()
            .where('schedule_id = :scheduleId', { scheduleId: schedule.id })
            .andWhere('date >= :today', { today: today(schedule.timezone) })
            .andWhere('state IN (:...states)', {
                states: [OccurrenceState.PENDING, OccurrenceState.ARMED],
            })
            .execute();

        return result.affected ?? 0;
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
     * Public, and used by the monitor as well as by arming. It had a second
     * implementation there which omitted the fallback below, so an occurrence
     * checked while still more than eight hours out was stored with no next
     * check at all and never looked at again.
     *
     * `computeNextCheckAt` returns null in two different situations, and they
     * need opposite answers. Past the wake time there is nothing left to decide,
     * so the row stops being claimed. Beyond the arming window there is plenty
     * to decide, just not yet, so the next check is set to the moment that
     * window opens. That keeps the monitor to a single claim query instead of
     * needing a second pass to notice occurrences becoming eligible.
     */
    nextCheck(plan: WakePlan, timezone: string, from: Date = new Date()): Date | null {
        const now = DateTime.fromJSDate(from).setZone(timezone);
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
        if (armsAt <= now) {
            return null;
        }
        // Once a day until the window opens, and then the window itself. A
        // morning a week out changes for one reason, announced works, and a
        // daily look is what notices those within a day.
        const daily = now.plus({ minutes: APP_CONSTANTS.MONITOR.FAR_CHECK_INTERVAL_MINUTES });
        return (daily < armsAt ? daily : armsAt).toJSDate();
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
                // Arming returns early while a simulation is in force, so
                // anything recorded here was computed from real data.
                simulated: false,
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
            simulated: false,
            message: `Alarm moved to ${clock(plan.wakeUpAt)}.`,
        }).save();
    }
}

function instant(iso: string): Date {
    return DateTime.fromISO(iso, { setZone: true }).toJSDate();
}

/**
 * For the operator's line on the event row, which never leaves the server.
 *
 * The app writes what its owner reads, from `reason` and `toAt`, in the language
 * they chose.
 */
function clock(iso: string): string {
    return DateTime.fromISO(iso, { setZone: true }).toFormat('HH:mm');
}

/** Today's date in a given zone, as the `date` column stores it. */
function today(timezone: string): string {
    return DateTime.now().setZone(timezone).toISODate() ?? '';
}
