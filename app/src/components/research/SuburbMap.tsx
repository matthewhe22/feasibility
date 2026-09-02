import { MapContainer, TileLayer, CircleMarker, Tooltip } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { formatCurrency } from '../../utils';

/**
 * Real geographic map (OpenStreetMap tiles via Leaflet — no API key) plotting
 * the village's own suburb plus surrounding suburbs, sized and coloured by
 * median house price (MHP). Coordinates come from server-side geocoding
 * (api/_lib/geocode.ts, OpenStreetMap Nominatim) attached to each suburb row;
 * a suburb with no lat/lng (geocoding miss, or beyond the geocoding cap) is
 * simply not plotted — the table above the map remains the complete record.
 */

export interface MappableSuburb {
  suburb: string;
  state?: string | null;
  postcode?: string | null;
  medianHousePrice?: number | null;
  medianUnitPrice?: number | null;
  lat?: number | null;
  lng?: number | null;
}

const money = (v?: number | null) => (typeof v === 'number' && isFinite(v) ? formatCurrency(v) : '—');

/** Bubble radius scales with price within the plotted set — relative, not an
 *  absolute $/px scale, so it stays legible whether prices span $600k or $3M. */
function radiusFor(price: number | null | undefined, min: number, max: number): number {
  if (typeof price !== 'number' || !isFinite(price) || max <= min) return 10;
  const t = (price - min) / (max - min);
  return 8 + t * 14; // 8px..22px
}

/** Colour scales from cool (cheaper) to warm (pricier) within the plotted set. */
function colorFor(price: number | null | undefined, min: number, max: number): string {
  if (typeof price !== 'number' || !isFinite(price) || max <= min) return '#7c3aed';
  const t = (price - min) / (max - min);
  // Hue 200 (blue) -> 10 (orange/red) as price rises.
  const hue = 200 - t * 190;
  return `hsl(${hue}, 75%, 45%)`;
}

export function SuburbMap({ suburbs }: { suburbs: MappableSuburb[] }) {
  const plottable = suburbs.filter(
    (s): s is MappableSuburb & { lat: number; lng: number } =>
      typeof s.lat === 'number' && isFinite(s.lat) && typeof s.lng === 'number' && isFinite(s.lng),
  );
  const missing = suburbs.length - plottable.length;

  if (plottable.length === 0) {
    return (
      <p className="text-[11px] italic text-gray-400 mt-3">
        Map unavailable — none of the returned suburbs could be geocoded.
      </p>
    );
  }

  const prices = plottable.map(s => s.medianHousePrice).filter((p): p is number => typeof p === 'number' && isFinite(p));
  const minPrice = prices.length ? Math.min(...prices) : 0;
  const maxPrice = prices.length ? Math.max(...prices) : 0;

  const centerLat = plottable.reduce((s, p) => s + p.lat, 0) / plottable.length;
  const centerLng = plottable.reduce((s, p) => s + p.lng, 0) / plottable.length;

  return (
    <div className="mt-3">
      <div className="rounded overflow-hidden border border-gray-200" style={{ height: 320 }}>
        <MapContainer center={[centerLat, centerLng]} zoom={11} scrollWheelZoom={false} style={{ height: '100%', width: '100%' }}>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {plottable.map((s, i) => (
            <CircleMarker
              key={`${s.suburb}-${i}`}
              center={[s.lat, s.lng]}
              radius={radiusFor(s.medianHousePrice, minPrice, maxPrice)}
              pathOptions={{
                color: colorFor(s.medianHousePrice, minPrice, maxPrice),
                fillColor: colorFor(s.medianHousePrice, minPrice, maxPrice),
                fillOpacity: 0.6,
                weight: 2,
              }}
            >
              <Tooltip direction="top" offset={[0, -4]} opacity={1}>
                <div className="text-xs">
                  <div className="font-semibold capitalize">{s.suburb}</div>
                  <div>MHP: {money(s.medianHousePrice)}</div>
                  <div>MUP: {money(s.medianUnitPrice)}</div>
                </div>
              </Tooltip>
            </CircleMarker>
          ))}
        </MapContainer>
      </div>
      <p className="text-[10px] text-gray-400 mt-1 italic">
        Bubble size and colour scale with median house price (MHP) — cooler/smaller is cheaper, warmer/larger is pricier.
        {missing > 0 && ` ${missing} of ${suburbs.length} suburb${missing === 1 ? '' : 's'} could not be geocoded and are not shown here.`}
      </p>
    </div>
  );
}
