import { describe, expect, it } from 'vitest';
import {
    API_ENDPOINTS,
    JourneyStatus,
    LegType,
    OccurrenceState,
    PUSH_MESSAGE_TYPE,
    SimulationKind,
    WakeChangeReason,
} from '@alarm/types';
import type { Journey, PushMessage } from '@alarm/types';

import AlarmEvent from '../src/app/models/AlarmEvent.entity';
import type Device from '../src/app/models/Device.entity';
import ScheduleOccurrence from '../src/app/models/ScheduleOccurrence.entity';
import { AppDataSource } from '../src/database/typeorm-db';
import { DisruptionSweepService } from '../src/app/services/DisruptionSweepService';
import { MonitorService } from '../src/app/services/MonitorService';
import { PushDeliveryService } from '../src/app/services/PushDeliveryService';
import { PushService } from '../src/app/services/PushService';
import { SimulationService } from '../src/app/services/SimulationService';
import { RoutineService } from '../src/app/services/RoutineService';
import { ScheduleService } from '../src/app/services/ScheduleService';
import type { PushOutcome } from '../src/app/services/PushService';
import { StubNsModule, disruption, stationlessDisruption } from './support/disruptions';
import { asDevice } from './support/client';
import { seedCommute, seedOccurrence, seedSchedule } from './support/factories';

const MINUTE = 60 * 1000;

/** A schedule with an armed morning already on it. */
async function armedMorning(overrides = {}): Promise<ScheduleOccurrence> {
    const { device, home, work, routine } = await seedCommute();
    const schedule = await seedSchedule(device, { origin: home, destination: work, routine });
    return seedOccurrence(schedule, overrides);
}

function sweeper(feed: unknown[]): DisruptionSweepService {
    return new DisruptionSweepService(new StubNsModule(feed));
}

