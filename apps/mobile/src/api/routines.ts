import { API_ENDPOINTS } from '@alarm/types';
import type {
    CreateRoutineRequest,
    ListRoutinesResponse,
    RoutineResponse,
    UpdateRoutineRequest,
} from '@alarm/types';

import Axios from '@/utils/modules/Axios';

export async function listRoutines(): Promise<ListRoutinesResponse> {
    return Axios.get<ListRoutinesResponse>(API_ENDPOINTS.ROUTINES.LIST);
}

export async function createRoutine(input: CreateRoutineRequest): Promise<RoutineResponse> {
    return Axios.post<RoutineResponse>(API_ENDPOINTS.ROUTINES.CREATE, input);
}

/**
 * Sending `steps` replaces the whole list; omitting it leaves them alone.
 *
 * Position in the array is the order, so there is no `order` field to send. The
 * editor changes names, order and membership together, and a diff would have to
 * infer which of those happened from a set of ids.
 */
export async function updateRoutine(
    id: string,
    input: UpdateRoutineRequest,
): Promise<RoutineResponse> {
    return Axios.patch<RoutineResponse>(API_ENDPOINTS.ROUTINES.DETAIL(id), input);
}

/** Fails with a 409 while a schedule still uses it. */
export async function deleteRoutine(id: string): Promise<void> {
    await Axios.delete<void>(API_ENDPOINTS.ROUTINES.DETAIL(id));
}
