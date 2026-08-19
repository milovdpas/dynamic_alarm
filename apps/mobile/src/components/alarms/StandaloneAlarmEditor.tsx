import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { Weekday } from '@alarm/types';

import type { StandaloneAlarm } from '@/alarm/standaloneAlarms';
import { Spacing } from '@/assets/Stylesheet';
import ReminderPicker from '@/components/alarms/ReminderPicker';
import ActionButton from '@/components/buttons/ActionButton';
import TextField from '@/components/ui/TextField';
import { ThemedText } from '@/components/ui/ThemedText';
import TimeField from '@/components/ui/TimeField';
import WeekdayPicker from '@/components/ui/WeekdayPicker';

/**
 * Everything a hand-set alarm can be told, inside the row it belongs to.
 *
 * Inline rather than on its own screen, which is the shape the phone's own Clock
 * app uses and the reason this tab feels like a list of alarms rather than a
 * list of settings. Setting one is four decisions, and pushing a route for four
 * decisions puts a back button between somebody and the switch they came for.
 *
 * Edits are applied as they are made rather than behind a Save. There is nothing
 * here that is only valid as a set, and a half-finished alarm is a real alarm
 * that will ring: a time with no days is "once, next time it comes round", which
 * is a complete answer rather than a draft.
 */
export default function StandaloneAlarmEditor({
    alarm,
    busy,
    onChange,
    onDelete,
}: {
    alarm: StandaloneAlarm;
    busy: boolean;
    onChange: (next: StandaloneAlarm) => void;
    onDelete: () => void;
}) {
    const { t } = useTranslation();
    const [time, setTime] = useState(alarm.time);

    /*
     * Held locally while it is being typed, and only handed up once it reads as
     * a time. A partially typed "07:" is not a time, and writing it through
     * would cancel the OS alarm the moment somebody put the cursor in the field.
     */
    const changeTime = useCallback(
        (next: string) => {
            setTime(next);
            if (/^\d{1,2}:\d{2}$/.test(next.trim())) {
                onChange({ ...alarm, time: next.trim() });
            }
        },
        [alarm, onChange],
    );

    const changeDays = useCallback(
        (days: Weekday[]) => {
            onChange({ ...alarm, days });
        },
        [alarm, onChange],
    );

    return (
        <View style={styles.body}>
            <TimeField label={t('alarms.time')} value={time} onChange={changeTime} />

            <TextField
                label={t('alarms.label')}
                value={alarm.label}
                onChangeText={(label) => {
                    onChange({ ...alarm, label });
                }}
                placeholder={t('alarms.label_placeholder')}
            />

            <View style={styles.days}>
                <WeekdayPicker value={alarm.days} onChange={changeDays} disabled={busy} />
                {/*
                 * Said plainly, because an empty row of days is ambiguous: it
                 * could mean never. It means once, which is the more useful
                 * default and the one the phone's own alarm app uses.
                 */}
                {alarm.days.length === 0 && (
                    <ThemedText type="small" themeColor="textSecondary">
                        {t('alarms.repeats_once')}
                    </ThemedText>
                )}
            </View>

            <ReminderPicker
                value={alarm.reminders}
                disabled={busy}
                onChange={(reminders) => {
                    onChange({ ...alarm, reminders });
                }}
            />

            <ActionButton label={t('alarms.delete')} disabled={busy} onPress={onDelete} />
        </View>
    );
}

const styles = StyleSheet.create({
    body: { gap: Spacing.medium },
    days: { gap: Spacing.small },
});
