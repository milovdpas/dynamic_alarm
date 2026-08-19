import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    LegType,
    OccurrenceState,
    PUSH_MESSAGE_TYPE,
    TransportMode,
    WakeChangeReason,
} from '@alarm/types';
import type { Journey, JourneyLeg, PushMessage } from '@alarm/types';
import type { PlanRequest, RefreshResult, TransportProvider } from '@alarm/core';

import AlarmEvent from '../src/app/models/AlarmEvent.entity';
import Device from '../src/app/models/Device.entity';
import Routine from '../src/app/models/Routine.entity';
import RoutineStep from '../src/app/models/RoutineStep.entity';
import Schedule from '../src/app/models/Schedule.entity';
import ScheduleOccurrence from '../src/app/models/ScheduleOccurrence.entity';
import { DisruptionSweepService } from '../src/app/services/DisruptionSweepService';
import { MonitorService } from '../src/app/services/MonitorService';
import { PushService } from '../src/app/services/PushService';
import { TransportProviderFactory } from '../src/app/services/TransportProviderFactory';
import { StubNsModule } from './support/disruptions';
import { fixtureProvider } from './support/transport';
import { seedCommute, seedOccurrence, seedSchedule } from './support/factories';

/**
 * One pass of the monitor over one morning, driven end to end.
 *
 * Everything else in the suite tests a piece: the sweep, the claim, the delivery
 * bookkeeping, the simulation. Nothing drove `check` itself, and that is where
 * the modes diverge, so a bug that only showed up for a car commute could sit
 * there with ninety tests passing over it.
 *
 * It did. `refresh` answered `null` for three different situations, and the
 * monitor read all three as a cancellation. Every car and fixed-travel morning
 * was announced to its owner as a cancelled service on the first check of the
 * night, and the re-plan that followed went through the replacement chooser,
 * which refuses a candidate departing at the same moment as the one it is
 * replacing. A drive whose forecast had not moved therefore produced no
 * replacement, and the alarm stopped following traffic entirely.
 */

/** Answers the interface without a network, so a mode can be chosen per test. */
class StubProvider implements TransportProvider {
    readonly name = 'STUB';

    constructor(private readonly result: RefreshResult) {}

    plan(request: PlanRequest): Promise<Journey[]> {
        return fixtureProvider.plan(request);
    }

    refresh(): Promise<RefreshResult> {
        return Promise.resolve(this.result);
    }
}

/** A tick that asks NS nothing: the sweep is not what these tests are about. */
function monitor(): MonitorService {
    return new MonitorService(new DisruptionSweepService(new StubNsModule([])));
}

/**
 * Every push the pass attempted, whether or not it landed.
 *
 * Spied on the prototype because `MonitorService` builds its own delivery
 * service. Recording the attempt rather than the outcome is deliberate: the bug
 * being guarded against is a message that should never have been composed, and
 * a device with no token would hide it behind a `NO_TOKEN` result.
 */
function recordPushes(): PushMessage[] {
    const sent: PushMessage[] = [];
    vi.spyOn(PushService.prototype, 'send').mockImplementation((_device, message) => {
        sent.push(message);
        return Promise.resolve('SENT');
    });
    return sent;
}

function useProvider(result: RefreshResult, forFixed: TransportProvider | null = null): void {
    const provider = new StubProvider(result);
    vi.spyOn(TransportProviderFactory, 'forMode').mockImplementation((mode) =>
        mode === TransportMode.FIXED ? forFixed : provider,
    );
}

/** An armed morning, due now, for a schedule in the given mode. */
async function dueMorning(
    mode: TransportMode,
    scheduleOverrides: Record<string, unknown> = {},
): Promise<ScheduleOccurrence> {
    const { device, home, work, routine } = await seedCommute();
    const schedule = await seedSchedule(device, { origin: home, destination: work, routine }, {
        mode,
        ...scheduleOverrides,
    });
    return seedOccurrence(schedule, { nextCheckAt: new Date(Date.now() - 60_000) });
}

function noticesIn(sent: PushMessage[]): PushMessage[] {
    return sent.filter((message) => message.type === PUSH_MESSAGE_TYPE.DISRUPTION_NOTICE);
}

