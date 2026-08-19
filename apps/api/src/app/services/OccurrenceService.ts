import { DateTime } from 'luxon';
import { In, MoreThanOrEqual } from 'typeorm';
import { APP_CONSTANTS, AlarmEventType, OccurrenceState, WakeChangeReason } from '@alarm/types';
import type { WakePlan } from '@alarm/types';
import { computeNextCheckAt } from '@alarm/core';

import AlarmEvent from '../models/AlarmEvent.entity';
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

    async arm(schedule: Schedule): Promise<ArmResult> {
        const simulated = await this.armedWithSimulation(schedule);
        if (simulated !== null) {
            /**
             * A simulation in force survives arming.
             *
             * Arming re-plans from live provider data, where nothing is actually
             * delayed, so re-planning during a test erased the very thing being
             * tested seconds after the monitor produced it. From the outside
             * that read as the tick having done nothing at all.
             *
             * Bounded by the simulation's own expiry, so this cannot become a
             * way for a morning to stop tracking reality.
             */
            return { ok: true, occurrence: simulated, schedule };
        }

        /**
         * A morning its owner has skipped stays skipped.
         *
         * Checked here, before anything is planned, for two reasons. The app
         * re-arms every active schedule whenever Today is focused, and `arm`
         * sets `state = ARMED` on whatever row it finds, so without this the
         * next glance at the app would quietly undo the skip. And planning
         * first would spend an NS request working out a journey for a morning
         * nobody is travelling on.
         */
        const skipped = await this.skippedNext(schedule);
        if (skipped !== null) {
            return { ok: true, occurrence: skipped, schedule };
        }

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
        // Arming computes a morning from scratch, so anything a previous
        // cancellation replaced belongs to a plan that no longer exists, and
        // whatever the device was told about it no longer applies either.
        occurrence.replacedJourney = null;
        occurrence.noticeKey = null;
        occurrence.ctxRecon = plan.journey?.ctxRecon ?? null;
        occurrence.watchedStationCodes = plan.journey?.watchedStationCodes ?? null;
        occurrence.lastCheckedAt = new Date();
        /**
         * A staged simulation stays due now.
         *
         * Arming recomputes the cadence, and for a morning still beyond the
         * monitoring window that means "look again in seven hours". Anything
         * staged for the next check would sit there until then, which is exactly
         * what happened: a simulation was staged, the home screen re-armed a
         * moment later, and the tick correctly found nothing due.
         */
        occurrence.nextCheckAt =
            occurrence.simulationKind === null
                ? this.nextCheck(plan, schedule.timezone)
                : new Date();

        await occurrence.save();

        await this.record(occurrence, previous, plan);

        return { ok: true, occurrence, schedule };
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
     * The next morning for this schedule, if its owner has skipped it.
     *
     * Matched on the exact date rather than "the soonest skipped row", so a
     * skip left behind on a morning that has already passed cannot shadow the
     * one being armed now.
     */
    private async skippedNext(schedule: Schedule): Promise<ScheduleOccurrence | null> {
        const date = this.plans.nextDate(schedule);
        if (date === null) {
            return null;
        }

        return ScheduleOccurrence.findOneBy({
            scheduleId: schedule.id,
            date,
            state: OccurrenceState.SKIPPED,
        });
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
     * An armed morning whose plan came from an unexpired simulation.
     *
     * Floored at today in the schedule's own zone. Without the floor this took
     * the earliest armed row of any date, so a stale morning left behind from
     * last week could shadow the one actually being armed and hand back its
     * plan instead.
     */
    private async armedWithSimulation(schedule: Schedule): Promise<ScheduleOccurrence | null> {
        const armed = await ScheduleOccurrence.findOne({
            where: {
                scheduleId: schedule.id,
                state: OccurrenceState.ARMED,
                date: MoreThanOrEqual(today(schedule.timezone)),
            },
            order: { date: 'ASC' },
        });

        if (armed === null || armed.simulationKind === null) {
            return null;
        }

        const expiresAt = armed.simulationExpiresAt;
        return expiresAt !== null && expiresAt.getTime() > Date.now() ? armed : null;
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

    /**
     * Every armed morning for this device, soonest first.
     *
     * A different question from `findNext`, and the schedules list needs this
     * one: a row saying a schedule is active without saying when it will wake
     * you is half an answer. Also a pure read, so opening the tab costs one
     * query rather than a provider call per schedule.
     */
    async findArmed(deviceId: string): Promise<ScheduleOccurrence[]> {
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
            where: { deviceId, state: In([OccurrenceState.ARMED, OccurrenceState.SKIPPED]) },
            order: { currentWakeAt: 'ASC' },
        });
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
