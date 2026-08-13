import type { BufferConfig } from './domain';

/** Single source of truth for route paths, shared by the API and the app. */
export const API_ENDPOINTS = {
    DEVICES: {
        REGISTER: '/api/v1/devices',
        UPDATE: (id: string) => `/api/v1/devices/${id}`,
    },
    PLACES: {
        LIST: '/api/v1/places',
        CREATE: '/api/v1/places',
        DETAIL: (id: string) => `/api/v1/places/${id}`,
        AUTOSUGGEST: '/api/v1/places/autosuggest',
    },
    ROUTINES: {
        LIST: '/api/v1/routines',
        CREATE: '/api/v1/routines',
        DETAIL: (id: string) => `/api/v1/routines/${id}`,
    },
    SCHEDULES: {
        LIST: '/api/v1/schedules',
        CREATE: '/api/v1/schedules',
        DETAIL: (id: string) => `/api/v1/schedules/${id}`,
        /** The wake plan for this schedule's next occurrence. */
        PLAN: (id: string) => `/api/v1/schedules/${id}/plan`,
    },
    OCCURRENCES: {
        NEXT: '/api/v1/occurrences/next',
        DETAIL: (id: string) => `/api/v1/occurrences/${id}`,
        ACK: (id: string) => `/api/v1/occurrences/${id}/ack`,
        EVENTS: (id: string) => `/api/v1/occurrences/${id}/events`,
    },
    PLAN: {
        PREVIEW: '/api/v1/plan/preview',
        OPTIONS: '/api/v1/plan/options',
    },
    HEALTH: '/api/v1/health',
} as const;

/**
 * How many journeys the options endpoint offers.
 *
 * Three is enough to express "a bit earlier" without turning a wake-up time
 * into a timetable to read at night. Every extra option is another NS itinerary
 * to render and another decision to make.
 */
export const MAX_JOURNEY_OPTIONS = 3;

export const DEFAULT_BUFFERS: BufferConfig = {
    arrivalMinutes: 3,
    preDepartureMinutes: 5,
    transferMinutes: 2,
    wakeSlackMinutes: 0,
};

/** Starting point for a new user's routine, editable immediately after. */
export const DEFAULT_ROUTINE_STEPS = [
    { label: 'Shower', minutes: 10 },
    { label: 'Get dressed', minutes: 8 },
    { label: 'Breakfast', minutes: 15 },
    { label: 'Other preparation', minutes: 5 },
] as const;

export const APP_CONSTANTS = {
    TIMEZONE: 'Europe/Amsterdam',

    ALARM: {
        /**
         * Snooze is **off** until its behaviour is designed properly.
         *
         * Snoozing a journey-derived alarm is not the same as snoozing a fixed
         * one. The wake time is already the latest that still gets you there,
         * so every snoozed minute comes straight out of the safety margin, and
         * nine of them can mean missing the train. Shipping a plain snooze
         * button would quietly convert "you will arrive on time" into "you will
         * not", which is the one promise this app exists to keep.
         *
         * M1 decides whether snooze shows its cost ("you will arrive 4 minutes
         * late"), caps itself at the available slack, or refuses outright. Until
         * then it stays disabled rather than shipping the dishonest version.
         */
        SNOOZE_ENABLED: false,

        /** Classic snooze length. Only used when {@link SNOOZE_ENABLED}. */
        SNOOZE_MINUTES: 9,
    },

    ROUTINE: {
        MAX_STEPS: 20,
        MAX_STEP_MINUTES: 180,
        MAX_LABEL_LENGTH: 40,
    },

    BUFFERS: {
        MAX_MINUTES: 120,
    },

    /**
     * Monitor loop cadence. Distance to the wake time determines how often an
     * occurrence is re-checked: a delay six hours out is noise, a delay twenty
     * minutes out is the entire product.
     *
     * Ordered widest-first; the first band whose threshold the occurrence is
     * still beyond wins. Roughly 35 provider calls per occurrence per night,
     * changing these numbers changes the API bill, so there is a test asserting
     * the total.
     */
    /**
     * NS publishes its ceiling after all: **300 requests per 5 minutes** for
     * external non-paying users, stated in the Reisinformatie API description.
     * A 429 carries `RateLimit-Limit` and `Retry-After` headers.
     *
     * That is one request per second sustained, and it is shared across every
     * user of this deployment. At roughly 35 calls per occurrence per night it
     * is comfortable for a small number of users and becomes the binding
     * constraint well before anything else does, so the monitor must count what
     * it spends rather than assume.
     */
    NS_RATE_LIMIT: {
        REQUESTS: 300,
        WINDOW_MINUTES: 5,
    },

    MONITOR: {
        /** Occurrences further out than this are not armed and cost nothing. */
        ARM_LEAD_MINUTES: 8 * 60,
        CADENCE_BANDS: [
            { withinMinutes: 8 * 60, intervalMinutes: 30 },
            { withinMinutes: 2 * 60, intervalMinutes: 10 },
            { withinMinutes: 45, intervalMinutes: 3 },
        ],
        /** Rows claimed per tick. */
        BATCH_SIZE: 200,
        /**
         * Don't push a change smaller than this. Without a floor, 20 seconds of
         * timetable jitter wakes every device's radio for a change no human
         * perceives, and burns battery doing it.
         */
        MIN_PUSH_DELTA_MINUTES: 2,
    },

    RISK_BUFFER: {
        /** Public transport: discrete risk, you either catch the 07:24 or you don't. */
        PT_BASE_MINUTES: 4,
        PT_PER_TRANSFER_MINUTES: 3,
        PT_DISRUPTED_LEG_MINUTES: 5,
        /** Car: continuous risk, traffic is a distribution, not a number. */
        CAR_MIN_MINUTES: 5,
        CAR_FRACTION: 0.15,
        /** Inside this window TomTom returns live traffic, so trust it more. */
        CAR_LIVE_TRAFFIC_WINDOW_MINUTES: 60,
    },
} as const;

export const ERROR_CODES = {
    UNAUTHORIZED: 'UNAUTHORIZED',
    DEVICE_NOT_FOUND: 'DEVICE_NOT_FOUND',
    NOT_FOUND: 'NOT_FOUND',
    VALIDATION_FAILED: 'VALIDATION_FAILED',
    /** Upstream NS/TomTom call failed or timed out. */
    TRANSPORT_PROVIDER_ERROR: 'TRANSPORT_PROVIDER_ERROR',
    /** Upstream rate limit hit, loud on purpose, we cannot see NS's ceiling. */
    TRANSPORT_RATE_LIMITED: 'TRANSPORT_RATE_LIMITED',
    NO_FEASIBLE_JOURNEY: 'NO_FEASIBLE_JOURNEY',
    INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
