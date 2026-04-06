const DEFAULT_ROUTING_SERVICE_URL =
  import.meta.env.VITE_ROUTING_SERVICE_URL ||
  "https://router.project-osrm.org/route/v1/driving";
const DEFAULT_MAX_ROUTE_POINTS = 6;

const routeCache = new Map();

function roundValue(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const radius = 6371.0;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;

  return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function normalizePoints(points = []) {
  return points
    .map((point) => ({
      lat: Number(point?.lat),
      lng: Number(point?.lng),
    }))
    .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng));
}

function estimateDirectDistanceKm(points) {
  let total = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    total += haversineKm(
      points[index].lat,
      points[index].lng,
      points[index + 1].lat,
      points[index + 1].lng,
    );
  }
  return roundValue(total);
}

function buildFallbackRoute(points) {
  return {
    coordinates: points.map((point) => [point.lat, point.lng]),
    distanceKm: estimateDirectDistanceKm(points),
    durationMin: null,
    source: "fallback",
  };
}

function dedupeNearbyPoints(points, minGapKm = 4) {
  if (points.length <= 2) {
    return points;
  }

  const deduped = [points[0]];
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = deduped[deduped.length - 1];
    if (haversineKm(previous.lat, previous.lng, points[index].lat, points[index].lng) >= minGapKm) {
      deduped.push(points[index]);
    }
  }
  deduped.push(points[points.length - 1]);
  return deduped;
}

function pickRoutePointIndices(totalPoints, maxPoints) {
  if (totalPoints <= maxPoints) {
    return [...Array(totalPoints).keys()];
  }

  const indices = new Set([0, totalPoints - 1]);
  const interiorSlots = Math.max(0, maxPoints - 2);

  for (let slot = 1; slot <= interiorSlots; slot += 1) {
    const ratio = slot / (interiorSlots + 1);
    const candidateIndex = Math.round((totalPoints - 1) * ratio);
    indices.add(Math.max(1, Math.min(totalPoints - 2, candidateIndex)));
  }

  return [...indices].sort((left, right) => left - right);
}

export function buildRouteRequestPoints(
  points,
  { strategy = "corridor", maxPoints = DEFAULT_MAX_ROUTE_POINTS } = {},
) {
  const normalizedPoints = normalizePoints(points);

  if (normalizedPoints.length < 2) {
    return normalizedPoints;
  }

  if (strategy === "direct") {
    return [normalizedPoints[0], normalizedPoints[normalizedPoints.length - 1]];
  }

  const dedupedPoints = dedupeNearbyPoints(normalizedPoints);
  const selectedIndices = pickRoutePointIndices(
    dedupedPoints.length,
    Math.max(2, maxPoints),
  );

  return selectedIndices.map((index) => dedupedPoints[index]);
}

function buildCacheKey(points, serviceUrl) {
  return `${serviceUrl}:${points
    .map((point) => `${point.lat.toFixed(5)},${point.lng.toFixed(5)}`)
    .join("|")}`;
}

function formatCoordinate(point) {
  return `${point.lat},${point.lng}`;
}

export function buildGoogleMapsDirectionsUrl(
  points,
  { strategy = "corridor", useDeviceOrigin = false, maxWaypoints = 4 } = {},
) {
  const requestPoints = buildRouteRequestPoints(points, {
    strategy,
    maxPoints: maxWaypoints + 2,
  });

  if (requestPoints.length < 2) {
    return null;
  }

  const origin = requestPoints[0];
  const destination = requestPoints[requestPoints.length - 1];
  const waypointPoints = requestPoints.slice(1, -1);

  const params = new URLSearchParams({
    api: "1",
    destination: formatCoordinate(destination),
    travelmode: "driving",
  });

  if (!useDeviceOrigin) {
    params.set("origin", formatCoordinate(origin));
  }

  if (waypointPoints.length) {
    params.set(
      "waypoints",
      waypointPoints.map((point) => formatCoordinate(point)).join("|"),
    );
  }

  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

export async function fetchRoadRoute(
  points,
  { timeoutMs = 8000, strategy = "corridor", maxRequestPoints = DEFAULT_MAX_ROUTE_POINTS } = {},
) {
  const normalizedPoints = normalizePoints(points);
  const requestPoints = buildRouteRequestPoints(normalizedPoints, {
    strategy,
    maxPoints: maxRequestPoints,
  });
  const fallbackRoute = buildFallbackRoute(
    strategy === "direct" ? requestPoints : normalizedPoints,
  );

  if (requestPoints.length < 2) {
    return fallbackRoute;
  }

  const cacheKey = buildCacheKey(
    requestPoints,
    `${DEFAULT_ROUTING_SERVICE_URL}:${strategy}:${maxRequestPoints}`,
  );
  const cached = routeCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const request = (async () => {
    const controller = new AbortController();
    const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs);

    try {
      const coordinates = requestPoints
        .map((point) => `${point.lng},${point.lat}`)
        .join(";");

      const url =
        `${DEFAULT_ROUTING_SERVICE_URL}/${coordinates}` +
        "?overview=full&geometries=geojson&steps=false&continue_straight=true";

      const response = await fetch(url, {
        method: "GET",
        signal: controller.signal,
      });

      if (!response.ok) {
        return fallbackRoute;
      }

      const payload = await response.json();
      const route = payload?.routes?.[0];
      const geometry = route?.geometry?.coordinates;

      if (payload?.code !== "Ok" || !Array.isArray(geometry) || geometry.length < 2) {
        return fallbackRoute;
      }

      return {
        coordinates: geometry.map(([lng, lat]) => [lat, lng]),
        distanceKm: roundValue((route.distance || 0) / 1000),
        durationMin: roundValue((route.duration || 0) / 60, 1),
        requestPoints,
        source: "road",
      };
    } catch (error) {
      return fallbackRoute;
    } finally {
      globalThis.clearTimeout(timer);
    }
  })();

  routeCache.set(cacheKey, request);

  const resolved = await request;
  routeCache.set(cacheKey, Promise.resolve(resolved));
  return resolved;
}
