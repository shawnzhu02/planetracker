import { NextRequest, NextResponse } from "next/server";
import { Flight, FlightRadar24API } from "flightradarapi";

type NearestFlight = {
  icao24: string;
  callsign: string;
  aircraftModel: string | null;
  originCountry: string;
  airlineCode: string | null;
  airlineName: string | null;
  originAirportIcao: string | null;
  destinationAirportIcao: string | null;
  latitude: number;
  longitude: number;
  baroAltitudeMeters: number | null;
  geoAltitudeMeters: number | null;
  velocityMps: number | null;
  headingDegrees: number | null;
  onGround: boolean;
  distanceKm: number;
  lastContact: number;
};

type FlightApiResponse = {
  source: "flightradar";
  mode: "nearest" | "tracked";
  nearest?: NearestFlight | null;
  tracked?: NearestFlight | null;
  searchSpanDegrees?: number;
  totalStatesInWindow?: number;
  retryAfterSec?: number;
  stale?: boolean;
  message?: string;
  error?: string;
  fetchedAt: string;
};

type RouteCacheEntry = {
  payload: FlightApiResponse;
  status: number;
  expiresAtMs: number;
};

type FlightRadarFlight = Flight & {
  originAirportIata?: string | null;
  destinationAirportIata?: string | null;
  originAirportIcao?: string | null;
  destinationAirportIcao?: string | null;
  originAirportCountryName?: string | null;
  airlineName?: string | null;
  aircraftModel?: string | null;
  setFlightDetails?: (flightDetails: object) => void;
};

const REQUEST_TTL_MS = 60_000;
const searchWindows = [
  { spanDegrees: 1.5, radiusMeters: 170_000 },
  { spanDegrees: 3, radiusMeters: 340_000 },
  { spanDegrees: 6, radiusMeters: 680_000 },
];

const nearestCache = new Map<string, RouteCacheEntry>();
const trackedCache = new Map<string, RouteCacheEntry>();

let flightRadarApi: FlightRadar24API | null = null;

function getFlightRadarApi(): FlightRadar24API {
  if (!flightRadarApi) {
    flightRadarApi = new FlightRadar24API();
  }

  return flightRadarApi;
}

function normalizeCallsign(callsign: string): string {
  return callsign.trim().toUpperCase();
}

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const earthRadiusKm = 6371;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
}

function toMetersFromFeet(value: number | null | undefined): number | null {
  return isFiniteNumber(value) ? value * 0.3048 : null;
}

function toMetersPerSecondFromKnots(value: number | null | undefined): number | null {
  return isFiniteNumber(value) ? value * 0.514444 : null;
}

async function enrichFlight(flight: FlightRadarFlight): Promise<FlightRadarFlight> {
  try {
    const details = await getFlightRadarApi().getFlightDetails(flight);
    if (typeof flight.setFlightDetails === "function") {
      flight.setFlightDetails(details);
    }
  } catch {
    // Best-effort enrichment only.
  }

  return flight;
}

function mapFlightToNearest(
  flight: FlightRadarFlight,
  refLat: number,
  refLon: number,
): NearestFlight | null {
  if (!isFiniteNumber(flight.latitude) || !isFiniteNumber(flight.longitude)) {
    return null;
  }

  const callsign = (flight.callsign ?? flight.number ?? "Unknown").trim() || "Unknown";

  return {
    icao24: (flight.icao24bit ?? "unknown").toLowerCase(),
    callsign,
    aircraftModel: flight.aircraftModel?.trim() || flight.aircraftCode?.trim() || null,
    originCountry: flight.originAirportCountryName?.trim() || "Unknown",
    airlineCode: flight.airlineIcao?.trim() || null,
    airlineName: flight.airlineName?.trim() || null,
    originAirportIcao: flight.originAirportIcao?.trim() || null,
    destinationAirportIcao: flight.destinationAirportIcao?.trim() || null,
    latitude: flight.latitude,
    longitude: flight.longitude,
    baroAltitudeMeters: toMetersFromFeet(flight.altitude),
    geoAltitudeMeters: toMetersFromFeet(flight.altitude),
    velocityMps: toMetersPerSecondFromKnots(flight.groundSpeed),
    headingDegrees: isFiniteNumber(flight.heading) ? flight.heading : null,
    onGround: flight.onGround === 1,
    distanceKm: haversineKm(refLat, refLon, flight.latitude, flight.longitude),
    lastContact: isFiniteNumber(flight.time) ? flight.time : Math.floor(Date.now() / 1000),
  };
}