describe('disruption sweep', () => {
    it('promotes an occurrence travelling through a disrupted station', async () => {
        const occurrence = await armedMorning();
        const now = new Date();

        const result = await sweeper([disruption(['UT'], new Date(now.getTime() - MINUTE))]).sweep(
            now,
        );

        expect(result).toEqual({ disruptions: 1, promoted: 1 });
        const promoted = await ScheduleOccurrence.findOneBy({ id: occurrence.id });
        expect(promoted?.nextCheckAt?.getTime()).toBe(now.getTime());
    });

    it('ignores a disruption somewhere this journey never goes', async () => {
        const occurrence = await armedMorning();
        const before = occurrence.nextCheckAt?.getTime();

        const result = await sweeper([disruption(['GVC'], new Date())]).sweep(new Date());

        expect(result).toEqual({ disruptions: 1, promoted: 0 });
        const after = await ScheduleOccurrence.findOneBy({ id: occurrence.id });
        expect(after?.nextCheckAt?.getTime()).toBe(before);
    });

    /**
     * The assertion that protects the API bill.
     *
     * A disruption lasting six hours must not promote the same occurrence every
     * minute. Nothing about that failure is visible: alarms still move, no error
     * is raised, and the only symptom is the per-night call count going from
     * about 35 to 360 and a 429 in the middle of someone's night.
     */
    it('does not promote again for a disruption already seen', async () => {
        const now = new Date();
        const publishedAt = new Date(now.getTime() - 10 * MINUTE);
        const occurrence = await armedMorning({
            // Checked after the disruption was published, so this occurrence has
            // already taken it into account.
            lastCheckedAt: new Date(now.getTime() - 5 * MINUTE),
            nextCheckAt: new Date(now.getTime() + 25 * MINUTE),
        });
        const before = occurrence.nextCheckAt?.getTime();

        const result = await sweeper([disruption(['UT'], publishedAt)]).sweep(now);

        expect(result).toEqual({ disruptions: 1, promoted: 0 });
        const after = await ScheduleOccurrence.findOneBy({ id: occurrence.id });
        expect(after?.nextCheckAt?.getTime()).toBe(before);
    });

    it('promotes again when NS republishes the same disruption', async () => {
        // `releaseTime` moves when NS updates a disruption, and an update is new
        // information: the cancellation may now be a replacement bus.
        const now = new Date();
        const occurrence = await armedMorning({
            lastCheckedAt: new Date(now.getTime() - 5 * MINUTE),
            nextCheckAt: new Date(now.getTime() + 25 * MINUTE),
        });

        const result = await sweeper([
            disruption(['UT'], new Date(now.getTime() - MINUTE)),
        ]).sweep(now);

        expect(result).toEqual({ disruptions: 1, promoted: 1 });
        const promoted = await ScheduleOccurrence.findOneBy({ id: occurrence.id });
        expect(promoted?.nextCheckAt?.getTime()).toBe(now.getTime());
    });

    it('leaves an occurrence that is already due alone', async () => {
        // It will be claimed by this same tick anyway, so rewriting its next
        // check would be a promotion that changes nothing.
        const now = new Date();
        const due = new Date(now.getTime() - MINUTE);
        await armedMorning({ nextCheckAt: due, lastCheckedAt: new Date(now.getTime() - 30 * MINUTE) });

        const result = await sweeper([disruption(['UT'], now)]).sweep(now);

        expect(result).toEqual({ disruptions: 1, promoted: 0 });
    });

    it('does nothing with a disruption that names no stations', async () => {
        // A national notice. Guessing which journeys it affects would promote
        // every armed occurrence at once.
        await armedMorning();

        const result = await sweeper([stationlessDisruption(new Date())]).sweep(new Date());

        expect(result).toEqual({ disruptions: 1, promoted: 0 });
    });

    it('never promotes a car journey, and does not even ask', async () => {
        // It used to fetch the feed and then match nothing against it. A car
        // journey has no station a rail disruption could touch, so the call was
        // spent to learn something already known from the row.
        await armedMorning({ watchedStationCodes: null });

        const result = await sweeper([disruption(['UT'], new Date())]).sweep(new Date());

        expect(result).toEqual({ disruptions: 0, promoted: 0 });
    });

    it('does not take the tick down when the feed fails', async () => {
        // One NS call covers everyone, so losing it costs a minute of disruption
        // visibility. Aborting the pass would cost the cadence sweep too.
        await armedMorning();
        const failing = new DisruptionSweepService({
            disruptions: () => Promise.reject(new Error('NS is down')),
        } as unknown as StubNsModule);

        const result = await new MonitorService(failing).tick();

        expect(result.disruptions).toBe(0);
        expect(result.failed).toBe(0);
    });
});

describe('claiming, with more than one worker', () => {
    /**
     * The assertion behind `FOR UPDATE SKIP LOCKED`.
     *
     * Two API instances run the same loop. If both could claim one occurrence,
     * the night's NS budget would be spent twice and two passes would write the
     * same row, so this is the property that makes running a second instance
     * safe rather than merely tempting.
     */
    it('never hands the same occurrence to two ticks at once', async () => {
        const { device, home, work, routine } = await seedCommute();
        const schedule = await seedSchedule(device, { origin: home, destination: work, routine });
        const due = new Date(Date.now() - MINUTE);
        for (const date of ['2026-08-20', '2026-08-21', '2026-08-22', '2026-08-23']) {
            await seedOccurrence(schedule, { date, nextCheckAt: due });
        }

        // The private claim, reached deliberately: the alternative is a full
        // tick, which would call NS four times to prove something about locking.
        const claim = async (): Promise<string[]> => {
            const monitor = new MonitorService(sweeper([]));
            return (monitor as unknown as { claim: (now: Date) => Promise<string[]> }).claim(
                new Date(),
            );
        };

        const [first, second] = await Promise.all([claim(), claim()]);

        expect([...first, ...second].length).toBe(4);
        expect(new Set([...first, ...second]).size).toBe(4);
    });

    it('writes a lease, so a slow pass is not claimed again', async () => {
        const { device, home, work, routine } = await seedCommute();
        const schedule = await seedSchedule(device, { origin: home, destination: work, routine });
        const occurrence = await seedOccurrence(schedule, {
            nextCheckAt: new Date(Date.now() - MINUTE),
        });

        const monitor = new MonitorService(sweeper([]));
        const now = new Date();
        await (monitor as unknown as { claim: (at: Date) => Promise<string[]> }).claim(now);

        const leased = await ScheduleOccurrence.findOneBy({ id: occurrence.id });
        expect(leased?.nextCheckAt?.getTime()).toBeGreaterThan(now.getTime());
    });
});

