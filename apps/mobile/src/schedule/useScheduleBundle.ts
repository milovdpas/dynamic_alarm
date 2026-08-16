import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import type { OccurrenceResponse, Place, Routine, Schedule } from '@alarm/types';

import { listOccurrences, listPlaces, listRoutines, listSchedules } from '@/api';
import { ApiRequestError } from '@/utils/modules/Axios';

export interface ScheduleBundle {
    schedule: Schedule;
    routine: Routine | null;
    origin: Place | null;
    destination: Place | null;
    /** The armed morning, absent while nothing is armed for this schedule. */
    occurrence: OccurrenceResponse | null;
}

/**
 * Everything the editing screens need about one schedule.
 *
 * Four reads rather than one endpoint, and deliberately so: they are all lists
 * this app already fetches elsewhere, none of them costs a provider call, and a
 * bespoke `GET /schedules/:id/everything` would exist only to serve these
 * screens and would have to be kept in step with them.
 *
 * Reloads on focus, which is what makes the hub and its sub-screens work as one
 * flow: a sub-screen saves and pops, and the hub is looking at the new answer by
 * the time it is visible again. Without that it would show what the user just
 * changed away from.
 */
export function useScheduleBundle(id: string): {
    bundle: ScheduleBundle | null;
    errorCode: string | null;
    reload: () => void;
} {
    const [bundle, setBundle] = useState<ScheduleBundle | null>(null);
    const [errorCode, setErrorCode] = useState<string | null>(null);

    const load = useCallback(async () => {
        try {
            const [schedules, routines, places, occurrences] = await Promise.all([
                listSchedules(),
                listRoutines(),
                listPlaces(),
                listOccurrences(),
            ]);

            const schedule = schedules.find((each) => each.id === id);
            if (schedule === undefined) {
                // Deleted from another screen while this one was open. Left null
                // so the screen shows its empty state rather than a stale copy.
                setBundle(null);
                return;
            }

            setBundle({
                schedule,
                routine: routines.find((each) => each.id === schedule.routineId) ?? null,
                origin: places.find((each) => each.id === schedule.originPlaceId) ?? null,
                destination: places.find((each) => each.id === schedule.destinationPlaceId) ?? null,
                occurrence: occurrences.find((each) => each.scheduleId === schedule.id) ?? null,
            });
            setErrorCode(null);
        } catch (error) {
            setErrorCode(ApiRequestError.from(error).code);
        }
    }, [id]);

    useFocusEffect(
        useCallback(() => {
            void load();
        }, [load]),
    );

    const reload = useCallback(() => {
        void load();
    }, [load]);

    return { bundle, errorCode, reload };
}
