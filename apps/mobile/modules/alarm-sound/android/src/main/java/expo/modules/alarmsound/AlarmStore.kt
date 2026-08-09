package expo.modules.alarmsound

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * One scheduled alarm, in a form that survives the process being killed.
 *
 * Everything the service needs to ring is here. Nothing is read from JavaScript
 * at fire time, because at fire time there may be no JavaScript.
 */
data class StoredAlarm(
    val id: String,
    val triggerAtMillis: Long,
    val title: String,
    val body: String,
    val soundUri: String?,
    val occurrenceId: String?,
    val dismissLabel: String,
    val snoozeLabel: String?,
    /** Wording for the "this did not ring" notice, translated at schedule time. */
    val missedTitle: String,
    /** May contain a {time} placeholder, substituted natively. */
    val missedBody: String,
) {
    fun toJson(): JSONObject =
        JSONObject().apply {
            put("id", id)
            put("triggerAtMillis", triggerAtMillis)
            put("title", title)
            put("body", body)
            put("soundUri", soundUri ?: JSONObject.NULL)
            put("occurrenceId", occurrenceId ?: JSONObject.NULL)
            put("dismissLabel", dismissLabel)
            put("snoozeLabel", snoozeLabel ?: JSONObject.NULL)
            put("missedTitle", missedTitle)
            put("missedBody", missedBody)
        }

    companion object {
        fun fromJson(json: JSONObject): StoredAlarm =
            StoredAlarm(
                id = json.getString("id"),
                triggerAtMillis = json.getLong("triggerAtMillis"),
                title = json.optString("title"),
                body = json.optString("body"),
                soundUri = json.optStringOrNull("soundUri"),
                occurrenceId = json.optStringOrNull("occurrenceId"),
                dismissLabel = json.optString("dismissLabel"),
                snoozeLabel = json.optStringOrNull("snoozeLabel"),
                missedTitle = json.optString("missedTitle"),
                missedBody = json.optString("missedBody"),
            )
    }
}

private fun JSONObject.optStringOrNull(key: String): String? {
    if (isNull(key)) {
        return null
    }
    val value = optString(key)
    return value.ifEmpty { null }
}

/**
 * Durable record of every armed alarm.
 *
 * Android drops all `AlarmManager` registrations on reboot, so something has to
 * remember what was scheduled and put it back. That something cannot be the JS
 * bundle: `BOOT_COMPLETED` arrives long before any React context exists, and the
 * whole point of this rewrite is that ringing never waits for JavaScript.
 *
 * SharedPreferences rather than a database: this is a handful of rows read once
 * at boot and on each schedule, and it must be readable from a broadcast
 * receiver with no dependencies available.
 */
object AlarmStore {
    private const val PREFS_NAME = "dynamic_alarm_store"
    private const val KEY_ALARMS = "alarms"
    private const val KEY_MISSED = "missed"

    /** Enough to explain a bad morning, not enough to grow without bound. */
    private const val MAX_MISSED = 10

    private fun prefs(context: Context) =
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    @Synchronized
    fun all(context: Context): List<StoredAlarm> = read(context, KEY_ALARMS)

    /**
     * Alarms whose time passed while the device was off.
     *
     * Kept rather than discarded so the app can say what happened. Waking
     * someone hours late is not a recovery, but leaving them to work out on
     * their own why the alarm never rang is its own failure.
     */
    @Synchronized fun missed(context: Context): List<StoredAlarm> = read(context, KEY_MISSED)

    /** Called once the user has been told. */
    @Synchronized
    fun clearMissed(context: Context) {
        write(context, KEY_MISSED, emptyList())
    }

    private fun read(context: Context, key: String): List<StoredAlarm> {
        val raw = prefs(context).getString(key, null) ?: return emptyList()
        return runCatching {
            val array = JSONArray(raw)
            (0 until array.length()).mapNotNull { index ->
                runCatching { StoredAlarm.fromJson(array.getJSONObject(index)) }.getOrNull()
            }
        }.getOrDefault(emptyList())
    }

    @Synchronized
    fun find(context: Context, id: String): StoredAlarm? = all(context).firstOrNull { it.id == id }

    /** Adds or replaces by id, so rescheduling never stacks a duplicate. */
    @Synchronized
    fun put(context: Context, alarm: StoredAlarm) {
        val next = all(context).filterNot { it.id == alarm.id } + alarm
        write(context, next)
    }

    @Synchronized
    fun remove(context: Context, id: String) {
        write(context, all(context).filterNot { it.id == id })
    }

    @Synchronized
    fun clear(context: Context) {
        write(context, emptyList())
    }