/** Records what it was asked to send, and answers with `outcome`. */
class RecordingPushService extends PushService {
    readonly sent: PushMessage[] = [];

    constructor(private readonly outcome: PushOutcome) {
        super();
    }

    override send(_device: Device, message: PushMessage): Promise<PushOutcome> {
        this.sent.push(message);
        return Promise.resolve(this.outcome);
    }
}

describe('push delivery', () => {
    async function deliverFor(
        occurrence: ScheduleOccurrence,
        outcome: PushOutcome = 'SENT',
    ): Promise<{ result: string; push: RecordingPushService }> {
        const push = new RecordingPushService(outcome);
        const device = await AppDataSource.getRepository('devices').findOneBy({
            id: occurrence.deviceId,
        });
        const result = await new PushDeliveryService(push).deliver(
            occurrence,
            device as Device,
            'Europe/Amsterdam',
            { reason: WakeChangeReason.DELAY, simulated: false },
        );
        return { result, push };
    }

    it('records what was sent, so the same time is not sent twice', async () => {
        const occurrence = await armedMorning({
            deviceAckedWakeAt: new Date(Date.now() + 2 * 60 * MINUTE),
        });

        const { result, push } = await deliverFor(occurrence);

        expect(result).toBe('SENT');
        expect(push.sent).toHaveLength(1);
        const saved = await ScheduleOccurrence.findOneBy({ id: occurrence.id });
        expect(saved?.pushedWakeAt?.getTime()).toBe(occurrence.currentWakeAt?.getTime());
        expect(saved?.lastPushedAt).not.toBeNull();
    });

    /**
     * The property that makes a dropped push survivable without a queue.
     *
     * A failed send must be indistinguishable from one that never happened, or
     * the next tick would believe the phone had been told.
     */
    it('writes nothing when the send fails', async () => {
        const occurrence = await armedMorning({
            deviceAckedWakeAt: new Date(Date.now() + 2 * 60 * MINUTE),
        });

        const { result } = await deliverFor(occurrence, 'FAILED');

        expect(result).toBe('FAILED');
        const saved = await ScheduleOccurrence.findOneBy({ id: occurrence.id });
        expect(saved?.pushedWakeAt).toBeNull();
        expect(saved?.lastPushedAt).toBeNull();
    });

    it('says nothing to a device that already holds this time', async () => {
        const occurrence = await armedMorning();
        occurrence.deviceAckedWakeAt = occurrence.currentWakeAt;
        await occurrence.save();

        const { result, push } = await deliverFor(occurrence);

        expect(result).toBe('NOT_NEEDED');
        expect(push.sent).toHaveLength(0);
    });

    it('holds off while a push for the same time is still in flight', async () => {
        const occurrence = await armedMorning({
            deviceAckedWakeAt: new Date(Date.now() + 2 * 60 * MINUTE),
            lastPushedAt: new Date(Date.now() - MINUTE),
        });
        occurrence.pushedWakeAt = occurrence.currentWakeAt;
        await occurrence.save();

        const { result, push } = await deliverFor(occurrence);

        expect(result).toBe('IN_FLIGHT');
        expect(push.sent).toHaveLength(0);
    });

    it('retries once the window has passed with no acknowledgement', async () => {
        const occurrence = await armedMorning({
            deviceAckedWakeAt: new Date(Date.now() + 2 * 60 * MINUTE),
            lastPushedAt: new Date(Date.now() - 30 * MINUTE),
        });
        occurrence.pushedWakeAt = occurrence.currentWakeAt;
        await occurrence.save();

        const { result, push } = await deliverFor(occurrence);

        expect(result).toBe('SENT');
        expect(push.sent).toHaveLength(1);
    });

    it('reuses the recorded reason on a retry rather than deriving a new one', async () => {
        // The delay that caused the change may have moved on since. Reading the
        // timetable as it looks now would explain a different morning.
        const occurrence = await armedMorning({
            deviceAckedWakeAt: new Date(Date.now() + 2 * 60 * MINUTE),
        });
        await AlarmEvent.create({
            occurrenceId: occurrence.id,
            type: 'MOVED_LATER' as never,
            fromAt: null,
            toAt: occurrence.currentWakeAt,
            reason: WakeChangeReason.CANCELLATION,
            simulated: true,
            message: 'SIMULATED: A service was cancelled, so the alarm moved to 07:05.',
        }).save();

        const push = new RecordingPushService('SENT');
        const device = await AppDataSource.getRepository('devices').findOneBy({
            id: occurrence.deviceId,
        });
        const result = await new PushDeliveryService(push).deliver(
            occurrence,
            device as Device,
            'Europe/Amsterdam',
            null,
        );

        expect(result).toBe('SENT');
        // Narrowed rather than cast: `PushMessage` is a union now, and the
        // assertion is about the wake-change arm of it.
        const sent = push.sent[0];
        expect(sent?.type).toBe(PUSH_MESSAGE_TYPE.WAKE_CHANGED);
        if (sent?.type === PUSH_MESSAGE_TYPE.WAKE_CHANGED) {
            expect(sent.reason).toBe(WakeChangeReason.CANCELLATION);
            // Read off the row rather than recomputed, which is the whole point
            // of a retry reusing the recorded event.
            expect(sent.simulated).toBe(true);
        }
    });

    it('says nothing when there is no recorded change to retry', async () => {
        const occurrence = await armedMorning({
            deviceAckedWakeAt: new Date(Date.now() + 2 * 60 * MINUTE),
        });

        const push = new RecordingPushService('SENT');
        const device = await AppDataSource.getRepository('devices').findOneBy({
            id: occurrence.deviceId,
        });
        const result = await new PushDeliveryService(push).deliver(
            occurrence,
            device as Device,
            'Europe/Amsterdam',
            null,
        );

        expect(result).toBe('NOTHING_TO_SAY');
        expect(push.sent).toHaveLength(0);
    });

    it('refuses to push an alarm that has already rung', async () => {
        const occurrence = await armedMorning({
            state: OccurrenceState.ARMED,
            currentWakeAt: new Date(Date.now() - MINUTE),
            deviceAckedWakeAt: new Date(Date.now() - 60 * MINUTE),
        });

        const { result, push } = await deliverFor(occurrence);

        expect(result).toBe('NOT_NEEDED');
        expect(push.sent).toHaveLength(0);
    });
});

