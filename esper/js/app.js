/**
 * app.js — ArchaeoSignal · Esper orchestrator.
 *
 * Coordinates signal field (map), worldline, right panel, and phi strip.
 * Signal selection flows: map click → selectSignal() → all panels update.
 * Territory selection: click/shift-click baronies → load signals within selection.
 */

import { RightPanel }       from './signal-panel.js';
import { WorldlinePanel }   from './worldline.js';
import { PhiSpectrograph }  from './phi-spectrograph.js';

// ── State ────────────────────────────────────────────────────────────────
const state = {
    signals:          null,   // GeoJSON FeatureCollection (current loaded set)
    signalIndex:      new Map(),
    selected:         null,
    mapView:          null,
    worldline:        null,
    phiStrip:         null,
    baroniesLayer:    null,
    baroniesVisible:  false,
    selectedBaronies: new Set(),   // context_id strings for territory selection
    activeSources:    new Set(['RMP', 'ONO']),  // RC included in territory fetches
    rcLoaded:         false,
    tau:              0,       // j2000 units — 0 = now (no gate)
    // Phase 1: relations + bundle
    constellation:    null,
    relationsActive:  false,
    relatedData:      null,
    bundleId:         null,
    relationsScope:   'radius',   // radius | townland | barony | region | island
    namesEntityData:  null,       // { norm, features[] } — active name-entity query
};

// ── Barony styles ─────────────────────────────────────────────────────────
const BARONY_STYLE_DEFAULT  = { color: 'rgba(200,133,26,0.5)',  weight: 1,
                                 fillColor: 'rgba(200,133,26,0.04)', fillOpacity: 1 };
const BARONY_STYLE_HOVER    = { color: 'rgba(200,133,26,0.9)',  weight: 1,
                                 fillColor: 'rgba(200,133,26,0.10)', fillOpacity: 1 };
const BARONY_STYLE_SELECTED = { color: '#e8a835',               weight: 2,
                                 fillColor: 'rgba(200,133,26,0.18)', fillOpacity: 1 };

function _clearBaronyStyles() {
    state.baroniesLayer?.eachLayer(l => {
        const id = l.feature?.properties?.context_id;
        if (!state.selectedBaronies.has(id)) l.setStyle(BARONY_STYLE_DEFAULT);
    });
}

function _updateLoadButton() {
    const btn = document.getElementById('btn-load');
    if (!btn) return;
    const hasSignals = (state.signals?.features?.length || 0) > 0;
    const hasSelection = state.selectedBaronies.size > 0;

    if (hasSignals) {
        btn.textContent = 'unload';
        btn.classList.add('active');
        btn.classList.remove('accent');
    } else if (hasSelection) {
        btn.textContent = 'load';
        btn.classList.remove('active');
        btn.classList.add('accent');
    } else {
        btn.textContent = 'load';
        btn.classList.remove('active', 'accent');
    }

    document.getElementById('btn-clear-territory').style.display = hasSelection ? '' : 'none';
}


window.__esper = { selectSignal: (id) => selectSignal(id) };

window.addEventListener('error', () => {
    document.getElementById('loading-overlay')?.classList.add('hidden');
});

