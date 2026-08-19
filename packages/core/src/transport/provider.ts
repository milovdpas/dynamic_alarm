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
    /**
     * The instant to plan from. Defaults to the real clock.
     *
     * Only the car provider reads it, and it needs to: how far away the drive is
     * decides whether TomTom can answer with live traffic or only with a
     * forecast. Passing it in rather than reading the clock keeps that decision
     * testable, which matters for a branch that is otherwise only exercised in
     * the last hour before somebody leaves the house.
     */
    now?: IsoDateTimeString;
}

/**
 * What asking a provider about an existing itinerary can tell you.
 *
 * Three answers, because `Journey | null` only had room for two and the two it
 * had were the wrong pair. Null meant both "this trip no longer exists" and
 * "I have no way to re-fetch a trip, ask me to plan again", which are opposite
 * instructions. The monitor believed the first, so every car journey was
 * reported to its owner as a cancellation on the first check of the night, and
 * the re-plan it triggered was routed through the replacement chooser, which
 * refuses an option departing at the same moment as the one it is replacing.
 * The result was a car alarm that stopped tracking traffic and said a train had
 * been cancelled, on a commute with no train in it.
 */
export type RefreshResult =
    /**
     * The same itinerary, as it stands now. `journey` carries current realtime
     * data and may be more delayed, less delayed or identical.
     */
    | { status: 'CURRENT'; journey: Journey }
    /**
     * The itinerary cannot be reconstructed. This is what a cancellation looks
     * like from here: the trip has stopped existing rather than slipped.
     */
    | { status: 'GONE' }
    /**
     * This provider has no way to re-fetch a specific trip, so the only way to
     * learn anything is to plan the journey again. Not a disruption, and it must
     * never be reported as one.
     */
    | { status: 'REPLAN' };

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
     * blindly adding a delay to it. The answer is a {@link RefreshResult} rather
     * than a nullable journey, because "gone" and "I cannot answer this
     * question, plan again" need opposite responses from the caller and used to
     * be indistinguishable.
     */
    refresh(journey: Journey): Promise<RefreshResult>;
}