describe('how often the same news is repeated', () => {
    /** A rail journey running `minutes` late, which is what a notice reads. */
    function delayed(minutes: number): Journey {
        return {
            id: 'j', ctxRecon: 'ctx', status: JourneyStatus.DISRUPTION,
            departureAt: '', arrivalAt: '', transferCount: 0, source: 'NS',
            watchedStationCodes: ['UT'],
            legs: [{
                type: LegType.TRAIN, name: 'IC 3051', fromName: 'Utrecht', toName: 'Amsterdam',
                plannedDeparture: '', actualDeparture: '', plannedArrival: '', actualArrival: '',
                delaySeconds: minutes * 60, cancelled: false,
            }],
        };
    }

    async function notifyWith(
        occurrence: ScheduleOccurrence,
        push: PushService,
        minutes: number,
    ): Promise<string> {
        const device = await AppDataSource.getRepository('devices').findOneBy({
            id: occurrence.deviceId,
        });
        return new PushDeliveryService(push).notify(
            occurrence,
            device as Device,
            delayed(minutes),
            false,
            false,
        );
    }

    it('says nothing new when a delay only breathes', async () => {
        /*
         * A reported delay drifts a minute either way between checks, and near
         * the alarm the monitor looks every three minutes. Deduplicating on the
         * exact number deduplicated nothing: the same news woke the radio all
         * morning. TomTom's traffic figure wobbles harder still.
         */
        const occurrence = await armedMorning();
        const push = new RecordingPushService('SENT');

        expect(await notifyWith(occurrence, push, 12)).toBe('SENT');
        expect(await notifyWith(occurrence, push, 13)).toBe('NOT_NEEDED');
        expect(await notifyWith(occurrence, push, 11)).toBe('NOT_NEEDED');
        expect(push.sent).toHaveLength(1);
    });

    it('says so when it grows into something worth knowing', async () => {
        const occurrence = await armedMorning();
        const push = new RecordingPushService('SENT');

        expect(await notifyWith(occurrence, push, 12)).toBe('SENT');
        expect(await notifyWith(occurrence, push, 21)).toBe('SENT');
        expect(push.sent).toHaveLength(2);
    });
});

