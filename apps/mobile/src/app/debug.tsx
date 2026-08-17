import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { DateTime } from 'luxon';
import * as Clipboard from 'expo-clipboard';

import { APP_CONSTANTS, DEFAULT_BUFFERS, SimulationKind, TransportMode } from '@alarm/types';
import type { OccurrenceResponse, WakePlan } from '@alarm/types';
import { FixtureTransportProvider, planWake } from '@alarm/core';

import {
    canPickSystemAlarmSound,
    canUseFullScreenIntent,
    getAlarmVolume,
    getDefaultAlarmSound,
    clearMissedAlarms,
    getAlarmDiagnostics,
    getMissedAlarms,
    isIgnoringBatteryOptimizations,
    requestIgnoreBatteryOptimizations,
    openFullScreenIntentSettings,
    pickAlarmSound,
    type AlarmSoundChoice,
    type AlarmVolumeInfo,
    type AlarmDiagnostics,
    type MissedAlarm,
} from '@modules/alarm-sound';
import { apiErrorMessage } from '@/utils/apiErrorMessage';
import { canGuaranteeAlarm, getAlarmScheduler, getAlarmSupport, isFullyPermitted } from '@/alarm';
import type { AlarmPermissionStatus } from '@/alarm';
import { Spacing } from '@/assets/Stylesheet';
import ActionButton from '@/components/buttons/ActionButton';
import DetailRow from '@/components/ui/DetailRow';
import { ThemedText } from '@/components/ui/ThemedText';
import { ThemedView } from '@/components/ui/ThemedView';
import WarningBanner from '@/components/ui/WarningBanner';
import { nextOccurrence, simulateOccurrence } from '@/api';
import { registerWakeChangePushTask } from '@/push/backgroundTask';
import { readHeldAlarm, type HeldAlarm } from '@/push/heldAlarm';
import { clearPushLog, readPushLog, type PushLogEntry } from '@/push/pushLog';
import { useApiConnection } from '@/utils/hooks/useApiConnection';
import { clock } from '@/utils/time';
import { ApiRequestError } from '@/utils/modules/Axios';
import { buildDebugReport } from '@/utils/modules/debugReport';
import {
    getMissingNativeModules,
    getNativeModuleStatuses,
} from '@/utils/modules/nativeDiagnostics';

const TEST_ALARM_ID = 'm0-test-alarm';
const SECOND_ALARM_ID = 'm0-test-alarm-2';

/** One line summarising the most recent re-arm, for the harness row. */
function formatLastRearm(diagnostics: AlarmDiagnostics): string {
    const at = new Date(diagnostics.lastRearmAt).toLocaleTimeString();
    const source = diagnostics.lastRearmSource ?? '?';
    return source + ' @ ' + at + ' (missed ' + diagnostics.lastRearmMissedCount + ')';
}

/** One line describing a handled push, for the diagnostics row. */
function formatPush(entry: PushLogEntry): string {
    const at = new Date(entry.at).toLocaleTimeString();
    const wake = new Date(entry.wakeAt).toLocaleTimeString();
    return `${at} -> ${wake} (${entry.outcome})`;
}

/**
 * M0 harness.
 *
 * Not the product, a rig for proving the one thing the whole product rests on:
 * that a real alarm fires on a real device through lock, force-quit, reboot,
 * battery saver and Do Not Disturb. Replaced by the real UI in M1.
 */
