import type { DeepPartial } from 'typeorm';

import {
    DEFAULT_BUFFERS,
    DevicePlatform,
    JourneyStatus,
    OccurrenceState,
    TransportMode,
    Weekday,
} from '@alarm/types';
import type { WakePlan } from '@alarm/types';

import Device from '../../src/app/models/Device.entity';
import Place from '../../src/app/models/Place.entity';
import Routine from '../../src/app/models/Routine.entity';
import RoutineStep from '../../src/app/models/RoutineStep.entity';
import Schedule from '../../src/app/models/Schedule.entity';
import ScheduleOccurrence from '../../src/app/models/ScheduleOccurrence.entity';
import { generateDeviceToken, hashDeviceToken } from '../../src/app/utils/Token';

/**
 * Seed helpers, written through the entities rather than raw SQL.
 *
 * Going through TypeORM means a column rename breaks the factories at compile
 * time instead of at the first assertion, and the fixtures cannot drift into a
 * shape the application could never produce.
 *
 * Every helper takes overrides so a test can state only the thing it is about.
 * A test that reads `seedPlace(device, { lat: 51.9 })` says what it cares about;
 * one that spells out six fields hides it.
 */

/** Real coordinates, so a plan against them is a plausible commute. */
export const UTRECHT = { lat: 52.0907, lng: 5.1214 };
export const AMSTERDAM_ZUID = { lat: 52.3391, lng: 4.8731 };

export interface SeededDevice {
    device: Device;
    /** The plain token. Only the hash reaches the database. */
    token: string;
}

export async function seedDevice(overrides: DeepPartial<Device> = {}): Promise<SeededDevice> {
    const token = generateDeviceToken();
    const device = Device.create({
        tokenHash: hashDeviceToken(token),
        platform: DevicePlatform.ANDROID,
        pushToken: null,
        timezone: 'Europe/Amsterdam',
        appVersion: 'test',
        lastSeenAt: new Date(),
    });
    Object.assign(device, overrides);
    await device.save();
    return { device, token };
}

export async function seedPlace(device: Device, overrides: DeepPartial<Place> = {}): Promise<Place> {
    const place = Place.create({
        deviceId: device.id,
        label: 'Home',
        address: 'Utrecht',
        lat: UTRECHT.lat,
        lng: UTRECHT.lng,
        nsStationCode: null,
    });
    Object.assign(place, overrides);
    return place.save();
}

/** Defaults to 25 enabled minutes plus a disabled 45-minute step. */
export async function seedRoutine(
    device: Device,
    steps?: { label: string; minutes: number; enabled: boolean }[],
): Promise<Routine> {
    const specs = steps ?? [
        { label: 'Shower', minutes: 10, enabled: true },
        { label: 'Breakfast', minutes: 15, enabled: true },
        { label: 'Gym', minutes: 45, enabled: false },
    ];

    const routine = Routine.create({
        deviceId: device.id,
        name: 'Weekday',
        steps: specs.map((spec, index) =>
            RoutineStep.create({
                label: spec.label,
                minutes: spec.minutes,
                order: index,
                enabled: spec.enabled,
            }),
        ),
    });
    return routine.save();
}

export async function seedSchedule(
    device: Device,
    refs: { origin: Place; destination: Place; routine: Routine },
    overrides: DeepPartial<Schedule> = {},
): Promise<Schedule> {
    const schedule = Schedule.create({
        deviceId: device.id,
        name: 'Work mornings',
        originPlaceId: refs.origin.id,
        destinationPlaceId: refs.destination.id,
        routineId: refs.routine.id,
        arrivalTime: '08:30',
        daysOfWeek: [Weekday.MONDAY, Weekday.TUESDAY, Weekday.WEDNESDAY],
        mode: TransportMode.PUBLIC_TRANSPORT,
        fixedTravelMinutes: null,
        buffers: DEFAULT_BUFFERS,
        timezone: 'Europe/Amsterdam',
        active: true,
    });
    Object.assign(schedule, overrides);
    return schedule.save();
}

/** A device with a home, a work and a routine already saved. */
export async function seedCommute(): Promise<{
    device: Device;
    token: string;
    home: Place;
    work: Place;
    routine: Routine;
}> {
    const { device, token } = await seedDevice();
    const home = await seedPlace(device, { label: 'Home', ...UTRECHT });
    const work = await seedPlace(device, { label: 'Work', ...AMSTERDAM_ZUID });
    const routine = await seedRoutine(device);
    return { device, token, home, work, routine };
}

/**
 * An armed morning, with the fields the monitor actually reads.
 *
 * Written through the entity rather than raw SQL like every other factory here,
 * so a column rename breaks this at compile time instead of at the first
 * assertion.
 *
 * Defaults describe the ordinary case: armed, due in half an hour, watching two
 * stations, never pushed and never acknowledged. A test overrides only the field
 * it is about.
 */
export async function seedOccurrence(
    schedule: Schedule,
    overrides: DeepPartial<ScheduleOccurrence> = {},
): Promise<ScheduleOccurrence> {
    const wakeAt = new Date(Date.now() + 3 * 60 * 60 * 1000);
    const occurrence = ScheduleOccurrence.create({
        scheduleId: schedule.id,
        deviceId: schedule.deviceId,
        date: '2026-08-20',
        state: OccurrenceState.ARMED,
        anchorWakeAt: wakeAt,
        currentWakeAt: wakeAt,
        deviceAckedWakeAt: null,
        departHomeAt: wakeAt,
        pushedWakeAt: null,
        lastPushedAt: null,
        planSnapshot: wakePlan(wakeAt),
        ctxRecon: 'test-ctx',
        watchedStationCodes: ['UT', 'ASD'],
        lastCheckedAt: new Date(Date.now() - 30 * 60 * 1000),
        nextCheckAt: new Date(Date.now() + 30 * 60 * 1000),
    });
    Object.assign(occurrence, overrides);
    return occurrence.save();
}

/** Enough of a plan for the monitor to read, not a realistic journey. */
function wakePlan(wakeAt: Date): WakePlan {
    const iso = wakeAt.toISOString();
    return {
        wakeUpAt: iso,
        departHomeAt: iso,
        feasible: true,
        journey: {
            id: 'test-journey',
            ctxRecon: 'test-ctx',
            status: JourneyStatus.NORMAL,
            legs: [],
            departureAt: iso,
            arrivalAt: iso,
            transferCount: 0,
            source: 'NS',
            watchedStationCodes: ['UT', 'ASD'],
        },
        breakdown: {
            requiredArrivalAt: iso,
            arrivalBufferMinutes: 3,
            latestArrivalAt: iso,
            travelMinutes: 45,
            riskBufferMinutes: 4,
            preDepartureBufferMinutes: 5,
            routineMinutes: 25,
            wakeSlackMinutes: 0,
        },
    };
}
