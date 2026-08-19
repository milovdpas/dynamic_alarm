import type { BufferConfig } from './domain';

/** Single source of truth for route paths, shared by the API and the app. */
export const API_ENDPOINTS = {
    DEVICES: {
        REGISTER: '/api/v1/devices',
        /** This device, identified by its token rather than by an id in the path. */
        ME: '/api/v1/devices/me',
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
        /** The wake plan for this schedule's next occurrence, computed and not stored. */
        PLAN: (id: string) => `/api/v1/schedules/${id}/plan`,
        /** Arms that occurrence, which is the same plan made durable. */
        ARM: (id: string) => `/api/v1/schedules/${id}/arm`,
    },
    OCCURRENCES: {
        /**
         * Every armed morning for this device, soonest first.
         *
         * Distinct from `NEXT`, which answers "what is the alarm", while this
         * answers "what is armed". The schedules list needs the second: a row
         * saying a schedule is active without saying when it will wake you is
         * the half of the answer nobody wants.
         */
        LIST: '/api/v1/occurrences',
        NEXT: '/api/v1/occurrences/next',
        DETAIL: (id: string) => `/api/v1/occurrences/${id}`,
        ACK: (id: string) => `/api/v1/occurrences/${id}/ack`,
        EVENTS: (id: string) => `/api/v1/occurrences/${id}/events`,
        /**
         * Test only. Stages a pretend delay or cancellation for the next check.
         *
         * Device authenticated like everything else here, and it can only touch
         * this device's own morning: a simulation that could be aimed at
         * somebody else's alarm is a way to make a stranger late.
         */
        SIMULATE: (id: string) => `/api/v1/occurrences/${id}/simulate`,
    },
    PLAN: {
        PREVIEW: '/api/v1/plan/preview',
        OPTIONS: '/api/v1/plan/options',
    },
    /**
     * Server-side only. The app never calls this, and holds no token for it.
     *
     * A route rather than a scheduled job inside the process, because the VPS
     * declares scheduled work as Ofelia labels on the app's own compose file.
     * Driving it over HTTP keeps the database pool and the provider caches warm,
     * where a fresh process each minute would reconnect to an external MySQL
     * across the internet for a tick that usually has nothing to do.
     */
    MONITOR: {
        TICK: '/api/v1/monitor/tick',
    },
    HEALTH: '/api/v1/health',
    /**
     * What this deployment actually sees of a caller's address.
     *
     * Diagnostic, and temporary. The rate limiters key on `req.ip`, which is
     * only the real client when Express has been told exactly how many proxies
     * sit in front. Guessing that number is unsafe in both directions: too high
     * and a caller picks their own rate-limit key by sending a header, too low
     * and everybody shares the proxy's address and one bucket.
     *
     * So it is measured rather than guessed. Call this from a phone against the
     * real deployment and the answer names the hop count to configure.
     */
    IP: '/api/v1/ip',
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
        /**
         * How long a staged simulation waits before it is discarded.
         *
         * Long enough to arm, walk away and watch it happen; short enough that
         * one left on by accident cannot still be lying to the monitor tonight.
         * A simulation that outlives the test is an alarm that has quietly
         * stopped tracking reality, which is the exact failure this product
         * exists to prevent.
         */
        SIMULATION_TTL_MINUTES: 60,
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
    /**
     * This caller is asking too often, and the API said so before NS had to.
     *
     * Distinct from `TRANSPORT_RATE_LIMITED`, which means the shared upstream
     * budget is already spent and everybody is affected. This one is about one
     * device or one address, and waiting fixes it.
     */
    RATE_LIMITED: 'RATE_LIMITED',
    NO_FEASIBLE_JOURNEY: 'NO_FEASIBLE_JOURNEY',
    /**
     * Understood and refused, because something still points at it.
     *
     * Its own code rather than a reused `VALIDATION_FAILED`: nothing about the
     * request is wrong, so telling the app to fix its input sends it in circles.
     * `details.blockedBy` names what is in the way, which is the difference
     * between "cannot delete" and "Work mornings uses this".
     */
    RESOURCE_IN_USE: 'RESOURCE_IN_USE',
    INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