// ── Boot ─────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    state.worldline = new WorldlinePanel(
        document.getElementById('worldline-canvas'),
        (idx) => {
            if (idx != null) state.phiStrip.highlightTick(idx);
            else state.phiStrip.clearHighlight();
        }
    );

    state.phiStrip = new PhiSpectrograph(
        document.getElementById('phi-canvas'),
        (idx) => {
            if (idx != null) state.worldline.highlightPhiTick(idx);
            else state.worldline.clearHighlight();
        }
    );

    // ── Basemap toggle ──────────────────────────────────────────────────
    document.getElementById('btn-map-toggle').addEventListener('click', (e) => {
        const btn = e.currentTarget;
        const next = !btn.classList.contains('active');
        btn.classList.toggle('active', next);
        state.mapView?.setMapVisible(next);
    });

    document.getElementById('townland-names-toggle').addEventListener('change', (e) => {
        state.mapView?.setTownlandNamesVisible(e.target.checked);
    });

    // ── Source toggles ──────────────────────────────────────────────────
    document.getElementById('source-controls').addEventListener('click', async (e) => {
        const btn = e.target.closest('.btn-src');
        if (!btn) return;
        const src = btn.dataset.src;
        if (state.activeSources.has(src)) {
            state.activeSources.delete(src);
            btn.classList.remove('active');
            applyFilters();
        } else {
            state.activeSources.add(src);
            btn.classList.add('active');
            applyFilters();
        }
    });

    // ── Tau point slicer ────────────────────────────────────────────────
    function onTauChange() {
        state.tau = parseInt(document.getElementById('tau-point').value);
        const ce = 2000 - state.tau;
        let label;
        if (state.tau === 0) {
            label = 'now';
        } else if (ce >= 0) {
            label = `${state.tau} BP · ${ce} CE`;
        } else {
            label = `${state.tau} BP · ${-ce} BCE`;
        }
        document.getElementById('tau-point-label').textContent = label;
        state.worldline?.setTauPoint(state.tau);
        applyFilters();
    }
    document.getElementById('tau-point').addEventListener('input', onTauChange);

    // ── Barony / navigate toggle ────────────────────────────────────────
    document.getElementById('btn-baronies').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        if (state.baroniesVisible) {
            state.baroniesLayer?.remove();
            state.baroniesVisible = false;
            btn.classList.remove('active');
            // Clear territory and signals
            state.selectedBaronies.clear();
            document.getElementById('btn-clear-territory').style.display = 'none';
            state.signals = { type: 'FeatureCollection', features: [] };
            state.signalIndex.clear();
            state.rcLoaded = false;
            state.mapView?.setData(state.signals);
            _updateLoadButton();
            document.getElementById('signal-count').textContent = 'select a territory';
        } else {
            if (!state.baroniesLayer) {
                await loadBaronies();
            }
            if (state.baroniesLayer && state.mapView) {
                state.baroniesLayer.addTo(state.mapView.map);
                state.baroniesVisible = true;
                btn.classList.add('active');
            }
        }
    });

    // ── Load / unload signals ───────────────────────────────────────────
    document.getElementById('btn-load').addEventListener('click', async () => {
        const hasSignals = (state.signals?.features?.length || 0) > 0;
        if (hasSignals) {
            state.signals = { type: 'FeatureCollection', features: [] };
            state.signalIndex.clear();
            state.rcLoaded = false;
            state.mapView?.setData(state.signals);
            state.mapView?.clearTownlandLayer();
            _updateLoadButton();
            updateSignalCountLabel();
        } else {
            if (state.selectedBaronies.size > 0) await applyTerritoryFilter();
        }
    });

    // ── Clear territory / new area ──────────────────────────────────────
    document.getElementById('btn-clear-territory').addEventListener('click', () => {
        state.selectedBaronies.clear();
        _clearBaronyStyles();
        state.rcLoaded = false;
        state.signals = { type: 'FeatureCollection', features: [] };
        state.signalIndex.clear();
        state.mapView?.setData(state.signals);
        state.mapView?.clearTownlandLayer();
        _updateLoadButton();
        document.getElementById('signal-count').textContent = 'select a territory';
    });

    // ── Grid level selector ─────────────────────────────────────────────
    document.getElementById('grid-controls').addEventListener('click', (e) => {
        const btn = e.target.closest('.btn-grid');
        if (!btn) return;
        document.querySelectorAll('.btn-grid').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.mapView?.setGridLevel(btn.dataset.level);
    });

    // ── Boot: load baronies only, start with empty field ───────────────
    try {
        await loadBaronies();
        state.mapView = new MapView('map', { type: 'FeatureCollection', features: [] });
        state.mapView.onSignalSelect = selectSignal;
        state.mapView.onClusterSelect = (ids) => {
            RightPanel.renderList(ids.map(id => state.signalIndex.get(id)).filter(Boolean));
        };
        // Constellation layer (plain class from constellation.js)
        state.constellation = new ConstellationLayer(state.mapView.map);
        document.getElementById('loading-overlay').classList.add('hidden');
        document.getElementById('signal-count').textContent = 'select a territory';
        if (state.baroniesLayer) {
            state.baroniesLayer.addTo(state.mapView.map);
            state.baroniesVisible = true;
        }
        // Restore saved bundle if present
        const savedBundleId = localStorage.getItem('bundle_id');
        if (savedBundleId) await restoreBundle(savedBundleId);
    } catch (err) {
        console.error('Failed to load:', err);
        document.getElementById('signal-count').textContent = 'error loading';
        document.getElementById('loading-overlay').classList.add('hidden');
    }
});

// ── Signal loading ────────────────────────────────────────────────────────

