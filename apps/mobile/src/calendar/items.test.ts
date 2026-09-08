import { DateTime } from 'luxon';
import { describe, expect, it, vi } from 'vitest';
import { OccurrenceState } from '@alarm/types';
import type { OccurrenceResponse } from '@alarm/types';

// The standalone module reaches the alarm layer, which is native. Only the pure
// half is exercised here, so the layer is stubbed as absent.
vi.mock('@/utils/modules/Storage', () => ({
    default: {
        getItem: () => Promise.resolve(null),
        setItem: () => Promise.resolve(),
        removeItem: () => Promise.resolve(),
    },
}));
vi.mock('@/alarm', () => ({
    canGuaranteeAlarm: () => false,
    getAlarmScheduler: () => {
        throw new Error('No scheduler in tests.');
    },
}));
vi.mock('@/alarm/alarmSound', () => ({ resolveAlarmSoundUri: () => Promise.resolve(null) }));
vi.mock('@/i18n/i18n', () => ({ default: { t: (key: string) => key } }));

const { calendarItems } = await import('./items');
type Alarm = Parameters<typeof calendarItems>[0]['alarms'][number];

const ZONE = 'Europe/Amsterdam';
/** A Wednesday at noon, so tomorrow is a Thursday and arithmetic is checkable. */
const NOW = DateTime.fromISO('2026-09-09T12:00:00', { zone: ZONE });

function occurrence(overrides: Partial<OccurrenceResponse> = {}): OccurrenceResponse {
    const wake = '2026-09-10T07:45:00.000+02:00';
    return {
        id: 'occ-1',
        scheduleId: 'sched-1',
        scheduleName: 'Work',
        reminders: { count: 1, intervalMinutes: 5 },
        date: '2026-09-10',
        state: OccurrenceState.ARMED,
        anchorWakeAt: wake,
        currentWakeAt: wake,
        departHomeAt: wake,
        journey: null,
        replacedJourney: null,
        plan: null as unknown as OccurrenceResponse['plan'],
        lastCheckedAt: null,
        simulated: null,
        disabledStepIds: [],
        ...overrides,
    };
}

function alarm(overrides: Partial<Alarm> = {}): Alarm {
    return {
        id: 'a1',
        label: 'Gym',
        time: '18:00',
        days: [],
        enabled: true,
        soundUri: null,
        reminders: { count: 1, intervalMinutes: 5 },
        onceOn: '2026-09-09',
        ...overrides,
    };
}

describe('what a day on the calendar shows', () => {
    it('puts a morning on the day its wake time falls', () => {
        const byDate = calendarItems({ occurrences: [occurrence()], alarms: [], now: NOW, zone: ZONE });

        expect([...byDate.keys()]).toEqual(['2026-09-10']);
        expect(byDate.get('2026-09-10')?.map((item) => item.kind)).toEqual(['SCHEDULE']);
    });

    it('lists the reminders before it, earliest first', () => {
        const byDate = calendarItems({
            occurrences: [occurrence({ reminders: { count: 3, intervalMinutes: 5 } })],
            alarms: [],
            now: NOW,
            zone: ZONE,
        });

        const day = byDate.get('2026-09-10') ?? [];
        expect(day.map((item) => item.kind)).toEqual(['REMINDER', 'REMINDER', 'SCHEDULE']);
        expect(day.map((item) => DateTime.fromISO(item.at).setZone(ZONE).toFormat('HH:mm'))).toEqual([
            '07:35',
            '07:40',
            '07:45',
        ]);
    });

    it('shows a skipped morning as skipped, with no reminders', () => {
        // Nothing rings on a morning that was sat out, so nothing before it
        // should appear to either.
        const byDate = calendarItems({
            occurrences: [
                occurrence({
                    state: OccurrenceState.SKIPPED,
                    reminders: { count: 3, intervalMinutes: 5 },
                }),
            ],
            alarms: [],
            now: NOW,
            zone: ZONE,
        });

        const day = byDate.get('2026-09-10') ?? [];
        expect(day).toHaveLength(1);
        expect(day[0]?.skipped).toBe(true);
    });

    it('includes hand-set alarms on their own days', () => {
        const byDate = calendarItems({ occurrences: [], alarms: [alarm()], now: NOW, zone: ZONE });

        const today = byDate.get('2026-09-09') ?? [];
        expect(today.map((item) => item.kind)).toEqual(['STANDALONE']);
        expect(today[0]?.title).toBe('Gym');
    });

    it('puts a reminder that falls before midnight on the evening before', () => {
        // The date is the ring's own, not the morning's. A calendar that put a
        // 23:55 reminder on the next day would be lying about when the phone
        // makes a noise.
        const byDate = calendarItems({
            occurrences: [
                occurrence({
                    currentWakeAt: '2026-09-10T00:05:00.000+02:00',
                    reminders: { count: 2, intervalMinutes: 10 },
                }),
            ],
            alarms: [],
            now: NOW,
            zone: ZONE,
        });

        expect(byDate.get('2026-09-09')?.map((item) => item.kind)).toEqual(['REMINDER']);
        expect(byDate.get('2026-09-10')?.map((item) => item.kind)).toEqual(['SCHEDULE']);
    });

    it('orders a mixed day by time', () => {
        const byDate = calendarItems({
            occurrences: [occurrence({ currentWakeAt: '2026-09-09T20:00:00.000+02:00' })],
            alarms: [alarm({ time: '18:00' })],
            now: NOW,
            zone: ZONE,
        });

        expect(byDate.get('2026-09-09')?.map((item) => item.kind)).toEqual([
            'STANDALONE',
            'SCHEDULE',
        ]);
    });
});
