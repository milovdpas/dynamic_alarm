import type { JourneyStatus, LegType, TransportMode, Weekday } from './enums';

/**
 * Time formats used across the wire.
 *
 * Mixing a wall-clock time up with an instant is the defining bug class in this
 * app, "arrive at 08:30" is a recurring local time, while "the 07:24 train
 * departs at 2026-08-10T07:26:00+02:00" is a fixed instant. The aliases below
 * are documentation, not enforcement; be deliberate about which one you take.
 */

/** Absolute instant, ISO 8601 with offset. e.g. `2026-08-10T06:46:00+02:00` */
export type IsoDateTimeString = string;
/** Calendar date, no time or zone. e.g. `2026-08-10` */
export type IsoDateString = string;
/** Wall-clock time of day in the schedule's timezone. e.g. `08:30` */
export type LocalTimeString = string;
/** IANA timezone. Always `Europe/Amsterdam` for the NL MVP. */
export type TimeZone = string;

export interface GeoPoint {
    lat: number;
    lng: number;
}

/** A saved origin or destination. */
export interface Place {
    id: string;
    /** User-facing name, e.g. "Home", "Work". */
    label: string;
    /** Full address as resolved by NS Places autosuggest, shown as a subtitle. */
    address?: string;
    lat: number;
    lng: number;
    /**
     * NS station code when the place *is* a station (e.g. `UT`). Normally absent,
     * journeys are planned door-to-door from coordinates, and NS derives the
     * nearest stations itself.
     */
    nsStationCode?: string;
}

/** One step of the morning routine, e.g. "Shower, 10 min". */
export interface RoutineStep {
    id: string;
    label: string;
    minutes: number;
    /** Display order; does not affect the total. */
    order: number;
    /**
     * Disabled steps stay in the list but contribute zero minutes, this is how
     * "I'll skip breakfast today" works without destroying the routine.
     */
    enabled: boolean;
}

export interface Routine {
    id: string;
    name: string;
    steps: RoutineStep[];
}

/**
 * The four buffers. They sit at different layers of the calculation on purpose,
 * see the wake-time engine. A single combined buffer cannot express this.
 */
export interface BufferConfig {
    /** Slack at the destination: reach the desk, not the front door. */
    arrivalMinutes: number;
    /** Slack between "ready to go" and actually being out the door. */
    preDepartureMinutes: number;
    /**
     * Minimum transfer time. Passed to the *planner* (NS `addChangeTime`) rather
     * than subtracted afterwards, so tight connections are never proposed.
     */
    transferMinutes: number;
    /** Grogginess allowance between the alarm and starting the routine. */
    wakeSlackMinutes: number;
}

export interface Schedule {
    id: string;
    name: string;
    originPlaceId: string;
    destinationPlaceId: string;
    routineId: string;
    /** Wall-clock time the user must be at the destination. */
    arrivalTime: LocalTimeString;
    daysOfWeek: Weekday[];
    mode: TransportMode;
    /** Travel duration in minutes. Only used when `mode` is `FIXED`. */
    fixedTravelMinutes?: number;
    buffers: BufferConfig;
    timezone: TimeZone;
    active: boolean;
}

/** A single leg of a planned journey, already normalised across providers. */
export interface JourneyLeg {
    type: LegType;
    /** e.g. "Intercity naar Amsterdam Centraal", or a road name for car legs. */
    name?: string;
    fromName: string;
    toName: string;
    plannedDeparture: IsoDateTimeString;
    /** Realtime departure when known; equals `plannedDeparture` otherwise. */
    actualDeparture: IsoDateTimeString;
    plannedArrival: IsoDateTimeString;
    actualArrival: IsoDateTimeString;
    delaySeconds: number;
    plannedTrack?: string;
    /** Differs from `plannedTrack` on a platform change. */
    actualTrack?: string;
    cancelled: boolean;
}

/** A concrete itinerary from a transport provider. */
export interface Journey {
    /** Provider-stable id where one exists. */
    id: string;
    /**
     * NS reconstruction context. Re-fetching with this returns *this same
     * itinerary* with fresh realtime data, the mechanism that lets us recompute
     * an actual journey instead of blindly adding a delay. Null for car journeys.
     */
    ctxRecon: string | null;
    status: JourneyStatus;
    legs: JourneyLeg[];
    departureAt: IsoDateTimeString;
    arrivalAt: IsoDateTimeString;
    /** Number of changes; drives the public-transport risk buffer. */
    transferCount: number;
    /** Provider label, e.g. `NS`, `TOMTOM`, `FIXTURE`. */
    source: string;
    /** Station codes / road segments to watch in the global disruption sweep. */
    watchedStationCodes: string[];
}

/**
 * Every term in the wake-time calculation, kept so the UI can show its work and
 * so "why did it wake me at 06:12?" is answerable after the fact.
 */
export interface WakeBreakdown {
    requiredArrivalAt: IsoDateTimeString;
    arrivalBufferMinutes: number;
    latestArrivalAt: IsoDateTimeString;
    travelMinutes: number;
    /** Derived per mode, not a user setting. */
    riskBufferMinutes: number;
    preDepartureBufferMinutes: number;
    routineMinutes: number;
    wakeSlackMinutes: number;
}

/** The output of the engine: when to wake, and everything behind that number. */
export interface WakePlan {
    /** False when no itinerary can meet the required arrival time. */
    feasible: boolean;
    wakeUpAt: IsoDateTimeString;
    departHomeAt: IsoDateTimeString;
    /** Null when `mode` is `FIXED` or no journey could be found. */
    journey: Journey | null;
    breakdown: WakeBreakdown;
    /**
     * How late the best available journey arrives, in minutes. Only set when
     * `feasible` is false, the alarm is still set for this best effort.
     */
    shortfallMinutes?: number;
}
