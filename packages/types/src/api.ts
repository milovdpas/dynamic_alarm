import type {
    AccessMode,
    AlarmEventType,
    DevicePlatform,
    OccurrenceState,
    TransportMode,
    WakeChangeReason,
    Weekday,
} from './enums';
import type {
    BufferConfig,
    IsoDateString,
    IsoDateTimeString,
    Journey,
    LocalTimeString,
    Place,
    Routine,
    Schedule,
    TimeZone,
    WakePlan,
} from './domain';

/* -------------------------------------------------------------------------- */
/* Envelopes                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * There is no success envelope. A successful response is the resource itself.
 *
 * The status code already says whether it worked, so `{ success: true, data }`
 * restated it and made every caller unwrap a level to reach anything. A list
 * endpoint returns a bare array for the same reason.
 *
 * The trade, stated so it is a choice rather than a surprise: a bare array has
 * nowhere to put pagination metadata later. That is deliberate here, since
 * every list is one device's own places, routines or schedules, which is a
 * handful of rows and will never be paged. A collection that could grow
 * unbounded should be given an object with its own `items` field instead of
 * quietly becoming an envelope again.
 */

/**
 * The body of any failed request, flat for the same reason.
 *
 * `code` is machine-readable and stable; `message` is for a human reading a log
 * rather than for a user, since user-facing copy lives in the app's
 * translations. `details` carries validation issues when there are any.
 */
export interface ApiErrorResponse {
    code: string;
    message: string;
    details?: unknown;
}

/* -------------------------------------------------------------------------- */
/* Devices, anonymous accounts                                                */
/* -------------------------------------------------------------------------- */

export interface RegisterDeviceRequest {
    platform: DevicePlatform;
    /** Expo push token. Absent until the user grants notification permission. */
    pushToken?: string;
    timezone: TimeZone;
    appVersion: string;
}

export interface RegisterDeviceResponse {
    deviceId: string;
    /** Bearer token, stored in expo-secure-store. This is the only credential. */
    token: string;
}

/**
 * What a device may know about itself.
 *
 * Deliberately not the whole row. `tokenHash` must never leave the server, and
 * the push token is reported as a boolean because the device already has the
 * value; what it cannot otherwise tell is whether the server still holds one.
 */
export interface DeviceResponse {
    deviceId: string;
    platform: DevicePlatform;
    timezone: TimeZone;
    hasPushToken: boolean;
    /**
     * Which disruptions may move the alarm, and in which direction. All on by
     * default, because together they are the product.
     *
     * Delays and cancellations are separate because they carry different
     * amounts of certainty: a delay shifts a journey by a known number of
     * minutes, a cancellation replaces it with a different train and possibly a
     * transfer. Accepting extra sleep from one and not the other is coherent.
     *
     * Traffic moves the alarm the other way, because a car journey grows rather
     * than slips. Turning that one off means accepting lateness when the roads
     * are bad, which the copy has to say.
     *
     * None of them govern the emergency path: when a cancellation leaves no way
     * to arrive on time, the alarm moves earlier regardless, because not moving
     * is a guaranteed failure rather than a risk.
     */
    allowLaterWakeOnDelay: boolean;
    allowLaterWakeOnCancellation: boolean;
    allowEarlierWakeOnTraffic: boolean;
}

/**
 * The mutable facts about a device. Platform is not one of them.
 *
 * `pushToken` is explicitly nullable rather than merely optional, because
 * omitted and cleared mean different things: omitted is "unchanged", null is
 * "notification permission was revoked". Collapsing them would leave the server
 * pushing at a token the device no longer has.
 */
export interface UpdateDeviceRequest {
    pushToken?: string | null;
    timezone?: TimeZone;
    appVersion?: string;
    allowLaterWakeOnDelay?: boolean;
    allowLaterWakeOnCancellation?: boolean;
    allowEarlierWakeOnTraffic?: boolean;
}

/* -------------------------------------------------------------------------- */
/* Places / routines / schedules                                               */
/* -------------------------------------------------------------------------- */

export type CreatePlaceRequest = Omit<Place, 'id'>;
export type UpdatePlaceRequest = Partial<CreatePlaceRequest>;

/**
 * A step on the way in. No `id`, and no `order` either.
 *
 * Position in the array is the order. Sending both would be two sources of the
 * same fact, and when they disagree (duplicate values, a gap after a delete)
 * something has to break the tie arbitrarily, which the user sees as the app
 * losing the arrangement they just made.
 */
export interface CreateRoutineStepRequest {
    label: string;
    minutes: number;
    enabled: boolean;
}

export interface CreateRoutineRequest {
    name: string;
    /**
     * Replaces every existing step when present, and leaves them alone when
     * absent. The editor changes names, order and membership together, so a
     * diff would have to infer which of those happened from a set of ids.
     */
    steps: CreateRoutineStepRequest[];
}
export type UpdateRoutineRequest = Partial<CreateRoutineRequest>;

export interface CreateScheduleRequest {
    name: string;
    originPlaceId: string;
    destinationPlaceId: string;
    routineId: string;
    arrivalTime: LocalTimeString;
    daysOfWeek: Weekday[];
    mode: TransportMode;
    /** Defaults to walking at both ends when omitted. */
    originAccess?: AccessMode;
    destinationAccess?: AccessMode;
    /** Counting back from the latest on-time departure. Defaults to 0. */
    journeyOffset?: number;
    fixedTravelMinutes?: number;
    buffers: BufferConfig;
    timezone: TimeZone;
}
export type UpdateScheduleRequest = Partial<CreateScheduleRequest> & { active?: boolean };

/* -------------------------------------------------------------------------- */
/* Planning                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Compute a wake plan without persisting anything. Drives the onboarding
 * preview, where the user is still deciding and has nothing saved yet.
 */
