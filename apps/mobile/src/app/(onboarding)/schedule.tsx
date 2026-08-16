import { useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { APP_CONSTANTS, DEFAULT_BUFFERS } from '@alarm/types';
import type { WakePlan } from '@alarm/types';

import { apiErrorMessage } from '@/utils/apiErrorMessage';
import { planOptions } from '@/api';
import { Radius, Spacing } from '@/assets/Stylesheet';
import ActionButton from '@/components/buttons/ActionButton';
import JourneyOptions from '@/components/ui/JourneyOptions';
import TimeField from '@/components/ui/TimeField';
import { ThemedText } from '@/components/ui/ThemedText';
import { ThemedView } from '@/components/ui/ThemedView';
import WarningBanner from '@/components/ui/WarningBanner';
import WeekdayPicker from '@/components/ui/WeekdayPicker';
import { useOnboarding } from '@/utils/contexts/OnboardingContext';
import { ApiRequestError } from '@/utils/modules/Axios';

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * The deadline, the days, and the first real answer the app gives.
 *
 * The preview is the point of the whole flow. It runs the same engine the
 * monitor will, against live NS and TomTom data, so what is shown here is the
 * actual commute rather than an illustration.
 */
export default function ScheduleStep() {
    const { t } = useTranslation();
    const router = useRouter();
    const { draft, update, routineMinutes } = useOnboarding();


    const [options, setOptions] = useState<WakePlan[] | null>(null);
    const [busy, setBusy] = useState(false);
    const [errorCode, setErrorCode] = useState<string | null>(null);

    const timeValid = TIME_PATTERN.test(draft.arrivalTime);
    const ready = timeValid && draft.daysOfWeek.length > 0;

    const preview = () => {
        if (draft.home === null || draft.work === null) {
            return;
        }
        setBusy(true);
        setErrorCode(null);

        void planOptions({
            origin: { lat: draft.home.lat, lng: draft.home.lng },
            destination: { lat: draft.work.lat, lng: draft.work.lng },
            arrivalTime: draft.arrivalTime,
            mode: draft.mode,
            originAccess: draft.originAccess,
            destinationAccess: draft.destinationAccess,
            routineMinutes,
            buffers: DEFAULT_BUFFERS,
            timezone: APP_CONSTANTS.TIMEZONE,
        })
            .then((results) => {
                setOptions(results);
                // The engine's own choice, which is the most sleep, so the
                // screen opens on the answer someone who has no preference
                // would want anyway.
                update({ journeyOffset: 0 });
            })
            .catch((error: unknown) => {
                setErrorCode(ApiRequestError.from(error).code);
                setOptions(null);
            })
            .finally(() => {
                setBusy(false);
            });
    };

    // Nothing is saved yet. The last step asks whether the alarm may move once
    // things go wrong, and commits everything together.
    const next = () => {
        router.push('/(onboarding)/adjustments');
    };

    return (
        <ThemedView style={styles.flex}>
            <SafeAreaView style={styles.flex} edges={['bottom']}>
                <ScrollView
                    contentContainerStyle={styles.content}
                    keyboardShouldPersistTaps="handled"
                >
                    <ThemedText type="subtitle">{t('onboarding.schedule_intro')}</ThemedText>

                    <TimeField
                        label={t('schedule.arrival_time')}
                        value={draft.arrivalTime}
                        onChange={(arrivalTime) => {
                            update({ arrivalTime });
                            // The options below were computed for the old
                            // deadline, so they are now wrong. Clearing them is
                            // more honest than leaving stale times on screen.
                            setOptions(null);
                        }}
                        error={timeValid ? undefined : t('schedule.arrival_time_invalid')}
                    />

                    <WeekdayPicker
                        value={draft.daysOfWeek}
                        onChange={(daysOfWeek) => {
                            update({ daysOfWeek });
                        }}
                    />

                    <ActionButton
                        label={busy ? t('schedule.working') : t('schedule.preview')}
                        onPress={preview}
                        disabled={!ready || busy}
                    />

                    {errorCode !== null && (
                        <WarningBanner
                            title={t('schedule.preview_failed')}
                            message={apiErrorMessage(t, errorCode)}
                        />
                    )}

                    {options !== null && (
                        <>
                            <JourneyOptions
                                options={options}
                                selected={draft.journeyOffset}
                                onSelect={(journeyOffset) => {
                                    update({ journeyOffset });
                                }}
                            />
                            <ActionButton
                                label={t('common.next')}
                                variant="primary"
                                onPress={next}
                                disabled={busy}
                            />
                        </>
                    )}

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
        padding: Spacing.medium,
        gap: Spacing.medium,
    },
    days: {
        flexDirection: 'row',
        gap: Spacing.extraSmall,
    },
    day: {
        flex: 1,
        alignItems: 'center',
        borderWidth: 1,
        borderRadius: Radius.small,
        paddingVertical: Spacing.small,
    },
});
