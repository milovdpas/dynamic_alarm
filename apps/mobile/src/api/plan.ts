import { API_ENDPOINTS } from '@alarm/types';
import type { PlanPreviewRequest, PlanPreviewResponse } from '@alarm/types';

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
