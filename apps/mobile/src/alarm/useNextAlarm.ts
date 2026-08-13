import { useCallback, useEffect, useState } from 'react';
import type { SchedulePlanResponse } from '@alarm/types';

import { listSchedules, planSchedule } from '@/api';
import { canGuaranteeAlarm, getAlarmScheduler } from '@/alarm';
import i18n from '@/i18n/i18n';
import { ApiRequestError } from '@/utils/modules/Axios';

/** What the home screen knows about the next morning. */
export interface NextAlarm {
    state: 'loading' | 'ready' | 'none' | 'failed';
    planned: SchedulePlanResponse | null;
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
    planned: null,
    armed: false,
    errorCode: null,
};

/**
 * Plans the next occurrence and arms a real alarm for it.
 *
 * This is the whole product in one hook: a saved schedule becomes a wake time
 * from live NS and TomTom data, and that time becomes an exact alarm the OS
 * holds. Everything before this point was setup.
 *
 * The alarm id is derived from the schedule, so re-arming replaces rather than
 * stacks. Without that, opening the app twice would leave two alarms and the
 * earlier one would fire on a time that had already been superseded.
 *
 * Arming is deliberately not silent about failure. An alarm the user believes
 * is set but which cannot ring is the worst outcome this app has, so a failure
 * leaves `armed` false and the screen says so.
 *
 * M2 replaces the "when the screen opens" trigger with the monitor loop and its
 * pushes. Until then this is honest but manual, which is worth saying on screen
 * rather than implying the alarm keeps itself up to date.
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
    const load = useCallback(async (): Promise<NextAlarm> => {
        try {
            const schedules = await listSchedules();
            const active = schedules.find((schedule) => schedule.active);

            if (active === undefined) {
                return { state: 'none', planned: null, armed: false, errorCode: null };
            }

            const planned = await planSchedule(active.id);
            return {
                state: 'ready',
                planned,
                armed: await arm(planned),
                errorCode: null,
            };
        } catch (error) {
            return {
                state: 'failed',
                planned: null,
                armed: false,
                errorCode: ApiRequestError.from(error).code,
            };
        }
    },
    // No dependencies, and that matters more than it looks. Loading spends an
    // NS request and re-arms an alarm, so tying it to a value whose identity
    // can change on any render (a translation function, say) turns one refresh
    // into an unbounded loop of both.
    []);

    useEffect(() => {
        let cancelled = false;

        void load().then((result) => {
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

/**
 * Arms the alarm and reports whether the OS is actually holding it.
 *
 * The check is a read-back rather than a return value: `listScheduled` asks the
 * platform what it has, which is the only source of truth. A build without the
 * native module, or a device that refused the exact-alarm permission, would
 * otherwise report success and ring nothing.
 */
async function arm(planned: SchedulePlanResponse): Promise<boolean> {
    if (!canGuaranteeAlarm()) {
        return false;
    }

    const scheduler = getAlarmScheduler();
    const id = `schedule-${planned.scheduleId}`;

    await scheduler.schedule({
        id,
        at: planned.plan.wakeUpAt,
        // The i18n instance rather than the hook: this is not React code, and
        // i18n is initialised synchronously exactly so it is safe from here.
        title: i18n.t('alarm.ringing_title'),
        body: i18n.t('home.alarm_body', { name: planned.scheduleName }),
    });

    return (await scheduler.listScheduled()).includes(id);
}
