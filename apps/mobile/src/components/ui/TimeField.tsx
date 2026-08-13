import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { FontSize, Fonts, Radius, Spacing } from '@/assets/Stylesheet';
import TextField from '@/components/ui/TextField';
import { ThemedText } from '@/components/ui/ThemedText';
import { useThemeColor } from '@/utils/hooks/useThemeColor';
import { loadOptionalModule } from '@/utils/modules/optionalModule';

/**
 * The Android clock dialog from `@expo/ui`, loaded the safe way.
 *
 * That module calls `requireNativeView` at module scope, so importing it throws
 * at *import* time when the native side is missing, taking every downstream
 * module with it. This is the rule that cost four debugging cycles in M0, and
 * the reason the ESLint guard exists.
 *
 * A null result is a fine outcome rather than an error: the field falls back to
 * being typed, which is exactly what it was before.
 */
interface TimePickerModule {
    /**
     * The Compose boundary. A Compose view has to be its **direct** child:
     * putting any plain `View` in between breaks the composition and the native
     * side refuses to render, which is how this was found.
     */
    Host: (props: { style?: object; children: React.ReactNode }) => React.ReactElement;
    TimePickerDialog: (props: {
        initialDate?: string | null;
        is24Hour?: boolean;
        confirmButtonLabel?: string;
        dismissButtonLabel?: string;
        onDateSelected?: (date: Date) => void;
        onDismissRequest: () => void;
    }) => React.ReactElement;
}

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

interface TimeFieldProps {
    label: string;
    /** `HH:mm`, 24 hour. */
    value: string;
    onChange: (value: string) => void;
    /** Shown when the value cannot be parsed. Already translated. */
    error?: string;
}

/**
 * A time, picked from the system clock where that is possible.
 *
 * Typing `08:30` is a poor way to answer "when do you need to be there", and it
 * is worse at the moment someone is setting this up at night. The dialog is
 * Android only in `@expo/ui`, so the typed field stays as the fallback rather
 * than being deleted: on iOS, and on any build without the native view, the
 * screen still works.
 */
export default function TimeField({ label, value, onChange, error }: TimeFieldProps) {
    const { t } = useTranslation();
    const border = useThemeColor({}, error === undefined ? 'border' : 'danger');
    const background = useThemeColor({}, 'backgroundElement');
    const text = useThemeColor({}, 'text');

    const [open, setOpen] = useState(false);

    const picker = useMemo(
        () =>
            loadOptionalModule<TimePickerModule>(
                () => require('@expo/ui/jetpack-compose') as TimePickerModule,
            ),
        [],
    );

    if (picker === null) {
        return (
            <TextField
                label={label}
                value={value}
                onChangeText={onChange}
                keyboardType="numbers-and-punctuation"
                maxLength={5}
                placeholder="08:30"
                error={error}
            />
        );
    }

    const { Host, TimePickerDialog } = picker;

    return (
        <View style={styles.field}>
            <ThemedText type="smallBold" themeColor="textSecondary">
                {label}
            </ThemedText>

            <Pressable
                onPress={() => {
                    setOpen(true);
                }}
                style={[styles.value, { borderColor: border, backgroundColor: background }]}
                accessibilityRole="button"
                accessibilityLabel={label}
                accessibilityValue={{ text: value }}
            >
                <ThemedText style={[styles.time, { color: text }]}>{value}</ThemedText>
            </Pressable>

            {error !== undefined && (
                <ThemedText type="small" themeColor="danger">
                    {error}
                </ThemedText>
            )}

            {open && (
                <Host
                    // Absolute so the boundary itself takes no space in the
                    // form. The dialog is an overlay, and a Host laid out inline
                    // would leave a gap under the field whenever it opened.
                    style={styles.host}
                >
                    <TimePickerDialog
                        // A whole date is what the dialog takes, though only
                        // the clock part is read back. Today's date is
                        // arbitrary and never leaves this component.
                        initialDate={toDateIso(value)}
                        is24Hour
                        confirmButtonLabel={t('common.confirm')}
                        dismissButtonLabel={t('common.cancel')}
                        onDateSelected={(date) => {
                            onChange(toClock(date));
                            setOpen(false);
                        }}
                        onDismissRequest={() => {
                            setOpen(false);
                        }}
                    />
                </Host>
            )}
        </View>
    );
}

/** `HH:mm` as an instant today, which is what the dialog wants to open on. */
function toDateIso(value: string): string {
    const date = new Date();
    const match = TIME_PATTERN.exec(value);
    if (match !== null) {
        const [hours, minutes] = value.split(':');
        date.setHours(Number(hours), Number(minutes), 0, 0);
    }
    return date.toISOString();
}

/** The clock part of an instant, zero padded. */
function toClock(date: Date): string {
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
}

const styles = StyleSheet.create({
    field: {
        gap: Spacing.extraSmall,
    },
    value: {
        borderRadius: Radius.medium,
        borderWidth: 1,
        paddingHorizontal: Spacing.medium,
        paddingVertical: Spacing.small,
    },
    // Deliberately identical to TextField's input. This behaves like a field
    // that happens to open a dialog, so making it look like one is the whole
    // explanation of how to use it. It was set large on the way in, which made
    // the one value on the screen that is not the answer read as though it was.
    time: {
        ...Fonts.regular,
        fontSize: FontSize.small,
    },
    host: {
        position: 'absolute',
    },
});