export default function DebugScreen() {
    const { t } = useTranslation();
    const [permissions, setPermissions] = useState<AlarmPermissionStatus | null>(null);
    const [volume, setVolume] = useState<AlarmVolumeInfo | null>(null);
    const [fullScreen, setFullScreen] = useState<boolean | null>(null);
    const [missed, setMissed] = useState<MissedAlarm[]>([]);
    const [diagnostics, setDiagnostics] = useState<AlarmDiagnostics | null>(null);
    const [unrestricted, setUnrestricted] = useState<boolean | null>(null);
    const [sound, setSound] = useState<AlarmSoundChoice | null>(null);
    const [scheduled, setScheduled] = useState<string[]>([]);
    const [status, setStatus] = useState('');
    const [plan, setPlan] = useState<WakePlan | null>(null);
    const support = getAlarmSupport();
    const missingModules = getMissingNativeModules();
    const nativeModules = getNativeModuleStatuses();

    const refresh = useCallback(async () => {
        const scheduler = getAlarmScheduler();
        setPermissions(await scheduler.getPermissions());
        setScheduled(await scheduler.listScheduled());
        setVolume(await getAlarmVolume());
        setFullScreen(await canUseFullScreenIntent());
        setMissed(await getMissedAlarms());
        setDiagnostics(await getAlarmDiagnostics());
        setUnrestricted(await isIgnoringBatteryOptimizations());
    }, []);

    useEffect(() => {
        // Every setState below happens after an await, i.e. in a later tick, the
        // rule cannot see through the async boundary and flags it anyway.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        void refresh();
        void getDefaultAlarmSound().then(setSound);

        // Exercises the shared engine on-device, which doubles as proof that
        // Metro really is resolving @alarm/core across the workspace.
        const arriveAt = DateTime.now()
            .setZone(APP_CONSTANTS.TIMEZONE)
            .plus({ days: 1 })
            .set({ hour: 8, minute: 30, second: 0, millisecond: 0 });

        void planWake(
            {
                requiredArrivalAt: arriveAt.toISO() ?? '',
                mode: TransportMode.PUBLIC_TRANSPORT,
                origin: { lat: 52.0907, lng: 5.1214 },
                destination: { lat: 52.3791, lng: 4.9003 },
                routineMinutes: 35,
                buffers: DEFAULT_BUFFERS,
                timezone: APP_CONSTANTS.TIMEZONE,
            },
            new FixtureTransportProvider(),
        ).then(setPlan);
    }, [refresh]);

    const grant = useCallback(async () => {
        setPermissions(await getAlarmScheduler().requestPermissions());
        await refresh();
    }, [refresh]);

    const grantUnrestricted = useCallback(async () => {
        await requestIgnoreBatteryOptimizations();
        setTimeout(() => void refresh(), 1000);
    }, [refresh]);

    const acknowledgeMissed = useCallback(async () => {
        await clearMissedAlarms();
        setMissed([]);
    }, []);

    const grantFullScreen = useCallback(async () => {
        await openFullScreenIntentSettings();
        // The user leaves the app to flip the switch; re-read it when they return.
        setTimeout(() => void refresh(), 1000);
    }, [refresh]);

    const choose = useCallback(async () => {
        const picked = await pickAlarmSound(sound?.uri ?? null);
        if (picked !== null) {
            setSound(picked);
        }
    }, [sound]);

    const scheduleIn = useCallback(
        async (seconds: number, id: string = TEST_ALARM_ID) => {
            try {
                const at = new Date(Date.now() + seconds * 1000);
                await getAlarmScheduler().schedule({
                    id,
                    at: at.toISOString(),
                    title: t('alarm.ringing_title'),
                    body: t('harness.title'),
                    soundUri: sound?.uri ?? null,
                });
                setStatus(t('harness.armed_for', { time: at.toLocaleTimeString() }));
                await refresh();
            } catch (error) {
                setStatus(error instanceof Error ? error.message : String(error));
            }
        },
        [refresh, sound, t],
    );

    /**
     * Copies the whole device state as text.
     *
     * Screenshots are how we lost time on the boot-receiver question: they show
     * a rendered value but not the raw one, and cannot be searched or diffed
     * between runs. Text can be pasted straight into a report.
     */
    const copyDebug = useCallback(async () => {
        const report = buildDebugReport({
            diagnostics,
            permissions,
            fullScreen,
            unrestricted,
            volume,
            sound,
            scheduled,
            missedCount: missed.length,
            nativeModules,
        });
        await Clipboard.setStringAsync(report);
        setStatus(t('diagnostics.copied'));
    }, [
        diagnostics,
        permissions,
        fullScreen,
        unrestricted,
        volume,
        sound,
        scheduled,
        missed.length,
        nativeModules,
        t,
    ]);

    const { connection, retry: retryApi } = useApiConnection();

    /**
     * Whether this device can be told to move an alarm while it is asleep.
     *
     * Registration is attempted on every launch anyway; this reads back the
     * answer, because the only part of the system that runs while nobody is
     * watching is also the only part that cannot report itself any other way.
     */
    /**
     * The morning a simulation would be staged against.
     *
     * The soonest armed one, because that is the alarm about to happen and the
     * only one worth testing against. Null when nothing is armed, in which case
     * there is nothing to disrupt and the buttons say so instead of failing.
     */
    const [occurrence, setOccurrence] = useState<OccurrenceResponse | null>(null);
    const [simulating, setSimulating] = useState(false);

    const [pushRegistered, setPushRegistered] = useState<boolean | null>(null);
    const [held, setHeld] = useState<HeldAlarm | null>(null);
    const [pushLog, setPushLog] = useState<PushLogEntry[]>([]);

    useEffect(() => {
        let cancelled = false;
        // A 404 means nothing is armed, which is an ordinary answer here.
        void nextOccurrence()
            .then((next) => {
                if (!cancelled) {
                    setOccurrence(next);
                }
            })
            .catch(() => undefined);

        void Promise.all([registerWakeChangePushTask(), readHeldAlarm(), readPushLog()]).then(
            ([registered, current, log]) => {
                if (!cancelled) {
                    setPushRegistered(registered);
                    setHeld(current);
                    setPushLog(log);
                }
            },
        );
        return () => {
            cancelled = true;
        };
    }, []);

    /**
     * Stages a pretend disruption, or clears one.
     *
     * Reports the outcome into the same status line the rest of this panel
     * uses, including failures: this is the screen where a broken thing should
     * say so rather than look inert.
     */
    const simulate = useCallback(
        async (kind: SimulationKind | null) => {
            if (occurrence === null) {
                return;
            }
            setSimulating(true);
            try {
                const updated = await simulateOccurrence(occurrence.id, kind, 20);
                setOccurrence(updated);
                setStatus(
                    kind === null ? t('simulate.cleared') : t('simulate.staged'),
                );
            } catch (error) {
                setStatus(apiErrorMessage(t, ApiRequestError.from(error).code));
            } finally {
                setSimulating(false);
            }
        },
        [occurrence, t],
    );

    const clearPushes = useCallback(async () => {
        await clearPushLog();
        setPushLog([]);
    }, []);

    const cancelAll = useCallback(async () => {
        await getAlarmScheduler().cancelAll();
        setStatus(t('harness.all_cancelled'));
        await refresh();
    }, [refresh, t]);

    return (
        <ThemedView style={styles.flex}>
            <SafeAreaView style={styles.flex} edges={['bottom']}>
                <ScrollView contentContainerStyle={styles.content}>
                    <ThemedText type="title">{t('harness.title')}</ThemedText>

                    {missingModules.length > 0 && (
                        <WarningBanner
                            title={t('diagnostics.rebuild_title')}
                            message={t('diagnostics.rebuild_message', {
                                names: missingModules.map((module) => module.name).join(', '),
                            })}
                        />
                    )}

                    {missed.length > 0 && (
                        <View style={styles.section}>
                            <WarningBanner
                                title={t('alarm.missed_title')}
                                message={t('alarm.missed_notice', { count: missed.length })}
                            />
                            <ActionButton
                                label={t('alarm.missed_ack')}
                                onPress={acknowledgeMissed}
                            />
                        </View>
                    )}

                    {support.reasonKey !== null && (
                        <WarningBanner
                            title={t('alarm.unavailable_title')}
                            message={t(support.reasonKey)}
                        />
                    )}

                    {volume?.isMuted === true && (
                        <WarningBanner
                            title={t('harness.alarm_volume')}
                            message={t('alarm.volume_muted')}
                        />
                    )}

                    <Section title={t('harness.platform')}>
                        <DetailRow
                            label={t('harness.real_alarm')}
                            value={
                                canGuaranteeAlarm() ? t('common.yes') : t('harness.no_ios_fallback')
                            }
                            warn={!canGuaranteeAlarm()}
                        />
                        <DetailRow
                            label={t('diagnostics.device_booted')}
                            value={
                                diagnostics == null
                                    ? t('common.unknown')
                                    : new Date(diagnostics.deviceBootedAt).toLocaleTimeString()
                            }
                        />
                        <DetailRow
                            label={t('diagnostics.boot_receiver')}
                            value={
                                diagnostics == null
                                    ? t('common.unknown')
                                    : diagnostics.bootRearmRanThisBoot
                                      ? t('diagnostics.boot_ran_after', {
                                            seconds: Math.round(
                                                diagnostics.bootRearmDelayMs / 1000,
                                            ),
                                        })
                                      : t('diagnostics.boot_not_this_boot', {
                                            count: diagnostics.bootRearmCount,
                                        })
                            }
                            warn={diagnostics != null && !diagnostics.bootRearmRanThisBoot}
                        />
                        <DetailRow
                            label={t('diagnostics.last_rearm')}
                            value={
                                diagnostics == null || diagnostics.lastRearmAt === 0
                                    ? t('harness.none')
                                    : formatLastRearm(diagnostics)
                            }
                        />
                        {diagnostics?.lastError != null && (
                            <DetailRow
                                label={t('diagnostics.last_error')}
                                value={diagnostics.lastError}
                                warn
                            />
                        )}
                        {nativeModules.map((module) => (
                            <DetailRow
                                key={module.name}
                                // Deliberately untranslated: this is the native
                                // module's own identifier, not user-facing copy.
                                label={module.name}
                                value={
                                    module.available
                                        ? t('diagnostics.linked')
                                        : t('diagnostics.missing')
                                }
                                warn={!module.available}
                            />
                        ))}
                        <ActionButton label={t('diagnostics.copy')} onPress={copyDebug} />
                    </Section>

                    <Section title={t('api.title')}>
                        <DetailRow
                            label={t('api.address')}
                            value={
                                connection?.apiUrl === null || connection?.apiUrl === undefined
                                    ? t('api.not_configured')
                                    : connection.inferred
                                      ? t('api.address_inferred', { url: connection.apiUrl })
                                      : connection.apiUrl
                            }
                            warn={connection?.apiUrl === null}
                        />
                        <DetailRow
                            label={t('api.title')}
                            value={
                                connection === null
                                    ? t('api.registering')
                                    : t(`api.${connection.state}`)
                            }
                            warn={
                                connection?.state === 'unreachable' ||
                                connection?.state === 'not_configured'
                            }
                        />
                        <DetailRow
                            label={t('api.push_token')}
                            value={
                                connection === null
                                    ? t('common.unknown')
                                    : t(`api.push.${connection.pushToken}`)
                            }
                            warn={
                                connection !== null &&
                                connection.pushToken !== 'registered' &&
                                connection.pushToken !== 'not_attempted'
                            }
                        />
                        {connection?.errorCode != null && (
                            <WarningBanner
                                title={t(`api.${connection.state}`)}
                                message={apiErrorMessage(t, connection.errorCode)}
                            />
                        )}
                        {connection !== null && connection.state !== 'registering' && (
                            <ActionButton label={t('api.retry')} onPress={retryApi} />
                        )}
                    </Section>

                    {/*
                     * Test tools, and the only place in the app that asks the
                     * server to lie. Behind the debug gate because a simulated
                     * disruption moves a real alarm, and nobody should meet that
                     * by accident.
                     */}
                    <Section title={t('simulate.title')}>
                        <ThemedText type="small" themeColor="textSecondary">
                            {t('simulate.help')}
                        </ThemedText>

                        <DetailRow
                            label={t('simulate.target')}
                            value={
                                occurrence === null
                                    ? t('harness.none')
                                    : `${occurrence.scheduleName} ${clock(occurrence.currentWakeAt)}`
                            }
                            warn={occurrence === null}
                        />
                        <DetailRow
                            label={t('simulate.staged_label')}
                            value={occurrence?.simulated ?? t('harness.none')}
                            warn={occurrence?.simulated != null}
                        />

                        <ActionButton
                            label={t('simulate.delay')}
                            disabled={occurrence === null || simulating}
                            onPress={() => void simulate(SimulationKind.DELAY)}
                        />
                        <ActionButton
                            label={t('simulate.cancellation')}
                            disabled={occurrence === null || simulating}
                            onPress={() => void simulate(SimulationKind.CANCELLATION)}
                        />
                        {occurrence?.simulated != null && (
                            <ActionButton
                                label={t('simulate.clear')}
                                disabled={simulating}
                                onPress={() => void simulate(null)}
                            />
                        )}
                    </Section>

                    <Section title={t('push.title')}>
                        <DetailRow
                            label={t('push.background_task')}
                            value={
                                pushRegistered === null
                                    ? t('common.unknown')
                                    : pushRegistered
                                      ? t('diagnostics.linked')
                                      : t('diagnostics.missing')
                            }
                            warn={pushRegistered === false}
                        />
                        <DetailRow
                            label={t('push.held')}
                            value={
                                held === null
                                    ? t('harness.none')
                                    : new Date(held.wakeAt).toLocaleString()
                            }
                        />
                        {pushLog.length === 0 ? (
                            <DetailRow label={t('push.received')} value={t('harness.none')} />
                        ) : (
                            pushLog.map((entry) => (
                                <DetailRow
                                    key={entry.at}
                                    label={t('push.received')}
                                    value={formatPush(entry)}
                                    warn={entry.outcome !== 'APPLIED'}
                                />
                            ))
                        )}
                        {pushLog.length > 0 && (
                            <ActionButton label={t('push.clear')} onPress={clearPushes} />
                        )}
                    </Section>

                    <Section title={t('permissions.title')}>
                        <DetailRow
                            label={t('permissions.notifications')}
                            value={
                                permissions?.notifications
                                    ? t('permissions.granted')
                                    : t('permissions.missing')
                            }
                            warn={permissions?.notifications === false}
                        />
                        <DetailRow
                            label={t('permissions.exact_alarms')}
                            value={
                                permissions?.exactAlarm
                                    ? t('permissions.granted')
                                    : t('permissions.missing')
                            }
                            warn={permissions?.exactAlarm === false}
                        />
                        <DetailRow
                            label={t('permissions.full_screen')}
                            value={
                                fullScreen === null
                                    ? t('common.unknown')
                                    : fullScreen
                                      ? t('permissions.granted')
                                      : t('permissions.missing')
                            }
                            warn={fullScreen === false}
                        />
                        {permissions !== null && !isFullyPermitted(permissions) && (
                            <ActionButton label={t('permissions.grant')} onPress={grant} />
                        )}
                        <DetailRow
                            label={t('permissions.battery')}
                            value={
                                unrestricted === null
                                    ? t('common.unknown')
                                    : unrestricted
                                      ? t('permissions.granted')
                                      : t('permissions.missing')
                            }
                            warn={unrestricted === false}
                        />
                        {unrestricted === false && (
                            <ActionButton
                                label={t('permissions.grant_battery')}
                                onPress={grantUnrestricted}
                                variant="primary"
                            />
                        )}
                        {fullScreen === false && (
                            <ActionButton
                                label={t('permissions.grant_full_screen')}
                                onPress={grantFullScreen}
                                variant="primary"
                            />
                        )}
                    </Section>

                    <Section title={t('harness.sound')}>
                        <DetailRow
                            label={t('harness.selected')}
                            value={sound?.label ?? t('harness.device_default')}
                        />
                        <DetailRow
                            label={t('harness.alarm_volume')}
                            value={
                                volume === null
                                    ? t('common.unknown')
                                    : `${volume.current}/${volume.max}`
                            }
                            warn={volume?.isMuted === true}
                        />
                        {canPickSystemAlarmSound && (
                            <ActionButton label={t('harness.pick_sound')} onPress={choose} />
                        )}
                    </Section>

                    <Section title={t('harness.fire_test')}>
                        <ActionButton
                            label={t('harness.in_seconds', { count: 30 })}
                            onPress={() => scheduleIn(30)}
                            disabled={!support.canScheduleAlarms}
                            variant="primary"
                        />
                        <ActionButton
                            label={t('harness.in_minutes', { count: 2 })}
                            onPress={() => scheduleIn(120)}
                            disabled={!support.canScheduleAlarms}
                        />
                        <ActionButton
                            label={t('harness.in_minutes', { count: 10 })}
                            onPress={() => scheduleIn(600)}
                            disabled={!support.canScheduleAlarms}
                        />
                        <ActionButton
                            label={t('harness.second_alarm')}
                            onPress={() => scheduleIn(90, SECOND_ALARM_ID)}
                            disabled={!support.canScheduleAlarms}
                        />
                        <ActionButton label={t('harness.cancel_all')} onPress={cancelAll} />
                        <DetailRow
                            label={t('harness.scheduled_with_os')}
                            value={scheduled.length > 0 ? scheduled.join(', ') : t('harness.none')}
                        />
                        {status !== '' && <ThemedText type="small">{status}</ThemedText>}
                    </Section>

                    <Section title={t('harness.engine')}>
                        {plan === null ? (
                            <ThemedText type="small">{t('harness.calculating')}</ThemedText>
                        ) : (
                            <>
                                <DetailRow
                                    label={t('common.wake_up')}
                                    value={formatTime(plan.wakeUpAt)}
                                />
                                <DetailRow
                                    label={t('common.leave_home')}
                                    value={formatTime(plan.departHomeAt)}
                                />
                                <DetailRow
                                    label={t('plan.travel')}
                                    value={t('common.minutes_short', {
                                        count: plan.breakdown.travelMinutes,
                                    })}
                                />
                                <DetailRow
                                    label={t('plan.risk_buffer')}
                                    value={t('common.minutes_short', {
                                        count: plan.breakdown.riskBufferMinutes,
                                    })}
                                />
                                <DetailRow
                                    label={t('plan.routine')}
                                    value={t('common.minutes_short', {
                                        count: plan.breakdown.routineMinutes,
                                    })}
                                />
                                <DetailRow
                                    label={t('plan.feasible')}
                                    value={
                                        plan.feasible
                                            ? t('common.yes')
                                            : t('plan.infeasible', {
                                                  minutes: plan.shortfallMinutes,
                                              })
                                    }
                                    warn={!plan.feasible}
                                />
                            </>
                        )}
                    </Section>
                </ScrollView>
            </SafeAreaView>
        </ThemedView>
    );
}

function formatTime(iso: string): string {
    return DateTime.fromISO(iso, { setZone: true })
        .setZone(APP_CONSTANTS.TIMEZONE)
        .toFormat('HH:mm');
}


function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <View style={styles.section}>
            <ThemedText type="subtitle">{title}</ThemedText>
            {children}
        </View>
    );
}

const styles = StyleSheet.create({
    flex: {
        flex: 1,
    },
    content: {
        padding: Spacing.large,
        gap: Spacing.large,
    },
    section: {
        gap: Spacing.small,
    },
});