function nearestCacheKey(lat: number, lon: number): string {
  return `${lat.toFixed(4)}|${lon.toFixed(4)}`;
}

function trackedCacheKey(
  callsign: string | null,
  icao24: string | null,
  lat?: number,
  lon?: number,
): string {
  const c = callsign ? normalizeCallsign(callsign) : "";
  const i = icao24 ? icao24.toLowerCase() : "";
  const loc =
    typeof lat === "number" && Number.isFinite(lat) && typeof lon === "number" && Number.isFinite(lon)
      ? `${lat.toFixed(4)}|${lon.toFixed(4)}`
      : "no-ref";

  return `${c}|${i}|${loc}`;
}

async function fetchFlightsByRadius(lat: number, lon: number, radiusMeters: number): Promise<FlightRadarFlight[]> {
  const bounds = getFlightRadarApi().getBoundsByPoint(lat, lon, radiusMeters);
  const flights = await getFlightRadarApi().getFlights(null, bounds, null, null, false);
  return Array.isArray(flights) ? flights : [];
}

function findNearestFlight(
  flights: FlightRadarFlight[],
  lat: number,
  lon: number,
): NearestFlight | null {
  let nearest: NearestFlight | null = null;

  for (const flight of flights) {
    const mapped = mapFlightToNearest(flight, lat, lon);
    if (!mapped) {
      continue;
    }

    if (!nearest || mapped.distanceKm < nearest.distanceKm) {
      nearest = mapped;
    }
  }

  return nearest;
}

function findTrackedFlight(
  flights: FlightRadarFlight[],
  lat: number,
  lon: number,
  trackedCallsign: string | null,
  trackedIcao: string | null,
): FlightRadarFlight | null {
  const targetCallsign = trackedCallsign ? normalizeCallsign(trackedCallsign) : null;
  const targetIcao = trackedIcao ? trackedIcao.toLowerCase() : null;

  let bestMatch: FlightRadarFlight | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const flight of flights) {
    const mapped = mapFlightToNearest(flight, lat, lon);
    if (!mapped) {
      continue;
    }

    const callsignMatches = targetCallsign ? normalizeCallsign(mapped.callsign) === targetCallsign : false;
    const icaoMatches = targetIcao ? mapped.icao24 === targetIcao : false;

    if (!callsignMatches && !icaoMatches) {
      continue;
    }

    if (mapped.distanceKm < bestDistance) {
      bestDistance = mapped.distanceKm;
      bestMatch = flight;
    }
  }

  return bestMatch;
}

function readFromCache(cache: Map<string, RouteCacheEntry>, key: string): RouteCacheEntry | null {
  const entry = cache.get(key);

  if (!entry) {
    return null;
  }

  if (entry.expiresAtMs <= Date.now()) {
    cache.delete(key);
    return null;
  }

  return entry;
}