async function applyTerritoryFilter() {
    const ids = [...state.selectedBaronies].join(',');
    state.mapView?.setLoading(true);
    try {
        const resp = await fetch(`/api/signals?barony_ids=${encodeURIComponent(ids)}&limit=5000`);
        if (!resp.ok) throw new Error(resp.statusText);
        const data = await resp.json();
        state.signals = data;
        state.signalIndex.clear();
        (data.features || []).forEach(f => {
            const id = f.id || f.properties?.signal_metadata?.signal_id;
            if (id) state.signalIndex.set(id, f);
        });
        state.rcLoaded = true;
        applyFilters();
        updateSignalCountLabel();
        if (state.mapView) state.mapView.fitBounds();

        // Load townland sub-grid for selected baronies (≤2 at once)
        if (state.selectedBaronies.size > 0 && state.selectedBaronies.size <= 2) {
            const baronIds = [...state.selectedBaronies].join(',');
            try {
                const tResp = await fetch(`/api/townlands?barony_id=${encodeURIComponent(baronIds)}`);
                if (tResp.ok) state.mapView?.setTownlandLayer(await tResp.json());
            } catch (_) {}
        }
    } catch (err) {
        console.error('Territory filter failed:', err);
    } finally {
        state.mapView?.setLoading(false);
        _updateLoadButton();
    }
}

// ── Filtering ─────────────────────────────────────────────────────────────

const SOURCE_TYPE_MAP = {
    RMP: ['monument'],
    ONO: ['territorial_toponym', 'placename_attestation'],
    RC:  ['radiocarbon_determination', 'radiocarbon_site'],
};

const STYPE_TO_SRC = {};
Object.entries(SOURCE_TYPE_MAP).forEach(([src, stypes]) => {
    stypes.forEach(st => { STYPE_TO_SRC[st] = src; });
});

function filteredSignals() {
    if (!state.signals) return { type: 'FeatureCollection', features: [] };
    const features = (state.signals.features || []).filter(f => {
        const p = f.properties || {};
        const sm = p.signal_metadata || {};

        // Source filter
        const stype = sm.signal_type || 'monument';
        const src = STYPE_TO_SRC[stype] || 'RMP';
        if (!state.activeSources.has(src)) return false;

        // Z-buffer worldline gate: entity present at τ iff bp[0] ≤ τ ≤ bp[1]
        if (state.tau > 0) {
            const bp = (p.tau_data || {}).bp_range;
            if (bp) {
                if (bp[1] != null && bp[1] < state.tau) return false; // incept after τ
                if (bp[0] != null && bp[0] > state.tau) return false; // destruct before τ
            }
        }

        return true;
    });
    return { type: 'FeatureCollection', features };
}

function applyFilters() {
    if (!state.mapView) return;
    const filtered = filteredSignals();
    state.mapView.setData(filtered);
    updateSignalCountLabel(filtered.features.length);
}

function updateSignalCountLabel(filteredCount) {
    const total = state.signals?.features?.length || 0;
    const n = filteredCount ?? total;
    const countEl = document.getElementById('signal-count');

    if (state.selectedBaronies.size > 0) {
        const names = [...state.selectedBaronies]
            .map(id => id.replace(/^BARONY_[^_]+_/, '').replace(/_/g, ' '))
            .map(s => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase())
            .join(' · ');
        if (total === 0) {
            countEl.textContent = `${names} · ↓ load`;
        } else {
            countEl.textContent = n < total
                ? `${names} · ${n.toLocaleString()} / ${total.toLocaleString()}`
                : `${names} · n=${total.toLocaleString()}`;
        }
    } else if (total === 0) {
        countEl.textContent = 'select a territory';
    } else {
        countEl.textContent = n < total
            ? `n=${n.toLocaleString()} / ${total.toLocaleString()} filtered`
            : `n=${total.toLocaleString()}`;
    }
}

// ── Barony layer ──────────────────────────────────────────────────────────

