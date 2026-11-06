/**
 * map-view.js — Signal Field (Esper left panel).
 *
 * Leaflet map with no basemap by default (Esper mode).
 * Source-type colour coding instead of quality colouring.
 * Subtle grid overlay + cursor coordinate readout.
 * Map toggle: CARTO dark tile layer switchable on/off via setMapVisible().
 */

const SOURCE_COLOURS = {
    RMP:   '#4aad7a',
    ONO:   '#e8c84a',
    RC:    '#e8714a',
    FLD:   '#c8851a',
    LiDAR: '#9e6fcd',
};
const DEFAULT_COLOUR = 'rgba(255,255,255,0.3)';

// Grid spacing in metres per level
const GRID_LEVELS = { '1km': 1000, '100m': 100, '10m': 10, '1m': 1 };

class MapView {
    constructor(containerId, data) {
        this.containerId = containerId;
        this.data = data;
        this.map = null;
        this.tileLayer = null;
        this.markerCluster = null;
        this.markers = new Map();    // signalId → marker element ref
        this.leafletMarkers = new Map(); // signalId → L.marker
        this.selectedId = null;
        this.onSignalSelect = null;
        this.onClusterSelect = null;
        this._gridLevel = '1km';
        this._gridManual = true;
        this._gridCanvas = null;
        this._mapVisible = false;
        this._townlandNamesVisible = false;
        this._townlandFeatures = null;
        this.init();
    }

    init() {
        this.map = L.map(this.containerId, {
            center: [54.27, -8.48], // Sligo
            zoom: 10,
            zoomControl: true,
            attributionControl: false,
        });

        // Tile layer — hidden by default (Esper mode)
        this.tileLayer = L.tileLayer(
            'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
            { maxZoom: 16, opacity: 0, attribution: 'Tiles © Esri' }
        ).addTo(this.map);

        // Grid canvas overlay
        this._gridCanvas = L.canvas({ padding: 0 });
        this.map.on('moveend zoomend', () => this._drawGrid());

        // Cluster group
        this.markerCluster = L.markerClusterGroup({
            maxClusterRadius: 40,
            spiderfyOnMaxZoom: true,
            showCoverageOnHover: false,
            zoomToBoundsOnClick: false,  // handled manually to detect co-located clusters
            iconCreateFunction: this._clusterIcon.bind(this),
        });

        this.markerCluster.on('clusterclick', (e) => {
            const children = e.layer.getAllChildMarkers();
            const latlngs = children.map(m => m.getLatLng());
            let maxDist = 0;
            for (let i = 0; i < latlngs.length; i++) {
                for (let j = i + 1; j < latlngs.length; j++) {
                    const d = latlngs[i].distanceTo(latlngs[j]);
                    if (d > maxDist) maxDist = d;
                }
            }
            if (maxDist < 30 && this.onClusterSelect) {
                const ids = children.map(m => m.options.signalId).filter(Boolean);
                this.onClusterSelect(ids);
            } else {
                this.map.fitBounds(e.layer.getBounds(), { padding: [20, 20] });
            }
        });

        this.map.addLayer(this.markerCluster);

        // Cursor coord readout
        this.map.on('mousemove', (e) => {
            const el = document.getElementById('map-coords');
            if (el) el.textContent = `${e.latlng.lat.toFixed(5)}° N  ${e.latlng.lng.toFixed(5)}° E`;
        });

        this.map.on('zoomend', () => this._refreshTownlandLabels());

        this._addSignals();
        this._scheduleGrid();
    }

    _clusterIcon(cluster) {
        const n = cluster.getChildCount();
        const size = n > 100 ? 'large' : n > 20 ? 'medium' : 'small';
        return L.divIcon({
            html: `<div>${n}</div>`,
            className: `marker-cluster marker-cluster-${size}`,
            iconSize: L.point(36, 36),
        });
    }

    _isPending(feature) {
        const text = feature.properties?.source_data?.original_text || '';
        return text.includes('has not been uploaded');
    }

    _sourceColour(feature) {
        const ds = (feature.properties?.source_data?.source_dataset || '').toUpperCase();
        return SOURCE_COLOURS[ds] || SOURCE_COLOURS[
            Object.keys(SOURCE_COLOURS).find(k => ds.includes(k)) || ''
        ] || DEFAULT_COLOUR;
    }

    setData(geojson) {
        this.data = geojson;
        this.markerCluster.clearLayers();
        this._addSignals();
    }

    _addSignals() {
        if (!this.data?.features) return;
        this.data.features.forEach(f => {
            const marker = this._makeMarker(f);
            if (marker) this.markerCluster.addLayer(marker);
        });
    }

