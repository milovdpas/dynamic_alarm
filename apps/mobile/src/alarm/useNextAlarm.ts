import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { API_ENDPOINTS, OccurrenceState } from '@alarm/types';
import type { OccurrenceResponse, Routine, Schedule } from '@alarm/types';

import {
    ackOccurrence,
    armSchedule,
    listOccurrences,
    listSchedules,
    OCCURRENCES_CACHE_KEY,
} from '@/api';
import { canGuaranteeAlarm, getAlarmScheduler } from '@/alarm';
import { readDisruption, rememberDisruption } from '@/alarm/disruption';
import i18n from '@/i18n/i18n';
import { rememberHeldAlarm } from '@/push/heldAlarm';
import { computeLocalPlans } from '@/alarm/localPlan';
import { peekCache } from '@/utils/modules/ApiCache';
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
    /**
     * Set when this is the stored copy rather than an answer from the server.
     *
     * Rendered, never acted on. See the note on the read below.
     */
    cachedAt: string | null;
    /**
     * True when this phone worked the time out itself, with no server involved.
     *
     * Always shown, never hidden. A wake time computed from a live journey and
     * one computed from "what this took last time, plus ten minutes" are worth
     * different amounts of trust, and only the person being woken can judge
     * that.
     */
    computedLocally: boolean;
}

