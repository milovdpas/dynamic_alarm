import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { AccessMode, TransportMode } from '@alarm/types';

import { Spacing } from '@/assets/Stylesheet';
import ActionButton from '@/components/buttons/ActionButton';
import AddressSearch from '@/components/places/AddressSearch';
import ChoiceRow from '@/components/ui/ChoiceRow';
import DetailRow from '@/components/ui/DetailRow';
import { ThemedText } from '@/components/ui/ThemedText';
import { ThemedView } from '@/components/ui/ThemedView';
import { toPlaceDraft, useOnboarding } from '@/utils/contexts/OnboardingContext';

/**
 * Where the journey starts and ends.
 *
 * Coordinates rather than stations. The planner works out which station is
 * nearest and how long it takes to reach, so asking the user to name one would
 * be asking them to do arithmetic the API already does, and to get it right:
 * the nearest station by distance is not always one trains stop at.
 *
 * How they reach it is the one thing the API cannot work out, and it is worth
 * more than it looks. A two-kilometre access leg is about twenty-five minutes
 * walking and about seven cycling, applied straight to the wake-up time. Until
 * this was asked, everyone was assumed to walk.
 */
export default function PlacesStep() {
    const { t } = useTranslation();
    const router = useRouter();
    const { draft, update } = useOnboarding();

    const ready = draft.home !== null && draft.work !== null;
    // A car journey has no station to reach, so the question does not apply.
    const publicTransport = draft.mode === TransportMode.PUBLIC_TRANSPORT;

    const accessChoices = [
        { value: AccessMode.WALK, label: t('travel.walk') },
        { value: AccessMode.BIKE, label: t('travel.bike') },
    ];

    return (
        <ThemedView style={styles.flex}>
            <SafeAreaView style={styles.flex} edges={['bottom']}>
                <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
                    <ThemedText type="subtitle">{t('onboarding.places_intro')}</ThemedText>

                    <ChoiceRow
                        label={t('travel.mode')}
                        value={draft.mode}
                        onChange={(mode) => {
                            update({ mode });
                        }}
                        choices={[
                            {
                                value: TransportMode.PUBLIC_TRANSPORT,
                                label: t('travel.public_transport'),
                            },
                            { value: TransportMode.CAR, label: t('travel.car') },
                        ]}
                    />

                    <View style={styles.section}>
                        <AddressSearch
                            label={t('places.home_label')}
                            placeholder={t('places.home_placeholder')}
                            onSelect={(suggestion) => {
                                update({ home: toPlaceDraft(suggestion, t('onboarding.home')) });
                            }}
                        />
                        {draft.home !== null && (
                            <DetailRow
                                label={t('onboarding.home')}
                                value={draft.home.address ?? draft.home.label}
                            />
                        )}
                        {publicTransport && (
                            <ChoiceRow
                                label={t('travel.origin_access')}
                                value={draft.originAccess}
                                onChange={(originAccess) => {
                                    update({ originAccess });
                                }}
                                choices={accessChoices}
                            />
                        )}
                    </View>

                    <View style={styles.section}>
                        <AddressSearch
                            label={t('places.work_label')}
                            placeholder={t('places.work_placeholder')}
                            onSelect={(suggestion) => {
                                update({ work: toPlaceDraft(suggestion, t('onboarding.work')) });
                            }}
                        />
                        {draft.work !== null && (
                            <DetailRow
                                label={t('onboarding.work')}
                                value={draft.work.address ?? draft.work.label}
                            />
                        )}
                        {publicTransport && (
                            <ChoiceRow
                                label={t('travel.destination_access')}
                                value={draft.destinationAccess}
                                onChange={(destinationAccess) => {
                                    update({ destinationAccess });
                                }}
                                choices={accessChoices}
                            />
                        )}
                    </View>

                    <ActionButton
                        label={t('common.next')}
                        variant="primary"
                        disabled={!ready}
                        onPress={() => {
                            router.push('/(onboarding)/routine');
                        }}
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
        gap: Spacing.large,
    },
    section: {
        gap: Spacing.small,
    },
});