async function loadBaronies() {
    try {
        const resp = await fetch('/api/baronies');
        if (!resp.ok) throw new Error(resp.statusText);
        const geojson = await resp.json();
        state.baroniesLayer = L.geoJSON(geojson, {
            style: BARONY_STYLE_DEFAULT,
            onEachFeature(feature, layer) {
                const p = feature.properties;
                const label = p.name_irish
                    ? `${p.name} · ${p.name_irish}`
                    : p.name;
                layer.bindTooltip(label, {
                    className: 'barony-tooltip',
                    sticky: true,
                });

                layer.on('mouseover', function() {
                    if (!state.selectedBaronies.has(p.context_id)) {
                        this.setStyle(BARONY_STYLE_HOVER);
                    }
                });
                layer.on('mouseout', function() {
                    if (!state.selectedBaronies.has(p.context_id)) {
                        this.setStyle(BARONY_STYLE_DEFAULT);
                    }
                });
                layer.on('click', function(e) {
                    L.DomEvent.stopPropagation(e);
                    const id = p.context_id;
                    if (e.originalEvent.shiftKey) {
                        if (state.selectedBaronies.has(id)) {
                            state.selectedBaronies.delete(id);
                            this.setStyle(BARONY_STYLE_DEFAULT);
                        } else {
                            state.selectedBaronies.add(id);
                            this.setStyle(BARONY_STYLE_SELECTED);
                        }
                    } else {
                        const wasOnlySelected = state.selectedBaronies.has(id)
                                             && state.selectedBaronies.size === 1;
                        _clearBaronyStyles();
                        state.selectedBaronies.clear();
                        if (!wasOnlySelected) {
                            state.selectedBaronies.add(id);
                            this.setStyle(BARONY_STYLE_SELECTED);
                        }
                    }
                    _updateLoadButton();
                    updateSignalCountLabel();
                });
            },
        });
    } catch (err) {
        console.error('Failed to load baronies:', err);
    }
}

// ── Signal selection ──────────────────────────────────────────────────────

function selectSignal(signalId) {
    const feature = state.signalIndex.get(signalId);
    if (!feature) return;

    state.selected = feature;

    state.mapView?.selectSignal(signalId);
    state.phiStrip?.render(feature);
    RightPanel.render(feature);

    // If relations are active, re-draw them for the new focus
    if (state.relationsActive) {
        drawRelations(signalId);
    } else {
        state.worldline?.render(feature);
    }

    const phiData = feature.properties?.phi_data || {};
    const nTicks = (phiData.materials?.length || 0)
                 + (phiData.structural_features?.length || 0)
                 + Object.values(phiData.dimensions || {}).filter(v => v != null).length
                 + (phiData.condition ? 1 : 0)
                 + (phiData.visibility ? 1 : 0);
    document.getElementById('phi-meta').textContent =
        `${signalId} · ${nTicks} φ events`;
}

// ── Relations + bundle ────────────────────────────────────────────────────

async function drawRelations(signalId) {
    const feature = state.signalIndex.get(signalId);
    if (!feature) return;
    // Read scope from DOM if panel is visible, else use stored state
    const scopeEl = document.getElementById('relations-scope');
    if (scopeEl) state.relationsScope = scopeEl.value;
    const scope = state.relationsScope;
    try {
        const resp = await fetch(
            `/api/signals/${encodeURIComponent(signalId)}/related?relations=spatial,temporal,name&scope=${encodeURIComponent(scope)}`
        );
        if (!resp.ok) throw new Error(resp.statusText);
        const data = await resp.json();
        state.relatedData   = data;
        state.relationsActive = true;
        state.constellation?.draw(feature, data);
        state.worldline?.renderWithRelations(feature, data);
        RightPanel.renderRelations(feature, data, state.bundleId, scope);
        _wireRelationsPanel();
    } catch (err) {
        console.error('Draw relations failed:', err);
    }
}

function clearRelations() {
    state.relationsActive = false;
    state.relatedData     = null;
    state.constellation?.clear();
    if (state.selected) {
        state.worldline?.render(state.selected);
        RightPanel.render(state.selected);
    }
}

async function saveBundle() {
    if (!state.selected) return;
    const focusId = state.selected.id || state.selected.properties?.signal_metadata?.signal_id;
    const members = [];
    if (state.relatedData) {
        for (const relType of ['spatial', 'temporal', 'name']) {
            for (const f of (state.relatedData[relType] || [])) {
                const sid = f.id || f.properties?.signal_metadata?.signal_id;
                if (sid) members.push({ signal_id: sid, added_via: relType });
            }
        }
    }
    try {
        const resp = await fetch('/api/bundles', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ focus_signal_id: focusId, members }),
        });
        if (!resp.ok) throw new Error(resp.statusText);
        const bundle = await resp.json();
        state.bundleId = bundle.bundle_id;
        localStorage.setItem('bundle_id', bundle.bundle_id);
        // Re-render panel to show saved state
        if (state.relatedData) RightPanel.renderRelations(state.selected, state.relatedData, state.bundleId, state.relationsScope);
        _wireRelationsPanel();
    } catch (err) {
        console.error('Save bundle failed:', err);
    }
}

