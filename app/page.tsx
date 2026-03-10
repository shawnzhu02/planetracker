"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Image from "next/image";
import CompassDial from "./components/CompassDial";

const FlightMap = dynamic(() => import("./components/FlightMap"), { ssr: false });
import { FlapDisplay, Presets } from "./components/FlapDisplay";

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

type NearbyFlightResponse = {
  source: string;
  mode?: "nearest" | "tracked";
  searchSpanDegrees?: number;
  nearest?: NearestFlight | null;
  tracked?: NearestFlight | null;
  totalStatesInWindow?: number;
  retryAfterSec?: number;
  stale?: boolean;
  fetchedAt?: string;
  message?: string;
  error?: string;
};

const DEFAULT_POLL_INTERVAL_MS = 30_000;
const USE_MOCK_FLIGHT_DATA = false;
const DING_DONG_AUDIO_SRC = encodeURI("/Airplane Ding Dong Sound Effect [Cll_UdGiOCE].webm");
const DING_DONG_VOLUME = 0.25;
let dingDongTemplateAudio: HTMLAudioElement | null = null;

type UserLocation = {
  latitude: number;
  longitude: number;
};

function formatMeters(value: number | null): string {
  if (value === null) {
    return "n/a";
  }

  return `${Math.round(value)} m`;
}

function getDisplayedAltitudeMeters(flight: NearestFlight): number | null {
  if (flight.geoAltitudeMeters !== null) {
    return flight.geoAltitudeMeters;
  }

  if (flight.baroAltitudeMeters !== null) {
    return flight.baroAltitudeMeters;
  }

  return null;
}

function formatSpeed(value: number | null): string {
  if (value === null) {
    return "n/a";
  }

  const knots = value * 1.94384;
  return `${knots.toFixed(0)} kt`;
}

function normalizeDegrees(value: number): number {
  return ((value % 360) + 360) % 360;
}

function playPlaneDingDong(): void {
  try {
    if (!dingDongTemplateAudio) {
      dingDongTemplateAudio = new Audio(DING_DONG_AUDIO_SRC);
      dingDongTemplateAudio.preload = "auto";
    }

    const audio = dingDongTemplateAudio.cloneNode(true) as HTMLAudioElement;
    audio.volume = DING_DONG_VOLUME;
    audio.defaultMuted = false;
    audio.muted = false;
    audio.currentTime = 0;
    void audio.play();
  } catch {
    // Ignore playback failures due to browser autoplay or unsupported formats.
  }
}

function destinationPoint(lat: number, lon: number, bearingDeg: number, distanceKm: number): { latitude: number; longitude: number } {
  const earthRadiusKm = 6371;
  const angularDistance = distanceKm / earthRadiusKm;
  const bearing = (bearingDeg * Math.PI) / 180;
  const lat1 = (lat * Math.PI) / 180;
  const lon1 = (lon * Math.PI) / 180;

  const sinLat1 = Math.sin(lat1);
  const cosLat1 = Math.cos(lat1);
  const sinAngular = Math.sin(angularDistance);
  const cosAngular = Math.cos(angularDistance);

  const lat2 = Math.asin(sinLat1 * cosAngular + cosLat1 * sinAngular * Math.cos(bearing));
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(bearing) * sinAngular * cosLat1,
      cosAngular - sinLat1 * Math.sin(lat2),
    );

  return {
    latitude: (lat2 * 180) / Math.PI,
    longitude: ((((lon2 * 180) / Math.PI) + 540) % 360) - 180,
  };
}

function bearingBetweenPoints(fromLat: number, fromLon: number, toLat: number, toLon: number): number {
  const fromLatRad = (fromLat * Math.PI) / 180;
  const toLatRad = (toLat * Math.PI) / 180;
  const deltaLonRad = ((toLon - fromLon) * Math.PI) / 180;

  const y = Math.sin(deltaLonRad) * Math.cos(toLatRad);
  const x =
    Math.cos(fromLatRad) * Math.sin(toLatRad) -
    Math.sin(fromLatRad) * Math.cos(toLatRad) * Math.cos(deltaLonRad);

  return normalizeDegrees((Math.atan2(y, x) * 180) / Math.PI);
}

