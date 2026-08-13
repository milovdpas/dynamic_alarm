import { TransportMode } from '@alarm/types';
import type {
    AccessMode,
    BufferConfig,
    GeoPoint,
    IsoDateTimeString,
    Journey,
    TimeZone,
    WakeBreakdown,
    WakePlan,
} from '@alarm/types';
import { ceilMinutes, minutesBetween, parseInstant, toIso } from '../time';
import type { TransportProvider } from '../transport/provider';
import { computeRiskBufferMinutes } from './risk';

export interface ComputeWakePlanInput {
    /** The hard deadline: when the user must be at the destination. */
    requiredArrivalAt: IsoDateTimeString;
    mode: TransportMode;
    /** Resolved itinerary. Null for `FIXED` mode or when planning failed. */
    journey: Journey | null;
    /** Travel duration in minutes. Required when `mode` is `FIXED`. */
    fixedTravelMinutes?: number;
    /** Sum of the enabled routine steps. */
    routineMinutes: number;
    buffers: BufferConfig;
    timezone: TimeZone;
    /** Reference instant, for the car's live-traffic window. Defaults to now. */
    now?: IsoDateTimeString;
}

/**
 * The wake-time calculation, working backwards from the arrival deadline.
 *
 * ```
 * requiredArrivalAt
 *   − arrivalBuffer        → latestArrivalAt   (the planner's target)
 *   [journey]              → departure at origin
 *   − riskBuffer           (derived per mode, not a user setting)
 *   − preDepartureBuffer   → departHomeAt
 *   − routineMinutes
 *   − wakeSlack            → wakeUpAt
 * ```
 *
 * `transferBuffer` is deliberately absent: it was already handed to the planner
 * as a minimum connection time, so a too-tight transfer was never proposed.
 * Subtracting it again here would double-count it.
 *
 * Pure and synchronous, every input is explicit so the app and the API always
 * produce the same number from the same data. Use {@link planWake} to fetch a
 * journey and feed it in.
 */
export function computeWakePlan(input: ComputeWakePlanInput): WakePlan {
    const { buffers, timezone } = input;

    const requiredArrival = parseInstant(input.requiredArrivalAt, timezone);
    const latestArrival = requiredArrival.minus({ minutes: buffers.arrivalMinutes });

    const travelMinutes = resolveTravelMinutes(input);

    const plannedDeparture =
        input.journey !== null
            ? parseInstant(input.journey.departureAt, timezone)
            : latestArrival.minus({ minutes: travelMinutes });

    const now = input.now !== undefined ? parseInstant(input.now, timezone) : null;
    const riskBufferMinutes = computeRiskBufferMinutes({
        mode: input.mode,
        journey: input.journey,
        travelMinutes,
        minutesUntilDeparture:
            now !== null ? Math.max(0, minutesBetween(now, plannedDeparture)) : undefined,
    });

    const departHome = plannedDeparture.minus({
        minutes: riskBufferMinutes + buffers.preDepartureMinutes,
    });
    const wakeUp = departHome.minus({
        minutes: input.routineMinutes + buffers.wakeSlackMinutes,
    });

    // Feasibility is measured against the real deadline, not against the padded
    // target. Eating into the arrival buffer makes a morning tight; it does not
    // make the user late, and telling them otherwise would be crying wolf.
    const actualArrival =
        input.journey !== null ? parseInstant(input.journey.arrivalAt, timezone) : latestArrival;
    const lateBy = minutesBetween(requiredArrival, actualArrival);
    const feasible = lateBy <= 0;

    const breakdown: WakeBreakdown = {
        requiredArrivalAt: toIso(requiredArrival),
        arrivalBufferMinutes: buffers.arrivalMinutes,
        latestArrivalAt: toIso(latestArrival),
        travelMinutes,
        riskBufferMinutes,
        preDepartureBufferMinutes: buffers.preDepartureMinutes,
        routineMinutes: input.routineMinutes,
        wakeSlackMinutes: buffers.wakeSlackMinutes,
    };

    return {
        feasible,
        wakeUpAt: toIso(wakeUp),
        departHomeAt: toIso(departHome),
        journey: input.journey,
        breakdown,
        ...(feasible ? {} : { shortfallMinutes: ceilMinutes(lateBy) }),
    };
}

function resolveTravelMinutes(input: ComputeWakePlanInput): number {
    if (input.journey !== null) {
        const departure = parseInstant(input.journey.departureAt, input.timezone);
        const arrival = parseInstant(input.journey.arrivalAt, input.timezone);
        return ceilMinutes(minutesBetween(departure, arrival));
    }
    if (input.mode === TransportMode.FIXED) {
        if (input.fixedTravelMinutes === undefined) {
            throw new Error('fixedTravelMinutes is required when mode is FIXED');
        }
        return input.fixedTravelMinutes;
    }
    // No journey and not FIXED means planning failed. Fall back to whatever the
    // user configured rather than producing a wake time of "now".
    return input.fixedTravelMinutes ?? 0;
}

