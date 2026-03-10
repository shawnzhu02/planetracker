"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";

type UserLocation = {
  latitude: number;
  longitude: number;
};

type FlightLocation = {
  latitude: number;
  longitude: number;
  callsign: string;
  headingDegrees: number | null;
};

type FlightMapProps = {
  userLocation: UserLocation;
  userHeadingDegrees: number;
  flightLocation: FlightLocation;
};

const PULSE_INTERVAL_MS = 2_500;
const PULSE_DURATION_MS = 2_500;
const PULSE_START_RADIUS_PX = 12;
const PULSE_MAX_RADIUS_PX = 550;

function destinationPoint(lat: number, lon: number, bearingDeg: number, distanceKm: number): L.LatLng {
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
  const lon2 = lon1 + Math.atan2(Math.sin(bearing) * sinAngular * cosLat1, cosAngular - sinLat1 * Math.sin(lat2));

  return L.latLng((lat2 * 180) / Math.PI, ((((lon2 * 180) / Math.PI) + 540) % 360) - 180);
}

function buildVisibilityConeBand(
  userLatLng: L.LatLng,
  headingDegrees: number,
  innerDistanceKm: number,
  outerDistanceKm: number,
  halfAngleDegrees = 28,
  steps = 12,
): L.LatLng[] {
  const start = headingDegrees - halfAngleDegrees;
  const end = headingDegrees + halfAngleDegrees;
  const points: L.LatLng[] = [];

  for (let i = 0; i <= steps; i += 1) {
    const bearing = start + ((end - start) * i) / steps;
    points.push(destinationPoint(userLatLng.lat, userLatLng.lng, bearing, outerDistanceKm));
  }

  for (let i = steps; i >= 0; i -= 1) {
    const bearing = start + ((end - start) * i) / steps;
    points.push(destinationPoint(userLatLng.lat, userLatLng.lng, bearing, innerDistanceKm));
  }

  return points;
}

function createVisibilityConeBands(userLatLng: L.LatLng, headingDegrees: number): L.Polygon[] {
  const maxDistanceKm = 25;
  const bandCount = 6;
  const polygons: L.Polygon[] = [];

  for (let bandIndex = 0; bandIndex < bandCount; bandIndex += 1) {
    const innerKm = (maxDistanceKm * bandIndex) / bandCount;
    const outerKm = (maxDistanceKm * (bandIndex + 1)) / bandCount;
    const fade = 1 - bandIndex / bandCount;

    polygons.push(
      L.polygon(buildVisibilityConeBand(userLatLng, headingDegrees, innerKm, outerKm), {
        color: "#34d399",
        opacity: 0.18,
        weight: 1,
        fillColor: "#34d399",
        fillOpacity: 0.32 * fade + 0.06,
        interactive: false,
      }),
    );
  }

  return polygons;
}

function createPlaneIcon(headingDegrees: number | null): L.DivIcon {
  const heading = typeof headingDegrees === "number" ? headingDegrees - 90 : -90;

  return L.divIcon({
    className: "",
    iconSize: [60, 60],
    iconAnchor: [30, 30],
    html: `<div style="width:60px;height:60px;display:flex;align-items:center;justify-content:center;transform:rotate(${heading}deg);transform-origin:center;"><span style="color:#f4d24f;font-size:34px;line-height:1;-webkit-text-stroke:1px rgba(15,23,42,0.95);text-shadow:0 0 1px rgba(15,23,42,0.95), 0 1px 0 rgba(15,23,42,0.75);filter:drop-shadow(0 0 1px rgba(0,0,0,0.55));">&#9992;</span></div>`,
  });
}

