import { describe, expect, it } from 'vitest';
import { OccurrenceState, WakeChangeReason } from '@alarm/types';
import type { PushMessage } from '@alarm/types';

import AlarmEvent from '../src/app/models/AlarmEvent.entity';
import type Device from '../src/app/models/Device.entity';
import ScheduleOccurrence from '../src/app/models/ScheduleOccurrence.entity';
import { AppDataSource } from '../src/database/typeorm-db';
import { DisruptionSweepService } from '../src/app/services/DisruptionSweepService';
import { MonitorService } from '../src/app/services/MonitorService';
import { PushDeliveryService } from '../src/app/services/PushDeliveryService';
import { PushService } from '../src/app/services/PushService';
import type { PushOutcome } from '../src/app/services/PushService';
import { StubNsModule, disruption, stationlessDisruption } from './support/disruptions';
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

    it('never promotes a car journey, which has no stations to match', async () => {
        await armedMorning({ watchedStationCodes: null });

        const result = await sweeper([disruption(['UT'], new Date())]).sweep(new Date());

        expect(result).toEqual({ disruptions: 1, promoted: 0 });
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

describe('push delivery', () => {
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
            { reason: WakeChangeReason.DELAY, message: 'A service is delayed.' },
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

    it('reuses the recorded sentence on a retry rather than inventing one', async () => {
        // The delay that caused the change may have moved on since. Describing
        // the timetable as it looks now would explain a different morning.
        const occurrence = await armedMorning({
            deviceAckedWakeAt: new Date(Date.now() + 2 * 60 * MINUTE),
        });
        await AlarmEvent.create({
            occurrenceId: occurrence.id,
            type: 'MOVED_LATER' as never,
            fromAt: null,
            toAt: occurrence.currentWakeAt,
            reason: WakeChangeReason.CANCELLATION,
            message: 'A service was cancelled, so the alarm moved to 07:05.',
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
        expect(push.sent[0]?.message).toBe('A service was cancelled, so the alarm moved to 07:05.');
        expect(push.sent[0]?.reason).toBe(WakeChangeReason.CANCELLATION);
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
