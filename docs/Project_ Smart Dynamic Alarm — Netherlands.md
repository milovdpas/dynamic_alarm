# Project: Smart Dynamic Alarm, Netherlands

I want to build a mobile app for **iOS and Android**, initially targeting **the Netherlands**.

The core idea is a **smart alarm / morning planner** that calculates the latest possible time a user should wake up based on when they need to arrive somewhere, their personal morning routine, and current/future travel conditions.

## Product concept

The app answers:

> **"What is the latest time I can wake up and still arrive at my destination on time?"**

For example:

A user needs to be at work at **08:30**.

Their routine:
- Shower: 10 min
- Get dressed: 8 min
- Breakfast: 15 min
- Other preparation: 5 min
- Buffer: 10 min

Their normal journey:
- Walk to station: 7 min
- Train journey: 35 min
- Walk from station: 8 min

The app calculates the required wake-up time.

If the train is delayed by 15 minutes, the app should be able to recalculate the journey and potentially move the alarm later.

If traffic becomes significantly worse for a car journey, the app should recalculate the required departure/wake-up time.

The goal is to **save the user sleep whenever possible while still getting them to their destination on time**.

---

# Target market

For the MVP, ONLY target the Netherlands.

Do not design the first version around worldwide transportation support.

Potential transport modes:
- Dutch trains
- Other Dutch public transport
- Car

Potential future modes:
- Bicycle
- Walking
- Multimodal combinations

---

# Important example

Imagine:

Destination:
Work

Required arrival:
08:30

Morning routine:
- Shower: 10 min
- Breakfast: 15 min
- Getting dressed: 10 min
- Buffer: 10 min

Travel:
- Walk to station: 7 min
- Train: 35 min
- Walk from station: 8 min

The app calculates the required wake-up time.

Later, the selected train is delayed by 12 minutes.

The system should determine whether:
1. The user can simply wake up 12 minutes later, OR
2. The delay causes a missed connection and therefore requires a completely different route, OR
3. The delay makes the user unable to arrive on time and another route should be recommended.

The calculation should NOT simply add/subtract the delay blindly. It should recalculate the actual journey where possible.

---

# Technology direction

I am considering:

- Expo
- React Native
- TypeScript
- iOS + Android
- A backend service for travel monitoring and recalculation
- Local storage/database for user preferences and schedules
- Native/local notifications or alarm functionality

I do NOT want the core alarm logic to depend on a JavaScript timer remaining active in the background.

The phone may be:
- locked
- in the background
- in low-power mode
- temporarily offline

The alarm architecture therefore needs careful consideration.

---

# Transportation data

Investigate suitable Dutch APIs/data sources.

Potential candidates include:

### 9292
Investigate:
- Reisadvies API
- Vertrektijden API
- real-time public transport information
- delays
- cancellations
- connections
- whether commercial/API access is required
- pricing and rate limits
- licensing
- whether the data can legally be used in a commercial app

### TomTom
Investigate:
- Routing API
- traffic-aware routing
- current traffic
- predicted traffic
- future departure times
- route duration
- API pricing
- rate limits
- licensing

Do NOT assume these services are automatically the correct choices. Research and compare alternatives where appropriate.

---

# Core architecture question

Before writing substantial code, help me determine the best architecture.

I want you to investigate and discuss:

## 1. Mobile application

What should live inside the Expo app?

For example:
- UI
- user preferences
- morning routines
- saved destinations
- alarm configuration
- local caching
- currently scheduled alarm
- notifications

## 2. Backend

What should live on the backend?

Potential responsibilities:
- monitoring selected journeys
- querying transport APIs
- querying traffic APIs
- recalculating journeys
- determining whether the alarm needs changing
- sending updates to the phone

Explain whether a backend is actually necessary and what architecture you recommend.

## 3. Alarm system

This is one of the most important technical questions.

Investigate the differences between iOS and Android.

I need to understand:

- Can Expo schedule a notification that fires while the phone is locked?
- Can it play a custom alarm sound?
- Can the alarm be updated after being scheduled?
- Can the app wake itself up in the background?
- What happens in low-power mode?
- What happens if the app is force-quit?
- What happens if the phone has no internet connection?
- What happens if the phone is completely powered off?
- Can Android provide a true alarm-clock experience?
- What limitations exist on iOS?
- Do we need native modules?
- Is Expo managed workflow sufficient?
- Would Expo prebuild/custom native code be necessary?
- Are there App Store restrictions around this type of application?

Be very precise here. Do not promise functionality that iOS or Android does not actually allow.

---

# Dynamic alarm model

I want the alarm to be derived from a journey rather than being a fixed time.

Think about a model similar to:

```text
required_arrival_time
-
travel_duration
-
pre_departure_time
-
morning_routine_duration
-
safety_buffer
=
wake_up_time
```

But design this properly.

For example, determine:

- Where does the buffer belong?
- Should the buffer be before departure, before arrival, or both?
- How should walking time be handled?
- How should transfers be handled?
- How should missed connections be handled?
- How should cancellations be handled?
- How should route changes be handled?
- What happens if no route can satisfy the required arrival time?
- How should uncertainty in traffic predictions be handled?

I want a robust model rather than a simplistic time subtraction system.

---

# User experience

Propose an initial onboarding flow.

For example:

1. Create profile
2. Add destination
3. Set required arrival time
4. Select transport mode
5. Enter morning routine
6. Set preferred safety buffer
7. Choose days of the week
8. Enable smart alarm

Then the app could show something like:

> Tomorrow
>
> 🏠 Home → Work
>
> Arrive by 08:30
>
> 🚆 Train: 07:24
> 🚶 Walk: 7 min
> 🚶 Final walk: 8 min
>
> Morning routine: 43 min
> Buffer: 10 min
>
> **Wake up: 06:46**

If the journey changes:

> 🚨 Journey update
>
> Your train is delayed by 12 minutes.
>
> We've recalculated your journey.
>
> **New wake-up time: 06:58**
>
> You can sleep 12 minutes longer.

Think about how this UX could be improved.

---

# Important edge cases

Please consider:

### Public transport
- train delay
- train cancellation
- missed connection
- platform changes
- route disruption
- replacement buses
- multiple possible routes
- insufficient connection time
- journey becomes impossible

### Car
- traffic suddenly increases
- traffic decreases
- accident/road closure
- predicted traffic vs current traffic
- different route becoming faster
- user leaves earlier than expected

### Alarm
- phone locked
- app backgrounded
- app force-quit
- phone offline
- phone in low-power mode
- notification permission denied
- alarm permission denied
- user manually changes the alarm
- journey changes after the alarm has already started
- multiple alarms
- recurring schedules

### User behavior
- user changes destination
- user changes arrival time
- user skips breakfast
- user wakes up earlier
- user ignores the alarm
- user manually overrides the calculated wake-up time

---

# MVP scope

Help me define a realistic MVP.

I do NOT want to build everything at once.

Recommend what should be included in:

### MVP 1
The simplest useful version.

### MVP 2
Dynamic transport updates.

### MVP 3
More advanced intelligence/automation.

For every feature, explain whether it is:
- essential
- useful
- unnecessary for MVP
- technically risky

---

# Important development approach

Do NOT immediately generate the entire application.

First:

1. Analyze the concept.
2. Identify technical risks.
3. Research relevant APIs and platform limitations.
4. Propose architecture.
5. Explain the alarm strategy for iOS and Android.
6. Define the data model.
7. Define the MVP.
8. Identify questions/decisions I need to make.
9. Only after discussing these things, start implementation.

When making recommendations, explain the tradeoffs.

If you believe my original idea has a technical problem, tell me directly rather than working around it silently.

I want to use this conversation to **design the product and architecture together first**, and then use Claude Code to implement it incrementally.

Please start by giving me:

1. Your understanding of the product
2. The biggest technical risks
3. Recommended architecture
4. Recommended MVP
5. The biggest decisions we need to make before coding