const LOADING: NextAlarm = {
    state: 'loading',
    occurrence: null,
    armed: false,
    errorCode: null,
    cachedAt: null,
    computedLocally: false,
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
            // A refresh skips the read on purpose: the stored plans are exactly
            // what the user is asking to have recomputed.
            const existing = force ? [] : await listOccurrences({ live: true });
            const occurrences = existing.length > 0 ? existing : await armActiveSchedules();

            // Alarms the OS still holds for mornings that no longer exist. A
            // deleted schedule that keeps ringing is worse than one that never
            // rang, so this runs even when there is nothing left to arm.
            await cancelOrphans(occurrences);

            if (occurrences.length === 0) {
                return {
                    state: 'none',
                    occurrence: null,
                    armed: false,
                    errorCode: null,
                    cachedAt: null,
                    computedLocally: false,
                };
            }

            // Every armed morning is held by the OS, not only the soonest. The
            // schedules list says each one is armed, and it has to be true.
            const armed = await Promise.all(occurrences.map((each) => arm(each)));

            for (const [index, occurrence] of occurrences.entries()) {
                if (armed[index] === true) {
                    // Only once the OS confirms. Reporting an intention would
                    // let the server believe a push landed when it had not,
                    // which is the one thing that endpoint exists to tell apart.
                    await ackOccurrence(occurrence.id, occurrence.currentWakeAt).catch(
                        () => undefined,
                    );
                }
            }

            // The soonest is what Today shows, and the list arrives in that
            // order, so this is the first rather than a search.
            const soonest = occurrences[0];

            if (soonest !== undefined) {
                // Written down for the ring screen, which cannot afford to wait
                // for a request at 06:00. Every time the app learns anything,
                // the alarm screen's copy of it is refreshed.
                await rememberDisruption(soonest.id, readDisruption(soonest)).catch(
                    () => undefined,
                );
            }
            if (soonest === undefined) {
                return {
                    state: 'none',
                    occurrence: null,
                    armed: false,
                    errorCode: null,
                    cachedAt: null,
                    computedLocally: false,
                };
            }

            return {
                state: 'ready',
                occurrence: soonest,
                armed: armed[0] === true,
                errorCode: null,
                cachedAt: null,
                computedLocally: false,
            };
        } catch (error) {
            return {
                state: 'failed',
                occurrence: null,
                armed: false,
                errorCode: ApiRequestError.from(error).code,
                cachedAt: null,
                computedLocally: false,
            };
        }
        // No dependencies, and that matters more than it looks. Loading can
        // spend an NS request and re-arm an alarm, so tying it to a value whose
        // identity can change on any render turns one refresh into an unbounded
        // loop of both.
    }, []);

    /**
     * On focus, not only on mount.
     *
     * Today used to read once per launch, so anything that changed the plan
     * elsewhere left it showing an answer that was true when the app started. A
     * cancellation was the visible case: the journey screen fetched fresh and
     * named the replacement train, and the card on Today still named the one
     * that had been cancelled, from the same occurrence, because it was holding
     * the copy it fetched hours earlier.
     *
     * Cheap to do. The read is a stored plan and spends no provider call; only
     * arming does, and that happens when nothing is armed or the user asks.
     */
    useFocusEffect(
        useCallback(() => {
            let cancelled = false;

            /*
             * The stored copy first, so the wake time is on screen before the
             * network is consulted. **Rendered and nothing else.** Arming from a
             * stored list would let a schedule deleted since be re-armed, and
             * would let `cancelOrphans` cancel an alarm the OS rightly holds
             * because yesterday's list did not mention it. So this sets state
             * and stops; `load` below does the acting, and its read refuses the
             * cache outright.
             *
             * Whether it is armed is read from the OS rather than assumed. That
             * is a local question, answerable with no network, and guessing
             * `false` would put "the alarm is not set" over an alarm that is.
             */
            void peekCache<OccurrenceResponse[]>(OCCURRENCES_CACHE_KEY).then(async (entry) => {
                const soonest = entry?.body[0];
                if (cancelled || entry === null || soonest === undefined) {
                    return;
                }
                const held = await heldByOs(soonest.id);
                if (!cancelled) {
                    setNext((current) =>
                        current.state === 'ready' || current.state === 'none'
                            ? current
                            : {
                                  state: 'ready',
                                  occurrence: soonest,
                                  armed: held,
                                  errorCode: null,
                                  cachedAt: entry.at,
                                  computedLocally: false,
                              },
                    );
                }
            });

            void load(attempt > 0).then(async (result) => {
                if (cancelled) {
                    return;
                }

                /*
                 * Nothing armed and nobody to ask. This is the case the shared
                 * engine was always meant for: the phone has the schedule and
                 * the routine cached, it knows what the journey took last time,
                 * and it can work out a safe wake time on its own rather than
                 * leaving somebody unwoken because a server was unreachable.
                 *
                 * Only when the server actually failed. A server that answered
                 * "nothing is armed" is an answer, and computing over the top of
                 * it would arm a morning for a schedule somebody has paused.
                 */
                const gap = result.state === 'failed' && result.occurrence === null;
                const local = gap ? await armLocally() : null;
                if (cancelled) {
                    return;
                }
                if (local !== null) {
                    setNext(local);
                    setBusy(false);
                    return;
                }

                setNext((current) =>
                    /*
                     * A failed refresh keeps what is already on screen. The
                     * cached morning is still the one this phone will ring at,
                     * since the OS is holding it, so replacing it with an error
                     * would throw away the true answer to show a problem the
                     * user cannot act on.
                     */
                    result.state === 'failed' && current.occurrence !== null
                        ? { ...current, errorCode: result.errorCode }
                        : result,
                );
                setBusy(false);
            });

            // Guards against a result landing after the screen is gone, and
            // against an earlier run overwriting a newer one after a refresh.
            return () => {
                cancelled = true;
            };
        }, [load, attempt]),
    );

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
 * Works out the next morning on this device, and arms it.
 *
 * Everything it needs is already cached: the schedules, the routines, and the
 * occurrences whose travel times it borrows. Returns null when any of that is
 * missing, because guessing at somebody's morning is worse than admitting the
 * alarm could not be worked out.
 *
 * The alarm it arms is real and it is pessimistic, which is the same bargain the
 * anchor has always made: a time computed with no live data should sit on the
 * safe side, since being woken early costs a few minutes and being woken late
 * costs the morning.
 */
