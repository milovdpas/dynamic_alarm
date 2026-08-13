import { useCallback, useEffect, useState } from 'react';
import type { OccurrenceResponse } from '@alarm/types';

import { ackOccurrence, armSchedule, listSchedules, nextOccurrence } from '@/api';
import { canGuaranteeAlarm, getAlarmScheduler } from '@/alarm';
import i18n from '@/i18n/i18n';
import { rememberHeldAlarm } from '@/push/heldAlarm';
import { ApiRequestError } from '@/utils/modules/Axios';

/** What the home screen knows about the next morning. */
export interface NextAlarm {
    state: 'loading' | 'ready' | 'none' | 'failed';
    occurrence: OccurrenceResponse | null;
    /**
     * Whether the alarm is actually armed in the OS.
     *
     * Read back from the scheduler rather than assumed from a successful call.
     * "We asked it to" and "it is set" are different claims, and only the second
     * one is worth showing to someone who is about to go to sleep.
     */
    armed: boolean;
    /** Error code for the UI to translate. Never shown raw. */
    errorCode: string | null;
}

const LOADING: NextAlarm = {
    state: 'loading',
    occurrence: null,
    armed: false,
    errorCode: null,
};

/**
 * Reads the next armed morning, makes sure the OS holds it, and says so.
 *
 * The read comes first and costs nothing: the server stored the plan when the
 * occurrence was armed, so launching the app does not spend an NS request.
 * Arming, which does spend one, happens only when nothing is armed yet or when
 * the user asks for a refresh.
 *
 * The device arms `currentWakeAt`, the latest computed time, not the anchor. The
 * anchor is the server's guarantee that a usable time exists even if every later
 * message is lost; the device's job is to hold the best time it has been told
 * about.
 *
 * **The monotonic-later rule is deliberately not here.** It belongs on the push
 * path, where an unexpected earlier time means a disruption resolved and the
 * risk is real. Refreshing on this screen is an explicit request for the current
 * answer, and someone who moves their arrival time earlier must get an earlier
 * alarm rather than be quietly refused.
 */
export function useNextAlarm(): { next: NextAlarm; busy: boolean; refresh: () => void } {
    const [next, setNext] = useState<NextAlarm>(LOADING);
    const [attempt, setAttempt] = useState(0);
    const [busy, setBusy] = useState(true);

    /**
     * Returns the next state rather than setting it, so nothing here touches
     * React. The effect below owns that, which keeps the only `setState` in a
     * promise callback where it cannot cascade renders.
     */
    const load = useCallback(async (force: boolean): Promise<NextAlarm> => {
        try {
            // A refresh skips the read on purpose: the stored plan is exactly
            // what the user is asking to have recomputed.
            const existing = force ? null : await nextOccurrence();
            const occurrence = existing ?? (await armNextSchedule());

            if (occurrence === null) {
                return { state: 'none', occurrence: null, armed: false, errorCode: null };
            }

            const armed = await arm(occurrence);
            if (armed) {
                // Only once the OS confirms. Reporting an intention would let
                // the server believe a push landed when it had not, which is
                // the one thing this endpoint exists to tell apart.
                await ackOccurrence(occurrence.id, occurrence.currentWakeAt).catch(
                    () => undefined,
                );
            }

            return { state: 'ready', occurrence, armed, errorCode: null };
        } catch (error) {
            return {
                state: 'failed',
                occurrence: null,
                armed: false,
                errorCode: ApiRequestError.from(error).code,
            };
        }
        // No dependencies, and that matters more than it looks. Loading can
        // spend an NS request and re-arm an alarm, so tying it to a value whose
        // identity can change on any render turns one refresh into an unbounded
        // loop of both.
    }, []);

    useEffect(() => {
        let cancelled = false;

        void load(attempt > 0).then((result) => {
            if (!cancelled) {
                setNext(result);
                setBusy(false);
            }
        });

        // Guards against a result landing after the screen is gone, and against
        // an earlier run overwriting a newer one after a refresh.
        return () => {
            cancelled = true;
        };
    }, [load, attempt]);

    /**
     * The previous answer stays on screen while a new one is worked out.
     *
     * Clearing it first blanked the whole screen for as long as the round trip
     * took, which reads as the app losing what it had rather than as it thinking.
     */
    const refresh = useCallback(() => {
        setBusy(true);
        setAttempt((count) => count + 1);
    }, []);

    return { next, busy, refresh };
}

/** Arms the first active schedule, or null when there is nothing to arm. */
async function armNextSchedule(): Promise<OccurrenceResponse | null> {
    const schedules = await listSchedules();
    const active = schedules.find((schedule) => schedule.active);
    return active === undefined ? null : armSchedule(active.id);
}

/**
 * Arms the alarm and reports whether the OS is actually holding it.
 *
 * The check is a read-back rather than a return value: `listScheduled` asks the
 * platform what it has, which is the only source of truth. A build without the
 * native module, or a device that refused the exact-alarm permission, would
 * otherwise report success and ring nothing.
 */
async function arm(occurrence: OccurrenceResponse): Promise<boolean> {
    if (!canGuaranteeAlarm()) {
        return false;
    }

    const scheduler = getAlarmScheduler();
    // Derived from the occurrence, so one morning has exactly one alarm.
    // Re-arming replaces rather than stacks, and a superseded time cannot
    // survive as a second entry that still fires.
    const id = `occurrence-${occurrence.id}`;

    await scheduler.schedule({
        id,
        at: occurrence.currentWakeAt,
        // The i18n instance rather than the hook: this is not React code, and
        // i18n is initialised synchronously exactly so it is safe from here.
        title: i18n.t('alarm.ringing_title'),
        body: i18n.t('home.alarm_body', { name: occurrence.scheduleName }),
        occurrenceId: occurrence.id,
    });

    if (!(await scheduler.listScheduled()).includes(id)) {
        return false;
    }

    // Written only once the OS confirms, because this is what a later push is
    // judged against. Recording an intention would let the monotonic rule
    // compare against a time nothing is holding.
    await rememberHeldAlarm({ occurrenceId: occurrence.id, wakeAt: occurrence.currentWakeAt });
    return true;
}
