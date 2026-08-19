import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { AccessMode, ReplacementPreference, TransportMode } from '@alarm/types';
import type { Place, Schedule } from '@alarm/types';

import { updatePlace, updateSchedule } from '@/api';
import { Spacing } from '@/assets/Stylesheet';
import ActionButton from '@/components/buttons/ActionButton';
import AddressSearch from '@/components/places/AddressSearch';
import ChoiceRow from '@/components/ui/ChoiceRow';
import ReplacementSection from '@/components/schedule/ReplacementSection';
import DetailRow from '@/components/ui/DetailRow';
import TextField from '@/components/ui/TextField';
import { ThemedText } from '@/components/ui/ThemedText';
import { ThemedView } from '@/components/ui/ThemedView';
import WarningBanner from '@/components/ui/WarningBanner';
import { useScheduleBundle } from '@/schedule/useScheduleBundle';
import { apiErrorMessage } from '@/utils/apiErrorMessage';
import { ApiRequestError } from '@/utils/modules/Axios';

/** An address as this screen holds it, before anything is saved. */
interface AddressDraft {
    address: string;
    lat: number;
    lng: number;
}

/**
 * Where this schedule travels, and how.
 *
 * The two addresses, the mode, and for a train journey how the station is
 * reached at either end. All of it was answerable only during onboarding until
 * now, which made moving house a reason to start again.
 */
export default function TravelScreen() {
    const { t } = useTranslation();
    const { id } = useLocalSearchParams<{ id: string }>();
    const { bundle, errorCode: loadError } = useScheduleBundle(id);

    return (
        <ThemedView style={styles.flex}>
            <SafeAreaView style={styles.flex} edges={['bottom']}>
                <ScrollView
                    contentContainerStyle={styles.content}
                    keyboardShouldPersistTaps="handled"
                >
                    {loadError !== null && (
                        <WarningBanner
                            title={t('schedules.failed')}
                            message={apiErrorMessage(t, loadError)}
                        />
                    )}

                    {/*
                     * The form mounts with its values rather than being seeded
                     * from an effect afterwards, so a reload while editing
                     * cannot overwrite what has been chosen.
                     */}
                    {bundle !== null && (
                        <TravelForm
                            id={id}
                            schedule={bundle.schedule}
                            origin={bundle.origin}
                            destination={bundle.destination}
                        />
                    )}
                </ScrollView>
            </SafeAreaView>
        </ThemedView>
    );
}

