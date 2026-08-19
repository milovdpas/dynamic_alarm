import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
    AccessMode,
    APP_CONSTANTS,
    DEFAULT_BUFFERS,
    DEFAULT_ROUTINE_STEPS,
    ReplacementPreference,
    TransportMode,
    Weekday,
} from '@alarm/types';
import type { CreateRoutineStepRequest, PlaceSuggestion, Schedule } from '@alarm/types';

import { createPlace, createRoutine, createSchedule, getDevice, updateDevice } from '@/api';

/** A place the user has chosen but which has not been saved yet. */
export interface PlaceDraft {
    label: string;
    address?: string;
    lat: number;
    lng: number;
    nsStationCode?: string;
}

/**
 * A step, with an identity the API does not have and does not need.
 *
 * The list is sent as an array whose position is the order, so the server never
 * sees these. React does: without a stable key, editing a label remounts the row
 * and the field loses focus mid-word, and two steps named the same collapse into
 * one.
 */
export interface RoutineStepDraft extends CreateRoutineStepRequest {
    id: string;
}

export interface OnboardingDraft {
    home: PlaceDraft | null;
    work: PlaceDraft | null;
    routineSteps: RoutineStepDraft[];
    /** Wall-clock, `HH:mm`, in the schedule's own timezone. */
    arrivalTime: string;
    daysOfWeek: Weekday[];
    mode: TransportMode;
    /**
     * How the traveller reaches each station. Separate ends on purpose: the
     * usual Dutch commute is a bike at the home end and a walk at the other,
     * and one setting for both gets one of them wrong.
     */
    originAccess: AccessMode;
    destinationAccess: AccessMode;
    /**
     * Which on-time journey to take, counting back from the latest departure.
     * Zero is the most sleep, and what the engine picks unasked.
     */
    journeyOffset: number;
    /**
     * Which disruptions may move the alarm. All off until asked, because moving
     * somebody's alarm is the most consequential thing this app does and it
     * should happen because they said so.
     */
    allowLaterWakeOnDelay: boolean;
    allowLaterWakeOnCancellation: boolean;
    allowEarlierWakeOnTraffic: boolean;
    /**
     * Which replacement is acceptable when the chosen train is cancelled.
     *
     * Asked here rather than defaulted, which is what onboarding did until
     * 2026-08-19: a schedule arrived with `EARLIER` and no window, so the first
     * cancellation could move somebody's alarm to a train an hour earlier, on a
     * preference they had never been shown and could only find by opening the
     * editor they did not know existed.
     *
     * The window bounds the departure of the first service leg, and empty means
     * any replacement will do, which is the behaviour of a schedule that has
     * never thought about it.
     */
    replacementPreference: ReplacementPreference;
    travelWindowStart: string;
    travelWindowEnd: string;
}

interface OnboardingContextValue {
    draft: OnboardingDraft;
    update: (patch: Partial<OnboardingDraft>) => void;
    /** Sum of the enabled steps, which is what the engine takes. */
    routineMinutes: number;
    addStep: () => void;
    removeStep: (id: string) => void;
    updateStep: (id: string, patch: Partial<CreateRoutineStepRequest>) => void;
    /** Saves everything, in dependency order. Throws `ApiRequestError`. */
    commit: () => Promise<Schedule>;
}

const WEEKDAYS = [
    Weekday.MONDAY,
    Weekday.TUESDAY,
    Weekday.WEDNESDAY,
    Weekday.THURSDAY,
    Weekday.FRIDAY,
];

/**
 * Unique within a session, which is all these ever need to be. They exist for
 * React keys and are dropped before anything is sent.
 *
 * Declared above the only thing that calls it. It was below, which put the
 * counter in its temporal dead zone while the initial draft was being built:
 * the increment produced NaN, every step came out as the same id, and React
 * refused to tell them apart.
 */
let stepCounter = 0;
function nextStepId(): string {
    stepCounter += 1;
    return `step-${String(stepCounter)}`;
}

/**
 * A fresh set of answers.
 *
 * A function rather than a shared constant, so leaving the flow and starting
 * again begins from the defaults instead of from a module-level object every
 * run has been handed, and so each run gets step ids of its own.
 */
function createInitialDraft(): OnboardingDraft {
    return {
        home: null,
        work: null,
        // Editable on the next screen. Starting from something plausible is the
        // difference between a form and a question, and the numbers are the
        // ones the engine already documents as defaults.
        routineSteps: DEFAULT_ROUTINE_STEPS.map((step) => ({
            ...step,
            enabled: true,
            id: nextStepId(),
        })),
        arrivalTime: '08:30',
        daysOfWeek: WEEKDAYS,
        mode: TransportMode.PUBLIC_TRANSPORT,
        originAccess: AccessMode.WALK,
        destinationAccess: AccessMode.WALK,
        journeyOffset: 0,
        allowLaterWakeOnDelay: false,
        allowLaterWakeOnCancellation: false,
        allowEarlierWakeOnTraffic: false,
        // Earlier, because arriving on time is the point of the app, and no
        // window, because inventing hours somebody has not thought about would
        // start refusing replacements they would have taken.
        replacementPreference: ReplacementPreference.EARLIER,
        travelWindowStart: '',
        travelWindowEnd: '',
    };
}

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

