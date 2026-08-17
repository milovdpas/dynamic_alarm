import { useCallback, useEffect, useState } from 'react';
import { AppState, Linking } from 'react-native';

import {
    canUseFullScreenIntent,
    isIgnoringBatteryOptimizations,
    openFullScreenIntentSettings,
    requestIgnoreBatteryOptimizations,
} from '@modules/alarm-sound';

import { getAlarmScheduler } from '@/alarm';
import { getAlarmSupport } from '@/alarm/alarmSupport';

/**
 * Everything the OS has to allow before this app can wake somebody.
 *
 * Two tiers, and the difference matters more than the list does.
 *
 * `notifications` and `exactAlarm` are **required**: without them the alarm
 * either cannot show the screen that stops it, or rings at a time the system
 * chose rather than the one the user needs. Neither is a degraded alarm, both
 * are a broken one.
 *
 * `fullScreen` and `unrestrictedBattery` are **recommended**: the alarm still
 * rings without them, but it may not cover the lock screen, and Doze may
 * interfere with the work around it. Asked for, never insisted on.
 */
export interface AlarmPermissions {
    notifications: boolean;
    exactAlarm: boolean;
    fullScreen: boolean;
    unrestrictedBattery: boolean;
}

export interface AlarmPermissionState {
    /** Null until the first read finishes, so nothing renders a guess. */
    permissions: AlarmPermissions | null;
    /** False when a required permission is missing. */
    canRing: boolean;
    /** True when only the recommended ones are missing. */
    hasGaps: boolean;
    /** Nothing to ask for on this runtime: Expo Go, iOS, an old build. */
    unsupported: boolean;
    /** The system dialog, for the ones that have one. */
    request: () => Promise<void>;
    /** The app's own settings page, for a permission already refused once. */
    openSettings: () => Promise<void>;
    requestFullScreen: () => Promise<void>;
    requestUnrestrictedBattery: () => Promise<void>;
    refresh: () => Promise<void>;
}

const NONE: AlarmPermissions = {
    notifications: false,
    exactAlarm: false,
    fullScreen: false,
    unrestrictedBattery: false,
};

/**
 * Reads them now, and again every time the app comes back to the foreground.
 *
 * The re-read is the point, not a refinement. Two of these are granted on a
 * system settings screen that hands back no result, so the only way to learn the
 * answer is to look again once the user returns. And every one of them can be
 * revoked from Android settings at any time, so a grant from three weeks ago is
 * not evidence about tonight. An alarm app that trusts a remembered yes is
 * making exactly the promise it cannot keep.
 */
export function useAlarmPermissions(): AlarmPermissionState {
    const support = getAlarmSupport();
    const unsupported = !support.canScheduleAlarms;

    const [permissions, setPermissions] = useState<AlarmPermissions | null>(
        unsupported ? NONE : null,
    );

    const refresh = useCallback(async () => {
        if (unsupported) {
            return;
        }
        const status = await getAlarmScheduler().getPermissions();

        // Each optional read is guarded on its own: a module that predates one
        // of these should cost that answer, not all four.
        const [fullScreen, battery] = await Promise.all([
            canUseFullScreenIntent().catch(() => false),
            isIgnoringBatteryOptimizations().catch(() => false),
        ]);

        setPermissions({
            notifications: status.notifications,
            exactAlarm: status.exactAlarm,
            fullScreen,
            unrestrictedBattery: battery,
        });
    }, [unsupported]);

    useEffect(() => {
        // Deferred by a microtask rather than called straight out of the effect.
        // Every read here is asynchronous already, so this changes no behaviour,
        // and it keeps the state update plainly outside the render pass that
        // scheduled it, which is what react-hooks/set-state-in-effect is for.
        void Promise.resolve().then(refresh);

        const subscription = AppState.addEventListener('change', (state) => {
            if (state === 'active') {
                void refresh();
            }
        });
        return () => {
            subscription.remove();
        };
    }, [refresh]);

    const request = useCallback(async () => {
        if (unsupported) {
            return;
        }
        await getAlarmScheduler().requestPermissions();
        await refresh();
    }, [refresh, unsupported]);

    /*
     * Android shows the notification dialog once. After a refusal the same call
     * returns "denied" without anything appearing on screen, which looks to the
     * user like a button that does nothing, so the second attempt has to be a
     * trip to the app's own settings page.
     */
    const openSettings = useCallback(async () => {
        await Linking.openSettings();
    }, []);

    const requestFullScreen = useCallback(async () => {
        await openFullScreenIntentSettings();
    }, []);

    const requestUnrestrictedBattery = useCallback(async () => {
        await requestIgnoreBatteryOptimizations();
    }, []);

    return {
        permissions,
        // Unknown is not treated as broken: the banner would flash on every
        // launch while the first read completes.
        canRing: permissions === null || (permissions.notifications && permissions.exactAlarm),
        hasGaps:
            permissions !== null && (!permissions.fullScreen || !permissions.unrestrictedBattery),
        unsupported,
        request,
        openSettings,
        requestFullScreen,
        requestUnrestrictedBattery,
        refresh,
    };
}