function TravelForm({
    id,
    schedule,
    origin,
    destination,
}: {
    id: string;
    schedule: Schedule;
    origin: Place | null;
    destination: Place | null;
}) {
    const { t } = useTranslation();
    const router = useRouter();

    const [mode, setMode] = useState<TransportMode>(schedule.mode);
    const [originAccess, setOriginAccess] = useState<AccessMode>(schedule.originAccess);
    const [destinationAccess, setDestinationAccess] = useState<AccessMode>(
        schedule.destinationAccess,
    );
    const [fixedMinutes, setFixedMinutes] = useState(
        schedule.fixedTravelMinutes === null ? '' : String(schedule.fixedTravelMinutes),
    );
    const [preference, setPreference] = useState<ReplacementPreference>(
        schedule.replacementPreference,
    );
    const [windowStart, setWindowStart] = useState(schedule.travelWindowStart ?? '');
    const [windowEnd, setWindowEnd] = useState(schedule.travelWindowEnd ?? '');
    const [newOrigin, setNewOrigin] = useState<AddressDraft | null>(null);
    const [newDestination, setNewDestination] = useState<AddressDraft | null>(null);
    const [errorCode, setErrorCode] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    // Only asked for a train journey: a car has no station to reach, and a fixed
    // travel time already includes however you get there.
    const publicTransport = mode === TransportMode.PUBLIC_TRANSPORT;
    const fixed = mode === TransportMode.FIXED;
    const valid = !fixed || Number(fixedMinutes) > 0;

    /**
     * Saves the addresses first, then the schedule.
     *
     * **Addresses are updated in place rather than replaced.** The schedule
     * points at a `Place` row, and pointing it at a new one would leave the old
     * behind with nothing referring to it. Editing the row means any other
     * schedule using the same home moves with it, which is what happens when you
     * actually move.
     */
    const save = useCallback(async () => {
        setSaving(true);
        try {
            // Addresses before the schedule: a schedule saved against a place
            // that failed to update would plan from the old coordinates and look
            // entirely correct doing it.
            if (newOrigin !== null && origin !== null) {
                await updatePlace(origin.id, newOrigin);
            }
            if (newDestination !== null && destination !== null) {
                await updatePlace(destination.id, newDestination);
            }

            await updateSchedule(id, {
                mode,
                originAccess,
                destinationAccess,
                fixedTravelMinutes: fixed ? Number(fixedMinutes) : undefined,
                replacementPreference: preference,
                // Empty means no limit, which is not the same as unchanged, so
                // it is sent as null rather than omitted.
                travelWindowStart: windowStart === '' ? null : windowStart,
                travelWindowEnd: windowEnd === '' ? null : windowEnd,
            });
            router.back();
        } catch (error) {
            setErrorCode(ApiRequestError.from(error).code);
        } finally {
            setSaving(false);
        }
    }, [
        destination,
        destinationAccess,
        preference,
        windowStart,
        windowEnd,
        fixed,
        fixedMinutes,
        id,
        mode,
        newDestination,
        newOrigin,
        origin,
        originAccess,
        router,
    ]);

    const accessChoices = [
        { value: AccessMode.WALK, label: t('travel.walk') },
        { value: AccessMode.BIKE, label: t('travel.bike') },
    ];

    return (
        <>
            {errorCode !== null && (
                <WarningBanner
                    title={t('schedules.save_failed')}
                    message={apiErrorMessage(t, errorCode)}
                />
            )}

            <ChoiceRow
                label={t('travel.mode')}
                value={mode}
                onChange={setMode}
                choices={[
                    { value: TransportMode.PUBLIC_TRANSPORT, label: t('travel.public_transport') },
                    { value: TransportMode.CAR, label: t('travel.car') },
                    { value: TransportMode.FIXED, label: t('travel.fixed') },
                ]}
            />

            {fixed && (
                <TextField
                    label={t('travel.fixed_minutes')}
                    value={fixedMinutes}
                    onChangeText={(text) => {
                        setFixedMinutes(text.replace(/\D/g, '').slice(0, 3));
                    }}
                    keyboardType="number-pad"
                    editable={!saving}
                />
            )}

            <View style={styles.section}>
                <ThemedText type="small" themeColor="textSecondary">
                    {t('onboarding.home')}
                </ThemedText>
                <DetailRow
                    label={t('places.current')}
                    value={newOrigin?.address ?? origin?.address ?? origin?.label ?? ''}
                />
                <AddressSearch
                    label={t('places.home_label')}
                    placeholder={t('places.home_placeholder')}
                    onSelect={(suggestion) => {
                        setNewOrigin({
                            address: suggestion.label,
                            lat: suggestion.lat,
                            lng: suggestion.lng,
                        });
                    }}
                />
                {publicTransport && (
                    <ChoiceRow
                        label={t('travel.origin_access')}
                        value={originAccess}
                        onChange={setOriginAccess}
                        choices={accessChoices}
                    />
                )}
            </View>

            <View style={styles.section}>
                <ThemedText type="small" themeColor="textSecondary">
                    {t('onboarding.work')}
                </ThemedText>
                <DetailRow
                    label={t('places.current')}
                    value={
                        newDestination?.address ?? destination?.address ?? destination?.label ?? ''
                    }
                />
                <AddressSearch
                    label={t('places.work_label')}
                    placeholder={t('places.work_placeholder')}
                    onSelect={(suggestion) => {
                        setNewDestination({
                            address: suggestion.label,
                            lat: suggestion.lat,
                            lng: suggestion.lng,
                        });
                    }}
                />
                {publicTransport && (
                    <ChoiceRow
                        label={t('travel.destination_access')}
                        value={destinationAccess}
                        onChange={setDestinationAccess}
                        choices={accessChoices}
                    />
                )}
            </View>

            {publicTransport && (
                <ReplacementSection
                    preference={preference}
                    onPreferenceChange={setPreference}
                    windowStart={windowStart}
                    onWindowStartChange={setWindowStart}
                    windowEnd={windowEnd}
                    onWindowEndChange={setWindowEnd}
                />
            )}

            <ThemedText type="small" themeColor="textSecondary">
                {t('schedules.rearm_notice')}
            </ThemedText>

            <ActionButton
                label={saving ? t('schedules.saving') : t('common.save')}
                variant="primary"
                disabled={!valid || saving}
                onPress={() => void save()}
            />
        </>
    );
}

const styles = StyleSheet.create({
    flex: { flex: 1 },
    content: { padding: Spacing.large, gap: Spacing.medium },
    section: { gap: Spacing.small },
});