async function armLocally(): Promise<NextAlarm | null> {
    const [schedules, routines, occurrences] = await Promise.all([
        peekCache<Schedule[]>(API_ENDPOINTS.SCHEDULES.LIST),
        peekCache<Routine[]>(API_ENDPOINTS.ROUTINES.LIST),
        peekCache<OccurrenceResponse[]>(OCCURRENCES_CACHE_KEY),
    ]);

    if (schedules === null || routines === null || occurrences === null) {
        return null;
    }

    const [soonest] = computeLocalPlans({
        schedules: schedules.body,
        routines: routines.body,
        knownOccurrences: occurrences.body,
        now: new Date().toISOString(),
    });

    if (soonest === undefined) {
        return null;
    }

    /*
     * Shaped as an occurrence so every screen below reads it the same way. It
     * carries no journey, which is honest: nothing planned one. The id is the
     * schedule's rather than an invented one, so that when the server comes back
     * and arms the real morning, `cancelOrphans` cancels this in the ordinary
     * way instead of leaving two alarms for one Thursday.
     */
    const occurrence: OccurrenceResponse = {
        id: `local-${soonest.scheduleId}`,
        scheduleId: soonest.scheduleId,
        scheduleName: soonest.scheduleName,
        date: soonest.date,
        state: OccurrenceState.ARMED,
        anchorWakeAt: soonest.plan.wakeUpAt,
        currentWakeAt: soonest.plan.wakeUpAt,
        departHomeAt: soonest.plan.departHomeAt,
        journey: null,
        replacedJourney: null,
        plan: soonest.plan,
        lastCheckedAt: null,
        simulated: null,
    };

    const armed = await arm(occurrence);

    return {
        state: 'ready',
        occurrence,
        armed,
        errorCode: null,
        cachedAt: null,
        computedLocally: true,
    };
}

/**
 * Whether the OS is holding an alarm for this morning.
 *
 * A local question with a local answer, which is what makes it usable beside a
 * cached occurrence: no network, no server, just what the platform says it has.
 */
async function heldByOs(occurrenceId: string): Promise<boolean> {
    if (!canGuaranteeAlarm()) {
        return false;
    }
    try {
        return (await getAlarmScheduler().listScheduled()).includes(`occurrence-${occurrenceId}`);
    } catch {
        return false;
    }
}

/**
 * Arms every active schedule, soonest first.
 *
 * All of them, not the first. A schedule is a standing commitment rather than a
 * mode: weekdays to work and a Saturday morning are both true at once, and
 * arming only one of them silently drops the other on the day it matters.
 *
 * One schedule failing does not take the others down. A schedule whose place was
 * deleted, or whose journey cannot be planned tonight, is a reason to lose that
 * alarm and not the rest of them.
 */
async function armActiveSchedules(): Promise<OccurrenceResponse[]> {
    const schedules = await listSchedules();
    const active = schedules.filter((schedule) => schedule.active);

    const armed = await Promise.all(
        active.map((schedule) => armSchedule(schedule.id).catch(() => null)),
    );

    return armed
        .filter((occurrence): occurrence is OccurrenceResponse => occurrence !== null)
        .sort((a, b) => a.currentWakeAt.localeCompare(b.currentWakeAt));
}

/**
 * Cancels OS alarms whose occurrence is gone.
 *
 * A deleted or paused schedule leaves its alarm armed in the OS, and the OS does
 * not care that the server has forgotten it: it would ring at 06:00 for a
 * commute nobody is making. Only alarms this app owns are touched, matched by
 * the `occurrence-` prefix, so the M0 harness alarms are left alone.
 */
async function cancelOrphans(occurrences: OccurrenceResponse[]): Promise<void> {
    if (!canGuaranteeAlarm()) {
        return;
    }

    const scheduler = getAlarmScheduler();
    const wanted = new Set(occurrences.map((occurrence) => `occurrence-${occurrence.id}`));

    for (const id of await scheduler.listScheduled()) {
        if (id.startsWith('occurrence-') && !wanted.has(id)) {
            await scheduler.cancel(id).catch(() => undefined);
        }
    }
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
