import { useEffect } from 'react';
import { Alert, Linking } from 'react-native';
import { useTranslation } from 'react-i18next';
import { RATE_URL, SUPPORT_URL } from '@alarm/types';
import type { IsoDateTimeString } from '@alarm/types';

import { nextPrompt, readPromptMarks, writePromptMarks, type PromptKind } from '@/prompts/prompts';

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * Whether a prompt has been shown since the app started.
 *
 * Module scope, so it survives Today re-mounting and is reset only by a
 * restart. One ask per session at most: somebody who dismissed the coffee
 * question should not meet it again when they come back from Settings.
 */
let shownThisSession = false;

/**
 * Asks for a rating or a coffee, when it is time.
 *
 * Mounted on Today because that is the screen somebody opens on purpose; asking
 * on the ring screen at 06:00 would be asking for a no. Nothing is shown until
 * the device record has arrived, since the schedule runs on its registration
 * date, and nothing is shown twice in one session.
 */
export function usePrompts(registeredAt: IsoDateTimeString | null): void {
    const { t } = useTranslation();

    useEffect(() => {
        if (registeredAt === null || shownThisSession) {
            return;
        }
        let cancelled = false;

        void readPromptMarks().then((marks) => {
            if (cancelled || shownThisSession) {
                return;
            }
            const kind = nextPrompt({ registeredAt, now: new Date(), marks });
            if (kind === null) {
                return;
            }
            shownThisSession = true;
            showPrompt(kind, t);
        });

        return () => {
            cancelled = true;
        };
    }, [registeredAt, t]);
}

/**
 * The prompt itself, as a system dialog.
 *
 * `Alert.alert` rather than a screen of its own: the app already asks its
 * yes-or-no questions this way, and a custom sheet for a message shown twelve
 * times a year would be a new pattern for the least important thing on the
 * phone. Exported so the debug panel can show either on demand.
 *
 * Every button writes a mark before it does anything else, so a dialog that is
 * dismissed by tapping outside it still counts as asked.
 */
export function showPrompt(kind: PromptKind, t: Translate): void {
    const now = new Date().toISOString();

    /*
     * Marked as asked before it is shown, not on a button. On Android a tap
     * outside the dialog dismisses it without any button firing, and a prompt
     * that only counted button presses came back on every cold start instead of
     * monthly. Whatever happens next, this counts as having asked.
     */
    void writePromptMarks(kind === 'DONATE' ? { lastDonatePromptAt: now } : { lastRatePromptAt: now });

    if (kind === 'DONATE') {
        Alert.alert(
            t('prompts.donate_title'),
            t('prompts.donate_body'),
            [
            {
                text: t('prompts.not_now'),
                style: 'cancel',
            },
            {
                text: t('prompts.already_donated'),
                onPress: () => {
                    // Taken on trust, and final. See PromptMarks.donatedAt.
                    void writePromptMarks({ donatedAt: now });
                },
            },
            {
                text: t('prompts.donate'),
                onPress: () => {
                    // Not marked as donated: a page opened is not a coffee bought,
                    // and the honest way to stop the asks is the button for it.
                    void Linking.openURL(SUPPORT_URL);
                },
            },
            ],
            { cancelable: true },
        );
        return;
    }

    Alert.alert(
        t('prompts.rate_title'),
        t('prompts.rate_body'),
        [
            { text: t('prompts.not_now'), style: 'cancel' },
            {
                text: t('prompts.rate'),
                onPress: () => {
                    void writePromptMarks({ ratedAt: now });
                    if (RATE_URL !== '') {
                        void Linking.openURL(RATE_URL);
                    }
                },
            },
        ],
        { cancelable: true },
    );
}
