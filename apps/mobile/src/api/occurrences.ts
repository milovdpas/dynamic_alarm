import { API_ENDPOINTS } from '@alarm/types';
import type { ListAlarmEventsResponse, OccurrenceResponse } from '@alarm/types';

import Axios, { ApiRequestError } from '@/utils/modules/Axios';

/**
 * The soonest armed morning, or null when nothing is armed.
 *
 * A pure read: the plan was stored when the occurrence was armed, so this costs
 * no NS request. Opening the app is therefore free, which is what makes it
 * reasonable to call on every launch.
 *
 * A 404 is an ordinary answer rather than a failure. Nothing is armed yet on a
 * fresh install, and after the last occurrence of a schedule has passed.
 */
export async function nextOccurrence(): Promise<OccurrenceResponse | null> {
    try {
        return await Axios.get<OccurrenceResponse>(API_ENDPOINTS.OCCURRENCES.NEXT);
    } catch (error) {
        if (ApiRequestError.from(error).status === 404) {
            return null;
        }
        throw error;
    }
}

/**
 * Arms the next morning for a schedule and returns what the device should hold.
 *
 * This is the call that spends a provider request, so it happens when there is
 * nothing armed or when the user asks for a refresh, rather than on every
 * launch. Idempotent per morning: calling it twice cannot produce two alarms for
 * one Thursday, and it never moves the anchor the device already holds.
 */
export async function armSchedule(scheduleId: string): Promise<OccurrenceResponse> {
    return Axios.post<OccurrenceResponse>(API_ENDPOINTS.SCHEDULES.ARM(scheduleId));
}

/**
 * Tells the server which time this device actually holds.
 *
 * Sent after the OS confirms the alarm, never before. The point is to record
 * what is true on the device, so reporting an intention would defeat it: the
 * server would believe a push landed when it had not.
 */
export async function ackOccurrence(
    occurrenceId: string,
    ackedWakeAt: string,
): Promise<OccurrenceResponse> {
    return Axios.post<OccurrenceResponse>(API_ENDPOINTS.OCCURRENCES.ACK(occurrenceId), {
        ackedWakeAt,
    });
}

/** Why this alarm moved, oldest first. */
export async function occurrenceEvents(
    occurrenceId: string,
): Promise<ListAlarmEventsResponse> {
    return Axios.get<ListAlarmEventsResponse>(API_ENDPOINTS.OCCURRENCES.EVENTS(occurrenceId));
}
