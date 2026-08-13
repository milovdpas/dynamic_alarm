import { API_ENDPOINTS } from '@alarm/types';
import type {
    CreateScheduleRequest,
    ListSchedulesResponse,
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
