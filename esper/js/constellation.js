/**
 * constellation.js — Leaflet overlay for signal relations.
 *
 * Draws polylines from the focus signal to each related signal,
 * coloured by relation type (spatial/temporal/name).
 * Plain class — loaded as a regular script before app.js.
 */

const CONSTELLATION_COLOURS = {
    spatial:  '#4aad7a',  // green — matches RMP marker colour
    temporal: '#e8a835',  // amber
    name:     '#378add',  // blue
};

class ConstellationLayer {
    constructor(map) {
        this._map   = map;
        this._group = L.layerGroup().addTo(map);
        this._focusLatLng = null;
    }

    /**
     * Draw relation lines from the focus signal to all related signals.
     *
     * @param {object} focusFeature   - GeoJSON Feature of the focus signal
     * @param {object} relatedData    - { spatial:[...], temporal:[...], name:[...] }
     */
    draw(focusFeature, relatedData) {
        this.clear();

        const coords = focusFeature.geometry?.coordinates;
        if (!coords) return;
        this._focusLatLng = L.latLng(coords[1], coords[0]);

        const types = ['spatial', 'temporal', 'name'];
        for (const relType of types) {
            const features = relatedData[relType] || [];
            const colour   = CONSTELLATION_COLOURS[relType] || '#ffffff';
            for (const feat of features) {
                this._drawLine(feat, relType, colour);
            }
        }
    }

    _drawLine(feat, relType, colour) {
        // Determine endpoint: name relations may have a geocoded locus
        let endLat, endLon;

        if (relType === 'name') {
            // Try territorial_context geocoded coord first
            const tc = feat.properties?.ono_data?.territorial_context;
            if (tc && tc.length > 0 && tc[0].geocoded_lat != null) {
                endLat = tc[0].geocoded_lat;
                endLon = tc[0].geocoded_lon;
            }
        }

        // Fall back to the signal's own geometry
        if (endLat == null) {
            const coords = feat.geometry?.coordinates;
            if (!coords) return;
            endLon = coords[0];
            endLat = coords[1];
        }

        const line = L.polyline(
            [this._focusLatLng, L.latLng(endLat, endLon)],
            {
                color:       colour,
                weight:      1,
                opacity:     0.55,
                interactive: false,
                dashArray:   relType === 'name' ? '3 5' : null,
            }
        );
        line.addTo(this._group);
    }

    clear() {
        this._group.clearLayers();
        this._focusLatLng = null;
    }
}