function writeToCache(
  cache: Map<string, RouteCacheEntry>,
  key: string,
  payload: FlightApiResponse,
  status: number,
): void {
  cache.set(key, {
    payload,
    status,
    expiresAtMs: Date.now() + REQUEST_TTL_MS,
  });
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const latParam = request.nextUrl.searchParams.get("lat");
  const lonParam = request.nextUrl.searchParams.get("lon");
  const trackedIcaoParam = request.nextUrl.searchParams.get("trackedIcao");
  const trackedCallsignParam = request.nextUrl.searchParams.get("trackedCallsign");

  const hasLatLon = latParam !== null && lonParam !== null;
  const lat = hasLatLon ? Number(latParam) : null;
  const lon = hasLatLon ? Number(lonParam) : null;

  if (trackedIcaoParam || trackedCallsignParam) {
    let trackedLat: number | undefined;
    let trackedLon: number | undefined;

    if (hasLatLon) {
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        return NextResponse.json(
          { error: "Invalid lat/lon query params for tracked flight mode." },
          { status: 400 },
        );
      }

      trackedLat = Number(lat);
      trackedLon = Number(lon);

      if (trackedLat < -90 || trackedLat > 90 || trackedLon < -180 || trackedLon > 180) {
        return NextResponse.json({ error: "Coordinates are out of bounds." }, { status: 400 });
      }
    }

    const key = trackedCacheKey(
      trackedCallsignParam,
      trackedIcaoParam,
      trackedLat,
      trackedLon,
    );
    const cached = readFromCache(trackedCache, key);

    if (cached) {
      return NextResponse.json(cached.payload, { status: cached.status });
    }

    try {
      let trackedFlightEntity: FlightRadarFlight | null = null;

      if (typeof trackedLat === "number" && typeof trackedLon === "number") {
        for (const window of searchWindows) {
          const flights = await fetchFlightsByRadius(trackedLat, trackedLon, window.radiusMeters);
          trackedFlightEntity = findTrackedFlight(
            flights,
            trackedLat,
            trackedLon,
            trackedCallsignParam,
            trackedIcaoParam,
          );

          if (trackedFlightEntity) {
            break;
          }
        }
      }

      if (!trackedFlightEntity) {
        const flights = await getFlightRadarApi().getFlights();

        if (Array.isArray(flights) && typeof trackedLat === "number" && typeof trackedLon === "number") {
          trackedFlightEntity = findTrackedFlight(
            flights,
            trackedLat,
            trackedLon,
            trackedCallsignParam,
            trackedIcaoParam,
          );
        }
      }

      if (!trackedFlightEntity || typeof trackedLat !== "number" || typeof trackedLon !== "number") {
        const payload: FlightApiResponse = {
          source: "flightradar",
          mode: "tracked",
          tracked: null,
          message: "Tracked plane not currently available in FlightRadar feed.",
          fetchedAt: new Date().toISOString(),
        };

        writeToCache(trackedCache, key, payload, 404);
        return NextResponse.json(payload, { status: 404 });
      }

      const enriched = await enrichFlight(trackedFlightEntity);
      const tracked = mapFlightToNearest(enriched, trackedLat, trackedLon);

      if (!tracked) {
        const payload: FlightApiResponse = {
          source: "flightradar",
          mode: "tracked",
          tracked: null,
          message: "Tracked plane has no position data right now.",
          fetchedAt: new Date().toISOString(),
        };

        writeToCache(trackedCache, key, payload, 404);
        return NextResponse.json(payload, { status: 404 });
      }

      const payload: FlightApiResponse = {
        source: "flightradar",
        mode: "tracked",
        tracked,
        fetchedAt: new Date().toISOString(),
      };

      writeToCache(trackedCache, key, payload, 200);
      return NextResponse.json(payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown server error";
      return NextResponse.json({ error: message }, { status: 502 });
    }
  }

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json({ error: "Missing or invalid lat/lon query params." }, { status: 400 });
  }

  const searchLat = Number(lat);
  const searchLon = Number(lon);

  if (searchLat < -90 || searchLat > 90 || searchLon < -180 || searchLon > 180) {
    return NextResponse.json({ error: "Coordinates are out of bounds." }, { status: 400 });
  }

  const key = nearestCacheKey(searchLat, searchLon);
  const cached = readFromCache(nearestCache, key);

  if (cached) {
    return NextResponse.json(cached.payload, { status: cached.status });
  }

  try {
    for (const window of searchWindows) {
      const flights = await fetchFlightsByRadius(searchLat, searchLon, window.radiusMeters);
      const nearest = findNearestFlight(flights, searchLat, searchLon);

      if (nearest) {
        const nearestEntity = flights.find(
          (flight) =>
            (flight.icao24bit ?? "").toLowerCase() === nearest.icao24 &&
            normalizeCallsign(flight.callsign ?? flight.number ?? "Unknown") === normalizeCallsign(nearest.callsign),
        );

        const nearestWithDetails = nearestEntity
          ? mapFlightToNearest(await enrichFlight(nearestEntity), searchLat, searchLon) ?? nearest
          : nearest;

        const payload: FlightApiResponse = {
          source: "flightradar",
          mode: "nearest",
          searchSpanDegrees: window.spanDegrees,
          nearest: nearestWithDetails,
          totalStatesInWindow: flights.length,
          fetchedAt: new Date().toISOString(),
        };

        writeToCache(nearestCache, key, payload, 200);
        return NextResponse.json(payload);
      }
    }

    const payload: FlightApiResponse = {
      source: "flightradar",
      mode: "nearest",
      nearest: null,
      message: "No nearby flights found in the current search windows.",
      fetchedAt: new Date().toISOString(),
    };

    writeToCache(nearestCache, key, payload, 404);
    return NextResponse.json(payload, { status: 404 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown server error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