    _makeMarker(feature) {
        const coords = feature.geometry?.coordinates;
        if (!coords || coords.length < 2) return null;
        const [lng, lat] = coords;
        const props = feature.properties || {};
        const meta = props.signal_metadata || {};
        const src = props.source_data || {};
        const tv = props.temporal_vector || {};

        const signalId = feature.id || meta.signal_id;
        const pending = this._isPending(feature);
        const colour = pending ? 'rgba(255,255,255,0.18)' : this._sourceColour(feature);
        const markerClass = pending ? 'signal-marker pending' : 'signal-marker';

        const icon = L.divIcon({
            className: '',
            html: `<div class="${markerClass}" style="background:${colour};" data-sid="${signalId}"></div>`,
            iconSize: [10, 10],
            iconAnchor: [5, 5],
        });

        const marker = L.marker([lat, lng], { icon, signalId });

        // popup
        const county   = src.county || '';
        const townland = src.townland || '';
        const cls      = src.original_class || '—';
        const bp       = tv.years_bp != null ? `${Math.round(tv.years_bp).toLocaleString()} BP` : '—';
        const popupHtml = `
            <div class="popup-title">${signalId}</div>
            <div class="popup-meta">${[townland, county].filter(Boolean).join(' · ')}</div>
            <div class="popup-meta">${cls} &nbsp;·&nbsp; τ ${bp}</div>
            <button class="popup-btn" onclick="window.__esper.selectSignal('${signalId}')">View →</button>
        `;
        marker.bindPopup(popupHtml, { maxWidth: 260, minWidth: 180 });

        marker.on('click', () => {
            if (this.onSignalSelect) this.onSignalSelect(signalId);
        });

        this.leafletMarkers.set(signalId, marker);
        return marker;
    }

    // ── grid overlay ────────────────────────────────────────────────────────
    _autoGridLevel() {
        const z = this.map.getZoom();
        if (z >= 16) return '1m';
        if (z >= 14) return '10m';
        if (z >= 11) return '100m';
        return '1km';
    }

    _scheduleGrid() {
        // draw once tiles settle
        setTimeout(() => this._drawGrid(), 300);
        this.map.on('moveend zoomend', () => this._drawGrid());
    }

    _drawGrid() {
        if (this._gridOverlay) { this._gridOverlay.remove(); this._gridOverlay = null; }

        const spacingM = GRID_LEVELS[this._gridLevel] || 1000;
        const bounds = this.map.getBounds();
        const sw = bounds.getSouthWest();
        const ne = bounds.getNorthEast();

        // Convert spacing in metres to approximate degrees
        const latDeg = spacingM / 111320;
        const lngDeg = spacingM / (111320 * Math.cos((sw.lat + ne.lat) / 2 * Math.PI / 180));

        const lines = [];
        // horizontal lines
        const latStart = Math.floor(sw.lat / latDeg) * latDeg;
        for (let lt = latStart; lt <= ne.lat + latDeg; lt += latDeg) {
            lines.push([[lt, sw.lng], [lt, ne.lng]]);
        }
        // vertical lines
        const lngStart = Math.floor(sw.lng / lngDeg) * lngDeg;
        for (let ln = lngStart; ln <= ne.lng + lngDeg; ln += lngDeg) {
            lines.push([[sw.lat, ln], [ne.lat, ln]]);
        }

        this._gridOverlay = L.polyline(lines, {
            color: 'rgba(255,255,255,0.04)',
            weight: 1,
            interactive: false,
        }).addTo(this.map);
    }

    // ── public API ──────────────────────────────────────────────────────────
    setGridLevel(level) {
        this._gridLevel = level;
        this._drawGrid();
    }

    setLoading(loading) {
        const el = document.getElementById('map-loading');
        if (el) el.style.opacity = loading ? '1' : '0';
    }

    setMapVisible(visible) {
        this._mapVisible = visible;
        this.tileLayer.setOpacity(visible ? 1 : 0);
    }

    selectSignal(signalId) {
        // Clear previous selection style
        if (this.selectedId) {
            const prev = this.leafletMarkers.get(this.selectedId);
            if (prev) {
                const el = prev.getElement();
                if (el) el.querySelector('.signal-marker')?.classList.remove('selected');
            }
        }
        this.selectedId = signalId;
        const marker = this.leafletMarkers.get(signalId);
        if (!marker) return;
        // Pan to signal
        this.map.setView(marker.getLatLng(), Math.max(this.map.getZoom(), 13), { animate: true });
        const el = marker.getElement();
        if (el) el.querySelector('.signal-marker')?.classList.add('selected');
        marker.openPopup();
    }

    clearSelection() {
        if (this.selectedId) {
            const marker = this.leafletMarkers.get(this.selectedId);
            if (marker) {
                marker.closePopup();
                const el = marker.getElement();
                if (el) el.querySelector('.signal-marker')?.classList.remove('selected');
            }
        }
        this.selectedId = null;
    }

    fitBounds() {
        if (this.markerCluster.getLayers().length > 0) {
            this.map.fitBounds(this.markerCluster.getBounds(), { padding: [20, 20] });
        }
    }

