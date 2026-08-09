import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import { useRootNavigationState, useRouter } from 'expo-router';

import { getRingingAlarm } from '@modules/alarm-sound';

import { hasAlarmNativeModule } from './alarmSupport';

/**
 * Sends the app to the ring screen whenever an alarm is actually sounding.
 *
 * The signal is **"is the native service ringing right now?"**, asked of the
 * service itself. Not "which notification launched the app": a full-screen
 * intent starts the activity directly rather than through a notification press,
 * so any initial-notification API returns nothing, and relying on one left the
 * user on the home screen with the alarm blaring.
 *
 * Checked at two moments, because one is not enough:
 *
 *  1. **On mount**, covering a cold start where the alarm launched the process.
 *  2. **On resume**, covering an app that was merely backgrounded when the alarm
 *     fired. No remount happens then, so a mount-only check never runs and the
 *     user unlocks to the wrong screen.
 */
export function useAlarmRouting(): void {
    const router = useRouter();
    // `push` before the navigator has mounted is silently dropped, and a cold
    // start from a full-screen intent is exactly when that race happens.
    const navigationReady = useRootNavigationState()?.key !== undefined;
    // Which alarm we have already opened the ring screen for.
    const routedAlarmId = useRef<string | null>(null);

    useEffect(() => {
        if (Platform.OS !== 'android' || !hasAlarmNativeModule() || !navigationReady) {
            return;
        }
        let cancelled = false;

        const routeIfRinging = () => {
            void getRingingAlarm()
                .then((ringing) => {
                    if (cancelled) {
                        return;
                    }
                    if (ringing === null || !ringing.isRinging) {
                        // Nothing sounding, so let the next alarm route freely.
                        routedAlarmId.current = null;
                        return;
                    }
                    // Guard against pushing /ring twice for one alarm: the mount
                    // check and a resume check can both see the same ringing
                    // alarm, and stacking ring screens would mean several
                    // dismisses before the user is rid of it.
                    if (routedAlarmId.current === ringing.alarmId) {
                        return;
                    }
                    routedAlarmId.current = ringing.alarmId;
                    router.push({
                        pathname: '/ring',
                        params: { alarmId: ringing.alarmId, takeover: 'true' },
                    });
                })
                .catch(() => undefined);
        };

        routeIfRinging();
        const subscription = AppState.addEventListener('change', (state) => {
            if (state === 'active') {
                routeIfRinging();
            }
        });

        return () => {
            cancelled = true;
            subscription.remove();
        };
    }, [router, navigationReady]);
}
