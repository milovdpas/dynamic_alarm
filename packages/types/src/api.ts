import type {
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
    RoutineStep,
    TimeZone,
    WakePlan,
} from './domain';

/* -------------------------------------------------------------------------- */
/* Envelopes                                                                   */
/* -------------------------------------------------------------------------- */

export interface ApiError {
    code: string;
    message: string;
    details?: unknown;
}

export interface ApiSuccess<T> {
    success: true;
    data: T;
}

export interface ApiFailure {
    success: false;
    error: ApiError;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

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
}

/* -------------------------------------------------------------------------- */
/* Places / routines / schedules                                               */
/* -------------------------------------------------------------------------- */

export type CreatePlaceRequest = Omit<Place, 'id'>;
export type UpdatePlaceRequest = Partial<CreatePlaceRequest>;

export interface CreateRoutineRequest {
    name: string;
    steps: Omit<RoutineStep, 'id'>[];
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
    fixedTravelMinutes?: number;
    routineMinutes: number;
    buffers: BufferConfig;
    timezone: TimeZone;
}

export type PlanPreviewResponse = WakePlan;

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

/* -------------------------------------------------------------------------- */
/* Convenience aliases                                                         */
/* -------------------------------------------------------------------------- */

export type PlaceDto = Place;
export type RoutineDto = Routine;