function relativeDirectionLabel(relativeAngle: number): string {
  const absAngle = Math.abs(relativeAngle);

  if (absAngle <= 15) {
    return "Straight ahead";
  }
  if (absAngle <= 60) {
    return relativeAngle > 0 ? "Front-right" : "Front-left";
  }
  if (absAngle <= 120) {
    return relativeAngle > 0 ? "Right" : "Left";
  }
  if (absAngle <= 165) {
    return relativeAngle > 0 ? "Rear-right" : "Rear-left";
  }
  return "Behind you";
}

function getAirlineLogoUrl(airlineCode: string | null): string | null {
  if (!airlineCode) {
    return null;
  }

  const iataByIcao: Record<string, string> = {
    AAL: "AA",
    ACA: "AC",
    AFR: "AF",
    ASA: "AS",
    BAW: "BA",
    DAL: "DL",
    DLH: "LH",
    EIN: "EI",
    ETD: "EY",
    FFT: "F9",
    JBU: "B6",
    KLM: "KL",
    QFA: "QF",
    RYR: "FR",
    SWA: "WN",
    THY: "TK",
    UAL: "UA",
    UAE: "EK",
    VIR: "VS",
    WJA: "WS",
  };

  const iata = iataByIcao[airlineCode.toUpperCase()];
  if (!iata) {
    return null;
  }

  return `https://content.airhex.com/content/logos/airlines_${iata}_200_200_s.png`;
}

function buildMockFlight(position: UserLocation, tick: number): NearestFlight {
  const wobble = Math.sin(tick / 3);
  const wobbleSmall = Math.cos(tick / 4);

  return {
    icao24: "abc123",
    callsign: "DAL123",
    aircraftModel: "Airbus A319",
    originCountry: "United States",
    airlineCode: "DAL",
    airlineName: "Delta Air Lines",
    originAirportIcao: "KATL",
    destinationAirportIcao: "KJFK",
    latitude: position.latitude + 0.09 + wobble * 0.01,
    longitude: position.longitude + 0.11 + wobbleSmall * 0.01,
    baroAltitudeMeters: 9500 + Math.round(wobble * 250),
    geoAltitudeMeters: 9700 + Math.round(wobbleSmall * 250),
    velocityMps: 240 + wobble * 10,
    headingDegrees: normalizeDegrees(45 + tick * 7),
    onGround: false,
    distanceKm: 14.2 + Math.abs(wobble) * 2,
    lastContact: Math.floor(Date.now() / 1000),
  };
}

function RelativeDirectionArrow({ angle }: { angle: number | null }) {
  if (angle === null) {
    return (
      <div className="flex h-28 w-28 items-center justify-center rounded-full border border-slate-600 bg-slate-900 text-xs text-slate-400">
        n/a
      </div>
    );
  }

  return (
    <div className="relative h-28 w-28 rounded-full border border-emerald-300/35 bg-slate-900/90">
      <div className="absolute left-1/2 top-2 -translate-x-1/2 text-[10px] font-semibold tracking-wide text-emerald-300">
        FRONT
      </div>
      <div
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-4xl text-emerald-300 transition-transform duration-300"
        style={{ transform: `translate(-50%, -50%) rotate(${angle}deg)` }}
        aria-hidden
      >
        ↑
      </div>
      <div className="absolute inset-0 flex items-center justify-center text-[10px] text-slate-300">
        aircraft
      </div>
    </div>
  );
}

function FlapText({
  value,
  minLength = 0,
  className = "radio-flap",
}: {
  value: string;
  minLength?: number;
  className?: string;
}) {
  const safeValue = value.length > 0 ? value : " ";

  return (
    <FlapDisplay
      className={className}
      chars={Presets.ALPHANUM + " -_.,:;!?/()+[]'\""}
      length={Math.max(minLength, safeValue.length)}
      timing={22}
      hinge
      value={safeValue}
    />
  );
}

type FlightSidebarProps = {
  flight: NearestFlight;
  airlineLogoUrl: string | null;
  showDetails: boolean;
  onToggleDetails: () => void;
  status: string;
  error: string | null;
  flightHeading: string;
  relativeFlightLabel: string;
  lastUpdated: string | null;
  selectionUpdatedAt: string | null;
  targetPollMs: number;
  onPollIntervalChange: (ms: number) => void;
  compassStatus: string;
  deviceHeadingDegrees: number;
  headingMode: "manual" | "compass";
  manualHeading: string;
  onManualHeadingChange: (value: string) => void;
  onEnableCompass: () => void;
  onCompassDialChange: (value: number) => void;
  relativeArrow: React.ReactNode;
};

