import { API_ENDPOINTS } from '@alarm/types';
import type {
    PlanOptionsResponse,
    PlanPreviewRequest,
    PlanPreviewResponse,
} from '@alarm/types';

import Axios from '@/utils/modules/Axios';

/**
 * A wake plan computed from live data and stored nowhere.
 *
 * The server runs the same engine the monitor will, on the same providers, so
 * onboarding can show a real commute against the real timetable before the user
 * has saved anything.
 *
 * An infeasible result is a normal 200, carrying `feasible: false` and
 * `shortfallMinutes`. "The earliest you can arrive is 08:41" is an answer, and
 * the user still needs an alarm, so the screen shows the shortfall rather than
 * an error.
 */
export async function previewPlan(input: PlanPreviewRequest): Promise<PlanPreviewResponse> {
    return Axios.post<PlanPreviewResponse>(API_ENDPOINTS.PLAN.PREVIEW, input);
}

/**
 * The same commute planned several ways, latest departure first.
 *
 * The index is the `journeyOffset` a schedule stores. The engine's default is
 * index 0, the latest journey that still arrives on time, which buys the most
 * sleep; later entries are earlier departures for anyone who wants a seat, the
 * direct train, or simply some margin.
 *
 * Costs the same as one preview: NS returns several itineraries per request.
 */
export async function planOptions(input: PlanPreviewRequest): Promise<PlanOptionsResponse> {
    return Axios.post<PlanOptionsResponse>(API_ENDPOINTS.PLAN.OPTIONS, input);
}
