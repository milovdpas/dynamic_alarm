import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { OnboardingProvider } from '@/utils/contexts/OnboardingContext';

/**
 * The setup flow, and the only place the onboarding draft exists.
 *
 * The provider sits here rather than at the root so the answers live exactly as
 * long as the flow does. Leaving halfway and coming back starts a fresh one,
 * which is the honest behaviour when nothing was saved.
 */
export default function OnboardingLayout() {
    const { t } = useTranslation();

    return (
        <OnboardingProvider>
            <Stack>
                <Stack.Screen name="places" options={{ title: t('onboarding.places_title') }} />
                <Stack.Screen name="routine" options={{ title: t('onboarding.routine_title') }} />
                <Stack.Screen name="schedule" options={{ title: t('onboarding.schedule_title') }} />
            </Stack>
        </OnboardingProvider>
    );
}
