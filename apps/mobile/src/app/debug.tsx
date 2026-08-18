import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import * as Clipboard from 'expo-clipboard';

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
import { canGuaranteeAlarm, getAlarmScheduler, getAlarmSupport, isFullyPermitted } from '@/alarm';
import type { AlarmPermissionStatus } from '@/alarm';
import { Spacing } from '@/assets/Stylesheet';
import ActionButton from '@/components/buttons/ActionButton';
import ApiSection from '@/components/debug/ApiSection';
import BundleSection from '@/components/debug/BundleSection';
import EngineSection from '@/components/debug/EngineSection';
import PushSection from '@/components/debug/PushSection';
import RingPreviewSection from '@/components/debug/RingPreviewSection';
import Section from '@/components/debug/Section';
import SimulationSection from '@/components/debug/SimulationSection';
import DetailRow from '@/components/ui/DetailRow';
import { ThemedText } from '@/components/ui/ThemedText';
import { ThemedView } from '@/components/ui/ThemedView';
import WarningBanner from '@/components/ui/WarningBanner';
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

/**
 * M0 harness.
 *
 * Not the product, a rig for proving the one thing the whole product rests on:
 * that a real alarm fires on a real device through lock, force-quit, reboot,
 * battery saver and Do Not Disturb. Replaced by the real UI in M1.
 *
 * What stays in this file is the alarm hardware: permissions, the native
 * diagnostics, the tone, and the buttons that arm a test alarm. Those all read
 * and re-read one cluster of state through `refresh`, so they belong together.
 * A section that owns its own state belongs in `components/debug/` instead.
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

                    <BundleSection />

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

                    <ApiSection />

                    <RingPreviewSection />

                    {/*
                     * The only place in the app that asks the server to lie.
                     * Behind the debug gate because a simulated disruption
                     * moves a real alarm, and nobody should meet that by
                     * accident. Its outcome goes to the status line below.
                     */}
                    <SimulationSection onStatus={setStatus} />

                    <PushSection />

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

                    <EngineSection />
                </ScrollView>
            </SafeAreaView>
        </ThemedView>
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