    invalidateSize() {
        if (this.map) this.map.invalidateSize();
    }

    setSecondaryData(geojson) {
        this.clearSecondaryData();
        if (!geojson?.features?.length) return;
        this._secondaryLayer = L.geoJSON(geojson, {
            pointToLayer: (_f, latlng) => L.circleMarker(latlng, {
                radius: 3,
                color: '#e8c84a',
                fillColor: '#e8c84a',
                fillOpacity: 0.5,
                weight: 1,
                opacity: 0.7,
            }),
            filter: (f) => f.geometry?.type === 'Point',
        }).addTo(this.map);
    }

    clearSecondaryData() {
        this._secondaryLayer?.remove();
        this._secondaryLayer = null;
    }

    showReconstructionPolygon(geojsonPolygon) {
        this.clearReconstructionPolygon();
        if (!geojsonPolygon) return;
        this._reconstructionLayer = L.geoJSON(geojsonPolygon, {
            style: {
                color: '#e8c84a',
                weight: 1.5,
                dashArray: '5 4',
                fillColor: '#e8c84a',
                fillOpacity: 0.04,
                interactive: false,
            },
            interactive: false,
        }).addTo(this.map);
    }

    clearReconstructionPolygon() {
        this._reconstructionLayer?.remove();
        this._reconstructionLayer = null;
    }

    setTownlandLayer(geojson) {
        this.clearTownlandLayer();
        if (!geojson?.features?.length) return;
        this._townlandFeatures = geojson;
        this._townlandLayer = L.geoJSON(geojson, {
            style: {
                color: 'rgba(255,255,255,0.10)',
                weight: 0.5,
                fillOpacity: 0,
                interactive: false,
            },
            interactive: false,
        }).addTo(this.map);
        this._refreshTownlandLabels();
    }

    setTownlandNamesVisible(visible) {
        this._townlandNamesVisible = visible;
        this._refreshTownlandLabels();
    }

    _refreshTownlandLabels() {
        this._clearTownlandLabels();
        if (!this._townlandNamesVisible) return;
        if (this.map.getZoom() < 12) return;
        if (!this._townlandFeatures?.features?.length) return;

        const markers = [];
        for (const f of this._townlandFeatures.features) {
            const name = f.properties?.name;
            if (!name) continue;
            const geom = f.geometry;
            if (!geom) continue;
            const ring = geom.type === 'Polygon'
                ? geom.coordinates[0]
                : geom.coordinates?.[0]?.[0];
            if (!ring?.length) continue;
            let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
            for (const [lon, lat] of ring) {
                if (lon < minLon) minLon = lon;
                if (lon > maxLon) maxLon = lon;
                if (lat < minLat) minLat = lat;
                if (lat > maxLat) maxLat = lat;
            }
            const cLat = (minLat + maxLat) / 2;
            const cLon = (minLon + maxLon) / 2;
            markers.push(L.marker([cLat, cLon], {
                icon: L.divIcon({
                    className: 'townland-label',
                    html: name,
                    iconSize: null,
                    iconAnchor: [0, 0],
                }),
                interactive: false,
                keyboard: false,
            }));
        }
        this._townlandLabelLayer = L.layerGroup(markers).addTo(this.map);
    }

    _clearTownlandLabels() {
        this._townlandLabelLayer?.remove();
        this._townlandLabelLayer = null;
    }

    clearTownlandLayer() {
        this._clearTownlandLabels();
        if (this._townlandLayer) {
            this._townlandLayer.remove();
            this._townlandLayer = null;
        }
        this._townlandFeatures = null;
    }

    enterRepositionMode(signalId, onDragEnd) {
        this.exitRepositionMode();
        const marker = this.leafletMarkers.get(signalId);
        if (!marker) return;
        this._repositionSignalId = signalId;

        marker.dragging.enable();
        marker.getElement()?.querySelector('.signal-marker')?.classList.add('reposition-active');

        this._repositionCircle = L.circle(marker.getLatLng(), {
            radius: 50,
            color: '#e8a835',
            weight: 1,
            fillOpacity: 0.05,
            dashArray: '4 4',
            interactive: false,
        }).addTo(this.map);

        marker.on('drag.repo', (e) => {
            this._repositionCircle?.setLatLng(e.latlng);
        });

        marker.once('dragend', (e) => {
            const { lat, lng } = e.target.getLatLng();
            this.exitRepositionMode();
            if (onDragEnd) onDragEnd(lat, lng);
        });
    }

    exitRepositionMode() {
        if (!this._repositionSignalId) return;
        const marker = this.leafletMarkers.get(this._repositionSignalId);
        if (marker) {
            marker.dragging.disable();
            marker.off('drag.repo');
            marker.getElement()?.querySelector('.signal-marker')?.classList.remove('reposition-active');
        }
        this._repositionCircle?.remove();
        this._repositionCircle = null;
        this._repositionSignalId = null;
    }
}
