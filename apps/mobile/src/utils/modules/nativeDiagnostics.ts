import { isAlarmSoundAvailable } from '@modules/alarm-sound';
import { isPersistent } from './Storage';
import { loadOptionalModule } from './optionalModule';

export interface NativeModuleStatus {
    /** Native module name, as the platform knows it. Not user copy. */
    name: string;
    available: boolean;
    /** i18n key describing the consequence of it being missing. */
    impactKey: string;
}

function hasExpoModule(load: () => unknown): boolean {
    return loadOptionalModule(load) !== null;
}

/**
 * Which native modules this binary actually contains.
 *
 * A development build freezes its native code at build time while JS keeps
 * hot-reloading, so adding any native dependency silently desynchronises the
 * installed app until it is rebuilt. The symptom is a runtime error deep inside
 * whichever unrelated file happened to import it first, during M0 that surfaced
 * four separate times as an unhelpful stack trace.
 *
 * This turns that into a list you can read at a glance. Impacts are i18n keys:
 * this module has no business choosing the user's language.
 */
export function getNativeModuleStatuses(): NativeModuleStatus[] {
    return [
        {
            name: 'AlarmSound',
            available: isAlarmSoundAvailable,
            impactKey: 'diagnostics.impact.alarm_sound',
        },
        {
            name: 'AsyncStorage',
            available: isPersistent(),
            impactKey: 'diagnostics.impact.storage',
        },
        {
            name: 'ExpoLocalization',
            available: hasExpoModule(() => require('expo-localization')),
            impactKey: 'diagnostics.impact.localization',
        },
        {
            name: 'ExpoSecureStore',
            available: hasExpoModule(() => require('expo-secure-store')),
            impactKey: 'diagnostics.impact.secure_store',
        },
    ];
}

export function getMissingNativeModules(): NativeModuleStatus[] {
    return getNativeModuleStatuses().filter((module) => !module.available);
}
