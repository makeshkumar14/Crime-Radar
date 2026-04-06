const DEFAULT_ROUTING_SERVICE_URL =
  import.meta.env.VITE_ROUTING_SERVICE_URL ||
  "https://router.project-osrm.org/route/v1/driving";

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

function buildCacheKey(points, serviceUrl) {
  return `${serviceUrl}:${points
    .map((point) => `${point.lat.toFixed(5)},${point.lng.toFixed(5)}`)
    .join("|")}`;
}

export async function fetchRoadRoute(points, { timeoutMs = 8000 } = {}) {
  const normalizedPoints = normalizePoints(points);
  const fallbackRoute = buildFallbackRoute(normalizedPoints);

  if (normalizedPoints.length < 2) {
    return fallbackRoute;
  }

  const cacheKey = buildCacheKey(normalizedPoints, DEFAULT_ROUTING_SERVICE_URL);
  const cached = routeCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const request = (async () => {
    const controller = new AbortController();
    const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs);

    try {
      const coordinates = normalizedPoints
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
