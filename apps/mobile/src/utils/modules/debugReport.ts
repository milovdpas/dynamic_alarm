import { Platform } from 'react-native';

import type { AlarmDiagnostics, AlarmSoundChoice, AlarmVolumeInfo } from '@modules/alarm-sound';
import type { AlarmPermissionStatus } from '@/alarm';
import type { NativeModuleStatus } from './nativeDiagnostics';

export interface DebugReportInput {
    diagnostics: AlarmDiagnostics | null;
    permissions: AlarmPermissionStatus | null;
    fullScreen: boolean | null;
    unrestricted: boolean | null;
    volume: AlarmVolumeInfo | null;
    sound: AlarmSoundChoice | null;
    scheduled: string[];
    missedCount: number;
    nativeModules: NativeModuleStatus[];
}

/**
 * Everything worth knowing about a device, as plain text.
 *
 * Deliberately not translated. This is written to be pasted into a bug report or
 * a chat, where the reader may not share the tester's language, and where an
 * exact timestamp matters more than a nicely worded one. It is the one place in
 * the app where English strings are correct.
 */
export function buildDebugReport(input: DebugReportInput): string {
    const {
        diagnostics,
        permissions,
        fullScreen,
        unrestricted,
        volume,
        sound,
        scheduled,
        missedCount,
        nativeModules,
    } = input;

    const time = (millis: number | undefined) =>
        millis === undefined || millis === 0 ? 'never' : new Date(millis).toISOString();

    const lines = [
        '=== Dynamic Alarm debug report ===',
        `generated:        ${new Date().toISOString()}`,
        `platform:         ${Platform.OS} ${String(Platform.Version)}`,
        '',
        '--- boot / re-arm ---',
        `device booted:    ${time(diagnostics?.deviceBootedAt)}`,
        `boot receiver:    ${
            diagnostics == null
                ? 'unknown'
                : diagnostics.bootRearmRanThisBoot
                  ? `ran ${Math.round(diagnostics.bootRearmDelayMs / 1000)}s after boot`
                  : 'DID NOT RUN THIS BOOT'
        }`,
        `boot runs ever:   ${diagnostics?.bootRearmCount ?? 0}`,
        `last boot re-arm: ${time(diagnostics?.lastBootRearmAt)}`,
        `last re-arm:      ${diagnostics?.lastRearmSource ?? 'none'} at ${time(diagnostics?.lastRearmAt)}`,
        `missed at re-arm: ${diagnostics?.lastRearmMissedCount ?? 0}`,
        `native error:     ${diagnostics?.lastError ?? 'none'}`,
        '',
        '--- permissions ---',
        `notifications:    ${describe(permissions?.notifications)}`,
        `exact alarms:     ${describe(permissions?.exactAlarm)}`,
        `full-screen:      ${describe(fullScreen)}`,
        `unrestricted:     ${describe(unrestricted)}`,
        '',
        '--- alarm state ---',
        `scheduled:        ${scheduled.length > 0 ? scheduled.join(', ') : 'none'}`,
        `missed pending:   ${missedCount}`,
        `sound:            ${sound?.label ?? 'device default'}`,
        `alarm volume:     ${volume === null ? 'unknown' : `${volume.current}/${volume.max}`}`,
        '',
        '--- native modules ---',
        ...nativeModules.map(
            (module) => `${module.name.padEnd(18)}${module.available ? 'linked' : 'MISSING'}`,
        ),
    ];

    return lines.join('\n');
}

function describe(value: boolean | null | undefined): string {
    if (value === null || value === undefined) {
        return 'unknown';
    }
    return value ? 'granted' : 'MISSING';
}