describe('editing a schedule discards what it already armed', () => {
    /**
     * The failure this prevents was reported from a real morning: the schedule
     * said 09:00, the list said the alarm was 05:43, and both were telling the
     * truth. Nothing errored, so only an assertion catches it coming back.
     */
    it('drops an upcoming occurrence when the deadline moves', async () => {
        const { device, home, work, routine } = await seedCommute();
        const schedule = await seedSchedule(device, { origin: home, destination: work, routine });
        const occurrence = await seedOccurrence(schedule, { date: futureDate(4) });

        await new ScheduleService().update(schedule, { arrivalTime: '09:00' });

        expect(await ScheduleOccurrence.findOneBy({ id: occurrence.id })).toBeNull();
    });

    it('drops it when the routine behind it changes', async () => {
        // The routine is the other half of the arithmetic: the journey says when
        // to leave, the routine says how long before that to wake.
        const { device, home, work, routine } = await seedCommute();
        const schedule = await seedSchedule(device, { origin: home, destination: work, routine });
        const occurrence = await seedOccurrence(schedule, { date: futureDate(4) });

        await new RoutineService().update(routine, {
            steps: [{ label: 'Shower', minutes: 40, enabled: true }],
        });

        expect(await ScheduleOccurrence.findOneBy({ id: occurrence.id })).toBeNull();
    });

    it('keeps it when only the name changes', async () => {
        // Renaming must not throw away an armed morning and spend a provider
        // call rebuilding an identical plan.
        const { device, home, work, routine } = await seedCommute();
        const schedule = await seedSchedule(device, { origin: home, destination: work, routine });
        const occurrence = await seedOccurrence(schedule, { date: futureDate(4) });

        await new ScheduleService().update(schedule, { name: 'Mornings' });

        expect(await ScheduleOccurrence.findOneBy({ id: occurrence.id })).not.toBeNull();
    });

    it('leaves a morning that has already happened alone', async () => {
        // A past occurrence records an alarm that rang. Rewriting that is a
        // different mistake.
        const { device, home, work, routine } = await seedCommute();
        const schedule = await seedSchedule(device, { origin: home, destination: work, routine });
        const occurrence = await seedOccurrence(schedule, { date: futureDate(-3) });

        await new ScheduleService().update(schedule, { arrivalTime: '09:00' });

        expect(await ScheduleOccurrence.findOneBy({ id: occurrence.id })).not.toBeNull();
    });
});

/** An ISO date some days from today, for occurrences that are not about time of day. */
function futureDate(days: number): string {
    const date = new Date();
    date.setDate(date.getDate() + days);
    return date.toISOString().slice(0, 10);
}

