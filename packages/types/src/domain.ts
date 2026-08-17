import type { AccessMode, JourneyStatus, LegType, TransportMode, Weekday } from './enums';

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
    /**
     * How the traveller reaches the departure station, and leaves the arrival
     * one. Separate on purpose: the usual Dutch commute is a bike at the home
     * end and a walk at the other, and a single setting gets one of them wrong.
     *
     * Ignored unless `mode` is `PUBLIC_TRANSPORT`, which is the only mode with
     * stations to reach.
     */
    originAccess: AccessMode;
    destinationAccess: AccessMode;
    /**
     * Which on-time journey to take, counting back from the latest departure.
     *
     * Zero is the most sleep, which is the default and what the engine would
     * choose unasked. Higher numbers are earlier journeys, for a traveller who
     * wants a seat, the direct train, or simply some margin.
     *
     * A position rather than a particular train, because the alarm recurs and
     * the timetable does not hold still. A cancellation moves the choice along
     * the list instead of invalidating it, and a morning with fewer options
     * clamps to the earliest rather than refusing to plan.
     */
    journeyOffset: number;
    /** Travel duration in minutes. Only used when `mode` is `FIXED`. */
    fixedTravelMinutes?: number;
    buffers: BufferConfig;
    timezone: TimeZone;
    active: boolean;
}

/** A single leg of a planned journey, already normalised across providers. */
/**
 * A station a leg calls at, in the order it is reached.
 *
 * Stations the train runs through without stopping are not included: NS marks
 * them `passing`, and a list that says "Boxtel" for a train that does not stop
 * there is worse than a shorter list.
 *
 * Both times are optional because the ends of a leg only have one each. The
 * first stop has a departure and no arrival, the last has an arrival and no
 * departure, and that is the honest shape rather than repeating a time twice.
 */
export interface JourneyStop {
    name: string;
    /** Absent at the first stop of the leg. */
    arrivalAt?: IsoDateTimeString;
    /** Absent at the last stop of the leg. */
    departureAt?: IsoDateTimeString;
    /** Realtime where known. Differs from the planned track on a change. */
    track?: string;
    delaySeconds: number;
    cancelled: boolean;
}

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
    /**
     * Where this leg calls, when the provider says. Absent for a walk, and for
     * any provider that does not publish them.
     *
     * Stored with the plan, so reading them later costs nothing. They are what
     * answers "is my stop on this train", which is the question the NS app is
     * usually open for.
     */
    stops?: JourneyStop[];
}

/** A concrete itinerary from a transport provider. */
export interface Journey {
    /** Provider-stable id where one exists. */
    id: string;
    /**
     * The provider's own link to this exact trip.
     *
     * NS returns one per trip (`https://www.ns.nl/rpx?ctx=...`), and it is an
     * app link: on a phone with the NS app installed it opens there, otherwise
     * in a browser. Theirs rather than one we assemble from station names and
     * times, which would drift the moment either side changed a format.
     */
    shareUrl?: string;
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
