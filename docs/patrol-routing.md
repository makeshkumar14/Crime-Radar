# Automatic Gasht Route Generation with Seasonal Intelligence

## 1. Pipeline

1. Load the last 12 months of district incident history from `fir_records`.
2. Project incident points into 1 km x 1 km grid cells.
3. Compute per-grid raw factors:
   - accident frequency
   - severity burden
   - optional crime burden
   - time-of-day alignment
   - seasonal pressure from weather, festivals, and event zones
4. Normalize each factor with percentile-clipped min-max scaling to `0..100`.
5. Compute the final risk score:

`risk_score = 0.35*accident + 0.20*severity + 0.15*crime + 0.15*time + 0.15*season`

6. Classify grid cells:
   - `HIGH` if score `>= 70`
   - `MEDIUM` if score `>= 40`
   - `LOW` otherwise
7. Select all `HIGH` risk grids. If none qualify, fall back to the top `MEDIUM` cells.
8. Compute patrol unit demand dynamically at roughly one unit per 5 to 10 high-risk grids.
9. Cluster the selected grids with balanced K-means so every high-risk cell belongs to exactly one patrol loop.
10. Snap every patrol stop to the road graph with OSRM `Nearest`.
11. Match each cluster to a patrol base and call OSRM `Trip` once per cluster.
12. Draw the returned `trip.geometry` as the one and only patrol polyline.
13. Fail closed if OSRM cannot return a real road path instead of drawing straight-line placeholders.

## 2. Seasonal Intelligence

- `rain`, `fog`, and `storm` primarily boost accident-sensitive cells.
- `night` boosts violent, women-safety, property, and NDPS-heavy cells.
- `festival` boosts public-order, women-safety, property, and accident pressure.
- `event_zones` let the API inject temporary crowd hotspots around festivals, rallies, stadiums, or markets.

## 3. API

Endpoint: `POST /api/patrol/routes/generate`

Sample request:

```json
{
  "district": "CHENNAI",
  "target_year": 2026,
  "target_month": 4,
  "unit_count": 3,
  "time_band": "peak",
  "weather": "rain",
  "is_festival": true,
  "strategy": "auto",
  "event_zones": [
    {
      "name": "Beach Festival",
      "lat": 13.0475,
      "lng": 80.2824,
      "radius_km": 2.5,
      "priority_boost": 1.22
    }
  ]
}
```

Sample response fragment:

```json
{
  "patrol_units": [
    {
      "unit_id": "P1",
      "route": [[80.21, 13.04], [80.24, 13.06], [80.21, 13.04]],
      "zones_covered": 10,
      "risk_level": "HIGH"
    }
  ]
}
```

## 4. OSRM Calls

Snap a patrol stop to the road network:

```bash
curl "http://router.project-osrm.org/nearest/v1/driving/80.2299,12.9845?number=1"
```

Generate a continuous closed patrol loop from snapped patrol stops:

```bash
curl "http://router.project-osrm.org/trip/v1/driving/80.2299,12.9845;80.2402,13.0011;80.2581,13.0432;80.2299,12.9845?roundtrip=true&source=first&destination=last&overview=full&geometries=geojson&steps=false"
```

The patrol line should be drawn from:

- `trips[0].geometry.coordinates`

Do not rebuild a polyline by manually joining patrol points on the client.

## 5. Leaflet Example

```jsx
import { Polyline } from "react-leaflet";

function PatrolRouteLayer({ patrolUnits = [] }) {
  return patrolUnits.map((unit) => {
    const positions =
      unit.route_geometry?.coordinates?.map(([lng, lat]) => [lat, lng]) || [];

    if (positions.length < 2) {
      return null;
    }

    return (
      <Polyline
        key={unit.unit_id}
        positions={positions}
        pathOptions={{ color: "#38BDF8", weight: 4 }}
      />
    );
  });
}
```

## 6. Production Notes

- OSRM gives road-constrained geometry; use a city-scoped OSRM backend for reliable large-scale routing.
- Standard OSRM does not model live traffic by itself. For dynamic re-routing, feed updated travel-time weights or closures into the routing backend and rerun this endpoint every 30 to 60 minutes.
- Keep per-unit high-risk grid counts bounded so loop sizes stay operationally realistic.
- For large cities, precompute the risk grid on a schedule and cache the selected high-risk grid set per district.
- Feed live weather and event overlays into `event_zones` or a future seasonal adapter service.

## 7. Visualization

- Render `grid_cells` as a heatmap or deck.gl screen-grid layer.
- Draw `priority_zones` as labeled polygons or cluster markers with `HIGH` and `MEDIUM` chips.
- Draw each patrol loop in a separate color from `patrol_units[*].route_geometry`.
- Animate the active patrol vehicle marker along the loop and display the next re-route timestamp from `reroute.recommended_next_run_at`.
- Add toolbar toggles for `time_band`, `weather`, and festival mode so operators can compare scenarios before dispatch.
