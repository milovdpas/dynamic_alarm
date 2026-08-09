import { APP_CONSTANTS, JourneyStatus, TransportMode } from '@alarm/types';
import type { Journey } from '@alarm/types';
import { ceilMinutes } from '../time';

const { RISK_BUFFER } = APP_CONSTANTS;

/** Statuses that mean the itinerary is degraded but still theoretically walkable. */
const DEGRADED_STATUSES: readonly JourneyStatus[] = [
    JourneyStatus.DISRUPTION,
    JourneyStatus.MAINTENANCE,
    JourneyStatus.UNCERTAIN,
    JourneyStatus.REPLACEMENT,
];

export interface RiskBufferInput {
    mode: TransportMode;
    journey: Journey | null;
    /** Travel time in minutes; used for the car's proportional buffer. */
    travelMinutes: number;
    /**
     * Minutes until departure. Inside the live-traffic window TomTom reports
     * observed rather than predicted traffic, so the estimate earns more trust.
     */
    minutesUntilDeparture?: number;
}

/**
 * How much slack to add beyond the planned journey.
 *
 * The two modes fail in fundamentally different shapes, so one shared buffer
 * cannot serve both:
 *
 * - **Public transport is discrete.** The risk is missing one specific
 *   departure. A two-minute delay costs nothing; a two-minute delay that breaks
 *   a connection costs half an hour. Risk therefore scales with the number of
 *   transfers, not with journey length.
 * - **Car is continuous.** Traffic is a distribution, so the risk scales with
 *   how long you are exposed to it, i.e. with duration.
 */
export function computeRiskBufferMinutes(input: RiskBufferInput): number {
    switch (input.mode) {
        case TransportMode.PUBLIC_TRANSPORT:
            return publicTransportRisk(input.journey);
        case TransportMode.CAR:
            return carRisk(input.travelMinutes, input.minutesUntilDeparture);
        case TransportMode.FIXED:
            // The user typed the number themselves; inventing risk on top of it would
            // be second-guessing an input we have no basis to doubt.
            return 0;
        default:
            return 0;
    }
}

function publicTransportRisk(journey: Journey | null): number {
    if (journey === null) {
        return RISK_BUFFER.PT_BASE_MINUTES;
    }
    let minutes = RISK_BUFFER.PT_BASE_MINUTES;
    minutes += journey.transferCount * RISK_BUFFER.PT_PER_TRANSFER_MINUTES;

    const degraded =
        DEGRADED_STATUSES.includes(journey.status) || journey.legs.some((leg) => leg.cancelled);
    if (degraded) {
        minutes += RISK_BUFFER.PT_DISRUPTED_LEG_MINUTES;
    }
    return minutes;
}

function carRisk(travelMinutes: number, minutesUntilDeparture?: number): number {
    const proportional = travelMinutes * RISK_BUFFER.CAR_FRACTION;
    const base = Math.max(RISK_BUFFER.CAR_MIN_MINUTES, proportional);

    // Far out, TomTom can only offer historic/predictive traffic, live conditions
    // are explicitly ignored for a future departAt. Once inside the live window
    // the estimate reflects the road as it actually is, so the padding can relax.
    const isLive =
        minutesUntilDeparture !== undefined &&
        minutesUntilDeparture <= RISK_BUFFER.CAR_LIVE_TRAFFIC_WINDOW_MINUTES;

    return ceilMinutes(isLive ? base * 0.75 : base);
}
