import { Platform } from 'react-native';

import type { AlarmDiagnostics, AlarmSoundChoice, AlarmVolumeInfo } from '@modules/alarm-sound';
import type { AlarmPermissionStatus } from '@/alarm';
import type { ApiConnection } from '@/api/registration';
import appConfig from '@/config';
import type { NativeModuleStatus } from './nativeDiagnostics';
import type { RunningBundle } from './Updates';

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
    /**
     * The API check, including the failure when there is one.
     *
     * The reason this is here: `state` collapses every possible failure into
     * `unreachable`, which was true of a 401 and a 500 as much as of a dead
     * network, and left "cannot reach the API" as the only clue for three
     * completely different problems. `errorCode` and `errorDetail` are what
     * separate them, and neither was in the report.
     */
    connection: ApiConnection | null;
    /** Which JavaScript is running: embedded, an update, or Metro. */
    bundle: RunningBundle | null;
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
        connection,
        bundle,
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
        '--- api ---',
        `address:          ${connection?.apiUrl ?? 'not configured'}${connection?.inferred === true ? ' (guessed from Metro)' : ''}`,
        `state:            ${connection?.state ?? 'unknown'}`,
        `error code:       ${connection?.errorCode ?? 'none'}`,
        // The English message from axios or the server. Not shown to users, and
        // the single most useful line here: "Network Error" and "Request failed
        // with status code 401" are the same word on screen and different bugs.
        `error detail:     ${connection?.errorDetail ?? 'none'}`,
        `push token:       ${connection?.pushToken ?? 'unknown'}`,
        `device id:        ${connection?.device?.deviceId ?? 'none'}`,
        '',
        '--- running code ---',
        `app version:      ${appConfig.appVersion}`,
        // Not "development (Metro)". `readRunningBundle` also answers null when
        // expo-updates is missing or throws, so a release APK could paste a
        // claim about itself that is plainly false, one line above `update id:
        // none (embedded)` contradicting it.
        `source:           ${
            bundle === null
                ? 'unknown (expo-updates did not answer; Metro, or the module is absent)'
                : bundle.fromUpdate
                  ? 'from an update'
                  : 'built into the app'
        }`,
        `update id:        ${bundle?.updateId ?? 'none (embedded)'}`,
        `published:        ${bundle?.publishedAt ?? 'n/a'}`,
        `channel:          ${bundle?.channel ?? 'none'}`,
        `runtime version:  ${bundle?.runtimeVersion ?? 'unknown'}`,
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
