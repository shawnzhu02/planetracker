# Planet Tracker

Live dashboard that:

- Automatically gets your location in the browser
- Selects the nearest flight every 1 minute
- Updates the selected flight once per minute
- Shows a clean always-visible summary: callsign, arrival, departure, distance, geometric altitude
- Shows flight direction relative to the direction your device is facing

## Getting Started

Run the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Allow geolocation access when prompted so nearest-flight tracking can work.

## Features

- Auto nearest-flight lock based on your current coordinates
- Nearest-flight selection cadence set to once per minute
- Selected flight updates on the same 1-minute cadence
- Split-flap display for departure airport using `react-split-flap-effect`
- Toggleable section for additional flight details
- Direction awareness: manual heading or device compass mode with relative flight direction

## Data Source Notes

- Flight state data is fetched through `flightradarapi` via the server route at `app/api/nearby-flight/route.ts`.
- Origin/destination and airline are best-effort enrichments and may be `n/a` for some aircraft.

## Tech Stack

- Next.js App Router
- TypeScript
- Tailwind CSS
