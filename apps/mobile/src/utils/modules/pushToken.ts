import Constants from 'expo-constants';

import { requestNotificationPermission } from '@/alarm/notificationPermission';
import { loadOptionalModule } from '@/utils/modules/optionalModule';
import { isExpoGo } from '@/utils/modules/runtime';

/**
 * Why a push token could not be obtained. Reported rather than thrown, because
 * none of these stop the app working: the alarm the device already holds needs
 * no network and no push.
 */
export type PushTokenProblem =
    /** Expo Go on Android, since SDK 53. A development build is required. */
    | 'UNSUPPORTED_RUNTIME'
    /** The user declined, and Android will not ask again. */
    | 'PERMISSION_DENIED'
    /** No EAS project id, so Expo cannot mint a token for this app. */
    | 'NO_PROJECT_ID'
    /** The request itself failed. It is a network call, so this is ordinary. */
    | 'REQUEST_FAILED';

export type PushTokenResult = { token: string } | { problem: PushTokenProblem };

type NotificationsModule = typeof import('expo-notifications');

/**
 * The Expo push token for this device, or the reason there isn't one.
 *
 * `expo-notifications` throws at *import* time when the native side is missing,
 * so it is loaded lazily like every other native module here. See CONVENTIONS.
 *
 * Push is how the monitor moves an alarm that is already armed. Without a token
 * the device still wakes on its anchor time, which is the whole point of the
 * anchor: the alarm is never late because of an infrastructure failure. So every
 * failure here is a named result rather than an exception.
 */
export async function getPushToken(): Promise<PushTokenResult> {
    if (isExpoGo()) {
        // Importable there, and refuses when used. Reported rather than thrown,
        // like every other reason a token can be missing.
        return { problem: 'UNSUPPORTED_RUNTIME' };
    }

    const notifications = loadOptionalModule<NotificationsModule>(
        () => require('expo-notifications') as NotificationsModule,
    );
    if (notifications === null) {
        // Expo Go on Android cannot do remote notifications since SDK 53, and a
        // development build older than the dependency behaves the same way.
        return { problem: 'UNSUPPORTED_RUNTIME' };
    }

    if (!(await requestNotificationPermission())) {
        return { problem: 'PERMISSION_DENIED' };
    }

    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    if (typeof projectId !== 'string' || projectId === '') {
        // Expo mints the token against a project, so without this there is
        // nothing to mint against. It comes from app.json and should never be
        // missing, which is why it is reported rather than defaulted.
        return { problem: 'NO_PROJECT_ID' };
    }

    try {
        const result = await notifications.getExpoPushTokenAsync({ projectId });
        return { token: result.data };
    } catch {
        // A network call, so this fails for ordinary reasons: no connectivity,
        // Expo's service unreachable. Worth retrying next launch, not worth
        // interrupting anyone over.
        return { problem: 'REQUEST_FAILED' };
    }
}