async function restoreBundle(bundleId) {
    try {
        const resp = await fetch(`/api/bundles/${encodeURIComponent(bundleId)}`);
        if (!resp.ok) { localStorage.removeItem('bundle_id'); return; }
        const bundle = await resp.json();
        state.bundleId = bundleId;
        // Add bundle members to signal index so they can be selected
        for (const m of (bundle.members || [])) {
            if (m.feature && m.signal_id) {
                state.signalIndex.set(m.signal_id, m.feature);
            }
        }
    } catch (_) {}
}

// ── Enhance (Phase 2) ─────────────────────────────────────────────────────

function _signalId(feature) {
    return feature?.id || feature?.properties?.signal_metadata?.signal_id;
}

function _applySignalUpdate(updatedFeature) {
    const sid = _signalId(updatedFeature);
    if (!sid) return;
    state.signalIndex.set(sid, updatedFeature);
    state.selected = updatedFeature;
    RightPanel.render(updatedFeature);
    if (state.relationsActive && state.relatedData) {
        state.worldline?.renderWithRelations(updatedFeature, state.relatedData);
        drawRelations(sid);
    } else {
        state.worldline?.render(updatedFeature);
    }
}

async function patchAnchor(lat, lon) {
    if (!state.selected) return;
    const sid = _signalId(state.selected);
    try {
        const resp = await fetch(`/api/signals/${encodeURIComponent(sid)}/anchor`, {
            method:  'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ lat, lon, confidence: 'approximate' }),
        });
        if (!resp.ok) throw new Error(resp.statusText);
        _applySignalUpdate(await resp.json());
    } catch (err) {
        console.error('Anchor patch failed:', err);
    }
}

async function patchTau(bpMin, bpMax, proxyBasis, evidence) {
    if (!state.selected) return;
    const sid = _signalId(state.selected);
    try {
        const resp = await fetch(`/api/signals/${encodeURIComponent(sid)}/tau`, {
            method:  'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ bp_range: [bpMin, bpMax], proxy_basis: proxyBasis, evidence }),
        });
        if (!resp.ok) throw new Error(resp.statusText);
        _applySignalUpdate(await resp.json());
    } catch (err) {
        console.error('Tau patch failed:', err);
    }
}

async function patchClassify(monumentClass, confidence, evidence) {
    if (!state.selected) return;
    const sid = _signalId(state.selected);
    try {
        const resp = await fetch(`/api/signals/${encodeURIComponent(sid)}/classify`, {
            method:  'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ monument_class: monumentClass, confidence, evidence }),
        });
        if (!resp.ok) throw new Error(resp.statusText);
        _applySignalUpdate(await resp.json());
    } catch (err) {
        console.error('Classify patch failed:', err);
    }
}

function _wireRelationsPanel() {
    // Wire "Draw relations" button (in inference panel before relations are drawn)
    document.getElementById('btn-draw-relations')?.addEventListener('click', () => {
        if (state.selected) {
            const sid = state.selected.id || state.selected.properties?.signal_metadata?.signal_id;
            drawRelations(sid);
        }
    });
    // Wire clear button
    document.getElementById('btn-clear-relations')?.addEventListener('click', clearRelations);
    // Wire save bundle button
    document.getElementById('btn-save-bundle')?.addEventListener('click', saveBundle);
}

