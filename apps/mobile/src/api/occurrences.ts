import { API_ENDPOINTS } from '@alarm/types';
import type {
    ListAlarmEventsResponse,
    ListOccurrencesResponse,
    OccurrenceResponse,
    SimulateOccurrenceRequest,
    SimulationKind,
} from '@alarm/types';

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
 * Every armed morning, soonest first.
 *
 * What the schedules list is built from: each schedule shows the time it will
 * actually wake you rather than only that it is active. Free, like the other
 * reads, because the plans were stored when the occurrences were armed.
 */
export async function listOccurrences(): Promise<ListOccurrencesResponse> {
    return Axios.get<ListOccurrencesResponse>(API_ENDPOINTS.OCCURRENCES.LIST);
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

/**
 * Stages a pretend disruption for the next check of this morning.
 *
 * A test tool, and the only call in this app that asks the server to lie. It
 * invents the timetable and nothing else: the monitor recomputes with the same
 * engine, the opt-in settings still decide whether the alarm may move, the push
 * is a real push, and this phone applies it under the same rule as any other.
 *
 * Nothing happens immediately. The monitor applies it on its next check, which
 * on the server is within a minute and locally is whenever a tick is run.
 *
 * `kind: null` clears one that has not been applied yet.
 */
export async function simulateOccurrence(
    occurrenceId: string,
    kind: SimulationKind | null,
    minutes?: number,
): Promise<OccurrenceResponse> {
    const body: SimulateOccurrenceRequest = { kind, minutes };
    return Axios.post<OccurrenceResponse>(API_ENDPOINTS.OCCURRENCES.SIMULATE(occurrenceId), body);
}
