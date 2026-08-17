import { useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { apiErrorMessage } from '@/utils/apiErrorMessage';
import { Spacing } from '@/assets/Stylesheet';
import ActionButton from '@/components/buttons/ActionButton';
import DisruptionSettings, { settingsForModes } from '@/components/settings/DisruptionSettings';
import { ThemedText } from '@/components/ui/ThemedText';
import { ThemedView } from '@/components/ui/ThemedView';
import WarningBanner from '@/components/ui/WarningBanner';
import { useOnboarding } from '@/utils/contexts/OnboardingContext';
import { ApiRequestError } from '@/utils/modules/Axios';

/**
 * Whether the alarm may move once things go wrong, and the last step.
 *
 * Asked rather than assumed. Moving somebody's alarm is the most consequential
 * thing this app does, and doing it because nobody objected is the wrong way
 * round, so every switch starts off and this screen is where they get turned on.
 *
 * Only the ones the chosen mode can act on are shown. A car journey has no train
 * to be delayed, and a train journey has no traffic; offering both would put
 * switches in front of someone that can never do anything.
 *
 * Saving happens here because this is the end of the flow, and everything before
 * it was held as a draft rather than written as it was answered.
 */
export default function AdjustmentsStep() {
    const { t } = useTranslation();
    const router = useRouter();
    const { draft, update, commit } = useOnboarding();

    const [busy, setBusy] = useState(false);
    const [errorCode, setErrorCode] = useState<string | null>(null);

    const settings = settingsForModes([draft.mode]);

    const finish = () => {
        setBusy(true);
        setErrorCode(null);

        void commit()
            .then(() => {
                // replace, not push: the answers are saved, and going back into
                // a finished flow would let someone create the whole thing twice.
                //
                // On to permissions rather than into the app. This is the moment
                // the request explains itself: somebody has just described the
                // morning they want waking for, and the next screen asks for
                // what that takes. Asked on first launch it arrives before the
                // app has said what it is for and gets refused by reflex.
                router.replace('/(onboarding)/permissions');
            })
            .catch((error: unknown) => {
                setErrorCode(ApiRequestError.from(error).code);
            })
            .finally(() => {
                setBusy(false);
            });
    };

    return (
        <ThemedView style={styles.flex}>
            <SafeAreaView style={styles.flex} edges={['bottom']}>
                <ScrollView contentContainerStyle={styles.content}>
                    <ThemedText type="subtitle">{t('onboarding.adjustments_intro')}</ThemedText>

                    {settings.length === 0 ? (
                        <ThemedText themeColor="textSecondary">
                            {t('onboarding.adjustments_none')}
                        </ThemedText>
                    ) : (
                        <DisruptionSettings
                            settings={settings}
                            values={{
                                allowLaterWakeOnDelay: draft.allowLaterWakeOnDelay,
                                allowLaterWakeOnCancellation:
                                    draft.allowLaterWakeOnCancellation,
                                allowEarlierWakeOnTraffic: draft.allowEarlierWakeOnTraffic,
                            }}
                            onChange={(setting, value) => {
                                update({ [setting]: value });
                            }}
                            disabled={busy}
                        />
                    )}

                    <ThemedText type="small" themeColor="textSecondary">
                        {t('onboarding.adjustments_changeable')}
                    </ThemedText>

                    {errorCode !== null && (
                        <WarningBanner
                            title={t('schedule.preview_failed')}
                            message={apiErrorMessage(t, errorCode)}
                        />
                    )}

                    <ActionButton
                        label={t('schedule.finish')}
                        variant="primary"
                        onPress={finish}
                        disabled={busy}
                    />
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
});
