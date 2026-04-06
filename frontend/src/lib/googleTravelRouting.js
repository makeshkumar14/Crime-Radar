import { loadGoogleMapsApi } from "./googleMapsLoader";

const geocodeCache = new Map();

function roundCoordinate(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function getSessionStorage() {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function readCachedCoordinate(query) {
  if (geocodeCache.has(query)) {
    return geocodeCache.get(query);
  }

  const storage = getSessionStorage();
  if (!storage) {
    return null;
  }

  try {
    const raw = storage.getItem(`crime-radar:geocode:${query}`);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    if (Number.isFinite(parsed?.lat) && Number.isFinite(parsed?.lng)) {
      geocodeCache.set(query, parsed);
      return parsed;
    }
  } catch {
    return null;
  }

  return null;
}

function writeCachedCoordinate(query, coordinate) {
  geocodeCache.set(query, coordinate);
  const storage = getSessionStorage();
  if (!storage) {
    return;
  }

  try {
    storage.setItem(
      `crime-radar:geocode:${query}`,
      JSON.stringify(coordinate),
    );
  } catch {
    // Ignore storage failures and keep the in-memory cache only.
  }
}

function toKmProjection(lat, lng, refLat) {
  const earthRadiusKm = 6371.0;
  const x = (lng * Math.PI * earthRadiusKm * Math.cos((refLat * Math.PI) / 180)) / 180;
  const y = (lat * Math.PI * earthRadiusKm) / 180;
  return { x, y };
}

function pointToSegmentDistanceKm(point, start, end) {
  const refLat = (point.lat + start.lat + end.lat) / 3;
  const projectedPoint = toKmProjection(point.lat, point.lng, refLat);
  const projectedStart = toKmProjection(start.lat, start.lng, refLat);
  const projectedEnd = toKmProjection(end.lat, end.lng, refLat);

  const abX = projectedEnd.x - projectedStart.x;
  const abY = projectedEnd.y - projectedStart.y;
  const apX = projectedPoint.x - projectedStart.x;
  const apY = projectedPoint.y - projectedStart.y;
  const lengthSquared = abX ** 2 + abY ** 2;

  if (lengthSquared <= 1e-9) {
    return Math.sqrt(apX ** 2 + apY ** 2);
  }

  const t = Math.max(
    0,
    Math.min(1, (apX * abX + apY * abY) / lengthSquared),
  );
  const closestX = projectedStart.x + abX * t;
  const closestY = projectedStart.y + abY * t;
  return Math.sqrt(
    (projectedPoint.x - closestX) ** 2 + (projectedPoint.y - closestY) ** 2,
  );
}

function minimumPolylineDistanceKm(point, coordinates) {
  if (coordinates.length === 0) {
    return Infinity;
  }

  if (coordinates.length === 1) {
    return pointToSegmentDistanceKm(point, coordinates[0], coordinates[0]);
  }

  let minDistance = Infinity;
  for (let index = 0; index < coordinates.length - 1; index += 1) {
    minDistance = Math.min(
      minDistance,
      pointToSegmentDistanceKm(point, coordinates[index], coordinates[index + 1]),
    );
  }
  return minDistance;
}

function routeCoordinatesFromGoogleRoute(route) {
  return (route?.overview_path || []).map((point) => ({
    lat: point.lat(),
    lng: point.lng(),
  }));
}

function routeDistanceKm(route) {
  return roundCoordinate(
    (route?.legs || []).reduce(
      (total, leg) => total + (leg?.distance?.value || 0),
      0,
    ) / 1000,
    2,
  );
}

function routeDurationMin(route) {
  return roundCoordinate(
    (route?.legs || []).reduce(
      (total, leg) =>
        total + (leg?.duration_in_traffic?.value || leg?.duration?.value || 0),
      0,
    ) / 60,
    1,
  );
}

function routeSignature(route) {
  const coordinates = routeCoordinatesFromGoogleRoute(route);
  if (!coordinates.length) {
    return "empty";
  }

  const sampleStep = Math.max(1, Math.floor(coordinates.length / 10));
  return coordinates
    .filter((_, index) => index % sampleStep === 0 || index === coordinates.length - 1)
    .map((point) => `${point.lat.toFixed(4)},${point.lng.toFixed(4)}`)
    .join("|");
}

function scoreRouteAgainstAccidentZones(route, accidentZones) {
  const coordinates = routeCoordinatesFromGoogleRoute(route);
  const hits = [];
  let accidentExposure = 0;

  for (const zone of accidentZones) {
    if (!Number.isFinite(zone?.lat) || !Number.isFinite(zone?.lng)) {
      continue;
    }

    const thresholdKm = Math.max(2.4, (zone.radius_km || 0) * 0.78);
    const minDistanceKm = minimumPolylineDistanceKm(
      { lat: zone.lat, lng: zone.lng },
      coordinates,
    );

    if (minDistanceKm > thresholdKm) {
      continue;
    }

    const severity =
      (zone.predicted_accident || 0) * 5.5 +
      (zone.risk_score || 0) * 0.28 +
      (zone.predicted_total || 0) * 0.08;
    const proximityFactor = Math.max(0.2, 1 - minDistanceKm / thresholdKm);
    accidentExposure += severity * proximityFactor;
    hits.push({
      ...zone,
      min_distance_km: roundCoordinate(minDistanceKm, 2),
    });
  }

  hits.sort(
    (left, right) =>
      (right.predicted_accident || 0) - (left.predicted_accident || 0) ||
      (left.min_distance_km || 0) - (right.min_distance_km || 0),
  );

  return {
    coordinates,
    distanceKm: routeDistanceKm(route),
    durationMin: routeDurationMin(route),
    accidentExposure: roundCoordinate(accidentExposure, 1),
    accidentZoneHits: hits.length,
    accidentHits: hits,
  };
}

function toTravelResult(candidate, routeAnalysis) {
  const firstLeg = candidate.route?.legs?.[0];
  const lastLeg = candidate.route?.legs?.[candidate.route.legs.length - 1];

  return {
    ...routeAnalysis,
    source: "google-road",
    route: routeAnalysis.coordinates,
    routeSummary: candidate.route?.summary || candidate.sourceLabel,
    origin: firstLeg?.start_location
      ? {
          lat: firstLeg.start_location.lat(),
          lng: firstLeg.start_location.lng(),
        }
      : null,
    destination: lastLeg?.end_location
      ? {
          lat: lastLeg.end_location.lat(),
          lng: lastLeg.end_location.lng(),
        }
      : null,
  };
}

function isMeaningfullySafer(currentCandidate, nextCandidate) {
  if (!nextCandidate || nextCandidate.signature === currentCandidate.signature) {
    return false;
  }

  if (
    nextCandidate.analysis.accidentZoneHits === 0 &&
    currentCandidate.analysis.accidentZoneHits > 0
  ) {
    return true;
  }

  if (
    nextCandidate.analysis.accidentZoneHits < currentCandidate.analysis.accidentZoneHits
  ) {
    return true;
  }

  if (
    nextCandidate.analysis.accidentExposure <=
    currentCandidate.analysis.accidentExposure - 6
  ) {
    return true;
  }

  return (
    nextCandidate.analysis.accidentExposure <=
      currentCandidate.analysis.accidentExposure - 2 &&
    nextCandidate.analysis.durationMin <= currentCandidate.analysis.durationMin + 8
  );
}

async function geocodeQuery(geocoder, query) {
  const cached = readCachedCoordinate(query);
  if (cached) {
    return cached;
  }

  const response = await geocoder.geocode({
    address: query,
    region: "in",
    componentRestrictions: {
      country: "IN",
    },
  });

  const location = response?.results?.[0]?.geometry?.location;
  if (!location) {
    return null;
  }

  const coordinate = {
    lat: location.lat(),
    lng: location.lng(),
  };
  writeCachedCoordinate(query, coordinate);
  return coordinate;
}

async function geocodeAccidentZones(geocoder, accidentZones) {
  const limitedZones = accidentZones
    .filter((zone) => zone.predicted_accident > 0)
    .sort(
      (left, right) =>
        (right.predicted_accident || 0) - (left.predicted_accident || 0) ||
        (right.risk_score || 0) - (left.risk_score || 0),
    )
    .slice(0, 24);

  const resolved = await Promise.all(
    limitedZones.map(async (zone) => {
      const coordinate = await geocodeQuery(geocoder, zone.location_query);
      if (!coordinate) {
        return null;
      }

      return {
        ...zone,
        ...coordinate,
      };
    }),
  );

  return resolved.filter(Boolean);
}

async function requestDirectionsCandidates(maps, directionsService, originQuery, destinationQuery) {
  const baseRequest = {
    origin: originQuery,
    destination: destinationQuery,
    travelMode: maps.TravelMode.DRIVING,
    provideRouteAlternatives: true,
    region: "in",
    drivingOptions: {
      departureTime: new Date(),
      trafficModel: maps.TrafficModel.BEST_GUESS,
    },
  };

  const requests = [
    {
      label: "Recommended road route",
      priority: 0,
      request: baseRequest,
    },
    {
      label: "Avoid highways",
      priority: 1,
      request: {
        ...baseRequest,
        provideRouteAlternatives: false,
        avoidHighways: true,
      },
    },
    {
      label: "Avoid tolls",
      priority: 2,
      request: {
        ...baseRequest,
        provideRouteAlternatives: false,
        avoidTolls: true,
      },
    },
    {
      label: "Avoid highways and tolls",
      priority: 3,
      request: {
        ...baseRequest,
        provideRouteAlternatives: false,
        avoidHighways: true,
        avoidTolls: true,
      },
    },
  ];

  const responses = await Promise.all(
    requests.map(async (entry) => {
      try {
        const result = await directionsService.route(entry.request);
        return (result?.routes || []).map((route, index) => ({
          route,
          sourceLabel: entry.label,
          priority: entry.priority + index / 10,
        }));
      } catch {
        return [];
      }
    }),
  );

  const uniqueCandidates = [];
  const seen = new Set();

  for (const candidate of responses.flat()) {
    const signature = routeSignature(candidate.route);
    if (seen.has(signature)) {
      continue;
    }
    seen.add(signature);
    uniqueCandidates.push({
      ...candidate,
      signature,
    });
  }

  return uniqueCandidates;
}

export async function analyseTravelRouteWithGoogle({
  apiKey,
  originQuery,
  destinationQuery,
  accidentZones,
}) {
  const maps = await loadGoogleMapsApi(apiKey);
  const [{ DirectionsService }, { Geocoder }] = await Promise.all([
    maps.importLibrary("routes"),
    maps.importLibrary("geocoding"),
  ]);

  const directionsService = new DirectionsService();
  const geocoder = new Geocoder();
  const resolvedAccidentZones = await geocodeAccidentZones(geocoder, accidentZones);
  const candidates = await requestDirectionsCandidates(
    maps,
    directionsService,
    originQuery,
    destinationQuery,
  );

  if (!candidates.length) {
    throw new Error("No road route candidates were returned by Google Maps.");
  }

  const scoredCandidates = candidates.map((candidate) => ({
    ...candidate,
    analysis: scoreRouteAgainstAccidentZones(candidate.route, resolvedAccidentZones),
  }));

  const currentCandidate = scoredCandidates[0];
  const safestCandidate = scoredCandidates.reduce((best, candidate) => {
    if (!best) {
      return candidate;
    }

    const scoreTuple = [
      candidate.analysis.accidentExposure,
      candidate.analysis.accidentZoneHits,
      candidate.analysis.durationMin,
      candidate.priority,
    ];
    const bestTuple = [
      best.analysis.accidentExposure,
      best.analysis.accidentZoneHits,
      best.analysis.durationMin,
      best.priority,
    ];

    for (let index = 0; index < scoreTuple.length; index += 1) {
      if (scoreTuple[index] < bestTuple[index]) {
        return candidate;
      }
      if (scoreTuple[index] > bestTuple[index]) {
        return best;
      }
    }

    return best;
  }, null);

  const saferCandidate = isMeaningfullySafer(currentCandidate, safestCandidate)
    ? safestCandidate
    : currentCandidate;

  const currentPath = toTravelResult(
    currentCandidate,
    currentCandidate.analysis,
  );
  const saferPath = toTravelResult(
    saferCandidate,
    saferCandidate.analysis,
  );
  const routeDiverges = saferCandidate.signature !== currentCandidate.signature;
  const riskReduction = roundCoordinate(
    Math.max(0, currentPath.accidentExposure - saferPath.accidentExposure),
    1,
  );
  const distanceDeltaKm = roundCoordinate(
    saferPath.distanceKm - currentPath.distanceKm,
    2,
  );
  const durationDeltaMin = roundCoordinate(
    saferPath.durationMin - currentPath.durationMin,
    1,
  );

  let recommendation =
    "No clearly safer detour was found. Stay alert on the main route.";
  if (routeDiverges && saferPath.accidentZoneHits === 0 && currentPath.accidentZoneHits > 0) {
    recommendation =
      "Use the safer route. It avoids the accident-prone stretch on the main drive.";
  } else if (routeDiverges && riskReduction >= 6) {
    recommendation =
      "Use the safer route. It reduces accident-zone exposure across the drive.";
  } else if (routeDiverges) {
    recommendation =
      "A modestly safer route is available. It lowers accident exposure with a small detour.";
  }

  return {
    status: "ok",
    route_diverges: routeDiverges,
    route_overlap_ratio: routeDiverges ? 0.5 : 1,
    risk_reduction: riskReduction,
    distance_delta_km: distanceDeltaKm,
    duration_delta_min: durationDeltaMin,
    recommendation,
    accident_zones_evaluated: resolvedAccidentZones.length,
    current_path: currentPath,
    safer_path: saferPath,
    alerts: currentPath.accidentHits.slice(0, 6),
    origin: saferPath.origin || currentPath.origin,
    destination: saferPath.destination || currentPath.destination,
  };
}
