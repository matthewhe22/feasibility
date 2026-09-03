import { MapContainer, TileLayer, CircleMarker, Tooltip } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { formatCurrency } from '../../utils';

/**
 * Real geographic map (OpenStreetMap tiles via Leaflet — no API key) plotting
 * the village's own suburb plus surrounding suburbs, each labelled with a
 * permanent callout showing the suburb name and median house price (MHP).
 * Coordinates come from server-side geocoding (api/_lib/geocode.ts,
 * OpenStreetMap Nominatim) attached to each suburb row; a suburb with no
 * lat/lng (geocoding miss, or beyond the geocoding cap) is simply not
 * plotted — the table above the map remains the complete record.
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

const MARKER_RADIUS = 7;
const MARKER_COLOR = '#7c3aed';

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
              radius={MARKER_RADIUS}
              pathOptions={{ color: MARKER_COLOR, fillColor: MARKER_COLOR, fillOpacity: 0.7, weight: 2 }}
            >
              {/* permanent: true keeps this visible as a callout rather than
                  only appearing on hover. */}
              <Tooltip direction="top" offset={[0, -6]} opacity={1} permanent>
                <div className="text-xs whitespace-nowrap">
                  <span className="font-semibold capitalize">{s.suburb}</span>
                  {': '}
                  <span>{money(s.medianHousePrice)}</span>
                </div>
              </Tooltip>
            </CircleMarker>
          ))}
        </MapContainer>
      </div>
      <p className="text-[10px] text-gray-400 mt-1 italic">
        Each label shows the suburb and its median house price (MHP).
        {missing > 0 && ` ${missing} of ${suburbs.length} suburb${missing === 1 ? '' : 's'} could not be geocoded and are not shown here.`}
      </p>
    </div>
  );
}