/** Gives the stored plan real legs, which the factory leaves empty. */
async function withLegs(
    occurrence: ScheduleOccurrence,
    legs: Partial<JourneyLeg>[],
): Promise<void> {
    const plan = occurrence.planSnapshot;
    if (plan?.journey == null) {
        throw new Error('The factory is meant to seed a journey.');
    }
    const iso = plan.journey.departureAt;
    await ScheduleOccurrence.update(occurrence.id, {
        planSnapshot: {
            ...plan,
            journey: {
                ...plan.journey,
                legs: legs.map((leg) => ({
                    type: LegType.TRAIN,
                    fromName: '',
                    toName: '',
                    plannedDeparture: iso,
                    actualDeparture: iso,
                    plannedArrival: iso,
                    actualArrival: iso,
                    delaySeconds: 0,
                    cancelled: false,
                    ...leg,
                })),
            },
        },
    });
}

/** What a FIXED schedule's plan really looks like: a wake time and no journey. */
async function stripJourney(occurrence: ScheduleOccurrence): Promise<void> {
    const plan = occurrence.planSnapshot;
    if (plan === null) {
        throw new Error('The factory is meant to seed a plan.');
    }
    await ScheduleOccurrence.update(occurrence.id, {
        planSnapshot: { ...plan, journey: null },
        ctxRecon: null,
        watchedStationCodes: null,
    });
}