function FlightSidebar({
  flight,
  airlineLogoUrl,
  showDetails,
  onToggleDetails,
  status,
  error,
  flightHeading,
  relativeFlightLabel,
  lastUpdated,
  selectionUpdatedAt,
  targetPollMs,
  onPollIntervalChange,
  compassStatus,
  deviceHeadingDegrees,
  headingMode,
  manualHeading,
  onManualHeadingChange,
  onEnableCompass,
  onCompassDialChange,
  relativeArrow,
}: FlightSidebarProps) {
  return (
    <aside className="h-full rounded-r-2xl border border-emerald-300/20 border-l-0 bg-[#0f1f17]/96 p-0 shadow-[0_20px_50px_rgba(0,0,0,0.45)] overflow-y-auto">
      <div className="border-b border-slate-600/40 bg-linear-to-r from-[#163122] via-[#12281d] to-[#0e1f16] px-4 pb-3 pt-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <FlapText value={flight.callsign} className="radio-flap radio-flap-title" />
            <div className="mt-2 flex items-center gap-2 text-xs">
              {flight.airlineCode ? (
                <span className="rounded-md bg-slate-700/80 px-2 py-1 font-semibold text-slate-100">{flight.airlineCode}</span>
              ) : null}
              <span className="rounded-md bg-[#2a5a42] px-2 py-1 font-semibold text-slate-100">
                {flight.aircraftModel?.split(" ").pop() ?? "N/A"}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 pt-1">
            {airlineLogoUrl ? (
              <Image
                src={airlineLogoUrl}
                alt={`${flight.airlineName ?? flight.airlineCode ?? "Airline"} logo`}
                width={20}
                height={20}
                className="h-5 w-5 rounded bg-white object-contain p-0.5"
                unoptimized
              />
            ) : null}
            <p className="text-sm font-semibold text-slate-100">{flight.airlineName ?? "Unknown airline"}</p>
          </div>
        </div>
      </div>

      <div className="border-b border-slate-700/60 bg-[#20262f]">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center">
          <div className="border-r border-slate-700/60 px-3 py-4 text-center">
            <p className="mb-1 text-[11px] uppercase tracking-[0.14em] text-slate-400">Departure</p>
            <div className="flex justify-center">
              <FlapDisplay
                className="departure-flap"
                chars={Presets.ALPHANUM + "- "}
                length={4}
                timing={25}
                hinge
                value={(flight.originAirportIcao ?? "N/A").toUpperCase()}
              />
            </div>
          </div>

          <div className="flex h-full min-h-21 w-16 items-center justify-center border-r border-slate-700/60 bg-[#101a14] text-2xl text-emerald-300">
            ✈
          </div>

          <div className="px-3 py-4 text-center">
            <p className="mb-1 text-[11px] uppercase tracking-[0.14em] text-slate-400">Arrival</p>
            <div className="flex justify-center">
              <FlapDisplay
                className="departure-flap"
                chars={Presets.ALPHANUM + "- "}
                length={4}
                timing={25}
                hinge
                value={(flight.destinationAirportIcao ?? "N/A").toUpperCase()}
              />
            </div>
          </div>
        </div>


      </div>

      <div className="px-3 py-3">
        <div className="rounded-md border border-slate-700/60 bg-[#1c222b] p-3">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="font-semibold uppercase tracking-wide text-slate-400">Aircraft Type</span>
            <span className="text-emerald-300">{flight.airlineCode ?? "N/A"}</span>
          </div>
          <span className="text-base font-semibold text-slate-100">{flight.aircraftModel ?? "Unknown Aircraft"}</span>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-md border border-slate-700/60 bg-[#1c222b] p-2">
            <p className="text-[11px] uppercase tracking-wide text-slate-400">Distance</p>
            <p className="text-lg font-semibold text-slate-100">{`${flight.distanceKm.toFixed(1)} km`}</p>
          </div>
          <div className="rounded-md border border-slate-700/60 bg-[#1c222b] p-2">
            <p className="text-[11px] uppercase tracking-wide text-slate-400">Altitude</p>
            <p className="text-lg font-semibold text-slate-100">{formatMeters(getDisplayedAltitudeMeters(flight))}</p>
          </div>
        </div>

        <div className="mt-3 rounded-md border border-slate-700/60 bg-[#1c222b] p-2">
          <div className="h-2 rounded-full bg-slate-700/60" />
          <div className="mt-2 flex items-center justify-between text-sm text-slate-300">
            <span>{`Heading ${flightHeading}`}</span>
            <span>{`Speed ${formatSpeed(flight.velocityMps)}`}</span>
          </div>
          <div className="mt-1 flex items-center justify-between text-sm text-slate-300">
            <span>{`Relative ${relativeFlightLabel}`}</span>
            <span>{`${Math.max(1, Math.round(flight.distanceKm / 12))} min`}</span>
          </div>
        </div>

        <button
          type="button"
          onClick={onToggleDetails}
          className="mt-3 w-full rounded-sm border border-emerald-300/35 bg-[#2c6247] px-4 py-2 text-base font-semibold text-slate-100 transition hover:bg-[#367557]"
        >
          Settings
        </button>
      </div>

      {showDetails ? (
        <div className="mx-3 mb-3 space-y-2 border border-slate-700/60 bg-[#1c222b] p-3 text-xs text-slate-200">
          <div className="rounded-md border border-slate-700/60 bg-[#151a22] p-2">
            <p className="mb-1.5 text-[11px] uppercase tracking-wide text-slate-400">Refresh Interval</p>
            <div className="mb-3 flex flex-wrap gap-1.5">
              {([20_000, 30_000, 45_000, 60_000, 120_000, 300_000] as const).map((ms) => (
                <button
                  key={ms}
                  type="button"
                  onClick={() => onPollIntervalChange(ms)}
                  className={`rounded px-2 py-0.5 text-xs font-semibold transition ${
                    targetPollMs === ms
                      ? "bg-emerald-600 text-white"
                      : "border border-slate-600 bg-[#0f141b] text-slate-300 hover:bg-[#1c2430]"
                  }`}
                >
                  {ms < 60_000 ? `${ms / 1000}s` : `${ms / 60_000}m`}
                </button>
              ))}
            </div>
            <CompassDial
              headingDegrees={deviceHeadingDegrees}
              onHeadingChange={onCompassDialChange}
              disabled={headingMode === "compass"}
            />
            <input
              type="number"
              min={0}
              max={359}
              value={manualHeading}
              onChange={(event) => onManualHeadingChange(event.target.value)}
              className="mt-2 w-full rounded-md border border-slate-600 bg-[#0f141b] px-2 py-1 text-sm text-slate-100 outline-none"
            />
            <button
              type="button"
              onClick={onEnableCompass}
              className="mt-2 w-full rounded-md border border-slate-500/70 bg-[#2e3b4d] px-3 py-1 text-sm font-semibold text-slate-100 transition hover:bg-[#3b4b61]"
            >
              Use Device Compass
            </button>
          </div>
        </div>
      ) : null}
    </aside>
  );
}

export default function Home() {
  const [location, setLocation] = useState<UserLocation | null>(null);
  const [flight, setFlight] = useState<NearestFlight | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [status, setStatus] = useState("Waiting for location access...");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [selectionUpdatedAt, setSelectionUpdatedAt] = useState<string | null>(null);
  const [targetPollMs, setTargetPollMs] = useState(DEFAULT_POLL_INTERVAL_MS);
  const locationRef = useRef<UserLocation | null>(null);
  const hasFetchedInitialFlightRef = useRef(false);
  const targetFlightKeyRef = useRef<string | null>(null);

  const [manualHeading, setManualHeading] = useState("0");
  const [deviceHeadingDegrees, setDeviceHeadingDegrees] = useState(0);
  const [headingMode, setHeadingMode] = useState<"manual" | "compass">("manual");
  const [compassStatus, setCompassStatus] = useState("Using manual heading");
  const [showDetails, setShowDetails] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [estimatedFlightPosition, setEstimatedFlightPosition] = useState<{
    latitude: number;
    longitude: number;
    callsign: string;
    headingDegrees: number | null;
  } | null>(null);

  async function selectClosestFlight(position: UserLocation): Promise<void> {
    const maybeNotifyTargetChange = (nextFlight: NearestFlight | null): void => {
      const nextKey = nextFlight ? `${nextFlight.icao24}|${nextFlight.callsign}` : null;

      if (nextKey && targetFlightKeyRef.current && targetFlightKeyRef.current !== nextKey) {
        playPlaneDingDong();
      }

      targetFlightKeyRef.current = nextKey;
    };

    if (USE_MOCK_FLIGHT_DATA) {
      const mock = buildMockFlight(position, Math.floor(Date.now() / 1000));
      maybeNotifyTargetChange(mock);
      setFlight(mock);
      const nowIso = new Date().toISOString();
      setLastUpdated(nowIso);
      setSelectionUpdatedAt(nowIso);
      setStatus("Mock mode enabled: using example nearest flight data.");
      setError(null);
      return;
    }

    setIsLoading(true);

    try {
      const params = new URLSearchParams({
        lat: String(position.latitude),
        lon: String(position.longitude),
      });

      const response = await fetch(`/api/nearby-flight?${params.toString()}`);
      const data = (await response.json()) as NearbyFlightResponse;

      if (!response.ok) {
        throw new Error(data.error ?? data.message ?? "Unable to fetch nearest flight data.");
      }

      maybeNotifyTargetChange(data.nearest ?? null);
      setFlight(data.nearest ?? null);
      setLastUpdated(data.fetchedAt ?? new Date().toISOString());
      setSelectionUpdatedAt(data.fetchedAt ?? new Date().toISOString());
      setStatus(
        data.nearest
          ? `Closest flight selected (${data.nearest.callsign}). Reselecting every 30 seconds...`
          : data.message ?? "No flights nearby.",
      );
      setError(null);
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : "Unexpected error";
      setError(message);
      setStatus("Plane selection paused due to data error.");
    } finally {
      setIsLoading(false);
    }
  }

  function updateManualHeading(nextValue: string): void {
    setManualHeading(nextValue);
    const numericValue = Number(nextValue);
    if (Number.isFinite(numericValue)) {
      setDeviceHeadingDegrees(normalizeDegrees(numericValue));
    }
  }

  function setManualHeadingFromCompass(nextDegrees: number): void {
    setHeadingMode("manual");
    setCompassStatus("Using manual heading");
    setDeviceHeadingDegrees(normalizeDegrees(nextDegrees));
    setManualHeading(String(Math.round(normalizeDegrees(nextDegrees))));
  }

  async function enableCompassHeading(): Promise<void> {
    if (!("DeviceOrientationEvent" in window)) {
      setCompassStatus("Compass is not supported in this browser.");
      return;
    }

    const orientationEvent = window.DeviceOrientationEvent as typeof DeviceOrientationEvent & {
      requestPermission?: () => Promise<"granted" | "denied">;
    };

    if (typeof orientationEvent.requestPermission === "function") {
      const permission = await orientationEvent.requestPermission();
      if (permission !== "granted") {
        setCompassStatus("Compass permission denied. Still using manual heading.");
        return;
      }
    }

    setHeadingMode("compass");
    setCompassStatus("Compass heading enabled");
  }

  useEffect(() => {
    if (!("geolocation" in navigator)) {
      setStatus("Geolocation is unavailable in this browser.");
      setError("Your browser does not support geolocation.");
      return;
    }

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const nextLocation = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        };

        locationRef.current = nextLocation;
        setLocation(nextLocation);
        setStatus("Location lock acquired. Tracking nearest flight every 30 seconds...");

        if (!hasFetchedInitialFlightRef.current) {
          hasFetchedInitialFlightRef.current = true;
          void selectClosestFlight(nextLocation);
        }
      },
      (geoError) => {
        setStatus("Unable to access your location.");
        setError(geoError.message);
      },
      {
        enableHighAccuracy: true,
        maximumAge: 15_000,
        timeout: 15_000,
      },
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      const currentLocation = locationRef.current;
      if (!currentLocation) {
        return;
      }

      void selectClosestFlight(currentLocation);
    }, targetPollMs);

    return () => window.clearInterval(intervalId);
  }, [targetPollMs]);

  useEffect(() => {
    function handleDeviceOrientation(event: DeviceOrientationEvent): void {
      if (headingMode !== "compass") {
        return;
      }

      const orientationEvent = event as DeviceOrientationEvent & {
        webkitCompassHeading?: number;
      };

      // iOS reports compass heading on webkitCompassHeading; other browsers use alpha.
      const maybeHeading =
        typeof orientationEvent.webkitCompassHeading === "number"
          ? orientationEvent.webkitCompassHeading
          : typeof orientationEvent.alpha === "number"
            ? 360 - orientationEvent.alpha
            : null;

      if (maybeHeading !== null && Number.isFinite(maybeHeading)) {
        const normalized = normalizeDegrees(maybeHeading);
        setDeviceHeadingDegrees(normalized);
      }
    }

    window.addEventListener("deviceorientation", handleDeviceOrientation, true);
    return () => window.removeEventListener("deviceorientation", handleDeviceOrientation, true);
  }, [headingMode]);

  const flightHeading = useMemo(() => {
    if (flight?.headingDegrees === null || flight?.headingDegrees === undefined) {
      return "n/a";
    }

    return `${Math.round(flight.headingDegrees)}°`;
  }, [flight?.headingDegrees]);

  const bearingToFlight = useMemo(() => {
    if (!location || !flight) {
      return null;
    }

    return bearingBetweenPoints(location.latitude, location.longitude, flight.latitude, flight.longitude);
  }, [flight, location]);

  const relativeFlightAngle = useMemo(() => {
    if (bearingToFlight === null) {
      return null;
    }

    const delta = normalizeDegrees(bearingToFlight - deviceHeadingDegrees);
    return delta > 180 ? delta - 360 : delta;
  }, [bearingToFlight, deviceHeadingDegrees]);

  const relativeFlightLabel = useMemo(() => {
    if (relativeFlightAngle === null) {
      return "n/a";
    }

    return relativeDirectionLabel(relativeFlightAngle);
  }, [relativeFlightAngle]);

  const airlineLogoUrl = useMemo(() => getAirlineLogoUrl(flight?.airlineCode ?? null), [flight?.airlineCode]);

  useEffect(() => {
    if (!flight) {
      setEstimatedFlightPosition(null);
      return;
    }

    const base = {
      latitude: flight.latitude,
      longitude: flight.longitude,
      callsign: flight.callsign,
      headingDegrees: flight.headingDegrees,
      velocityMps: flight.velocityMps,
      onGround: flight.onGround,
      startedAtMs: Date.now(),
    };

    setEstimatedFlightPosition({
      latitude: base.latitude,
      longitude: base.longitude,
      callsign: base.callsign,
      headingDegrees: base.headingDegrees,
    });

    const intervalId = window.setInterval(() => {
      if (
        base.onGround ||
        base.velocityMps === null ||
        base.velocityMps <= 1 ||
        base.headingDegrees === null ||
        !Number.isFinite(base.headingDegrees)
      ) {
        setEstimatedFlightPosition({
          latitude: base.latitude,
          longitude: base.longitude,
          callsign: base.callsign,
          headingDegrees: base.headingDegrees,
        });
        return;
      }

      const elapsedSec = (Date.now() - base.startedAtMs) / 1000;
      const traveledKm = (base.velocityMps * elapsedSec) / 1000;
      const projected = destinationPoint(base.latitude, base.longitude, base.headingDegrees, traveledKm);

      setEstimatedFlightPosition({
        latitude: projected.latitude,
        longitude: projected.longitude,
        callsign: base.callsign,
        headingDegrees: base.headingDegrees,
      });
    }, 250);

    return () => window.clearInterval(intervalId);
  }, [flight]);

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-[#062016] text-slate-100">
      <div className="h-full w-full">
        {flight ? (
          <section className="relative isolate h-full w-full">
            <div className="absolute inset-0 z-0">
              {location ? (
                <FlightMap
                  userLocation={location}
                  userHeadingDegrees={deviceHeadingDegrees}
                  flightLocation={{
                    latitude: estimatedFlightPosition?.latitude ?? flight.latitude,
                    longitude: estimatedFlightPosition?.longitude ?? flight.longitude,
                    callsign: estimatedFlightPosition?.callsign ?? flight.callsign,
                    headingDegrees: estimatedFlightPosition?.headingDegrees ?? flight.headingDegrees,
                  }}
                />
              ) : (
                <div className="h-full w-full bg-linear-to-br from-slate-900 via-slate-800 to-slate-700" />
              )}

              <div className="pointer-events-none absolute inset-0 bg-[#0a1522]/25" />

              <div className="absolute bottom-3 left-1/2 z-1500 flex -translate-x-1/2 items-center gap-4 rounded-md border border-emerald-400/30 bg-[#07170f]/90 px-4 py-2 text-xs text-slate-100 shadow-[0_8px_24px_rgba(0,0,0,0.35)]">
                <span className="flex items-center gap-2">
                  <span className="inline-block h-3 w-3 rounded-full border-2 border-white/80 bg-[#34d399]" />
                  You
                </span>
                <span className="flex items-center gap-2">
                  <span style={{ color: "#f4d24f", fontSize: "16px", lineHeight: 1 }}>✈</span>
                  Plane
                </span>
              </div>
            </div>

            <div className="absolute left-1/2 top-3 z-1800 -translate-x-1/2 rounded-sm border border-emerald-400/40 bg-[#04170f]/95 px-5 py-2 text-emerald-300">
              <div className="inline-flex max-w-[95vw] items-center gap-3 whitespace-nowrap">
                <span className="truncate text-xl font-semibold text-emerald-100">
                  {flight.aircraftModel ?? "Unknown Aircraft"}
                </span>
                <div className="flex shrink-0 items-center self-center leading-none">
                  <FlapText value={flight.callsign} className="radio-flap radio-flap-title" />
                </div>
                <div className="flex min-w-0 items-center gap-2">
                  {airlineLogoUrl ? (
                    <Image
                      src={airlineLogoUrl}
                      alt={`${flight.airlineName ?? flight.airlineCode ?? "Airline"} logo`}
                      width={22}
                      height={22}
                      className="h-5.5 w-5.5 rounded bg-white object-contain p-0.5"
                      unoptimized
                    />
                  ) : null}
                  <span className="truncate text-base font-semibold text-slate-100">
                    {flight.airlineName ?? flight.airlineCode ?? "Unknown airline"}
                  </span>
                </div>
              </div>
            </div>

            {/* Tab handle — independent of sidebar slide so it's always visible */}
            <button
              type="button"
              onClick={() => setSidebarOpen((current) => !current)}
              className={`absolute top-1/2 z-2100 -translate-y-1/2 rounded-r-md border border-slate-500/80 border-l-0 bg-[#0f141b]/95 px-2 py-6 text-[10px] uppercase tracking-[0.14em] text-slate-200 shadow-[0_8px_22px_rgba(0,0,0,0.35)] transition-[left] duration-300 ease-out ${
                sidebarOpen ? "left-[min(340px,calc(100vw-1rem))]" : "left-0"
              }`}
              aria-expanded={sidebarOpen}
              aria-label={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
            >
              {sidebarOpen ? "◀" : "▶"}
            </button>

            {/* Sidebar panel — slides fully off-screen when closed */}
            <div
              className={`absolute bottom-2 left-0 top-2 z-2000 w-[min(340px,calc(100vw-1rem))] overflow-hidden transition-transform duration-300 ease-out ${
                sidebarOpen ? "translate-x-0" : "-translate-x-full"
              }`}
            >
              <FlightSidebar
                flight={flight}
                airlineLogoUrl={airlineLogoUrl}
                showDetails={showDetails}
                onToggleDetails={() => setShowDetails((current) => !current)}
                status={status}
                error={error}
                flightHeading={flightHeading}
                relativeFlightLabel={relativeFlightLabel}
                lastUpdated={lastUpdated}
                selectionUpdatedAt={selectionUpdatedAt}
                targetPollMs={targetPollMs}
                onPollIntervalChange={setTargetPollMs}
                compassStatus={compassStatus}
                deviceHeadingDegrees={deviceHeadingDegrees}
                headingMode={headingMode}
                manualHeading={manualHeading}
                onManualHeadingChange={(value) => {
                  setHeadingMode("manual");
                  setCompassStatus("Using manual heading");
                  updateManualHeading(value);
                }}
                onEnableCompass={() => {
                  void enableCompassHeading();
                }}
                onCompassDialChange={setManualHeadingFromCompass}
                relativeArrow={<RelativeDirectionArrow angle={relativeFlightAngle} />}
              />
            </div>
          </section>
        ) : (
          <section className="rounded-2xl border border-emerald-300/20 bg-[#05160f]/85 p-6 text-emerald-100">
            <p>{`No flight lock yet. ${isLoading ? "Scanning airspace..." : "Waiting for next update..."}`}</p>
          </section>
        )}
      </div>
    </main>
  );
}
