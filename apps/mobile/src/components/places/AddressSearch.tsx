import { useEffect, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { PlaceSuggestion } from '@alarm/types';

import { autosuggestPlaces } from '@/api';
import { Radius, Spacing } from '@/assets/Stylesheet';
import TextField from '@/components/ui/TextField';
import { ThemedText } from '@/components/ui/ThemedText';
import { useDebouncedValue } from '@/utils/hooks/useDebouncedValue';
import { useThemeColor } from '@/utils/hooks/useThemeColor';
import { ApiRequestError } from '@/utils/modules/Axios';

/** Matches the server's floor. Below this it answers 422 rather than searching. */
const MIN_QUERY_LENGTH = 3;

/**
 * Long enough that a word typed at speed is one request, short enough that the
 * list does not feel stuck. Every keystroke saved here is one not taken from a
 * budget the whole deployment shares.
 */
const DEBOUNCE_MS = 400;

/** What came back, and what it came back for. */
interface SearchResult {
    query: string;
    items: PlaceSuggestion[];
    failed: boolean;
}

interface AddressSearchProps {
    label: string;
    /** Shown when nothing has been typed yet. Already translated. */
    placeholder?: string;
    onSelect: (suggestion: PlaceSuggestion) => void;
}

/**
 * Dutch address, station and POI search, backed by the API's NS Places proxy.
 *
 * Stations come back with an `nsStationCode` and addresses do not, which is the
 * only difference the caller needs to care about: both carry the coordinates the
 * planner wants.
 *
 * The result carries the query it belongs to, and everything shown is derived
 * from comparing that against the current one. Two things fall out of it for
 * free. Nothing is stored for a query too short to search, and a slow answer for
 * "Utr" arriving after a fast one for "Utrecht" is ignored rather than replacing
 * the better list with the worse one.
 */
export default function AddressSearch({ label, placeholder, onSelect }: AddressSearchProps) {
    const { t } = useTranslation();
    const border = useThemeColor({}, 'border');
    const selectedBackground = useThemeColor({}, 'backgroundSelected');

    const [query, setQuery] = useState('');
    const [result, setResult] = useState<SearchResult | null>(null);
    /**
     * True once something has been picked, until the field is edited again.
     *
     * Without it, selecting a suggestion writes its label into the field, the
     * debounce settles on that label, and the effect searches for it: the list
     * reopens showing the answer that was just chosen, and an NS request is
     * spent confirming it.
     */
    const [chosen, setChosen] = useState(false);

    const settled = useDebouncedValue(query.trim(), DEBOUNCE_MS);
    const searchable = settled.length >= MIN_QUERY_LENGTH && !chosen;
    const current = searchable && result?.query === settled ? result : null;

    useEffect(() => {
        if (!searchable) {
            return;
        }

        let cancelled = false;

        void autosuggestPlaces(settled)
            .then((items) => {
                if (!cancelled) {
                    setResult({ query: settled, items, failed: false });
                }
            })
            .catch((error: unknown) => {
                if (!cancelled) {
                    // Logged rather than shown: the server's message is English
                    // and written for a log. The user gets translated copy.
                    console.warn('Autosuggest failed:', ApiRequestError.from(error).message);
                    setResult({ query: settled, items: [], failed: true });
                }
            });

        return () => {
            cancelled = true;
        };
    }, [settled, searchable]);

    const choose = (suggestion: PlaceSuggestion) => {
        onSelect(suggestion);
        // The chosen label replaces what was typed, so the field reads as the
        // answer rather than as a half-finished search.
        setQuery(suggestion.label);
        setChosen(true);
        // The question has been answered, so the keyboard has no business
        // covering the next one.
        Keyboard.dismiss();
    };

    const items = current?.failed === false ? current.items : [];

    return (
        <View style={styles.container}>
            <TextField
                label={label}
                placeholder={placeholder}
                value={query}
                onChangeText={(text) => {
                    setQuery(text);
                    // Editing reopens the search. Anything already selected
                    // stays selected until something else is picked, so a stray
                    // keystroke cannot silently empty the answer.
                    setChosen(false);
                }}
                autoCorrect={false}
                autoCapitalize="words"
                returnKeyType="search"
            />

            {searchable && current === null && (
                <ThemedText type="small" themeColor="textSecondary">
                    {t('places.searching')}
                </ThemedText>
            )}
            {current?.failed === true && (
                <ThemedText type="small" themeColor="danger">
                    {t('places.search_failed')}
                </ThemedText>
            )}
            {current?.failed === false && current.items.length === 0 && (
                <ThemedText type="small" themeColor="textSecondary">
                    {t('places.no_results')}
                </ThemedText>
            )}

            {items.length > 0 && (
                <View style={[styles.results, { borderColor: border }]}>
                    {items.map((suggestion) => (
                        <Pressable
                            key={suggestion.id}
                            onPress={() => {
                                choose(suggestion);
                            }}
                            style={({ pressed }) => [
                                styles.result,
                                { borderColor: border },
                                pressed && { backgroundColor: selectedBackground },
                            ]}
                            accessibilityRole="button"
                        >
                            <ThemedText>{suggestion.label}</ThemedText>
                            {suggestion.description !== undefined && (
                                <ThemedText type="small" themeColor="textSecondary">
                                    {suggestion.nsStationCode === undefined
                                        ? suggestion.description
                                        : t('places.station', {
                                              description: suggestion.description,
                                          })}
                                </ThemedText>
                            )}
                        </Pressable>
                    ))}
                </View>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        gap: Spacing.extraSmall,
    },
    results: {
        borderWidth: 1,
        borderRadius: Radius.medium,
        overflow: 'hidden',
    },
    result: {
        paddingHorizontal: Spacing.medium,
        paddingVertical: Spacing.small,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
});