describe('simulated disruptions', () => {
    const simulations = new SimulationService();

    /**
     * The point of the whole feature: only the timetable is invented.
     *
     * A simulated delay must reach the engine as a delayed journey, so that
     * everything downstream, the risk buffer included, behaves as it would for a
     * real one. A version that only moved the wake time would test arithmetic
     * and prove nothing about the product.
     */
    it('moves the journey later and marks it disrupted', () => {
        const occurrence = ScheduleOccurrence.create({
            simulationKind: SimulationKind.DELAY,
            simulationMinutes: 20,
            simulationExpiresAt: new Date(Date.now() + 30 * MINUTE),
        });

        const journey = simulations.apply(occurrence, sampleJourney(), new Date());

        expect(journey?.status).toBe(JourneyStatus.DISRUPTION);
        expect(journey?.departureAt).toBe('2026-08-20T08:20:00.000+02:00');
        expect(journey?.arrivalAt).toBe('2026-08-20T09:10:00.000+02:00');
        // Every leg, not only the first: a train that leaves late arrives late,
        // and shifting one end invents a journey that gains time in transit.
        expect(journey?.legs[0]?.actualArrival).toBe('2026-08-20T09:10:00.000+02:00');
        expect(journey?.legs[0]?.delaySeconds).toBe(20 * 60);
    });

    it('makes a cancellation unreconstructable, which forces a re-plan', () => {
        const occurrence = ScheduleOccurrence.create({
            simulationKind: SimulationKind.CANCELLATION,
            simulationExpiresAt: new Date(Date.now() + 30 * MINUTE),
        });

        expect(simulations.apply(occurrence, sampleJourney(), new Date())).toBeNull();
    });

    /**
     * The safety property. A simulation left staged overnight would be an alarm
     * that has quietly stopped tracking reality, which is the exact failure this
     * product exists to prevent.
     */
    it('is ignored once it has expired', () => {
        const occurrence = ScheduleOccurrence.create({
            simulationKind: SimulationKind.CANCELLATION,
            simulationExpiresAt: new Date(Date.now() - MINUTE),
        });

        // Undefined, not null: "nothing staged" and "simulated into a
        // cancellation" must stay distinguishable to the caller.
        expect(simulations.apply(occurrence, sampleJourney(), new Date())).toBeUndefined();
    });

    it('does nothing when none is staged', () => {
        const occurrence = ScheduleOccurrence.create({ simulationKind: null });

        expect(simulations.apply(occurrence, sampleJourney(), new Date())).toBeUndefined();
    });

    it('is applied once, and stays on the row until it expires', async () => {
        const occurrence = await armedMorning({
            simulationKind: SimulationKind.DELAY,
            simulationMinutes: 20,
            simulationExpiresAt: new Date(Date.now() + 30 * MINUTE),
            nextCheckAt: new Date(Date.now() - MINUTE),
        });

        await new MonitorService(sweeper([])).tick();

        const after = await ScheduleOccurrence.findOneBy({ id: occurrence.id });
        // Marked used rather than forgotten. Clearing it erased the only sign
        // that the plan was invented, and arming then re-planned the invention
        // away seconds later, which read as the tick doing nothing.
        expect(after?.simulationAppliedAt).not.toBeNull();
        expect(after?.simulationKind).toBe(SimulationKind.DELAY);
    });

    it('is not applied twice', () => {
        const occurrence = ScheduleOccurrence.create({
            simulationKind: SimulationKind.DELAY,
            simulationMinutes: 20,
            simulationExpiresAt: new Date(Date.now() + 30 * MINUTE),
            simulationAppliedAt: new Date(),
        });

        expect(simulations.apply(occurrence, sampleJourney(), new Date())).toBeUndefined();
    });
});

