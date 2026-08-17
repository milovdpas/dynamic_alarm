import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import {
    canPickSystemAlarmSound,
    getDefaultAlarmSound,
    pickAlarmSound,
    playAlarmSound,
    stopAlarmSound,
} from '@modules/alarm-sound';

import { readChosenSound, writeChosenSound, type ChosenSound } from '@/alarm/alarmSound';
import { canPickOwnSoundFile, pickOwnSoundFile } from '@/alarm/ownSoundFile';
import { Radius, Spacing } from '@/assets/Stylesheet';
import ActionButton from '@/components/buttons/ActionButton';
import DetailRow from '@/components/ui/DetailRow';
import { ThemedText } from '@/components/ui/ThemedText';
import { ThemedView } from '@/components/ui/ThemedView';
import { useThemeColor } from '@/utils/hooks/useThemeColor';

/**
 * Which tone the alarm plays.
 *
 * The OS's own picker rather than a list of our own: it shows exactly the alarm
 * tones this phone already has, including anything the user added, and it looks
 * native because it is. Nothing is bundled and nothing is enumerated.
 *
 * Previewing is on the alarm stream at alarm volume, which is the only honest
 * way to answer "will this wake me". A tone auditioned at media volume tells you
 * nothing about 06:00, and this screen exists to prevent exactly that surprise.
 */
export default function SoundScreen() {
    const { t } = useTranslation();
    const border = useThemeColor({}, 'border');

    const [chosen, setChosen] = useState<ChosenSound | null>(null);
    const [systemDefault, setSystemDefault] = useState<string | null>(null);
    const [playing, setPlaying] = useState(false);

    useEffect(() => {
        void readChosenSound().then(setChosen);
        // The name of what plays when nothing has been chosen, so the row can
        // say "Oxygen (your phone's default)" rather than an empty space.
        void getDefaultAlarmSound().then((sound) => {
            setSystemDefault(sound?.label ?? null);
        });
    }, []);

    // Nothing else stops it: the module loops on purpose, because that is what
    // an alarm does, so leaving this screen has to silence it.
    useEffect(() => {
        return () => {
            void stopAlarmSound();
        };
    }, []);

    const choose = useCallback(async () => {
        const picked = await pickAlarmSound(chosen?.uri ?? null);
        // Null means the picker was backed out of, which is not a choice to
        // store. Silencing a tone by picking nothing is what "Use the phone's
        // default" is for.
        if (picked === null) {
            return;
        }
        setChosen(picked);
        await writeChosenSound(picked);
    }, [chosen]);

    const chooseFile = useCallback(async () => {
        const picked = await pickOwnSoundFile();
        if (picked === null) {
            return;
        }
        setChosen(picked);
        await writeChosenSound(picked);
    }, []);

    const resetToDefault = useCallback(async () => {
        setChosen(null);
        await writeChosenSound(null);
    }, []);

    const preview = useCallback(async () => {
        if (playing) {
            await stopAlarmSound();
            setPlaying(false);
            return;
        }
        setPlaying(true);
        await playAlarmSound(chosen?.uri ?? null, { loop: true });
    }, [chosen, playing]);

    return (
        <ThemedView style={styles.flex}>
            <SafeAreaView style={styles.flex} edges={['bottom']}>
                <ScrollView contentContainerStyle={styles.content}>
                    <View style={[styles.card, { borderColor: border }]}>
                        <DetailRow
                            label={t('sound.current')}
                            value={
                                chosen?.label ??
                                (systemDefault === null
                                    ? t('sound.system_default')
                                    : t('sound.system_default_named', { name: systemDefault }))
                            }
                        />
                    </View>

                    {canPickSystemAlarmSound ? (
                        <>
                            <ActionButton
                                label={t('sound.choose')}
                                variant="primary"
                                onPress={() => void choose()}
                            />
                            {/*
                             * A file of your own, copied into this app rather
                             * than referenced. Offered below the system tones
                             * because most people want one of those and this is
                             * the answer for the person who does not.
                             */}
                            {canPickOwnSoundFile() ? (
                                <ActionButton
                                    label={t('sound.choose_file')}
                                    onPress={() => void chooseFile()}
                                />
                            ) : (
                                <ThemedText type="small" themeColor="textSecondary">
                                    {t('sound.file_needs_rebuild')}
                                </ThemedText>
                            )}

                            <ActionButton
                                label={playing ? t('sound.stop') : t('sound.preview')}
                                onPress={() => void preview()}
                            />
                            {chosen !== null && (
                                <ActionButton
                                    label={t('sound.use_default')}
                                    onPress={() => void resetToDefault()}
                                />
                            )}
                            <ThemedText type="small" themeColor="textSecondary">
                                {t('sound.stream_note')}
                            </ThemedText>
                            {canPickOwnSoundFile() && (
                                <ThemedText type="small" themeColor="textSecondary">
                                    {t('sound.copied_note')}
                                </ThemedText>
                            )}
                            {/*
                             * Said before it can surprise anybody. A content URI
                             * points at something the phone may lose: a tone on
                             * a card that comes out, or one belonging to an app
                             * that gets uninstalled. The service falls back to
                             * the default rather than ringing nothing, which is
                             * the right behaviour and a bad thing to discover at
                             * 06:00 without warning.
                             */}
                            <ThemedText type="small" themeColor="textSecondary">
                                {t('sound.may_disappear')}
                            </ThemedText>
                        </>
                    ) : (
                        <ThemedText type="small" themeColor="textSecondary">
                            {t('sound.unavailable')}
                        </ThemedText>
                    )}
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
    },
});
