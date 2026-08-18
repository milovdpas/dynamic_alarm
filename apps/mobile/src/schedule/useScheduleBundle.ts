import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import type { OccurrenceResponse, Place, Routine, Schedule } from '@alarm/types';

import { listOccurrences, listPlaces, listRoutines, listSchedules } from '@/api';
import { peekCache, writeCache } from '@/utils/modules/ApiCache';
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
 * The key this assembled answer is stored under.
 *
 * Its own key, because the four reads behind it are each cached under their own
 * endpoint and nothing writes the combination. Per schedule, so opening one does
 * not put another one's routine on screen for a frame.
 */
function cacheKey(id: string): string {
    return `scheduleBundle:${id}`;
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
 *
 * The stored copy goes up first, like every other read in this app: show what the
 * phone already knows, ask anyway, replace when the answer lands. See
 * `useApiQuery`, which does the same for reads that need no focus reload.
 */
export function useScheduleBundle(id: string): {
    bundle: ScheduleBundle | null;
    errorCode: string | null;
    reload: () => void;
} {
    const [bundle, setBundle] = useState<ScheduleBundle | null>(null);
    const [errorCode, setErrorCode] = useState<string | null>(null);
    /**
     * Which run is the current one.
     *
     * A counter rather than a boolean per effect, because there are three ways to
     * start a load (focus, a changed id, and `reload` from a screen that just
     * saved) and any two of them can be in flight together. Whoever started last
     * wins; everything else drops its answer on the floor. A flag owned by the
     * focus effect could not cover `reload`, which is called from an event
     * handler and has no cleanup of its own.
     */
    const run = useRef(0);

    const load = useCallback(async () => {
        const ticket = (run.current += 1);
        const superseded = () => ticket !== run.current;

        // The head start, and only while there is nothing better on screen: a
        // live answer must never be replaced by a stored one.
        void peekCache<ScheduleBundle>(cacheKey(id)).then((entry) => {
            if (!superseded() && entry !== null) {
                setBundle((current) => current ?? entry.body);
            }
        });

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
                if (!superseded()) {
                    setBundle(null);
                }
                return;
            }

            const assembled: ScheduleBundle = {
                schedule,
                routine: routines.find((each) => each.id === schedule.routineId) ?? null,
                origin: places.find((each) => each.id === schedule.originPlaceId) ?? null,
                destination: places.find((each) => each.id === schedule.destinationPlaceId) ?? null,
                occurrence: occurrences.find((each) => each.scheduleId === schedule.id) ?? null,
            };

            // Written even when this run has been superseded: the answer arrived
            // and is worth keeping for whatever asks next.
            void writeCache(cacheKey(id), assembled);

            if (!superseded()) {
                setBundle(assembled);
                setErrorCode(null);
            }
        } catch (error) {
            if (!superseded()) {
                setErrorCode(ApiRequestError.from(error).code);
            }
        }
    }, [id]);

    useFocusEffect(
        useCallback(() => {
            void load();

            // Bumping the counter is the cancel: an answer still in flight when
            // this screen goes away has nowhere to land.
            return () => {
                run.current += 1;
            };
        }, [load]),
    );

    const reload = useCallback(() => {
        void load();
    }, [load]);

    return { bundle, errorCode, reload };
}
