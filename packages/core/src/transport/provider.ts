import type { AccessMode, GeoPoint, IsoDateTimeString, Journey, TimeZone } from '@alarm/types';

export interface PlanRequest {
    origin: GeoPoint;
    destination: GeoPoint;
    /**
     * Latest acceptable arrival instant. Providers plan backwards from this,
     * NS via `searchForArrival=true`, TomTom via `arriveAt`.
     */
    arriveBy: IsoDateTimeString;
    /**
     * Minimum transfer time, handed to the planner rather than subtracted after
     * the fact, so a connection that is too tight is never proposed at all.
     */
    addChangeTimeMinutes: number;
    /**
     * How the traveller reaches the departure station and leaves the arrival
     * one. Only the public-transport provider reads these; a car journey has no
     * station to reach.
     */
    originAccess?: AccessMode;
    destinationAccess?: AccessMode;
    timezone: TimeZone;
}

export interface TransportProvider {
    /** Stable identifier written into `Journey.source`. */
    readonly name: string;

    /**
     * Plan itineraries arriving no later than `arriveBy`.
     *
     * Returns them best-first. May return journeys arriving *after* `arriveBy`
     * when nothing else exists, the engine decides whether that is acceptable,
     * because "you'll be 11 minutes late" is far more useful to a user than an
     * error, and they still need an alarm.
     */
    plan(request: PlanRequest): Promise<Journey[]>;

    /**
     * Re-fetch this exact itinerary with current realtime data.
     *
     * This is the mechanism that recalculates an actual journey instead of
     * blindly adding a delay to it. Returns null when the provider cannot
     * reconstruct the journey (no `ctxRecon`, or it has expired), which the
     * caller must treat as "re-plan from scratch".
     */
    refresh(journey: Journey): Promise<Journey | null>;
}
