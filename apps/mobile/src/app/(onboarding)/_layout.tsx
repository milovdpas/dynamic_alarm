import { StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Radius, Spacing } from '@/assets/Stylesheet';
import { ThemedText } from '@/components/ui/ThemedText';
import { OnboardingProvider, useOnboarding } from '@/utils/contexts/OnboardingContext';
import { useThemeColor } from '@/utils/hooks/useThemeColor';

/**
 * The setup flow, and the only place the onboarding draft exists.
 *
 * The provider sits here rather than at the root so the answers live exactly as
 * long as the flow does. Leaving halfway and coming back starts a fresh one,
 * which is the honest behaviour when nothing was saved.
 */
export default function OnboardingLayout() {
    return (
        <OnboardingProvider>
            <RehearsalNotice />
            <OnboardingStack />
        </OnboardingProvider>
    );
}

/**
 * Says so, on every screen, when the flow is only being looked at.
 *
 * Inside the provider so it can read the flag, and above the stack so it stays
 * put while the steps change. A rehearsal that looked exactly like the real
 * thing would end with somebody pressing the last button, watching it succeed
 * and finding no alarm, which is the failure this app is least allowed to have.
 */
function RehearsalNotice() {
    const { t } = useTranslation();
    const { rehearsing } = useOnboarding();
    const warning = useThemeColor({}, 'warning');

    if (!rehearsing) {
        return null;
    }

    return (
        <View style={[styles.notice, { borderColor: warning }]}>
            <ThemedText type="smallBold" style={{ color: warning }}>
                {t('harness.onboarding_rehearsal')}
            </ThemedText>
        </View>
    );
}

function OnboardingStack() {
    const { t } = useTranslation();

    return (
        <Stack>
                <Stack.Screen name="places" options={{ title: t('onboarding.places_title') }} />
                <Stack.Screen name="routine" options={{ title: t('onboarding.routine_title') }} />
                <Stack.Screen name="schedule" options={{ title: t('onboarding.schedule_title') }} />
                <Stack.Screen
                    name="adjustments"
                    options={{ title: t('onboarding.adjustments_title') }}
                />
                <Stack.Screen
                    name="permissions"
                    options={{
                        title: t('permissions.title'),
                        // No way back. The schedule is already saved by the time
                        // this shows, so returning to the previous step would
                        // offer to save it a second time.
                        headerBackVisible: false,
                        gestureEnabled: false,
                    }}
                />
        </Stack>
    );
}

const styles = StyleSheet.create({
    notice: {
        borderWidth: 1,
        borderRadius: Radius.small,
        margin: Spacing.medium,
        padding: Spacing.small,
    },
});
