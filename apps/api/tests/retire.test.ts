import { describe, expect, it } from 'vitest';
import { AlarmEventType, API_ENDPOINTS, OccurrenceState, TransportMode } from '@alarm/types';
import type { ListOccurrencesResponse } from '@alarm/types';

import AlarmEvent from '../src/app/models/AlarmEvent.entity';
import ScheduleOccurrence from '../src/app/models/ScheduleOccurrence.entity';
import { DisruptionSweepService } from '../src/app/services/DisruptionSweepService';
import { MonitorService } from '../src/app/services/MonitorService';
import { asDevice, data } from './support/client';
import { StubNsModule } from './support/disruptions';
import { seedCommute, seedOccurrence, seedSchedule } from './support/factories';

/**
 * A morning ends when its wake time arrives.
 *
 * Nothing said so before. `FIRED` and `DISMISSED` sat in the enum unused, so a
 * morning stayed `ARMED` for ever after it rang. The phone read that stale row
 * first, never planned the next morning because the list was not empty, and
 * tried to arm a time in the past, which Android refused and Today reported as
 * this device being unable to hold an alarm. Every alarm after the first one
 * depended on nobody ever opening the app.
 */
const AN_HOUR = 60 * 60 * 1000;

async function morning(currentWakeAt: Date, state = OccurrenceState.ARMED) {
    const { device, token, home, work, routine } = await seedCommute();
    const schedule = await seedSchedule(
        device,
        { origin: home, destination: work, routine },
        { mode: TransportMode.PUBLIC_TRANSPORT },
    );
    const occurrence = await seedOccurrence(schedule, {
        state,
        currentWakeAt,
        nextCheckAt: null,
    });
    return { token, occurrence };
}

/** A tick that asks NS nothing: the sweep is not what these tests are about. */
function monitor(): MonitorService {
    return new MonitorService(new DisruptionSweepService(new StubNsModule([])));
}

describe('a morning whose wake time has passed', () => {
    it('is retired by the next tick', async () => {
        const { occurrence } = await morning(new Date(Date.now() - AN_HOUR));

        const result = await monitor().tick();

        expect(result.retired).toBe(1);
        const after = await ScheduleOccurrence.findOneBy({ id: occurrence.id });
        expect(after?.state).toBe(OccurrenceState.FIRED);
    });

    it('is retired even when it was skipped, because it is equally over', async () => {
        const { occurrence } = await morning(
            new Date(Date.now() - AN_HOUR),
            OccurrenceState.SKIPPED,
        );

        await monitor().tick();

        const after = await ScheduleOccurrence.findOneBy({ id: occurrence.id });
        expect(after?.state).toBe(OccurrenceState.FIRED);
    });

    it('is not listed to the phone, whether or not the tick has run', async () => {
        /*
         * The tick has been down in production before. A stale row reaching the
         * phone is the whole failure, so the read refuses it on its own rather
         * than trusting a sweep to have happened.
         */
        const { token, occurrence } = await morning(new Date(Date.now() - AN_HOUR));

        const listed = await asDevice(token).get(API_ENDPOINTS.OCCURRENCES.LIST);
        const next = await asDevice(token).get(API_ENDPOINTS.OCCURRENCES.NEXT);

        expect(data<ListOccurrencesResponse>(listed).map((each) => each.id)).not.toContain(
            occurrence.id,
        );
        expect(next.status).toBe(404);
    });

    it('leaves a morning still to come exactly as it was', async () => {
        // The other half: retiring must never touch tonight's alarm.
        const { token, occurrence } = await morning(new Date(Date.now() + 3 * AN_HOUR));

        const result = await monitor().tick();

        expect(result.retired).toBe(0);
        const after = await ScheduleOccurrence.findOneBy({ id: occurrence.id });
        expect(after?.state).toBe(OccurrenceState.ARMED);
        const listed = await asDevice(token).get(API_ENDPOINTS.OCCURRENCES.LIST);
        expect(data<ListOccurrencesResponse>(listed).map((each) => each.id)).toContain(
            occurrence.id,
        );
    });
});

describe('the phone reporting that the alarm was switched off', () => {
    it('closes the morning and writes it in the trail', async () => {
        const { token, occurrence } = await morning(new Date(Date.now() - 5 * 60 * 1000));

        const response = await asDevice(token).post(
            API_ENDPOINTS.OCCURRENCES.DISMISSED(occurrence.id),
            {},
        );

        expect(response.status).toBe(200);
        const after = await ScheduleOccurrence.findOneBy({ id: occurrence.id });
        expect(after?.state).toBe(OccurrenceState.DISMISSED);
        const event = await AlarmEvent.findOneBy({
            occurrenceId: occurrence.id,
            type: AlarmEventType.DISMISSED,
        });
        expect(event).not.toBeNull();
    });

    it('is harmless to repeat, and after the tick has already retired the row', async () => {
        // A phone that was offline at 06:00 may report hours later. The answer
        // is still "noted", not a conflict it has nothing useful to do with.
        const { token, occurrence } = await morning(new Date(Date.now() - AN_HOUR));
        await monitor().tick();

        const first = await asDevice(token).post(
            API_ENDPOINTS.OCCURRENCES.DISMISSED(occurrence.id),
            {},
        );
        const second = await asDevice(token).post(
            API_ENDPOINTS.OCCURRENCES.DISMISSED(occurrence.id),
            {},
        );

        expect(first.status).toBe(200);
        expect(second.status).toBe(200);
        const events = await AlarmEvent.findBy({
            occurrenceId: occurrence.id,
            type: AlarmEventType.DISMISSED,
        });
        expect(events).toHaveLength(1);
    });

    it('cannot be aimed at a morning owned by another device', async () => {
        const { occurrence } = await morning(new Date(Date.now() - AN_HOUR));
        const { token: other } = await seedCommute();

        const response = await asDevice(other).post(
            API_ENDPOINTS.OCCURRENCES.DISMISSED(occurrence.id),
            {},
        );

        expect(response.status).toBe(404);
    });
});
