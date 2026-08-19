import type {
    AccessMode,
    AlarmEventType,
    DevicePlatform,
    OccurrenceState,
    ReplacementPreference,
    SimulationKind,
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
    /** Which way to look for a replacement, and when travel is acceptable. */
    replacementPreference?: ReplacementPreference;
    travelWindowStart?: LocalTimeString | null;
    travelWindowEnd?: LocalTimeString | null;
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

/**
 * What one pass of the monitor did.
 *
 * Reported rather than only logged, because the scheduler's output is the first
 * place anyone looks when alarms stop moving. `claimed: 0` every minute is the
 * normal night; `failed` above zero for several ticks running is the shape of a
 * provider outage, and it should be visible without opening the container.
 *
 * `skipped` means a previous tick was still running and this one did nothing.
 * One or two is a slow provider call; a run of them means the batch no longer
 * fits inside a minute.
 */
export interface MonitorTickResponse {
    /**
     * Provider calls this process has made in the last rate-limit window.
     *
     * Reported on every tick because the ceiling is a rate, shared across the
     * whole deployment, and a cadence designed on paper is worth exactly as much
     * as the measurement that confirms it.
     */
    nsCallsInWindow: number;
    tomtomCallsInWindow: number;
    /** Calls this tick alone spent, which is what a new feature changes. */
    nsCallsThisTick: number;
    tomtomCallsThisTick: number;
    /** Active disruptions seen by the one sweep that covers every user. */
    disruptions: number;
    /** Occurrences the sweep pulled forward, ahead of their cadence band. */
    promoted: number;
    claimed: number;
    moved: number;
    unchanged: number;
    failed: number;
    skipped: boolean;
    durationMs: number;
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
    /**
     * The itinerary a cancellation replaced, when one did.
     *
     * Kept so the journey screen can show the train that is gone above the one
     * that took its place. Without it a re-plan erases the evidence: a perfectly
     * good 08:02 appears with nothing to say the 07:52 it replaced is cancelled,
     * and the user goes looking for their usual train on the platform.
     */
    replacedJourney: Journey | null;
    plan: WakePlan;
    lastCheckedAt: IsoDateTimeString | null;
    /**
     * Set while a pretend disruption is waiting to be applied, or has been.
     *
     * On the wire because it has to be visible. Someone woken early by a test
     * must be able to see that is what happened, and a simulation that hides
     * itself is indistinguishable from the product being wrong.
     */
    simulated: SimulationKind | null;
}

/**
 * Asks for a pretend disruption on the next check of this occurrence.
 *
 * `minutes` applies to a delay and is ignored otherwise. Omit `kind` to clear a
 * simulation that has not been applied yet.
 */
export interface SimulateOccurrenceRequest {
    kind: SimulationKind | null;
    minutes?: number;
}

/**
 * Sent by the device once its local alarm actually matches `currentWakeAt`.
 * Without this the server cannot distinguish "pushed" from "armed", and would
 * re-push the same change forever.
 */
export interface AckOccurrenceRequest {
    ackedWakeAt: IsoDateTimeString;
}

/**
 * One recorded change to an alarm, as ingredients rather than as a sentence.
 *
 * `reason` and `toAt` are everything the wording needs, and the app owns the
 * wording: its translations are the single home for user-facing copy, and a
 * sentence rendered on the server would arrive in English whatever language its
 * reader picked. The server keeps its own prose in the row for operators, and
 * that copy never leaves the database.
 */
export interface AlarmEventDto {
    id: string;
    occurrenceId: string;
    type: AlarmEventType;
    fromAt: IsoDateTimeString | null;
    toAt: IsoDateTimeString | null;
    reason: WakeChangeReason;
    /** True when a staged test produced this change rather than NS. */
    simulated: boolean;
    createdAt: IsoDateTimeString;
}

/* -------------------------------------------------------------------------- */
/* Address diagnostics, temporary                                             */
/* -------------------------------------------------------------------------- */

/**
 * One address in the chain, and what can be told about it without trusting it.
 *
 * `index` counts from the left of `X-Forwarded-For` as sent. `fromRight` is the
 * number that matters, because a forwarded chain grows on the left: a client can
 * put anything it likes at the front, and every proxy appends the peer it
 * actually saw. Only the entries closest to the right were written by
 * infrastructure this deployment controls.
 */
export interface ForwardedHop {
    index: number;
    /** Distance from the end of the chain. The last entry is 0. */
    fromRight: number;
    value: string;
    /** `::ffff:1.2.3.4` reduced to `1.2.3.4`, so entries compare sensibly. */
    normalised: string;
    /** Loopback, private range, or link local. A real client is none of these. */
    private: boolean;
    /** Parses as an address at all. A spoofed header need not. */
    valid: boolean;
}

/**
 * What `req.ip` would be at a given `trust proxy` setting.
 *
 * The whole point of the endpoint. Express resolves the client by walking the
 * chain `[socket, ...forwarded reversed]` and taking the entry `hops` steps in,
 * so this table turns "which number do we configure" into something read off a
 * response rather than reasoned about.
 */
export interface HopCandidate {
    hops: number;
    resolvedIp: string;
    /** True for the value the deployment is configured for right now. */
    current: boolean;
    /** A public address here is the shape of a correct answer. */
    private: boolean;
}

/**
 * Everything needed to decide how many proxies to trust.
 *
 * Deliberately verbose, because the cost of another deploy to ask one more
 * question is far higher than the cost of returning a field nobody reads.
 *
 * Sensitive headers are redacted. What is left is the caller's own request
 * reflected back, which holds no secret from the caller, plus what this
 * deployment made of it.
 */
export interface IpDebugResponse {
    /**
     * The address the rate limiters key on today, and the one under suspicion.
     *
     * Equal to `socket.address` when nothing is trusted, and to an entry from
     * the forwarded chain when something is.
     */
    resolvedIp: string;
    /** What `addressOf` in the limiter returns for this request, verbatim. */
    rateLimitKey: string;
    /** The TCP peer. Cannot be spoofed, and behind a proxy is the proxy. */
    socket: {
        address: string | null;
        normalised: string | null;
        port: number | null;
        family: string | null;
        private: boolean;
        /**
         * The connection came from this machine, which is not the same thing as
         * arriving through a proxy. On the VPS nginx is a separate container, so
         * loopback there means the call bypassed it.
         */
        loopback: boolean;
        /** True when Node handed back an IPv4 address inside an IPv6 one. */
        ipv4Mapped: boolean;
    };
    /** How Express is configured, and where that setting came from. */
    trustProxy: {
        setting: string;
        /** `TRUST_PROXY_HOPS`, or the default that applied when it was unset. */
        configuredHops: number;
        envValue: string | null;
        nodeEnv: string;
    };
    forwarded: {
        /** The header exactly as it arrived, or null when there was none. */
        raw: string | null;
        /** Split, trimmed, and annotated. Empty when the header is absent. */
        hops: ForwardedHop[];
        count: number;
        /** `req.ips`: what Express itself made of the chain. */
        expressIps: string[];
    };
    /**
     * The chain Express walks, socket first, forwarded entries right to left.
     *
     * `candidates[n].resolvedIp` is what `req.ip` becomes at `trust proxy: n`.
     */
    chain: string[];
    candidates: HopCandidate[];
    /**
     * Other headers a proxy or CDN might use to name the client.
     *
     * Present so one deploy answers the question even if the answer turns out
     * not to be `X-Forwarded-For`. A value here that matches the phone's real
     * address is a simpler configuration than counting hops.
     */
    clientHeaders: Record<string, string | null>;
    /** Every header, minus the ones that carry a credential. */
    headers: Record<string, string>;
    request: {
        method: string;
        /** `req.protocol`, which `trust proxy` also affects. */
        protocol: string;
        secure: boolean;
        hostname: string;
        originalUrl: string;
        httpVersion: string;
    };
    /** Plain sentences about what the numbers above imply. */
    findings: string[];
    timestamp: IsoDateTimeString;
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
