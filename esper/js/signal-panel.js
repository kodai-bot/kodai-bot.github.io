/**
 * signal-panel.js — Right panel: Identity Slug + Inference Summary.
 *
 * Identity Slug: measured facts only — coordinates, spatial context, UARI.
 * Inference Summary: what we can derive from the current pipeline output.
 */

import { wgs84ToItm } from './itm.js';

const PROXY_BASES = [
    'radiocarbon_date',
    'period_label',
    'survey_date_minimum',
    'monument_class_coarse',
    'artefact_estimate',
    'historical_record',
    'linguistic_stratum',
    'event_coreference',
    'typological',
];

export const RightPanel = {

    render(feature) {
        this._renderSlug(feature);
        this._renderInference(feature);
    },

    clear() {
        document.getElementById('identity-slug').innerHTML =
            '<p class="slug-empty dim">select a signal</p>';
        document.getElementById('inference-summary').innerHTML =
            '<p class="infer-empty dim">inference chain: no bundles loaded</p>';
    },

    renderList(features) {
        if (!features || features.length === 0) return;
        const rows = features.map(f => {
            const sm = f.properties?.signal_metadata || {};
            const sd = f.properties?.source_data || {};
            const id = sm.signal_id || f.id || '—';
            const cls = sd.original_class || '—';
            const loc = sd.townland || sd.county || '';
            return `<div class="sig-list-row" data-id="${_esc(String(id))}">
                <span class="slug-val uari">${_esc(String(id))}</span>
                <span class="slug-key">${_esc(cls)}${loc ? ' · ' + _esc(loc) : ''}</span>
            </div>`;
        }).join('');

        document.getElementById('identity-slug').innerHTML = `
            <div class="slug-empty dim" style="margin-bottom:8px">${features.length} co-located signals</div>
            ${rows}`;

        document.getElementById('identity-slug').querySelectorAll('.sig-list-row').forEach(row => {
            row.addEventListener('click', () => window.selectSignal(row.dataset.id));
        });

        document.getElementById('inference-summary').innerHTML =
            '<p class="infer-empty dim">select a signal from list</p>';
    },

    // ── Identity Slug ───────────────────────────────────────────────────────
    _renderSlug(feature) {
        const p  = feature.properties;
        const sa = p.spatial_anchor || {};
        const sd = p.source_data || {};
        const sm = p.signal_metadata || {};

        const lat = sa.wgs84_lat ?? feature.geometry?.coordinates?.[1];
        const lon = sa.wgs84_lon ?? feature.geometry?.coordinates?.[0];

        let itmStr = '—';
        if (lat != null && lon != null) {
            try {
                const { E, N } = wgs84ToItm(lat, lon);
                itmStr = `E ${E.toLocaleString()}  N ${N.toLocaleString()}`;
            } catch (_) {}
        }

        const gcrs = sa.gcrs_cartesian || {};
        const gcrsStr = (gcrs.x != null)
            ? `${_fmt(gcrs.x / 1000)} / ${_fmt(gcrs.y / 1000)} / ${_fmt(gcrs.z / 1000)} ×10³ km`
            : '—';

        const rows = [
            { k: 'WGS84',    v: lat != null ? `${lat.toFixed(5)}° N  ${lon.toFixed(5)}° E` : '—' },
            { k: 'ITM',      v: itmStr },
            { k: 'GCRS',     v: gcrsStr },
            null, // rule
            { k: 'townland', v: sd.townland || '—' },
            { k: 'county',   v: sd.county   || '—' },
            null,
            { k: 'SMRS',     v: sd.original_id || '—' },
            { k: 'class',    v: sd.original_class || '—', cls: 'class' },
            { k: 'UARI',     v: sm.signal_id || feature.id || '—', cls: 'uari' },
        ];

        const html = rows.map(r => {
            if (!r) return '<hr class="slug-rule">';
            return `<div class="slug-row">
                <span class="slug-key">${r.k}</span>
                <span class="slug-val${r.cls ? ' ' + r.cls : ''}">${_esc(String(r.v))}</span>
            </div>`;
        }).join('');

        document.getElementById('identity-slug').innerHTML = html;
    },

    // ── Inference Summary ───────────────────────────────────────────────────
    _renderInference(feature) {
        const p  = feature.properties;
        const sd = p.source_data || {};
        const tv = p.temporal_vector || {};
        const sm = p.signal_metadata || {};
        const td = p.tau_data || {};
        const pd = p.phi_data || {};

        const isPending = (sd.original_text || '').includes('has not been uploaded');

        const quality = sm.signal_quality ?? 0.5;
        const qualPct = Math.round(quality * 100);

        const posConf = sm.position_confidence || 'unknown';
        const canReposition = posConf === 'approximate' || posConf === 'unknown';
        const history = (p.update_history || []).slice().reverse();

        const proxyMap = {
            radiocarbon_date:      'radiocarbon date',
            period_label:          'period label',
            survey_date_minimum:   'survey date (minimum)',
            monument_class_coarse: 'monument class (coarse)',
            artefact_estimate:     'artefact estimate',
            historical_record:     'historical record',
        };
        const basisLabel = proxyMap[tv.temporal_source] || (tv.temporal_source || '—');
        const bpMin = tv.years_bp_min != null ? Math.round(tv.years_bp_min).toLocaleString() : '—';
        const bpMax = tv.years_bp_max != null ? Math.round(tv.years_bp_max).toLocaleString() : '—';
        const bpStr = bpMin === bpMax ? `${bpMin} BP` : `${bpMin} → ${bpMax} BP`;

        const nMat   = (pd.materials || []).filter(Boolean).length;
        const nFeat  = (pd.structural_features || []).filter(Boolean).length;
        const dimRaw = (pd.dimensions || {}).raw;

        const chips = [
            ...((pd.materials || []).filter(Boolean).map(m => m.slice(0, 28))),
            ...((pd.structural_features || []).filter(Boolean).slice(0, 3).map(f => f.slice(0, 28))),
        ];

        const rawText = sd.original_text || '';
        const srcLine = `${sd.source_dataset || 'RMP'} · pipeline v${sm.schema_version || 1}`;

        const isOno = sm.signal_type === 'territorial_toponym' || sm.signal_type === 'placename_attestation';
        const tcItems = isOno
            ? (p.ono_data?.territorial_context || []).filter(tc => tc.raw_name && tc.context_type !== 'county')
            : [];
        const county = sd.county || '';
        const tcHtml = tcItems.length ? `
            <div class="infer-section">
                <div class="infer-label">territorial context</div>
                <div class="infer-chips">
                    ${tcItems.map(tc => `<span class="tc-chip"
                        data-norm="${_esc(tc.raw_name.toLowerCase())}"
                        data-context-type="${_esc(tc.context_type || '')}"
                        data-context-name="${_esc(tc.raw_name)}"
                        data-county="${_esc(county)}"
                    >${_esc(tc.raw_name)}</span>`).join('')}
                </div>
            </div>` : '';

        document.getElementById('inference-summary').innerHTML = `
            ${isPending ? `<div class="asi-pending-banner">
                <span class="asi-pending-icon">⧖</span>
                ASI record not yet uploaded — spatial data only
            </div>` : ''}

            <div class="infer-section">
                <div class="infer-label">classification</div>
                <div class="infer-value">${_esc(sd.original_class || '—')}</div>
                <div class="conf-bar-wrap"><div class="conf-bar" style="width:${qualPct}%"></div></div>
            </div>

            <div class="infer-section">
                <div class="infer-label">temporal basis</div>
                <div class="infer-value">${_esc(basisLabel)}</div>
                <div class="infer-value dim" style="margin-top:2px">${bpStr}</div>
            </div>

            ${!isPending ? `
            <div class="infer-section">
                <div class="infer-label">physical evidence</div>
                <div class="infer-value dim">${nMat} material${nMat !== 1 ? 's' : ''} · ${nFeat} structural feature${nFeat !== 1 ? 's' : ''}${dimRaw ? ' · dims recorded' : ''}</div>
                ${chips.length ? `<div class="infer-chips">${chips.map(c => `<span class="infer-chip">${_esc(c)}</span>`).join('')}</div>` : ''}
            </div>` : ''}

            <div class="infer-section">
                <div class="infer-label">source</div>
                <div class="infer-value dim">${_esc(srcLine)}</div>
            </div>

            ${canReposition ? `
            <div class="infer-section">
                <div class="infer-label">spatial</div>
                <span class="edit-hint dim">${_esc(posConf)} position</span>
                <button class="infer-action-btn" id="btn-reposition" style="margin-top:4px">⊕ reposition</button>
            </div>` : ''}

            <details class="edit-form">
                <summary>retau ↻</summary>
                <div class="edit-form-body">
                    <div class="edit-row">
                        <span class="edit-label">bp min</span>
                        <input class="edit-input" type="number" id="retau-bp-min" min="1"
                               value="${tv.years_bp_min != null ? Math.round(tv.years_bp_min) : ''}">
                    </div>
                    <div class="edit-row">
                        <span class="edit-label">bp max</span>
                        <input class="edit-input" type="number" id="retau-bp-max" min="1"
                               value="${tv.years_bp_max != null ? Math.round(tv.years_bp_max) : ''}">
                    </div>
                    <div class="edit-row">
                        <span class="edit-label">basis</span>
                        <select class="edit-select" id="retau-proxy-basis">
                            ${PROXY_BASES.map(b => `<option${b === tv.temporal_source ? ' selected' : ''}>${_esc(b)}</option>`).join('')}
                        </select>
                    </div>
                    <div class="edit-row">
                        <span class="edit-label">evidence</span>
                        <textarea class="edit-textarea" id="retau-evidence" rows="2" placeholder="reason for update"></textarea>
                    </div>
                    <button class="infer-action-btn" id="btn-retau-submit" style="margin-top:6px">commit retau</button>
                </div>
            </details>

            <details class="edit-form">
                <summary>reclassify ↻</summary>
                <div class="edit-form-body">
                    <div class="edit-row">
                        <span class="edit-label">class</span>
                        <input class="edit-input" type="text" id="reclassify-class"
                               value="${_esc(sd.original_class || '')}">
                    </div>
                    <div class="edit-row">
                        <span class="edit-label">conf</span>
                        <input type="range" id="reclassify-conf" min="0" max="1" step="0.05" value="${quality}">
                        <span class="edit-conf-val" id="reclassify-conf-val">${qualPct}%</span>
                    </div>
                    <div class="edit-row">
                        <span class="edit-label">evidence</span>
                        <textarea class="edit-textarea" id="reclassify-evidence" rows="2" placeholder="reason for update"></textarea>
                    </div>
                    <button class="infer-action-btn" id="btn-reclassify-submit" style="margin-top:6px">commit reclassify</button>
                </div>
            </details>

            ${history.length ? `
            <details class="edit-form edit-history">
                <summary>update history (${history.length})</summary>
                <div class="edit-form-body">
                    ${history.map(h => `
                    <div class="history-entry">
                        <div class="history-meta dim">${_esc(h.update_type || '?')} · ${_esc((h.timestamp || '').slice(0, 16))}</div>
                        ${h.evidence ? `<div class="history-evidence dim">${_esc(String(h.evidence).slice(0, 80))}</div>` : ''}
                    </div>`).join('')}
                </div>
            </details>` : ''}

            ${tcHtml}

            <div class="infer-section">
                <div class="infer-label">scope</div>
                <select class="edit-select" id="relations-scope">
                    <option value="radius">~1.5 km</option>
                    <option value="townland">Townland</option>
                    <option value="barony">Barony</option>
                    <option value="region">Region ~25 km</option>
                    <option value="island">Island</option>
                </select>
                <div class="dim" style="font-size:8px;margin-top:3px">name links always island-wide</div>
                <button class="infer-action-btn" id="btn-draw-relations" style="margin-top:6px">⟁ Draw relations</button>
            </div>

            ${rawText && !isPending ? `
            <details class="src-text">
                <summary>original record text</summary>
                <div class="src-text-body">${_esc(rawText)}</div>
            </details>` : ''}
        `;
    },

    // ── Names-entity panel (replaces inference when tc-chip is clicked) ──────
    renderNamesEntity(norm, features, focusFeature) {
        const count = features.length;
        const sm = focusFeature?.properties?.signal_metadata || {};
        const focusId = sm.signal_id || focusFeature?.id || '—';

        document.getElementById('inference-summary').innerHTML = `
            <div class="infer-section">
                <div class="infer-label">name search</div>
                <div class="infer-value">${_esc(norm)}</div>
                <div class="infer-value dim" style="margin-top:2px">${count} signal${count !== 1 ? 's' : ''} share this name</div>
                ${count >= 3 ? `<button class="infer-action-btn promote-btn" id="btn-promote-field"
                    data-norm="${_esc(norm)}" style="margin-top:8px">▲ promote to field</button>` : ''}
                <button class="infer-action-btn dim" id="btn-clear-names-entity" style="margin-top:4px">✕ back to signal</button>
            </div>
        `;
    },

    // ── Relations panel (replaces inference when Draw relations fires) ───────
    renderRelations(focusFeature, relatedData, bundleId, scope = 'radius') {
        const p  = focusFeature.properties;
        const sm = p.signal_metadata || {};
        const sd = p.source_data || {};
        const focusLabel = sd.original_class || sm.signal_id || '—';

        // Reach badge — computed from already-fetched relations, no extra request
        const focusCoords = focusFeature.geometry?.coordinates;
        let reachHtml = '';
        if (focusCoords) {
            const [fLon, fLat] = focusCoords;
            const nameFeats = relatedData.name || [];
            const allFeats  = [...nameFeats, ...(relatedData.temporal || [])];
            let maxDistKm = 0;
            for (const f of nameFeats) {
                const c = f.geometry?.coordinates;
                if (c) {
                    const d = _haversineKm(fLat, fLon, c[1], c[0]);
                    if (d > maxDistKm) maxDistKm = d;
                }
            }
            const counties = new Set();
            for (const f of allFeats) {
                const c = f.properties?.source_data?.county;
                if (c) counties.add(c.toLowerCase());
            }
            const parts = [];
            if (maxDistKm > 0.1) parts.push(`~${maxDistKm.toFixed(1)} km`);
            if (counties.size > 0) parts.push(`${counties.size} ${counties.size === 1 ? 'county' : 'counties'}`);
            if (parts.length) reachHtml = `<div class="reach-badge">reach ${parts.join(' · ')}</div>`;
        }

        const REL_LABELS = { spatial: 'nearby', temporal: 'overlapping τ', name: 'name co-reference' };
        const REL_COLOURS = { spatial: '#4aad7a', temporal: '#e8a835', name: '#378add' };

        const sections = ['spatial', 'temporal', 'name'].map(relType => {
            const features = (relatedData[relType] || []).slice(0, 20);
            if (features.length === 0) return '';
            const rows = features.map(f => {
                const fsm = f.properties?.signal_metadata || {};
                const fsd = f.properties?.source_data || {};
                const fono = f.properties?.ono_data || {};
                const id   = fsm.signal_id || f.id || '—';
                const lbl  = fono.headword_gaelic || fsd.original_class || '—';
                const loc  = fsd.townland || fsd.county || '';
                const ev   = f.evidence || {};
                let evStr  = '';
                if (ev.distance_m != null) evStr = `${Math.round(ev.distance_m)}m`;
                else if (ev.overlapping_range) evStr = `${Math.round(ev.overlapping_range[0])}–${Math.round(ev.overlapping_range[1])} BP`;
                else if (ev.shared_entity_names) evStr = ev.shared_entity_names.slice(0, 2).join(', ');
                return `<div class="relations-row" data-id="${_esc(id)}">
                    <span class="slug-val" style="color:${REL_COLOURS[relType]}">${_esc(lbl)}</span>
                    <span class="slug-key dim">${loc ? _esc(loc) + ' · ' : ''}${evStr}</span>
                </div>`;
            }).join('');
            const overflow = (relatedData[relType] || []).length > 20
                ? `<div class="dim" style="font-size:8px;margin-top:4px">+${(relatedData[relType].length - 20)} more</div>` : '';
            return `<div class="infer-section">
                <div class="relations-group-header" style="color:${REL_COLOURS[relType]}">${REL_LABELS[relType]}</div>
                ${rows}${overflow}
            </div>`;
        }).join('');

        const bundleBtn = bundleId
            ? `<button class="infer-action-btn bundle-save-btn active" id="btn-save-bundle">✓ bundle saved</button>`
            : `<button class="infer-action-btn bundle-save-btn" id="btn-save-bundle">↗ save bundle</button>`;

        const SCOPE_OPTS = [
            ['radius',   '~1.5 km'],
            ['townland', 'Townland'],
            ['barony',   'Barony'],
            ['region',   'Region ~25 km'],
            ['island',   'Island'],
        ];
        const scopeSelect = `<select class="edit-select" id="relations-scope" style="margin-top:4px">
            ${SCOPE_OPTS.map(([v, l]) => `<option value="${v}"${v === scope ? ' selected' : ''}>${l}</option>`).join('')}
        </select>`;

        document.getElementById('inference-summary').innerHTML = `
            <div class="infer-section">
                <div class="infer-label">focus</div>
                <div class="infer-value">${_esc(focusLabel)}</div>
                ${reachHtml}
                ${scopeSelect}
                <div class="dim" style="font-size:8px;margin-top:2px">name links always island-wide</div>
                <button class="infer-action-btn dim" id="btn-redraw-relations" style="margin-top:4px">⟁ redraw</button>
                <button class="infer-action-btn dim" id="btn-clear-relations" style="margin-top:4px">✕ clear</button>
            </div>
            ${sections || '<div class="infer-empty dim">no relations found</div>'}
            <div class="infer-section">${bundleBtn}</div>
        `;

        // Wire row clicks via delegation (app.js handles via window.selectSignal)
        document.getElementById('inference-summary').querySelectorAll('.relations-row').forEach(row => {
            row.addEventListener('click', () => window.selectSignal(row.dataset.id));
        });
    },
};

function _haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2)**2
            + Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) * Math.sin(dLon/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function _fmt(n) { return n != null ? n.toFixed(0) : '—'; }
function _esc(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