/** A one-leg journey, enough to assert what a simulation did to it. */
function sampleJourney() {
    return {
        id: 'test-journey',
        ctxRecon: 'test-ctx',
        status: JourneyStatus.NORMAL,
        departureAt: '2026-08-20T08:00:00.000+02:00',
        arrivalAt: '2026-08-20T08:50:00.000+02:00',
        transferCount: 0,
        source: 'NS',
        watchedStationCodes: ['UT'],
        legs: [
            {
                type: LegType.TRAIN,
                fromName: 'Utrecht Centraal',
                toName: 'Amsterdam Zuid',
                plannedDeparture: '2026-08-20T08:00:00.000+02:00',
                actualDeparture: '2026-08-20T08:00:00.000+02:00',
                plannedArrival: '2026-08-20T08:50:00.000+02:00',
                actualArrival: '2026-08-20T08:50:00.000+02:00',
                delaySeconds: 0,
                cancelled: false,
            },
        ],
    };
}

describe('what the sweep costs when nothing is armed', () => {
    /**
     * The feed is one call per tick whatever the user count, which made it look
     * free. It was being spent every minute of the day, including the sixteen
     * hours when no alarm is armed at all.
     */
    it('does not ask NS anything when no occurrence is watching', async () => {
        let asked = 0;
        const counting = new DisruptionSweepService({
            disruptions: () => {
                asked += 1;
                return Promise.resolve([disruption(['UT'], new Date())]);
            },
        } as unknown as StubNsModule);

        await counting.sweep(new Date());

        expect(asked).toBe(0);
    });

    it('asks once when something is', async () => {
        let asked = 0;
        await armedMorning();

        const counting = new DisruptionSweepService({
            disruptions: () => {
                asked += 1;
                return Promise.resolve([disruption(['UT'], new Date())]);
            },
        } as unknown as StubNsModule);

        await counting.sweep(new Date());

        expect(asked).toBe(1);
    });

    it('ignores occurrences with no stations to watch', async () => {
        // A car journey has no station a rail disruption could touch, so a
        // deployment of drivers should never call the feed at all.
        let asked = 0;
        await armedMorning({ watchedStationCodes: null });

        const counting = new DisruptionSweepService({
            disruptions: () => {
                asked += 1;
                return Promise.resolve([]);
            },
        } as unknown as StubNsModule);

        await counting.sweep(new Date());

        expect(asked).toBe(0);
    });
});

describe('taking a simulation back', () => {
    /**
     * The button says "take it back", and until 2026-08-19 it only did half of
     * that: the fields were cleared and the invented cancellation stayed on
     * screen, because nothing scheduled a check to plan against reality again.
     *
     * Staging has always marked the occurrence due immediately. Clearing did
     * not, so an applied simulation kept its invented journey and its moved wake
     * time until the next band check, up to half an hour of the app disagreeing
     * with the message that said it had been cleared.
     */
    it('makes the occurrence due now, so the real journey comes back', async () => {
        const { device, token, home, work, routine } = await seedCommute();
        const schedule = await seedSchedule(device, {
            origin: home,
            destination: work,
            routine,
        });
        const occurrence = await seedOccurrence(schedule, {
            simulationKind: SimulationKind.CANCELLATION,
            simulationMinutes: null,
            simulationExpiresAt: new Date(Date.now() + 30 * MINUTE),
            // Already applied, which is the case that was broken. A staged one
            // that nothing has consumed had nothing to undo.
            simulationAppliedAt: new Date(),
            nextCheckAt: new Date(Date.now() + 30 * MINUTE),
        });

        const response = await asDevice(token)
            .post(API_ENDPOINTS.OCCURRENCES.SIMULATE(occurrence.id))
            .send({ kind: null });

        expect(response.status).toBe(200);

        const saved = await ScheduleOccurrence.findOneByOrFail({ id: occurrence.id });
        expect(saved.simulationKind).toBeNull();
        expect(saved.simulationAppliedAt).toBeNull();
        // Due, rather than merely sooner: the next tick is what re-plans.
        expect(saved.nextCheckAt?.getTime()).toBeLessThanOrEqual(Date.now());
    });
});
