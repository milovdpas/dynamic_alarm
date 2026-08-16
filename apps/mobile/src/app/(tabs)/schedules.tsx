import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useFocusEffect, useRouter } from 'expo-router';
import type { OccurrenceResponse, Schedule } from '@alarm/types';

import { deleteSchedule, listOccurrences, listSchedules, updateSchedule } from '@/api';
import { Spacing } from '@/assets/Stylesheet';
import ActionButton from '@/components/buttons/ActionButton';
import { ThemedText } from '@/components/ui/ThemedText';
import { ThemedView } from '@/components/ui/ThemedView';
import WarningBanner from '@/components/ui/WarningBanner';
import { apiErrorMessage } from '@/utils/apiErrorMessage';
import { clock, relativeDay } from '@/utils/time';
import { useThemeColor } from '@/utils/hooks/useThemeColor';
import { ApiRequestError } from '@/utils/modules/Axios';

/**
 * Every schedule, with the time it will actually wake you.
 *
 * The armed occurrence is shown beside each row rather than only whether the
 * schedule is active, because "active" answers a question nobody asked. What
 * someone checks the night before is what time they are getting up, and a list
 * that cannot say that is a list of settings rather than of alarms.
 *
 * Both reads are free: schedules come from the database, and the occurrences
 * carry plans that were stored when they were armed. Opening this tab spends no
 * provider call.
 */
export default function SchedulesScreen() {
    const { t } = useTranslation();
    const router = useRouter();
    const border = useThemeColor({}, 'border');

    const [schedules, setSchedules] = useState<Schedule[] | null>(null);
    const [armed, setArmed] = useState<OccurrenceResponse[]>([]);
    const [errorCode, setErrorCode] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        try {
            const [saved, occurrences] = await Promise.all([listSchedules(), listOccurrences()]);
            setSchedules(saved);
            setArmed(occurrences);
            setErrorCode(null);
        } catch (error) {
            setErrorCode(ApiRequestError.from(error).code);
        }
    }, []);

    // On focus rather than on mount: coming back from the editor must show the
    // change that was just made, and a stale list here is a list somebody will
    // act on.
    useFocusEffect(
        useCallback(() => {
            void load();
        }, [load]),
    );

    const togglePaused = useCallback(
        async (schedule: Schedule) => {
            setBusy(true);
            try {
                await updateSchedule(schedule.id, { active: !schedule.active });
                await load();
            } catch (error) {
                setErrorCode(ApiRequestError.from(error).code);
            } finally {
                setBusy(false);
            }
        },
        [load],
    );

    const confirmDelete = useCallback(
        (schedule: Schedule) => {
            // Destructive and not obviously reversible, so it asks. The armed
            // occurrence goes with it, which is the part someone would not
            // expect from a row that only says a name.
            Alert.alert(t('schedules.delete_title'), t('schedules.delete_body'), [
                { text: t('common.cancel'), style: 'cancel' },
                {
                    text: t('schedules.delete_confirm'),
                    style: 'destructive',
                    onPress: () => {
                        setBusy(true);
                        deleteSchedule(schedule.id)
                            .then(load)
                            .catch((error: unknown) => {
                                setErrorCode(ApiRequestError.from(error).code);
                            })
                            .finally(() => {
                                setBusy(false);
                            });
                    },
                },
            ]);
        },
        [load, t],
    );

    return (
        <ThemedView style={styles.flex}>
            <SafeAreaView style={styles.flex} edges={['top', 'bottom']}>
                <ScrollView contentContainerStyle={styles.content}>
                    <ThemedText type="title">{t('tabs.schedules')}</ThemedText>

                    {errorCode !== null && (
                        <WarningBanner
                            title={t('schedules.failed')}
                            message={apiErrorMessage(t, errorCode)}
                        />
                    )}

                    {schedules !== null && schedules.length === 0 && (
                        <ThemedText themeColor="textSecondary">{t('schedules.empty')}</ThemedText>
                    )}

                    {schedules?.map((schedule) => (
                        <ScheduleCard
                            key={schedule.id}
                            schedule={schedule}
                            occurrence={armed.find(
                                (occurrence) => occurrence.scheduleId === schedule.id,
                            )}
                            borderColor={border}
                            busy={busy}
                            onEdit={() => {
                                router.push({
                                    pathname: '/schedules/[id]/overview',
                                    params: { id: schedule.id },
                                });
                            }}
                            onTogglePaused={() => void togglePaused(schedule)}
                            onDelete={() => {
                                confirmDelete(schedule);
                            }}
                        />
                    ))}

                    <ActionButton
                        label={t('schedules.add')}
                        variant="primary"
                        disabled={busy}
                        onPress={() => {
                            router.push('/(onboarding)/places');
                        }}
                    />
                </ScrollView>
            </SafeAreaView>
        </ThemedView>
    );
}

function ScheduleCard({
    schedule,
    occurrence,
    borderColor,
    busy,
    onEdit,
    onTogglePaused,
    onDelete,
}: {
    schedule: Schedule;
    occurrence: OccurrenceResponse | undefined;
    borderColor: string;
    busy: boolean;
    onEdit: () => void;
    onTogglePaused: () => void;
    onDelete: () => void;
}) {
    const { t } = useTranslation();

    return (
        <Pressable
            style={[styles.card, { borderColor }]}
            onPress={onEdit}
            accessibilityRole="button"
            accessibilityLabel={schedule.name}
        >
            <View style={styles.row}>
                <ThemedText type="smallBold">{schedule.name}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                    {t('schedules.arrive_by', { time: schedule.arrivalTime })}
                </ThemedText>
            </View>

            <ThemedText type="small" themeColor="textSecondary">
                {days(t, schedule.daysOfWeek)}
            </ThemedText>

            {/*
             * The line that makes this a list of alarms rather than of settings.
             * A paused schedule says so; an active one that has nothing armed
             * says that too, because the difference matters at bedtime.
             */}
            <ThemedText type="smallBold" themeColor={schedule.active ? 'text' : 'textSecondary'}>
                {!schedule.active
                    ? t('schedules.paused')
                    : occurrence === undefined
                      ? t('schedules.not_armed')
                      : t('schedules.armed_for', {
                            time: clock(occurrence.currentWakeAt),
                            day: relativeDay(t, occurrence.date),
                        })}
            </ThemedText>

            <View style={styles.actions}>
                <ActionButton
                    label={t('schedules.edit')}
                    variant="primary"
                    disabled={busy}
                    onPress={onEdit}
                />
                <ActionButton
                    label={schedule.active ? t('schedules.pause') : t('schedules.resume')}
                    disabled={busy}
                    onPress={onTogglePaused}
                />
                <ActionButton label={t('schedules.delete')} disabled={busy} onPress={onDelete} />
            </View>
        </Pressable>
    );
}

/** Compact weekday list, using the abbreviations the schedule screen already has. */
function days(t: (key: string) => string, weekdays: number[]): string {
    return weekdays.map((day) => t(`schedule.day_short.${String(day)}`)).join(' ');
}

const styles = StyleSheet.create({
    flex: { flex: 1 },
    content: { padding: Spacing.large, gap: Spacing.medium },
    card: { borderWidth: 1, borderRadius: 12, padding: Spacing.medium, gap: Spacing.extraSmall },
    row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    actions: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: Spacing.small,
        marginTop: Spacing.extraSmall,
    },
});