export interface PlanWakeInput extends Omit<ComputeWakePlanInput, 'journey'> {
    origin: GeoPoint;
    destination: GeoPoint;
    /**
     * How the traveller reaches the departure station and leaves the arrival
     * one. Passed straight through to the provider, which is the only thing
     * that knows what a station is; the engine works in minutes either way.
     */
    originAccess?: AccessMode;
    destinationAccess?: AccessMode;
    /**
     * Which of the on-time journeys to take, counting back from the latest.
     * Zero is the most sleep. See {@link selectJourney}.
     */
    journeyOffset?: number;
}

/**
 * Fetch the best itinerary for the deadline, then compute the wake plan.
 *
 * When the provider returns nothing we still return a plan built from the
 * fallback travel time and marked infeasible, an alarm at a rough time beats
 * no alarm at all on a morning the user is relying on us.
 */
export async function planWake(
    input: PlanWakeInput,
    provider: TransportProvider,
): Promise<WakePlan> {
    const requiredArrival = parseInstant(input.requiredArrivalAt, input.timezone);
    const latestArrival = requiredArrival.minus({ minutes: input.buffers.arrivalMinutes });

    const journeys = await provider.plan({
        origin: input.origin,
        destination: input.destination,
        arriveBy: toIso(latestArrival),
        addChangeTimeMinutes: input.buffers.transferMinutes,
        originAccess: input.originAccess,
        destinationAccess: input.destinationAccess,
        timezone: input.timezone,
    });

    const journey = selectJourney(
        journeys,
        toIso(requiredArrival),
        input.timezone,
        input.journeyOffset,
    );
    return computeWakePlan({ ...input, journey });
}

/**
 * On-time itineraries, latest departure first.
 *
 * "Best" is the first entry: among journeys that arrive by the deadline, the
 * latest departure buys the most sleep, which is the entire point of the
 * product. Departing later is only better if you still arrive on time, so
 * on-time candidates are filtered first. Ranking purely by departure would
 * happily put someone on a train that gets them there half an hour late.
 *
 * The rest of the list is what makes a preference possible. A traveller who
 * wants a seat, or the direct train, or simply a little margin, is choosing to
 * be somewhere further down it.
 *
 * Empty when nothing arrives on time. That is a real answer rather than an
 * error, and {@link selectJourney} handles it by returning the least-late
 * journey so the user still gets an alarm.
 */
export function rankJourneys(
    journeys: Journey[],
    deadline: IsoDateTimeString,
    timezone: TimeZone,
): Journey[] {
    const deadlineAt = parseInstant(deadline, timezone);

    return journeys
        .filter((journey) => parseInstant(journey.arrivalAt, timezone) <= deadlineAt)
        .sort(
            (a, b) =>
                parseInstant(b.departureAt, timezone).toMillis() -
                parseInstant(a.departureAt, timezone).toMillis(),
        );
}

/**
 * The itinerary at `offset` places before the latest on-time one.
 *
 * Offset 0 is the most sleep. Higher numbers are earlier journeys, which is how
 * a stated preference survives a changing timetable: it is a position in each
 * morning's list rather than a particular train, so a cancellation moves the
 * choice along instead of invalidating it.
 *
 * Clamped rather than failed when the list is shorter than the offset. On a
 * quiet morning there may be only one way to arrive on time, and refusing to
 * choose it because a preference cannot be honoured would leave someone with no
 * alarm over a comfort setting.
 *
 * When nothing arrives on time, the one that arrives least late, and the caller
 * marks the plan infeasible.
 */
export function selectJourney(
    journeys: Journey[],
    deadline: IsoDateTimeString,
    timezone: TimeZone,
    offset = 0,
): Journey | null {
    if (journeys.length === 0) {
        return null;
    }

    const ranked = rankJourneys(journeys, deadline, timezone);

    if (ranked.length === 0) {
        return journeys.reduce((best, candidate) =>
            parseInstant(candidate.arrivalAt, timezone) < parseInstant(best.arrivalAt, timezone)
                ? candidate
                : best,
        );
    }

    return ranked[Math.min(Math.max(offset, 0), ranked.length - 1)] ?? null;
}

/** @deprecated Use {@link selectJourney}, which also takes a preference. */
export function selectBestJourney(
    journeys: Journey[],
    deadline: IsoDateTimeString,
    timezone: TimeZone,
): Journey | null {
    return selectJourney(journeys, deadline, timezone, 0);
}