// Event delegation for dynamically rendered buttons
document.addEventListener('click', (e) => {
    if (e.target.closest('#btn-draw-relations') && state.selected) {
        drawRelations(_signalId(state.selected));
    }
    if (e.target.closest('#btn-redraw-relations') && state.selected) {
        drawRelations(_signalId(state.selected));
    }
    if (e.target.closest('#btn-clear-relations')) clearRelations();
    if (e.target.closest('#btn-save-bundle')) saveBundle();

    if (e.target.closest('#btn-reposition') && state.selected) {
        state.mapView?.enterRepositionMode(_signalId(state.selected), (lat, lon) => patchAnchor(lat, lon));
    }

    // Phase 3 — tc-chip / names entity / promote
    const tcChip = e.target.closest('.tc-chip');
    if (tcChip) {
        const { norm, contextType, contextName, county } = tcChip.dataset;
        let contextId = null;
        if (contextType === 'barony' && contextName && county) {
            const _n = s => s.toUpperCase().trim().replace(/[^A-Z0-9]/g, '_');
            contextId = `BARONY_${_n(county)}_${_n(contextName)}`;
        }
        queryNamesEntity(norm, contextId);
    }

    if (e.target.closest('#btn-clear-names-entity')) clearNamesEntity();

    if (e.target.closest('#btn-promote-field') && state.namesEntityData) {
        const norm = e.target.closest('#btn-promote-field').dataset.norm;
        const featureIds = state.namesEntityData.features
            .map(f => f.id || f.properties?.signal_metadata?.signal_id)
            .filter(Boolean);
        if (norm && featureIds.length) promoteToField(norm, featureIds);
    }

    if (e.target.closest('#btn-retau-submit') && state.selected) {
        const bpMin = parseFloat(document.getElementById('retau-bp-min')?.value);
        const bpMax = parseFloat(document.getElementById('retau-bp-max')?.value);
        const basis = document.getElementById('retau-proxy-basis')?.value || '';
        const evidence = document.getElementById('retau-evidence')?.value || '';
        if (!isNaN(bpMin) && !isNaN(bpMax) && bpMin > 0 && bpMax > 0) {
            patchTau(bpMin, bpMax, basis, evidence);
        }
    }

    if (e.target.closest('#btn-reclassify-submit') && state.selected) {
        const cls = document.getElementById('reclassify-class')?.value?.trim();
        const conf = parseFloat(document.getElementById('reclassify-conf')?.value ?? '0.5');
        const evidence = document.getElementById('reclassify-evidence')?.value || '';
        if (cls) patchClassify(cls, isNaN(conf) ? 0.5 : conf, evidence);
    }
});

// Live confidence slider readout
document.addEventListener('input', (e) => {
    if (e.target.id === 'reclassify-conf') {
        const val = document.getElementById('reclassify-conf-val');
        if (val) val.textContent = Math.round(parseFloat(e.target.value) * 100) + '%';
    }
});

// ── Phase 3 — Territorial reconstruction ──────────────────────────────────

async function queryNamesEntity(norm, contextId) {
    state.mapView?.setLoading(true);
    try {
        const resp = await fetch(`/api/signals?names_entity=${encodeURIComponent(norm)}&limit=500`);
        if (!resp.ok) throw new Error(resp.statusText);
        const data = await resp.json();
        state.namesEntityData = { norm, contextId: contextId || null, features: data.features || [] };
        state.mapView?.setSecondaryData(data);
        RightPanel.renderNamesEntity(norm, state.namesEntityData.features, state.selected);
    } catch (err) {
        console.error('Names entity query failed:', err);
    } finally {
        state.mapView?.setLoading(false);
    }
}

function clearNamesEntity() {
    state.namesEntityData = null;
    state.mapView?.clearSecondaryData();
    state.mapView?.clearReconstructionPolygon();
    if (state.selected) RightPanel.render(state.selected);
}

async function promoteToField(norm, featureIds) {
    const contextId = state.namesEntityData?.contextId;
    state.mapView?.setLoading(true);
    try {
        // 1. Compute hull — prefer context_id (fetches spatially-distributed RMP/RC evidence)
        // over the names_entity signals which may all share a centroid coordinate.
        const reconBody = { entity_name_norm: norm };
        if (contextId) {
            reconBody.context_id = contextId;
        } else {
            reconBody.signal_ids = featureIds;
        }
        const reconResp = await fetch('/api/territory/reconstruct', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(reconBody),
        });
        if (!reconResp.ok) {
            const err = await reconResp.json().catch(() => ({ detail: reconResp.statusText }));
            console.error('Reconstruct failed:', err.detail);
            return;
        }
        const recon = await reconResp.json();
        state.mapView?.showReconstructionPolygon(recon.buffered || recon.hull);

        // 2. Persist inferred_field signal
        const createResp = await fetch('/api/signals/inferred-field', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({
                entity_name_norm: norm,
                source_signal_ids: recon.contributing_ids || featureIds,
                hull_geojson: recon.buffered || recon.hull,
            }),
        });
        if (!createResp.ok) {
            console.error('Create inferred-field failed:', createResp.statusText);
            return;
        }
        const ifld = await createResp.json();
        const sid = ifld.id;

        // Add to signal index
        if (sid) state.signalIndex.set(sid, ifld);

        // Add to bundle if one is active
        if (state.bundleId && sid) {
            await fetch(`/api/bundles/${state.bundleId}/members`, {
                method:  'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ add: [{ signal_id: sid, added_via: 'inferred_field' }], remove: [] }),
            }).catch(() => {});
        }
    } catch (err) {
        console.error('Promote to field failed:', err);
    } finally {
        state.mapView?.setLoading(false);
    }
}

window.selectSignal = selectSignal;
