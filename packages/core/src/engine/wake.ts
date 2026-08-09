import { TransportMode } from '@alarm/types';
import type {
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
        timezone: input.timezone,
    });

    const journey = selectBestJourney(journeys, toIso(requiredArrival), input.timezone);
    return computeWakePlan({ ...input, journey });
}

/**
 * Choose the itinerary that buys the most sleep without being late.
 *
 * Among journeys that arrive by the deadline, the latest departure wins, that
 * is the entire point of the product. Departing later is only better if you
 * still arrive on time, so on-time candidates are filtered first; picking
 * purely by departure time would happily hand back a journey that gets the user
 * there half an hour late.
 *
 * When nothing arrives on time we return the one that arrives least late, and
 * the caller marks the plan infeasible.
 */
export function selectBestJourney(
    journeys: Journey[],
    deadline: IsoDateTimeString,
    timezone: TimeZone,
): Journey | null {
    if (journeys.length === 0) {
        return null;
    }
    const deadlineAt = parseInstant(deadline, timezone);
    const onTime = journeys.filter(
        (journey) => parseInstant(journey.arrivalAt, timezone) <= deadlineAt,
    );

    if (onTime.length === 0) {
        return journeys.reduce((best, candidate) =>
            parseInstant(candidate.arrivalAt, timezone) < parseInstant(best.arrivalAt, timezone)
                ? candidate
                : best,
        );
    }

    return onTime.reduce((best, candidate) =>
        parseInstant(candidate.departureAt, timezone) > parseInstant(best.departureAt, timezone)
            ? candidate
            : best,
    );
}