export interface PlanPreviewRequest {
    origin: { lat: number; lng: number };
    destination: { lat: number; lng: number };
    arrivalTime: LocalTimeString;
    /** Defaults to the next matching day when omitted. */
    date?: IsoDateString;
    mode: TransportMode;
    originAccess?: AccessMode;
    destinationAccess?: AccessMode;
    journeyOffset?: number;
    fixedTravelMinutes?: number;
    routineMinutes: number;
    buffers: BufferConfig;
    timezone: TimeZone;
}

export type PlanPreviewResponse = WakePlan;

/**
 * The same journey planned several ways, one plan per option.
 *
 * A whole `WakePlan` per option rather than a list of journeys, because the
 * number the user is actually choosing between is the wake-up time, and that
 * only exists once the routine and the buffers have been applied. Showing
 * departures alone would make them do that arithmetic themselves.
 *
 * Ordered latest departure first, so index 0 is the most sleep and the index is
 * the `journeyOffset` to store.
 */
export type PlanOptionsResponse = WakePlan[];

/**
 * The wake plan for a saved schedule's next occurrence.
 *
 * The date is carried separately because a wake time on its own cannot say
 * whether it means tomorrow or Monday, and that is the first thing anyone
 * looking at an alarm wants to know.
 *
 * Everything needed to arm the alarm is here, so the device does not have to
 * reassemble the request from places, routines and schedules and duplicate the
 * server's own arithmetic to do it.
 */
export interface SchedulePlanResponse {
    scheduleId: string;
    scheduleName: string;
    /** The day the traveller must arrive, in the schedule's timezone. */
    date: IsoDateString;
    plan: WakePlan;
}

/* -------------------------------------------------------------------------- */
/* Responses                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * One declared type per endpoint, named after the endpoint rather than the
 * thing it happens to return.
 *
 * These exist so `sendSuccess` can be told what an endpoint promised instead of
 * inferring it from whatever was passed. An inferred type argument can never
 * fail: the argument defines the expectation, so the check is circular. Named
 * explicitly, the mapper's output has to satisfy the contract, and the app
 * imports the same name it will parse.
 *
 * Aliases rather than fresh interfaces on purpose. A list endpoint returning
 * something structurally different from the resource's own type is a bug, not a
 * design, and giving it a separate shape here would let that happen quietly.
 */

export type ListPlacesResponse = Place[];
export type PlaceResponse = Place;
export type PlaceAutosuggestResponse = PlaceSuggestion[];

export type ListRoutinesResponse = Routine[];
export type RoutineResponse = Routine;

export type ListSchedulesResponse = Schedule[];
export type ScheduleResponse = Schedule;

export type ListOccurrencesResponse = OccurrenceDto[];
export type OccurrenceResponse = OccurrenceDto;
export type ListAlarmEventsResponse = AlarmEventDto[];

/**
 * Health, and the one response that is not wrapped in the envelope.
 *
 * Load balancers and uptime checks read this, and none of them know about
 * `{ success, data }`. It also reports the database separately rather than
 * folding it into one boolean: a process that is up but cannot reach MySQL is
 * exactly the state where the monitor loop silently stops moving alarms, and
 * "ok" would hide it.
 */
export interface HealthResponse {
    status: 'ok' | 'degraded';
    database: boolean;
    uptime: number;
    timestamp: IsoDateTimeString;
}

/* -------------------------------------------------------------------------- */
/* Occurrences, one day's instance of a schedule                              */
/* -------------------------------------------------------------------------- */

export interface OccurrenceDto {
    id: string;
    scheduleId: string;
    scheduleName: string;
    date: IsoDateString;
    state: OccurrenceState;
    /**
     * The pessimistic time computed at arming. This is what the device actually
     * schedules, and what it falls back to when the network is gone.
     */
    anchorWakeAt: IsoDateTimeString;
    /** Latest computed time. Never earlier than what the device already has. */
    currentWakeAt: IsoDateTimeString;
    departHomeAt: IsoDateTimeString;
    journey: Journey | null;
    plan: WakePlan;
    lastCheckedAt: IsoDateTimeString | null;
}

/**
 * Sent by the device once its local alarm actually matches `currentWakeAt`.
 * Without this the server cannot distinguish "pushed" from "armed", and would
 * re-push the same change forever.
 */
export interface AckOccurrenceRequest {
    ackedWakeAt: IsoDateTimeString;
}

export interface AlarmEventDto {
    id: string;
    occurrenceId: string;
    type: AlarmEventType;
    fromAt: IsoDateTimeString | null;
    toAt: IsoDateTimeString | null;
    reason: WakeChangeReason;
    /** Pre-rendered human sentence, e.g. "Your train is delayed by 12 minutes." */
    message: string;
    createdAt: IsoDateTimeString;
}

/* -------------------------------------------------------------------------- */
/* Places autosuggest, proxied NS Places API                                  */
/* -------------------------------------------------------------------------- */

export interface PlaceSuggestion {
    id: string;
    label: string;
    /** Secondary line, typically the city or full address. */
    description?: string;
    lat: number;
    lng: number;
    nsStationCode?: string;
    /** NS place type, e.g. `station`, `address`, `poi`. */
    type: string;
}

/* -------------------------------------------------------------------------- */
/* Push payloads                                                               */
/* -------------------------------------------------------------------------- */

/** Data-only push telling the device to move an alarm. */
export interface WakeTimeChangedPush {
    type: 'WAKE_TIME_CHANGED';
    occurrenceId: string;
    wakeAt: IsoDateTimeString;
    previousWakeAt: IsoDateTimeString;
    reason: WakeChangeReason;
    message: string;
}

export type PushPayload = WakeTimeChangedPush;
