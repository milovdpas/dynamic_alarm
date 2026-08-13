import { API_ENDPOINTS } from '@alarm/types';
import type {
    CreateScheduleRequest,
    ListSchedulesResponse,
    SchedulePlanResponse,
    ScheduleResponse,
    UpdateScheduleRequest,
} from '@alarm/types';

import Axios from '@/utils/modules/Axios';

export async function listSchedules(): Promise<ListSchedulesResponse> {
    return Axios.get<ListSchedulesResponse>(API_ENDPOINTS.SCHEDULES.LIST);
}

export async function createSchedule(input: CreateScheduleRequest): Promise<ScheduleResponse> {
    return Axios.post<ScheduleResponse>(API_ENDPOINTS.SCHEDULES.CREATE, input);
}

export async function updateSchedule(
    id: string,
    input: UpdateScheduleRequest,
): Promise<ScheduleResponse> {
    return Axios.patch<ScheduleResponse>(API_ENDPOINTS.SCHEDULES.DETAIL(id), input);
}

export async function deleteSchedule(id: string): Promise<void> {
    await Axios.delete<void>(API_ENDPOINTS.SCHEDULES.DETAIL(id));
}

/**
 * The wake plan for this schedule's next occurrence.
 *
 * One request for everything needed to arm an alarm: the date, the wake time,
 * the journey and the breakdown behind it. The device does not reassemble that
 * from places, routines and schedules, because a second copy of the arithmetic
 * would eventually disagree with the server's and nothing would say which was
 * right.
 *
 * Costs a provider call, so it is something to do on purpose rather than poll.
 */
export async function planSchedule(id: string): Promise<SchedulePlanResponse> {
    return Axios.get<SchedulePlanResponse>(API_ENDPOINTS.SCHEDULES.PLAN(id));
}
