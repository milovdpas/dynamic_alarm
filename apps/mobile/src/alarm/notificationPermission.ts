import { PermissionsAndroid, Platform } from 'react-native';

const POST_NOTIFICATIONS = 'android.permission.POST_NOTIFICATIONS' as const;

/**
 * The Android 13+ runtime notification permission.
 *
 * Uses `PermissionsAndroid` rather than a notification library, because the
 * alarm no longer depends on one. Below API 33 notifications are granted at
 * install, so there is nothing to ask for.
 *
 * Note this gates the *visible* alarm, not the sound: the foreground service
 * plays the tone regardless. Without the permission the user would be woken by
 * an alarm they cannot see or dismiss from the lock screen, which is why the
 * harness reports it as missing rather than shrugging.
 */
export async function hasNotificationPermission(): Promise<boolean> {
    if (Platform.OS !== 'android' || Number(Platform.Version) < 33) {
        return true;
    }
    try {
        return await PermissionsAndroid.check(POST_NOTIFICATIONS);
    } catch {
        return false;
    }
}

export async function requestNotificationPermission(): Promise<boolean> {
    if (Platform.OS !== 'android' || Number(Platform.Version) < 33) {
        return true;
    }
    try {
        const result = await PermissionsAndroid.request(POST_NOTIFICATIONS);
        return result === PermissionsAndroid.RESULTS.GRANTED;
    } catch {
        return false;
    }
}
