import { loadOptionalModule } from '@/utils/modules/optionalModule';
import type { ChosenSound } from '@/alarm/alarmSound';

type DocumentPicker = typeof import('expo-document-picker');
type FileSystem = typeof import('expo-file-system');

/** The name the copy is always given, so replacing one leaves no orphan. */
const FILENAME = 'alarm-sound';

/**
 * A sound file the user owns, copied into this app's storage.
 *
 * **Copied, not referenced, and that is the whole reason this file exists.** A
 * document picker hands back a URI that is a temporary grant: it survives the
 * session that asked for it and not much else, certainly not a reboot. The alarm
 * is played hours later by a native service that has no JavaScript, no picker
 * and no way to ask again, so a referenced file is a tone that works when you
 * test it in the evening and is silent at 06:00.
 *
 * Loaded optionally, like every native module in this app. Both of these arrived
 * after the current build was made, and `runtimeVersion` follows the app version
 * rather than the native fingerprint, so an over-the-air update can reach a
 * binary that has neither. A throwing import at module scope would take the
 * whole app down; this returns null and the screen says a rebuild is needed.
 */
function modules(): { picker: DocumentPicker; fs: FileSystem } | null {
    const picker = loadOptionalModule(() => require('expo-document-picker') as DocumentPicker);
    const fs = loadOptionalModule(() => require('expo-file-system') as FileSystem);
    return picker === null || fs === null ? null : { picker, fs };
}

/** False on a build made before these were added. The UI says so rather than failing. */
export function canPickOwnSoundFile(): boolean {
    return modules() !== null;
}

/**
 * Opens the system file browser and keeps a copy of what comes back.
 *
 * Returns null when the picker is unavailable or the user backed out, which are
 * both ordinary outcomes rather than failures.
 *
 * Always the same filename. Choosing a second tone overwrites the first rather
 * than accumulating copies of every audio file somebody has ever auditioned,
 * and there is only ever one alarm sound to keep.
 */
export async function pickOwnSoundFile(): Promise<ChosenSound | null> {
    const loaded = modules();
    if (loaded === null) {
        return null;
    }

    const result = await loaded.picker.getDocumentAsync({
        type: 'audio/*',
        // Without this the picker may hand back a URI that is only readable
        // while it is open, which is exactly the trap this module avoids.
        copyToCacheDirectory: true,
        multiple: false,
    });

    const asset = result.canceled ? undefined : result.assets[0];
    if (asset === undefined) {
        return null;
    }

    const source = new loaded.fs.File(asset.uri);
    const destination = new loaded.fs.File(
        loaded.fs.Paths.document,
        `${FILENAME}${extensionOf(asset.name)}`,
    );

    // Replacing rather than merging: the previous copy is this app's own file
    // and nothing else refers to it once the stored choice changes.
    if (destination.exists) {
        destination.delete();
    }
    source.copy(destination);

    return {
        uri: destination.uri,
        // The file's own name, which is what the person who chose it will
        // recognise. Falling back to the filename we gave it is better than an
        // empty row, and happens only if the picker reports no name at all.
        label: asset.name.length > 0 ? asset.name : FILENAME,
    };
}

/** `.mp3` from `song.mp3`, or nothing. Kept so players can sniff the format. */
function extensionOf(name: string): string {
    const dot = name.lastIndexOf('.');
    return dot > 0 ? name.slice(dot) : '';
}
