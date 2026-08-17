import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { JourneyStatus, LegType, ReplacementPreference } from '@alarm/types';
import type { WakePlan } from '@alarm/types';

import { chooseReplacement } from './replacement';

const TZ = 'Europe/Amsterdam';

function at(time: string): string {
    return DateTime.fromISO(`2026-08-20T${time}:00`, { zone: TZ }).toISO() ?? '';
}

/** A plan whose only interesting property is when its train leaves. */
function option(departs: string): WakePlan {
    const departure = at(departs);
    return {
        wakeUpAt: departure,
        departHomeAt: departure,
        feasible: true,
        breakdown: {
            requiredArrivalAt: at('09:00'),
            arrivalBufferMinutes: 3,
            latestArrivalAt: at('08:57'),
            travelMinutes: 45,
            riskBufferMinutes: 4,
            preDepartureBufferMinutes: 5,
            routineMinutes: 25,
            wakeSlackMinutes: 0,
        },
        journey: {
            id: departs,
            ctxRecon: null,
            status: JourneyStatus.NORMAL,
            legs: [
                {
                    type: LegType.BIKE,
                    fromName: 'Home',
                    toName: 'Oss',
                    plannedDeparture: departure,
                    actualDeparture: departure,
                    plannedArrival: departure,
                    actualArrival: departure,
                    delaySeconds: 0,
                    cancelled: false,
                },
                {
                    type: LegType.TRAIN,
                    name: `train ${departs}`,
                    fromName: 'Oss',
                    toName: 'Tilburg',
                    plannedDeparture: departure,
                    actualDeparture: departure,
                    plannedArrival: departure,
                    actualArrival: departure,
                    delaySeconds: 0,
                    cancelled: false,
                },
            ],
            departureAt: departure,
            arrivalAt: departure,
            transferCount: 0,
            source: 'NS',
            watchedStationCodes: [],
        },
    };
}

const base = {
    cancelledDepartureAt: at('07:52'),
    windowStart: '07:00',
    windowEnd: '09:00',
    timezone: TZ,
};

describe('chooseReplacement', () => {
    it('takes the closest earlier train when that is the preference', () => {
        // The smallest sacrifice, not the earliest option available: 07:30 costs
        // twenty-two minutes of sleep and 07:05 costs forty-seven.
        const result = chooseReplacement({
            ...base,
            preference: ReplacementPreference.EARLIER,
            options: [option('07:05'), option('07:30'), option('08:10')],
        });

        expect(result).toMatchObject({ found: true, direction: 'EARLIER' });
        expect(result.found && result.plan.journey?.id).toBe('07:30');
    });

    it('takes the closest later train when that is the preference', () => {
        const result = chooseReplacement({
            ...base,
            preference: ReplacementPreference.LATER,
            options: [option('07:30'), option('08:10'), option('08:40')],
        });

        expect(result.found && result.plan.journey?.id).toBe('08:10');
    });

    /**
     * The rule that makes the preference a preference rather than a demand.
     * Someone who would rather leave earlier still wants an alarm at all.
     */
    it('falls back to the other direction inside the window', () => {
        const result = chooseReplacement({
            ...base,
            preference: ReplacementPreference.EARLIER,
            options: [option('08:10'), option('08:40')],
        });

        expect(result).toMatchObject({ found: true, direction: 'LATER' });
        expect(result.found && result.plan.journey?.id).toBe('08:10');
    });

    /**
     * The case this whole feature exists for: a technically valid replacement
     * that the user would never take.
     */
    it('refuses a train outside the window, even with nothing else on offer', () => {
        const result = chooseReplacement({
            ...base,
            preference: ReplacementPreference.EARLIER,
            options: [option('06:50')],
        });

        expect(result).toEqual({ found: false, reason: 'OUTSIDE_WINDOW' });
    });

    it('accepts anything when no window is set', () => {
        const result = chooseReplacement({
            ...base,
            windowStart: null,
            windowEnd: null,
            preference: ReplacementPreference.EARLIER,
            options: [option('06:50')],
        });

        expect(result.found && result.plan.journey?.id).toBe('06:50');
    });

    it('says so when the planner offered nothing', () => {
        const result = chooseReplacement({
            ...base,
            preference: ReplacementPreference.EARLIER,
            options: [],
        });

        expect(result).toEqual({ found: false, reason: 'NOTHING_PLANNED' });
    });

    it('is not fooled by the planner returning the cancelled train again', () => {
        // A refresh that hands back the same departure is not a replacement, and
        // treating it as one would silently leave the alarm on a dead service.
        const result = chooseReplacement({
            ...base,
            preference: ReplacementPreference.EARLIER,
            options: [option('07:52')],
        });

        expect(result).toEqual({ found: false, reason: 'OUTSIDE_WINDOW' });
    });

    it('ignores the ride to the station when judging the window', () => {
        // The window is about trains. A 07:00 window must not reject the 07:05
        // because its owner leaves the house at 06:47.
        const early = option('07:05');
        const bike = early.journey?.legs[0];
        if (bike !== undefined) {
            bike.actualDeparture = at('06:47');
        }

        const result = chooseReplacement({
            ...base,
            preference: ReplacementPreference.EARLIER,
            options: [early],
        });

        expect(result.found && result.plan.journey?.id).toBe('07:05');
    });
});