export default function FlightMap({ userLocation, userHeadingDegrees, flightLocation }: FlightMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const userMarkerRef = useRef<L.CircleMarker | null>(null);
  const pulseTickerRef = useRef<number | null>(null);
  const pulseAnimationRef = useRef<number | null>(null);
  const activePulseRef = useRef<L.CircleMarker | null>(null);
  const planeMarkerRef = useRef<L.Marker | null>(null);
  const lineRef = useRef<L.Polyline | null>(null);
  const visibilityConeLayerRef = useRef<L.LayerGroup | null>(null);
  const hasFitInitiallyRef = useRef(false);

  function triggerUserPulse(): void {
    const map = mapRef.current;
    const userMarker = userMarkerRef.current;
    if (!map || !userMarker) {
      return;
    }

    if (pulseAnimationRef.current !== null) {
      window.cancelAnimationFrame(pulseAnimationRef.current);
      pulseAnimationRef.current = null;
    }

    if (activePulseRef.current) {
      activePulseRef.current.remove();
      activePulseRef.current = null;
    }

    const center = userMarker.getLatLng();
    const pulse = L.circleMarker(center, {
      radius: PULSE_START_RADIUS_PX,
      color: "#34d399",
      weight: 3,
      opacity: 0.35,
      fillColor: "#34d399",
      fillOpacity: 0,
      interactive: false,
    }).addTo(map);
    activePulseRef.current = pulse;

    const startedAtMs = Date.now();
    const animate = () => {
      const elapsed = Date.now() - startedAtMs;
      const progress = Math.min(1, elapsed / PULSE_DURATION_MS);

      // Linear expansion keeps a constant speed from start to end.
      pulse.setRadius(PULSE_START_RADIUS_PX + (PULSE_MAX_RADIUS_PX - PULSE_START_RADIUS_PX) * progress);
      pulse.setStyle({
        opacity: 0.35 * (1 - progress),
        fillOpacity: 0,
      });

      if (progress >= 1) {
        pulse.remove();
        if (activePulseRef.current === pulse) {
          activePulseRef.current = null;
        }
        return;
      }

      pulseAnimationRef.current = window.requestAnimationFrame(animate);
    };

    pulseAnimationRef.current = window.requestAnimationFrame(animate);
  }

  useEffect(() => {
    if (!containerRef.current || mapRef.current) {
      return;
    }

    const map = L.map(containerRef.current, {
      zoomControl: true,
      attributionControl: true,
    }).setView([userLocation.latitude, userLocation.longitude], 10);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);

    userMarkerRef.current = L.circleMarker([userLocation.latitude, userLocation.longitude], {
      radius: 8,
      color: "#ecfdf5",
      weight: 2,
      fillColor: "#34d399",
      fillOpacity: 1,
    })
      .addTo(map)
      .bindTooltip("You", { direction: "top", offset: [0, -8] });

    const userLatLng = L.latLng(userLocation.latitude, userLocation.longitude);
    visibilityConeLayerRef.current = L.layerGroup(createVisibilityConeBands(userLatLng, userHeadingDegrees)).addTo(map);

    planeMarkerRef.current = L.marker([flightLocation.latitude, flightLocation.longitude], {
      icon: createPlaneIcon(flightLocation.headingDegrees),
      keyboard: false,
    })
      .addTo(map)
      .bindTooltip(flightLocation.callsign || "Plane", { direction: "top", offset: [0, -8] });

    lineRef.current = L.polyline(
      [
        [userLocation.latitude, userLocation.longitude],
        [flightLocation.latitude, flightLocation.longitude],
      ],
      {
        color: "#22c55e",
        weight: 4,
        opacity: 0.9,
        dashArray: "10 8",
      },
    ).addTo(map);

    triggerUserPulse();
    pulseTickerRef.current = window.setInterval(() => {
      triggerUserPulse();
    }, PULSE_INTERVAL_MS);

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      userMarkerRef.current = null;
      if (pulseTickerRef.current !== null) {
        window.clearInterval(pulseTickerRef.current);
        pulseTickerRef.current = null;
      }
      if (pulseAnimationRef.current !== null) {
        window.cancelAnimationFrame(pulseAnimationRef.current);
        pulseAnimationRef.current = null;
      }
      if (activePulseRef.current) {
        activePulseRef.current.remove();
        activePulseRef.current = null;
      }
      planeMarkerRef.current = null;
      lineRef.current = null;
      visibilityConeLayerRef.current = null;
      hasFitInitiallyRef.current = false;
    };
    // Map instance should mount once; dynamic positions are handled in the update effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const userMarker = userMarkerRef.current;
    const planeMarker = planeMarkerRef.current;
    const line = lineRef.current;
    const visibilityConeLayer = visibilityConeLayerRef.current;

    if (!map || !userMarker || !planeMarker || !line || !visibilityConeLayer) {
      return;
    }

    const userLatLng = L.latLng(userLocation.latitude, userLocation.longitude);
    const planeLatLng = L.latLng(flightLocation.latitude, flightLocation.longitude);

    userMarker.setLatLng(userLatLng);
    if (activePulseRef.current) {
      activePulseRef.current.setLatLng(userLatLng);
    }
    planeMarker.setLatLng(planeLatLng);
    planeMarker.setIcon(createPlaneIcon(flightLocation.headingDegrees));
    planeMarker.setTooltipContent(flightLocation.callsign || "Plane");
    line.setLatLngs([userLatLng, planeLatLng]);
    visibilityConeLayer.clearLayers();
    createVisibilityConeBands(userLatLng, userHeadingDegrees).forEach((layer) => {
      visibilityConeLayer.addLayer(layer);
    });

    if (!hasFitInitiallyRef.current) {
      const bounds = L.latLngBounds([userLatLng, planeLatLng]).pad(0.2);
      map.fitBounds(bounds, { animate: false });
      hasFitInitiallyRef.current = true;
    }
  }, [flightLocation.callsign, flightLocation.headingDegrees, flightLocation.latitude, flightLocation.longitude, userHeadingDegrees, userLocation.latitude, userLocation.longitude]);

  return <div ref={containerRef} className="h-full w-full" />;
}