/**
 * The answers, held until the end of the flow.
 *
 * Nothing is written to the API while the user is still deciding. Creating each
 * place the moment it is picked would be simpler, but going back a step to
 * change an answer would then mean editing a saved record, and abandoning the
 * flow would leave places nobody asked for.
 */
export function OnboardingProvider({ children }: { children: ReactNode }) {
    const [draft, setDraft] = useState<OnboardingDraft>(createInitialDraft);
    /**
     * For the two records this flow names on the user's behalf.
     *
     * Those names are not internal. The schedule's shows on the schedules list
     * and travels into the alarm notification body, so a hardcoded "Work
     * mornings" was English copy reaching a Dutch user at 06:00, from the one
     * place a search for strings in JSX would never find it.
     */
    const { t } = useTranslation();

    const update = useCallback((patch: Partial<OnboardingDraft>) => {
        setDraft((current) => ({ ...current, ...patch }));
    }, []);

    const addStep = useCallback(() => {
        setDraft((current) => ({
            ...current,
            // Empty and enabled: a new row is a question, and starting it at
            // zero minutes means adding one cannot move the alarm until it has
            // been filled in.
            routineSteps: [
                ...current.routineSteps,
                { id: nextStepId(), label: '', minutes: 0, enabled: true },
            ],
        }));
    }, []);

    const removeStep = useCallback((id: string) => {
        setDraft((current) => ({
            ...current,
            routineSteps: current.routineSteps.filter((step) => step.id !== id),
        }));
    }, []);

    const updateStep = useCallback((id: string, patch: Partial<CreateRoutineStepRequest>) => {
        setDraft((current) => ({
            ...current,
            routineSteps: current.routineSteps.map((step) =>
                step.id === id ? { ...step, ...patch } : step,
            ),
        }));
    }, []);

    const routineMinutes = useMemo(
        () =>
            draft.routineSteps.reduce(
                (total, step) => total + (step.enabled ? step.minutes : 0),
                0,
            ),
        [draft.routineSteps],
    );

    /**
     * Order matters: the schedule names a place and a routine by id, so both
     * have to exist first. Nothing here is a transaction, and it does not need
     * to be. A failure part way through leaves a place or a routine the user can
     * pick again rather than a schedule pointing at nothing.
     */
    const commit = useCallback(async (): Promise<Schedule> => {
        if (draft.home === null || draft.work === null) {
            throw new Error('commit() called before both places were chosen');
        }

        const [home, work] = await Promise.all([
            createPlace(draft.home),
            createPlace(draft.work),
        ]);

        const routine = await createRoutine({
            name: t('onboarding.default_routine_name'),
            // Ids are ours, not the server's, and position is the order.
            steps: draft.routineSteps.map(({ label, minutes, enabled }) => ({
                label,
                minutes,
                enabled,
            })),
        });

        const schedule = await createSchedule({
            name: t('onboarding.default_schedule_name'),
            originPlaceId: home.id,
            destinationPlaceId: work.id,
            routineId: routine.id,
            arrivalTime: draft.arrivalTime,
            daysOfWeek: draft.daysOfWeek,
            mode: draft.mode,
            originAccess: draft.originAccess,
            destinationAccess: draft.destinationAccess,
            journeyOffset: draft.journeyOffset,
            replacementPreference: draft.replacementPreference,
            // Empty means unset rather than midnight, and the two are very
            // different: one accepts any replacement, the other accepts none.
            travelWindowStart: draft.travelWindowStart === '' ? null : draft.travelWindowStart,
            travelWindowEnd: draft.travelWindowEnd === '' ? null : draft.travelWindowEnd,
            buffers: DEFAULT_BUFFERS,
            timezone: APP_CONSTANTS.TIMEZONE,
        });

        // Last, and deliberately not fatal. The schedule is saved by this point,
        // so failing here costs the answers to three switches rather than the
        // whole setup, and the settings screen can still set them.
        try {
            const device = await getDevice();
            await updateDevice(device.deviceId, {
                allowLaterWakeOnDelay: draft.allowLaterWakeOnDelay,
                allowLaterWakeOnCancellation: draft.allowLaterWakeOnCancellation,
                allowEarlierWakeOnTraffic: draft.allowEarlierWakeOnTraffic,
            });
        } catch {
            // Swallowed on purpose. See above.
        }

        return schedule;
    }, [draft, t]);

    const value = useMemo(
        () => ({ draft, update, routineMinutes, addStep, removeStep, updateStep, commit }),
        [draft, update, routineMinutes, addStep, removeStep, updateStep, commit],
    );

    return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>;
}

export function useOnboarding(): OnboardingContextValue {
    const value = useContext(OnboardingContext);
    if (value === null) {
        throw new Error('useOnboarding used outside the onboarding flow');
    }
    return value;
}

/** A suggestion, as the shape a place is created from. */
export function toPlaceDraft(suggestion: PlaceSuggestion, label: string): PlaceDraft {
    return {
        label,
        address: suggestion.label,
        lat: suggestion.lat,
        lng: suggestion.lng,
        nsStationCode: suggestion.nsStationCode,
    };
}