    /**
     * Moves alarms whose time has already passed onto the missed list.
     *
     * Called after boot. An alarm due while the phone was off cannot be honoured,
     * and firing it late would be worse than not firing at all. It is recorded
     * rather than deleted so the app can tell the user their alarm was missed,
     * instead of leaving them to discover a silent morning by themselves.
     */
    @Synchronized
    fun pruneExpired(context: Context, nowMillis: Long): List<StoredAlarm> {
        val ringingId = AlarmService.ringingAlarmId
        val (expired, live) =
            all(context).partition { alarm ->
                // An alarm sounding right now has a trigger time in the past by
                // definition. Treating it as missed would mark a working alarm
                // as failed and cancel it mid-ring.
                alarm.triggerAtMillis <= nowMillis && alarm.id != ringingId
            }
        if (expired.isNotEmpty()) {
            write(context, KEY_MISSED, (missed(context) + expired).takeLast(MAX_MISSED))
        }
        write(context, KEY_ALARMS, live)
        return expired
    }

    /* ---------------------------------------------------------------------- */
    /* Diagnostics                                                            */
    /*                                                                        */
    /* Whether BOOT_COMPLETED actually reaches us cannot be reasoned out from  */
    /* symptoms, and a broadcast receiver leaves no trace a user can read. So  */
    /* it writes one down.                                                     */
    /* ---------------------------------------------------------------------- */

    private const val KEY_LAST_REARM_AT = "lastRearmAt"
    private const val KEY_LAST_REARM_SOURCE = "lastRearmSource"
    private const val KEY_LAST_REARM_MISSED = "lastRearmMissed"
    private const val KEY_LAST_BOOT_REARM_AT = "lastBootRearmAt"
    private const val KEY_LAST_ERROR = "lastRearmError"
    private const val KEY_BOOT_REARM_COUNT = "bootRearmCount"
    private const val KEY_BOOT_REARM_DEVICE_BOOT_AT = "bootRearmDeviceBootAt"

    /**
     * When this device last started, as a wall-clock time.
     *
     * `elapsedRealtime` counts milliseconds since boot including sleep, so
     * subtracting it from the current time gives the moment of boot. This is the
     * number that settles the question: a boot re-arm timestamp is only
     * meaningful next to the boot it supposedly followed.
     */
    fun deviceBootedAt(): Long = System.currentTimeMillis() - android.os.SystemClock.elapsedRealtime()

    @Synchronized
    fun recordRearm(context: Context, source: String, missedCount: Int) {
        prefs(context)
            .edit()
            .putLong(KEY_LAST_REARM_AT, System.currentTimeMillis())
            .putString(KEY_LAST_REARM_SOURCE, source)
            .putInt(KEY_LAST_REARM_MISSED, missedCount)
            .apply()

        // Only a genuine device restart counts. An app update also reaches the
        // boot receiver, and treating the two alike made this readout lie.
        if (source.startsWith("boot") || source == "quickboot" || source == "locked_boot") {
            prefs(context)
                .edit()
                .putLong(KEY_LAST_BOOT_REARM_AT, System.currentTimeMillis())
                // Stamped so a later reading can tell whether that re-arm
                // belonged to the boot the device is currently running, or to
                // some earlier one.
                .putLong(KEY_BOOT_REARM_DEVICE_BOOT_AT, deviceBootedAt())
                .putInt(KEY_BOOT_REARM_COUNT, prefs(context).getInt(KEY_BOOT_REARM_COUNT, 0) + 1)
                .apply()
        }
    }

    @Synchronized
    fun recordRearmError(context: Context, message: String) {
        prefs(context).edit().putString(KEY_LAST_ERROR, message).apply()
    }

    @Synchronized
    fun diagnostics(context: Context): Map<String, Any?> {
        val store = prefs(context)
        val bootedAt = deviceBootedAt()
        val bootRearmAt = store.getLong(KEY_LAST_BOOT_REARM_AT, 0L)
        val bootRearmForBoot = store.getLong(KEY_BOOT_REARM_DEVICE_BOOT_AT, 0L)

        // Boot timestamps drift by a few seconds between readings, so compare
        // with tolerance rather than for equality.
        val ranThisBoot = bootRearmAt > 0L && Math.abs(bootRearmForBoot - bootedAt) < 10_000L

        return mapOf(
            "lastRearmAt" to store.getLong(KEY_LAST_REARM_AT, 0L),
            "lastRearmSource" to store.getString(KEY_LAST_REARM_SOURCE, null),
            "lastRearmMissedCount" to store.getInt(KEY_LAST_REARM_MISSED, 0),
            "lastBootRearmAt" to bootRearmAt,
            "bootRearmCount" to store.getInt(KEY_BOOT_REARM_COUNT, 0),
            "deviceBootedAt" to bootedAt,
            // The two that settle it: did the boot receiver run for the boot we
            // are currently in, and how long after that boot did it run.
            "bootRearmRanThisBoot" to ranThisBoot,
            "bootRearmDelayMs" to if (ranThisBoot) bootRearmAt - bootedAt else -1L,
            "lastError" to store.getString(KEY_LAST_ERROR, null),
        )
    }

    private fun write(context: Context, alarms: List<StoredAlarm>) =
        write(context, KEY_ALARMS, alarms)

    private fun write(context: Context, key: String, alarms: List<StoredAlarm>) {
        val array = JSONArray()
        alarms.forEach { array.put(it.toJson()) }
        prefs(context).edit().putString(key, array.toString()).apply()
    }
}
