import { Platform } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';

import { isAlarmSoundAvailable } from '@modules/alarm-sound';

/** True when running inside the Expo Go sandbox, which has no custom native code. */
export const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

/**
 * Whether the native alarm module is present in this binary.
 *
 * Checked lazily rather than at module scope: on the New Architecture the
 * TurboModule is not installed until the runtime is ready, so a top-level probe
 * can report "missing" for a module that appears moments later. `get` returns
 * null instead of throwing, unlike `getEnforcing`.
 */
export function hasAlarmNativeModule(): boolean {
    return Platform.OS === 'android' && isAlarmSoundAvailable;
}

export interface AlarmSupport {
    /** Can we schedule an OS-level alarm that survives lock, doze and reboot? */
    canScheduleAlarms: boolean;
    /** Can we play a looping sound on the alarm stream? */
    canPlayAlarmSound: boolean;
    /**
     * i18n key explaining why support is missing, or null when all is well.
     *
     * A key rather than a sentence: this module runs outside React and has no
     * business deciding what language the user reads. The component translates.
     */
    reasonKey: string | null;
}

/**
 * What this build can actually promise.
 *
 * The point is to let the app run everywhere, Expo Go included, so the engine
 * and the UI stay workable without a 15-minute native build, while never
 * letting a user arm an alarm that physically cannot ring.
 */
export function getAlarmSupport(): AlarmSupport {
    const canScheduleAlarms = hasAlarmNativeModule();
    const canPlayAlarmSound = isAlarmSoundAvailable;

    if (canScheduleAlarms && canPlayAlarmSound) {
        return { canScheduleAlarms, canPlayAlarmSound, reasonKey: null };
    }
    if (isExpoGo) {
        return { canScheduleAlarms, canPlayAlarmSound, reasonKey: 'alarm.expo_go' };
    }
    if (Platform.OS === 'ios') {
        return { canScheduleAlarms, canPlayAlarmSound, reasonKey: 'alarm.ios_not_ready' };
    }
    return { canScheduleAlarms, canPlayAlarmSound, reasonKey: 'alarm.missing_modules' };
}
