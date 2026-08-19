import { NativeModule, requireOptionalNativeModule } from 'expo';

import type {
    AlarmDiagnostics,
    AlarmSoundChoice,
    AlarmVolumeInfo,
    MissedAlarm,
    NativeAlarmConfig,
} from './AlarmSound.types';

declare class AlarmSoundModule extends NativeModule {
    getDefaultAlarmSound(): Promise<AlarmSoundChoice | null>;
    getSoundLabel(uri: string): Promise<string>;
    /** Opens the OS ringtone picker. Resolves null when the user backs out. */
    pickAlarmSound(currentUri: string | null): Promise<AlarmSoundChoice | null>;
    play(uri: string | null, loop?: boolean, volume?: number): Promise<void>;
    stop(): Promise<void>;
    isPlaying(): Promise<boolean>;
    getAlarmVolume(): Promise<AlarmVolumeInfo>;
    canUseFullScreenIntent(): Promise<boolean>;
    /** Lets this activity cover the lock screen, or stops it. */
    setShowWhenLocked(enabled: boolean): Promise<void>;
    scheduleAlarm(config: NativeAlarmConfig): Promise<void>;
    cancelAlarm(id: string): Promise<void>;
    cancelAllAlarms(): Promise<void>;
    getScheduledAlarmIds(): Promise<string[]>;
    getMissedAlarms(): Promise<MissedAlarm[]>;
    clearMissedAlarms(): Promise<void>;
    getAlarmDiagnostics(): Promise<AlarmDiagnostics>;
    isIgnoringBatteryOptimizations(): Promise<boolean>;
    requestIgnoreBatteryOptimizations(): Promise<void>;
    getRingingAlarm(): Promise<{ alarmId: string; isRinging: boolean } | null>;
    stopRingingAlarm(id: string): Promise<void>;
    snoozeRingingAlarm(id: string): Promise<void>;
    canScheduleExactAlarms(): Promise<boolean>;
    openExactAlarmSettings(): Promise<void>;
    moveAppToBackground(): Promise<void>;
    openFullScreenIntentSettings(): Promise<void>;
}

/**
 * Null whenever the native module is absent, Expo Go, or a dev build made
 * before this module existed.
 *
 * `requireOptionalNativeModule` rather than `requireNativeModule` on purpose:
 * the throwing variant fails at *import* time, which takes down every module
 * that transitively imports it. In practice that meant the router reporting
 * "Route is missing the required default export" for unrelated screens and the
 * whole app failing to mount, a confusing symptom a long way from its cause.
 */
export default requireOptionalNativeModule<AlarmSoundModule>('AlarmSound');