/** Makes the morning's routine longer, so a recompute wants an earlier wake. */
async function lengthenRoutine(
    occurrence: ScheduleOccurrence,
    minutes: number,
): Promise<void> {
    const schedule = await Schedule.findOneBy({ id: occurrence.scheduleId });
    const routine = await Routine.findOne({
        where: { id: schedule?.routineId },
        relations: { steps: true },
    });
    const step = routine?.steps[0];
    if (step === undefined) {
        throw new Error('The factory is meant to seed a routine with steps.');
    }
    await RoutineStep.update(step.id, { minutes: step.minutes + minutes });
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('a car morning, which has no service to cancel', () => {
    it('is never announced as a cancellation', async () => {
        const occurrence = await dueMorning(TransportMode.CAR);
        useProvider({ status: 'REPLAN' });
        const sent = recordPushes();

        await monitor().tick();

        // `REPLAN` means "route it again", not "the trip is gone". Telling
        // somebody who drives to work that their service is cancelled is both
        // false and unactionable: there is no service.
        expect(noticesIn(sent)).toEqual([]);
        const after = await ScheduleOccurrence.findOneBy({ id: occurrence.id });
        expect(after?.replacedJourney).toBeNull();
    });

    it('is re-routed rather than sent through the replacement chooser', async () => {
        const occurrence = await dueMorning(TransportMode.CAR);
        useProvider({ status: 'REPLAN' });
        recordPushes();

        const result = await monitor().tick();

        // The pass has to complete. Routed through the cancellation path it
        // would stop at `OUTSIDE_WINDOW` whenever the new departure matched the
        // old one, which for an unchanged forecast is most nights, and the alarm
        // would keep a time nothing had re-examined.
        expect(result.failed).toBe(0);
        expect(result.claimed).toBe(1);
        const after = await ScheduleOccurrence.findOneBy({ id: occurrence.id });
        expect(after?.planSnapshot?.journey?.source).toBe('FIXTURE');
        expect(after?.lastCheckedAt?.getTime()).toBeGreaterThan(
            occurrence.lastCheckedAt?.getTime() ?? 0,
        );
    });

    it('keeps being checked rather than stalling on its claim lease', async () => {
        const occurrence = await dueMorning(TransportMode.CAR);
        useProvider({ status: 'REPLAN' });
        recordPushes();

        await monitor().tick();

        const after = await ScheduleOccurrence.findOneBy({ id: occurrence.id });
        expect(after?.state).toBe(OccurrenceState.ARMED);
        expect(after?.nextCheckAt).not.toBeNull();
    });
});

describe('what a driver is told, and in what words', () => {
    it('is never told a service is late, because there is no service', async () => {
        /*
         * A car leg carries `delaySeconds` as congestion against free flow, and
         * a hardcoded `fromName: 'Origin'` because a road has no service name.
         * Routing the car through REPLAN reached the delay branch for the first
         * time, which put both together and told people who drive to work that
         * "Origin is 12 minutes late". Congestion is the ordinary state of a
         * road at 07:30, and the plan has already priced it in.
         */
        await dueMorning(TransportMode.CAR);
        useProvider({ status: 'REPLAN' });
        const sent = recordPushes();

        await monitor().tick();

        expect(noticesIn(sent)).toEqual([]);
        expect(JSON.stringify(sent)).not.toContain('Origin');
    });
});

describe('a fixed travel time, which has no journey at all', () => {
    it('is never announced as a cancellation', async () => {
        // Nothing can disrupt a number the user typed in, and there is no
        // provider to ask about it. What a FIXED plan actually stores is a
        // journey of null, which used to reach the monitor as the same null it
        // read as "gone".
        const occurrence = await dueMorning(TransportMode.FIXED, { fixedTravelMinutes: 40 });
        await stripJourney(occurrence);
        useProvider({ status: 'GONE' });
        const sent = recordPushes();

        await monitor().tick();

        expect(noticesIn(sent)).toEqual([]);
    });

    it('is still re-checked, so a routine edit reaches it', async () => {
        const occurrence = await dueMorning(TransportMode.FIXED, { fixedTravelMinutes: 40 });
        await stripJourney(occurrence);
        useProvider({ status: 'GONE' });
        recordPushes();

        const result = await monitor().tick();

        expect(result.failed).toBe(0);
        const after = await ScheduleOccurrence.findOneBy({ id: occurrence.id });
        expect(after?.state).toBe(OccurrenceState.ARMED);
        expect(after?.nextCheckAt).not.toBeNull();
    });
});

describe('whether a fixed-travel morning is allowed to move', () => {
    it('may ring earlier without an opt-in about trains', async () => {
        /*
         * The three settings govern whether a *disruption* may move an alarm,
         * and this mode has none. Naming the reason honestly moved fixed-travel
         * schedules from the cancellation opt-in onto the delay one, and with it
         * off, an alarm that had worked out it should ring sooner was refused
         * and said nothing. A recomputation of the user's own arithmetic is not
         * something to be cautious about.
         */
        const occurrence = await dueMorning(TransportMode.FIXED, { fixedTravelMinutes: 40 });
        await stripJourney(occurrence);
        // Every opt-in off, which is the default a device that never answered
        // the onboarding question keeps.
        await Device.update(occurrence.deviceId, {
            allowLaterWakeOnDelay: false,
            allowLaterWakeOnCancellation: false,
            allowEarlierWakeOnTraffic: false,
        });
        // A routine that now takes two hours longer than the plan assumed, so
        // the recomputed wake time is much earlier.
        await lengthenRoutine(occurrence, 120);
        useProvider({ status: 'GONE' });
        recordPushes();

        await monitor().tick();

        const after = await ScheduleOccurrence.findOneBy({ id: occurrence.id });
        expect(after?.currentWakeAt?.getTime()).toBeLessThan(
            occurrence.currentWakeAt?.getTime() ?? 0,
        );
    });
});

describe('a rail morning whose trip really has gone', () => {
    it('is still announced as a cancellation', async () => {
        // The case all of the above must not break. Rail is the mode where a
        // trip that cannot be reconstructed genuinely means it is not running.
        await dueMorning(TransportMode.PUBLIC_TRANSPORT);
        useProvider({ status: 'GONE' });
        const sent = recordPushes();

        await monitor().tick();

        const notices = noticesIn(sent);
        expect(notices).toHaveLength(1);
        const notice = notices[0];
        if (notice?.type === PUSH_MESSAGE_TYPE.DISRUPTION_NOTICE) {
            expect(notice.kind).toBe('CANCELLATION');
        }
    });

    it('looks for a replacement, and records what was lost when it moves', async () => {
        const occurrence = await dueMorning(TransportMode.PUBLIC_TRANSPORT);
        await Device.update(occurrence.deviceId, { allowLaterWakeOnCancellation: true });
        useProvider({ status: 'GONE' });
        recordPushes();

        await monitor().tick();

        const after = await ScheduleOccurrence.findOneBy({ id: occurrence.id });
        // A screen showing only the replacement leaves somebody looking for a
        // train that is not coming.
        expect(after?.replacedJourney).not.toBeNull();
    });

    it('names the train that stopped, not the walk to the station', async () => {
        /*
         * A door-to-door plan starts with a walk, and a journey cancelled as a
         * whole flags no single leg, so the fallback to `legs[0]` named that
         * walk. NS gives an access leg no service name, and the server filled
         * one in, so a cancelled train reached a Dutch lock screen as
         * "Origin is not running".
         */
        const occurrence = await dueMorning(TransportMode.PUBLIC_TRANSPORT);
        await Device.update(occurrence.deviceId, { allowLaterWakeOnCancellation: true });
        await withLegs(occurrence, [
            { type: LegType.WALK, fromName: '', toName: 'Utrecht Centraal' },
            { type: LegType.TRAIN, name: 'Intercity 3052', fromName: 'Utrecht Centraal' },
        ]);
        useProvider({ status: 'GONE' });
        const sent = recordPushes();

        await monitor().tick();

        // The move carries what was lost, since that is the message the ring
        // screen reads from: "your Intercity 3052 is not running, take ...".
        const moved = sent.find((message) => message.type === PUSH_MESSAGE_TYPE.WAKE_CHANGED);
        if (moved?.type !== PUSH_MESSAGE_TYPE.WAKE_CHANGED) {
            throw new Error('The alarm should have been moved to a replacement.');
        }
        expect(moved.cancelledService).toBe('Intercity 3052');
    });
});

describe('an occurrence the monitor can do nothing with', () => {
    it('stops being claimed instead of taking a slot on every tick', async () => {
        // Armed with no plan is a state nothing should be able to produce. It
        // used to be answered by returning early, which left the five minute
        // claim lease as the row's next check, so one impossible occurrence was
        // re-claimed every five minutes until its morning had passed.
        const occurrence = await dueMorning(TransportMode.PUBLIC_TRANSPORT);
        await ScheduleOccurrence.update(occurrence.id, { planSnapshot: null });
        useProvider({ status: 'CURRENT', journey: null as unknown as Journey });

        const result = await monitor().tick();

        expect(result.claimed).toBe(1);
        const after = await ScheduleOccurrence.findOneBy({ id: occurrence.id });
        expect(after?.state).toBe(OccurrenceState.CANCELLED);
        expect(after?.nextCheckAt).toBeNull();
    });
});

describe('what a pass records when a provider will not answer', () => {
    it('leaves the alarm alone and comes back, rather than moving on nothing', async () => {
        const occurrence = await dueMorning(TransportMode.CAR);
        const provider = new StubProvider({ status: 'REPLAN' });
        vi.spyOn(provider, 'plan').mockRejectedValue(new Error('TomTom is down'));
        vi.spyOn(TransportProviderFactory, 'forMode').mockReturnValue(provider);
        const sent = recordPushes();

        await monitor().tick();

        const after = await ScheduleOccurrence.findOneBy({ id: occurrence.id });
        // The time it already holds came from the last answer that worked, which
        // is a better guess than anything an outage can produce.
        expect(after?.currentWakeAt?.getTime()).toBe(occurrence.currentWakeAt?.getTime());
        expect(after?.nextCheckAt).not.toBeNull();
        expect(noticesIn(sent)).toEqual([]);
    });
});

describe('the reason a change is recorded under', () => {
    it('is traffic for a car, never a cancellation', async () => {
        const occurrence = await dueMorning(TransportMode.CAR);
        await Device.update(occurrence.deviceId, { allowEarlierWakeOnTraffic: true });
        useProvider({ status: 'REPLAN' });
        recordPushes();

        await monitor().tick();

        const events = await AlarmEvent.findBy({ occurrenceId: occurrence.id });
        for (const event of events) {
            expect(event.reason).not.toBe(WakeChangeReason.CANCELLATION);
        }
    });
});
