import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

import { useAlarmPermissions } from '@/alarm/useAlarmPermissions';
import { Radius, Spacing } from '@/assets/Stylesheet';
import ActionButton from '@/components/buttons/ActionButton';
import { ThemedText } from '@/components/ui/ThemedText';
import { ThemedView } from '@/components/ui/ThemedView';
import { useThemeColor } from '@/utils/hooks/useThemeColor';

/**
 * The last step of setup: letting the alarm actually ring.
 *
 * **Here, and not earlier.** On first launch a permission dialog arrives before
 * the app has said what it is for, and gets refused by reflex. By this screen
 * the user has described the morning they want to be woken for, so the request
 * explains itself: this is the app asking for what it needs to do the thing they
 * just set up.
 *
 * **Here, and not later either.** The alternative is asking at arming time,
 * which happens in the background, hours later, with nobody watching.
 *
 * Android shows the notification dialog exactly once. A refusal is close to
 * permanent, and every attempt after it has to be a trip to the system settings
 * page, so the sentence before the button is doing real work rather than being
 * polite.
 *
 * Skippable on purpose. Someone who says no keeps an app that works and cannot
 * ring, and Today says so permanently. What this screen must never do is stand
 * between them and the app they have already finished configuring.
 */
export default function PermissionsStep() {
    const { t } = useTranslation();
    const router = useRouter();
    const border = useThemeColor({}, 'border');
    const success = useThemeColor({}, 'success');
    const warning = useThemeColor({}, 'warning');

    const {
        permissions,
        canRing,
        unsupported,
        request,
        openSettings,
        requestFullScreen,
        requestUnrestrictedBattery,
    } = useAlarmPermissions();

    // Set once the system dialog has been through. After that a still-missing
    // permission means it was refused, and the only way back is settings.
    const [asked, setAsked] = useState(false);

    const finish = () => {
        router.replace('/(tabs)');
    };

    const ask = () => {
        setAsked(true);
        void request();
    };

    const rows = [
        {
            key: 'notifications',
            granted: permissions?.notifications ?? false,
            required: true,
        },
        { key: 'exact_alarms', granted: permissions?.exactAlarm ?? false, required: true },
        { key: 'full_screen', granted: permissions?.fullScreen ?? false, required: false },
        {
            key: 'battery',
            granted: permissions?.unrestrictedBattery ?? false,
            required: false,
        },
    ];

    return (
        <ThemedView style={styles.flex}>
            <SafeAreaView style={styles.flex} edges={['bottom']}>
                <ScrollView contentContainerStyle={styles.content}>
                    <ThemedText type="title">{t('permissions.onboarding_title')}</ThemedText>
                    <ThemedText themeColor="textSecondary">
                        {t('permissions.onboarding_body')}
                    </ThemedText>

                    {unsupported ? (
                        <View style={[styles.card, { borderColor: border }]}>
                            <ThemedText type="small" themeColor="textSecondary">
                                {t('permissions.unsupported')}
                            </ThemedText>
                        </View>
                    ) : (
                        <View style={[styles.card, { borderColor: border }]}>
                            {rows.map((row) => (
                                <View key={row.key} style={styles.row}>
                                    <MaterialCommunityIcons
                                        name={row.granted ? 'check-circle' : 'circle-outline'}
                                        size={20}
                                        color={row.granted ? success : warning}
                                    />
                                    <View style={styles.grow}>
                                        <ThemedText type="smallBold">
                                            {t(`permissions.${row.key}`)}
                                        </ThemedText>
                                        <ThemedText type="small" themeColor="textSecondary">
                                            {t(`permissions.why_${row.key}`)}
                                        </ThemedText>
                                    </View>
                                </View>
                            ))}
                        </View>
                    )}

                    {!unsupported && !canRing && (
                        <ActionButton
                            label={asked ? t('permissions.open_settings') : t('permissions.grant')}
                            variant="primary"
                            onPress={asked ? () => void openSettings() : ask}
                        />
                    )}

                    {/*
                     * Offered only once the required pair is in place. Asking for
                     * the optional two while the alarm still cannot ring buries
                     * the thing that matters under two things that do not.
                     */}
                    {!unsupported && canRing && permissions !== null && !permissions.fullScreen && (
                        <ActionButton
                            label={t('permissions.grant_full_screen')}
                            onPress={() => void requestFullScreen()}
                        />
                    )}
                    {!unsupported &&
                        canRing &&
                        permissions !== null &&
                        !permissions.unrestrictedBattery && (
                            <ActionButton
                                label={t('permissions.grant_battery')}
                                onPress={() => void requestUnrestrictedBattery()}
                            />
                        )}

                    {asked && !canRing && (
                        <ThemedText type="small" themeColor="textSecondary">
                            {t('permissions.refused')}
                        </ThemedText>
                    )}

                    <ActionButton
                        label={canRing ? t('permissions.done') : t('permissions.skip')}
                        variant={canRing ? 'primary' : 'default'}
                        onPress={finish}
                    />
                </ScrollView>
            </SafeAreaView>
        </ThemedView>
    );
}

const styles = StyleSheet.create({
    flex: { flex: 1 },
    content: { padding: Spacing.large, gap: Spacing.medium },
    card: {
        borderWidth: 1,
        borderRadius: Radius.small,
        padding: Spacing.medium,
        gap: Spacing.medium,
    },
    row: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.small },
    grow: { flex: 1, gap: Spacing.extraSmall },
});
