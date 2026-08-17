/** How the traveller gets from origin to destination. */
export enum TransportMode {
    /** Trains, bus, tram, metro, ferry, planned by NS `/api/v3/trips`. */
    PUBLIC_TRANSPORT = 'PUBLIC_TRANSPORT',
    /** Car, planned by TomTom Routing. */
    CAR = 'CAR',
    /** No provider; the user types a travel duration themselves. Used in M1. */
    FIXED = 'FIXED',
}

/**
 * How the traveller reaches the station at each end.
 *
 * Only the two that can be modelled honestly. Driving to a station is a real
 * Dutch habit, but it carries parking time and a walk from the car park that
 * nothing here measures, so a car access leg would be systematically optimistic
 * in exactly the direction that makes someone miss a train. Offering two options
 * that are right beats three where one quietly lies.
 */
export enum AccessMode {
    WALK = 'WALK',
    BIKE = 'BIKE',
}

/** Modality of a single leg. Mirrors the NS Reisinformatie leg modality enum. */
export enum LegType {
    TRAIN = 'TRAIN',
    BUS = 'BUS',
    TRAM = 'TRAM',
    METRO = 'METRO',
    FERRY = 'FERRY',
    WALK = 'WALK',
    BIKE = 'BIKE',
    CAR = 'CAR',
    TAXI = 'TAXI',
    TRANSFER = 'TRANSFER',
    UNKNOWN = 'UNKNOWN',
}

/**
 * Health of a planned journey. Mirrors the NS trip `status` enum.
 *
 * The three values in {@link REPLAN_REQUIRED_STATUSES} mean the itinerary we
 * stored is no longer walkable and a `ctxRecon` refresh cannot rescue it, the
 * monitor must plan from scratch.
 */
export enum JourneyStatus {
    NORMAL = 'NORMAL',
    DISRUPTION = 'DISRUPTION',
    MAINTENANCE = 'MAINTENANCE',
    UNCERTAIN = 'UNCERTAIN',
    REPLACEMENT = 'REPLACEMENT',
    ADDITIONAL = 'ADDITIONAL',
    SPECIAL = 'SPECIAL',
    ALTERNATIVE_TRANSPORT = 'ALTERNATIVE_TRANSPORT',
    CHANGE_NOT_POSSIBLE = 'CHANGE_NOT_POSSIBLE',
    CANCELLED = 'CANCELLED',
}

/** Statuses that invalidate a stored itinerary and force a full re-plan. */
export const REPLAN_REQUIRED_STATUSES: readonly JourneyStatus[] = [
    JourneyStatus.CANCELLED,
    JourneyStatus.CHANGE_NOT_POSSIBLE,
    JourneyStatus.ALTERNATIVE_TRANSPORT,
];

/** Lifecycle of one day's instance of a recurring schedule. */
export enum OccurrenceState {
    /** Created but too far out to monitor. */
    PENDING = 'PENDING',
    /** Alarm is scheduled on the device; the monitor loop is watching it. */
    ARMED = 'ARMED',
    FIRED = 'FIRED',
    DISMISSED = 'DISMISSED',
    /** User skipped this day. */
    SKIPPED = 'SKIPPED',
    CANCELLED = 'CANCELLED',
}

/** Audit trail entries explaining every alarm time change. */
export enum AlarmEventType {
    SCHEDULED = 'SCHEDULED',
    MOVED_LATER = 'MOVED_LATER',
    /** Best-effort emergency path only, see the fail-safe rules. */
    MOVED_EARLIER = 'MOVED_EARLIER',
    /** No route can meet the required arrival time. */
    INFEASIBLE = 'INFEASIBLE',
    FIRED = 'FIRED',
    DISMISSED = 'DISMISSED',
}

/**
 * A pretend disruption, applied to one occurrence on its next check.
 *
 * Test-only, and the one place this system deliberately lies to itself. Real
 * trains are mostly on time, so the path this product exists for runs perhaps
 * twice a month and never while anyone is watching. Everything downstream stays
 * real: the same engine recomputes, the same push goes out, the phone reschedules
 * under the same rule. Only the timetable is invented.
 */
export enum SimulationKind {
    /** Shifts the stored journey later and marks its legs disrupted. */
    DELAY = 'DELAY',
    /** Makes the refresh unreconstructable, which forces a re-plan. */
    CANCELLATION = 'CANCELLATION',
}

/** ISO-8601 weekday numbering, matching Luxon's `weekday`. */
export enum Weekday {
    MONDAY = 1,
    TUESDAY = 2,
    WEDNESDAY = 3,
    THURSDAY = 4,
    FRIDAY = 5,
    SATURDAY = 6,
    SUNDAY = 7,
}

export enum DevicePlatform {
    ANDROID = 'android',
    IOS = 'ios',
}

/** Why a wake time changed, surfaced to the user, so keep these human. */
export enum WakeChangeReason {
    INITIAL_PLAN = 'INITIAL_PLAN',
    DELAY = 'DELAY',
    DELAY_RESOLVED = 'DELAY_RESOLVED',
    CANCELLATION = 'CANCELLATION',
    ROUTE_CHANGED = 'ROUTE_CHANGED',
    TRAFFIC_WORSE = 'TRAFFIC_WORSE',
    TRAFFIC_BETTER = 'TRAFFIC_BETTER',
    USER_EDITED = 'USER_EDITED',
}
