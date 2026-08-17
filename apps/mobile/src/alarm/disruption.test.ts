import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JourneyStatus, LegType, SimulationKind } from '@alarm/types';
import type { Journey, JourneyLeg, OccurrenceResponse } from '@alarm/types';

const store = new Map<string, string>();

vi.mock('@/utils/modules/Storage', () => ({
    default: {
        getItem: (key: string) => Promise.resolve(store.get(key) ?? null),
        setItem: (key: string, value: string) => {
            store.set(key, value);
            return Promise.resolve();
        },
        removeItem: (key: string) => {
            store.delete(key);
            return Promise.resolve();
        },
    },
    isPersistent: () => true,
}));

const { readDisruption, readRememberedDisruption, rememberDisruption } = await import(
    '@/alarm/disruption'
);

beforeEach(() => {
    store.clear();
});

function leg(overrides: Partial<JourneyLeg> = {}): JourneyLeg {
    return {
        type: LegType.TRAIN,
        name: 'Intercity naar Amsterdam Centraal',
        fromName: 'Utrecht Centraal',
        toName: 'Amsterdam Centraal',
        plannedDeparture: '2026-08-18T06:10:00.000Z',
        actualDeparture: '2026-08-18T06:10:00.000Z',
        plannedArrival: '2026-08-18T06:38:00.000Z',
        actualArrival: '2026-08-18T06:38:00.000Z',
        delaySeconds: 0,
        cancelled: false,
        ...overrides,
    };
}

function occurrence(legs: JourneyLeg[], overrides: Partial<OccurrenceResponse> = {}) {
    const journey: Journey = {
        id: 'journey-1',
        ctxRecon: 'ctx',
        status: JourneyStatus.NORMAL,
        legs,
        departureAt: '2026-08-18T06:10:00.000Z',
        arrivalAt: '2026-08-18T06:38:00.000Z',
        transferCount: 0,
        source: 'NS',
        watchedStationCodes: ['UT', 'ASD'],
    };
    return { journey, simulated: null, ...overrides } as OccurrenceResponse;
}

describe('what counts as a disruption', () => {
    it('is nothing at all when every leg is on time', () => {
        expect(readDisruption(occurrence([leg()]))).toBeNull();
    });

    it('ignores under a minute, which is timetable jitter rather than a delay', () => {
        // The same floor the server uses before it will push anything. Without
        // it a 40 second wobble would wake the radio on every device.
        expect(readDisruption(occurrence([leg({ delaySeconds: 55 })]))).toBeNull();
    });

    it('reports the worst leg, since that is the one that shapes the morning', () => {
        const result = readDisruption(
            occurrence([
                leg({ delaySeconds: 240, name: 'Sprinter' }),
                leg({ delaySeconds: 900, name: 'Intercity' }),
            ]),
        );

        expect(result).toEqual({
            kind: 'DELAY',
            minutes: 15,
            service: 'Intercity',
            simulated: false,
        });
    });

    it('lets a cancellation win over a delay on the same journey', () => {
        // A train that is not running is not a train that is late, and saying
        // both would bury the one that matters.
        const result = readDisruption(
            occurrence([leg({ delaySeconds: 600 }), leg({ cancelled: true, name: 'Sprinter' })]),
        );

        expect(result?.kind).toBe('CANCELLATION');
        expect(result?.service).toBe('Sprinter');
    });

    it('catches a journey cancelled as a whole, with no leg flagged', () => {
        const cancelled = occurrence([leg()]);
        cancelled.journey = { ...cancelled.journey!, status: JourneyStatus.CANCELLED };

        expect(readDisruption(cancelled)?.kind).toBe('CANCELLATION');
    });

    it('falls back to the station name when a leg has no service name', () => {
        const result = readDisruption(
            occurrence([leg({ name: undefined, delaySeconds: 300, fromName: 'Gouda' })]),
        );

        expect(result?.service).toBe('Gouda');
    });

    it('marks a simulated one, so the ring screen can say it is a test', () => {
        const result = readDisruption(
            occurrence([leg({ delaySeconds: 1200 })], { simulated: SimulationKind.DELAY }),
        );

        expect(result?.simulated).toBe(true);
    });

    it('says nothing for a morning with no journey, rather than throwing', () => {
        expect(readDisruption(occurrence([], { journey: null }))).toBeNull();
    });
});

describe('the note the ring screen reads at 06:00', () => {
    const delay = { kind: 'DELAY', minutes: 12, service: 'Intercity', simulated: false } as const;
    const cancellation = {
        kind: 'CANCELLATION',
        minutes: 0,
        service: 'Sprinter',
        simulated: false,
    } as const;

    it('comes back for the morning it was written for', async () => {
        await rememberDisruption('morning-a', delay);

        expect(await readRememberedDisruption('morning-a')).toEqual(delay);
    });

    it('is not offered to a different morning', async () => {
        await rememberDisruption('morning-a', delay);

        // Explaining Thursday's alarm with Wednesday's cancellation is worse
        // than explaining nothing.
        expect(await readRememberedDisruption('morning-b')).toBeNull();
    });

    it('keeps one morning while another is cleared', async () => {
        // The bug this replaced: a single slot, so a cancellation pushed for
        // Thursday was erased the moment Today refreshed and found Wednesday
        // running normally, and Thursday then rang with an empty screen.
        await rememberDisruption('thursday', cancellation);
        await rememberDisruption('wednesday', null);

        expect(await readRememberedDisruption('thursday')).toEqual(cancellation);
    });

    it('replaces a morning`s own note rather than keeping both', async () => {
        await rememberDisruption('morning-a', delay);
        await rememberDisruption('morning-a', { ...delay, minutes: 20 });

        expect((await readRememberedDisruption('morning-a'))?.minutes).toBe(20);
    });

    it('reads the single-entry shape it used to be stored in', async () => {
        // A phone updating overnight must keep the note it already had rather
        // than starting empty.
        store.set(
            'lastDisruption',
            JSON.stringify({ occurrenceId: 'morning-a', ...cancellation }),
        );

        expect(await readRememberedDisruption('morning-a')).toMatchObject(cancellation);
        expect(await readRememberedDisruption('morning-b')).toBeNull();
    });

    it('survives a corrupted note instead of taking the alarm screen down', async () => {
        store.set('lastDisruption', '{{{');

        expect(await readRememberedDisruption('morning-a')).toBeNull();
    });
});
