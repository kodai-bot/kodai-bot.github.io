/**
 * worldline.js — Vertical tau-axis renderer for the centre panel.
 *
 * Draws on a <canvas> element. Spine runs from "now" (top) to "INCEPT" (bottom).
 * Worldline nodes = raw temporal items from tau_data.raw_items.
 * Phi ticks = individual phi observations positioned near "now" (modern survey).
 */

const NODE_COLOURS = {
    radiocarbon_date: '#e8a835',
    period_label:     'rgba(255,255,255,0.35)',
    survey_date:      '#4aad7a',
    artefact_estimate:'#c8851a',
    historical_record:'#378add',
    unknown:          'rgba(255,255,255,0.2)',
};

const SRC_COLOUR = '#4aad7a'; // RMP default

const PAD_TOP    = 28;
const PAD_BOTTOM = 28;
const SPINE_X_FRAC = 0.5; // spine at 50% width

export class WorldlinePanel {
    constructor(canvasEl, onPhiHover) {
        this.canvas = canvasEl;
        this.ctx = canvasEl.getContext('2d');
        this.onPhiHover = onPhiHover; // callback(phiIdx | null)
        this.feature = null;
        this.phiTicks = []; // [{y, idx, label}]
        this._activeBarTooltip = null;
        this._tauPoint = 0;
        this._bound = {
            mousemove: this._onMouseMove.bind(this),
            mouseleave: this._onMouseLeave.bind(this),
            click: this._onClick.bind(this),
        };
        canvasEl.addEventListener('mousemove', this._bound.mousemove);
        canvasEl.addEventListener('mouseleave', this._bound.mouseleave);
        canvasEl.addEventListener('click', this._bound.click);
        this._resizeObs = new ResizeObserver(() => this._resize());
        this._resizeObs.observe(canvasEl.parentElement);
        this._resize();
        this._drawEmpty();
    }

    _resize() {
        const parent = this.canvas.parentElement;
        this.canvas.width  = parent.clientWidth;
        this.canvas.height = parent.clientHeight;
        if (this.feature && this._relatedData) {
            this.renderWithRelations(this.feature, this._relatedData);
        } else if (this.feature) {
            this.render(this.feature);
        } else {
            this._drawEmpty();
        }
    }

    _drawEmpty() {
        const { ctx, canvas } = this;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const cx = canvas.width * SPINE_X_FRAC;
        // draw amber spine
        ctx.strokeStyle = '#c8851a';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cx, PAD_TOP);
        ctx.lineTo(cx, canvas.height - PAD_BOTTOM);
        ctx.stroke();
        // label
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.font = '9px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText('select a signal', cx, canvas.height / 2);
    }

    render(feature) {
        this.feature = feature;
        this._relatedData = null;
        const td = feature.properties?.tau_data || {};
        const bp = td.bp_range || [null, null];
        const frameMax = bp[1] || bp[0] || 1000;
        this._renderFrame(feature, 0, frameMax);
    }

    /**
     * Render focused signal + relation bars from all three relation types.
     * Reframes the τ axis to the union of all bp_ranges with 10% padding.
     *
     * @param {object} focusFeature
     * @param {object} relatedData  - { spatial:[...], temporal:[...], name:[...] }
     * @param {object} opts         - { maxBars=12 } — cap for future density-band
     */
    renderWithRelations(focusFeature, relatedData, { maxBars = 12 } = {}) {
        this.feature = focusFeature;
        this._relatedData = relatedData;

        // Collect all bp values across focus + related to frame the axis
        const allBP = [];
        const gatherBP = (feat) => {
            const bp = feat?.properties?.tau_data?.bp_range;
            if (Array.isArray(bp)) {
                if (bp[0] != null) allBP.push(bp[0]);
                if (bp[1] != null) allBP.push(bp[1]);
            }
        };
        gatherBP(focusFeature);
        ['spatial', 'temporal', 'name'].forEach(t => (relatedData[t] || []).forEach(gatherBP));

        if (allBP.length === 0) { this.render(focusFeature); return; }

        const rawMin = Math.min(...allBP);
        const rawMax = Math.max(...allBP);
        const pad    = Math.max((rawMax - rawMin) * 0.10, 100);
        const frameMin = Math.max(0, rawMin - pad);
        const frameMax = rawMax + pad;

        this._renderFrame(focusFeature, frameMin, frameMax);
        this._drawRelationBars(relatedData, frameMin, frameMax, maxBars);
    }

    setTauPoint(bp) {
        this._tauPoint = bp || 0;
        if (this.feature) {
            if (this._relatedData) {
                this.renderWithRelations(this.feature, this._relatedData);
            } else {
                this.render(this.feature);
            }
        }
    }

    // ── Core draw (used by both render paths) ─────────────────────────────────
    _renderFrame(feature, frameMin, frameMax) {
        const { ctx, canvas } = this;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const p = feature.properties;
        const td = p.tau_data || {};

        const spineTop    = PAD_TOP;
        const spineBottom = canvas.height - PAD_BOTTOM;
        const spineHeight = spineBottom - spineTop;
        const cx = Math.round(canvas.width * SPINE_X_FRAC);
        const span = frameMax - frameMin || 1;

        const bpToY = (bp) => {
            const clamped = Math.max(frameMin, Math.min(frameMax, bp));
            return spineTop + ((clamped - frameMin) / span) * spineHeight;
        };
        this._bpToY    = bpToY;
        this._spineTop = spineTop;
        this._spineBottom = spineBottom;
        this._cx       = cx;
        this._frameMin = frameMin;
        this._frameMax = frameMax;

        // ── amber spine ──────────────────────────────────────────────────────
        ctx.strokeStyle = '#c8851a';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cx, spineTop);
        ctx.lineTo(cx, spineBottom);
        ctx.stroke();

        // ── axis labels ──────────────────────────────────────────────────────
        ctx.font = '8px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#e8a835';
        ctx.fillText(frameMin > 0 ? `${Math.round(frameMin)}BP` : 'now', cx, spineTop - 6);
        ctx.fillStyle = '#4aad7a';
        ctx.fillText(`τ = ${Math.round(frameMax)}BP`, cx, spineBottom + 14);

        // ── worldline nodes ──────────────────────────────────────────────────
        const rawItems = td.raw_items || [];
        const bpRange  = td.bp_range || [frameMin, frameMax];
        const nodeTooltips = [];
        rawItems.forEach((item, i) => {
            if (!item) return;
            const itemBP = this._parseItemToBP(item, bpRange);
            const isFallback = itemBP == null;
            const plotBP = isFallback ? (bpRange[0] + bpRange[1]) / 2 : itemBP;
            const y = bpToY(plotBP);
            if (y < spineTop - 4 || y > spineBottom + 4) return;
            const col = NODE_COLOURS[item.type] || NODE_COLOURS.unknown;
            const r = item.confidence ? 3 + item.confidence * 3 : 4;
            ctx.beginPath();
            ctx.arc(cx, y, r, 0, Math.PI * 2);
            if (isFallback) {
                ctx.strokeStyle = col;
                ctx.lineWidth = 1;
                ctx.stroke();
            } else {
                ctx.fillStyle = col;
                ctx.fill();
            }
            ctx.font = '7px "JetBrains Mono", monospace';
            const label = item.value != null
                ? String(item.value).slice(0, 20)
                : (item.type || '').replace(/_/g, ' ');
            const textW = ctx.measureText(label).width;
            const preferSide = i % 2 === 0 ? -1 : 1;
            // Flip to right if label would overflow left canvas edge, and vice-versa
            const side = (preferSide < 0 && cx - 9 - textW < 2) ? 1
                       : (preferSide > 0 && cx + 9 + textW > canvas.width - 2) ? -1
                       : preferSide;
            ctx.fillStyle = col;
            ctx.textAlign = side < 0 ? 'right' : 'left';
            ctx.fillText(label, cx + side * 9, y + 3);
            nodeTooltips.push({ y, r: r + 4, text: label, conf: item.confidence });
        });
        this._nodeTooltips = nodeTooltips;

        // ── τ clip plane ─────────────────────────────────────────────────────
        if (this._tauPoint > 0 && this._tauPoint >= frameMin && this._tauPoint <= frameMax) {
            const ty = bpToY(this._tauPoint);
            const ce = 2000 - this._tauPoint;
            const ceStr = ce >= 0 ? `${ce} CE` : `${-ce} BCE`;
            ctx.save();
            ctx.strokeStyle = 'rgba(232,168,53,0.6)';
            ctx.lineWidth = 1;
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            ctx.moveTo(0, ty);
            ctx.lineTo(canvas.width, ty);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = 'rgba(232,168,53,0.75)';
            ctx.font = '7px "JetBrains Mono", monospace';
            ctx.textAlign = 'left';
            ctx.fillText(`τ ${ceStr}`, 3, ty - 2);
            ctx.restore();
        }

        // ── phi ticks (physical observations near "now") ──────────────────────
        const phiData = p.phi_data || {};
        const nowY = spineTop + (spineBottom - spineTop) * 0.04;
        const phiItems = this._collectPhiItems(phiData);
        this.phiTicks = [];
        phiItems.forEach((item, i) => {
            const y = nowY + (i % 3) * 2;
            const len = 8 + (item.confidence || 0.5) * 16;
            const side = i % 2 === 0 ? -1 : 1;
            const x0 = cx + side * 2;
            const x1 = cx + side * (2 + len);
            ctx.beginPath();
            ctx.moveTo(x0, y);
            ctx.lineTo(x1, y);
            ctx.strokeStyle = SRC_COLOUR;
            ctx.globalAlpha = 0.5;
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.globalAlpha = 1;
            this.phiTicks.push({ y, x0, x1, idx: i, label: item.label });
        });
        this._relBarTooltips = [];
    }

    // ── Relation bars (drawn right of spine) ──────────────────────────────────
    _drawRelationBars(relatedData, frameMin, frameMax, maxBars) {
        const { ctx, _cx: cx, _bpToY: bpToY, _spineTop: spineTop, _spineBottom: spineBottom } = this;
        const BAR_X = cx + 14; // offset from spine
        const CAP_W = 4;       // half-width of end caps

        // Dash patterns per proxy_basis (used as line-style for evidence channel)
        const basisDash = (basis) => {
            if (!basis) return [];
            if (basis.includes('radiocarbon')) return [];                    // solid
            if (basis.includes('linguistic') || basis.includes('event'))
                return [3, 3];                                               // short dash
            return [6, 3];                                                   // long dash
        };

        const RELATION_COLOURS = {
            spatial:  '#4aad7a',
            temporal: '#e8a835',
            name:     '#378add',
        };

        // Derived proxy_bases that get full-weight treatment on name bars
        const DERIVED_BASES = new Set([
            'linguistic_stratum', 'event_coreference',
            'linguistic_taq:old_irish', 'linguistic_taq:middle_irish',
            'linguistic_taq:early_modern_irish', 'linguistic_taq:unknown',
        ]);

        const drawn = [];
        this._relBarTooltips = [];

        let barOffset = 0; // lane stacking (future: density band beyond maxBars)

        for (const relType of ['spatial', 'temporal', 'name']) {
            const features = (relatedData[relType] || []).slice(0, maxBars);
            const colour   = RELATION_COLOURS[relType] || '#ffffff';

            for (const feat of features) {
                const bp = feat?.properties?.tau_data?.bp_range;
                if (!Array.isArray(bp) || bp[0] == null || bp[1] == null) continue;

                const yTop = bpToY(bp[0]);
                const yBot = bpToY(bp[1]);
                if (yTop > spineBottom + 4 || yBot < spineTop - 4) continue;

                const proxyBasis = feat?.properties?.tau_data?.proxy_basis || '';
                const isDerived  = relType === 'name' && DERIVED_BASES.has(proxyBasis);

                // Evidence channel: dash pattern
                const dash  = basisDash(proxyBasis);
                // Emphasis for derived name relations (hero moment)
                const alpha = isDerived ? 1.0 : 0.3;
                const lw    = isDerived ? 2   : 1;

                const barX = BAR_X + barOffset;

                ctx.save();
                ctx.globalAlpha = alpha;
                ctx.strokeStyle = colour;
                ctx.lineWidth = lw;
                ctx.setLineDash(dash);

                // Vertical bar
                ctx.beginPath();
                ctx.moveTo(barX, yTop);
                ctx.lineTo(barX, yBot);
                ctx.stroke();

                // End caps (always solid)
                ctx.setLineDash([]);
                // Top cap
                ctx.beginPath();
                ctx.moveTo(barX - CAP_W, yTop);
                ctx.lineTo(barX + CAP_W, yTop);
                ctx.stroke();
                // Bottom cap
                ctx.beginPath();
                ctx.moveTo(barX - CAP_W, yBot);
                ctx.lineTo(barX + CAP_W, yBot);
                ctx.stroke();

                ctx.restore();

                // Annotation dot for derived name bars
                if (isDerived) {
                    ctx.save();
                    ctx.fillStyle = colour;
                    ctx.beginPath();
                    ctx.arc(barX, yTop, 3, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.restore();
                }

                // Hover tooltip registration
                const sm = feat?.properties?.signal_metadata || {};
                const sd = feat?.properties?.source_data || {};
                const ono = feat?.properties?.ono_data || {};
                const label = ono.headword_gaelic || sd.original_class || sm.signal_id || '—';
                this._relBarTooltips.push({
                    x: barX, yTop, yBot,
                    label: `${label} [${relType}]`,
                    colour,
                });

                drawn.push(relType);
            }
        }
    }

    // Convert a raw_temporal_item value to BP years.
    // Values may be CE years ("1912"), CE ranges ("1997-1999"), or text ("modern period").
    // Returns null for text-only values so the caller can use bp_range midpoint instead.
    _parseItemToBP(item, bpRange) {
        const v = item.value;
        if (v == null) return null;
        if (typeof v === 'number') return Math.round(2000 - v);
        if (typeof v === 'string') {
            // CE range "1200-1400" or "1997-1999"
            const rangeMatch = v.match(/^(\d{3,4})\s*[-–]\s*(\d{3,4})$/);
            if (rangeMatch) {
                const mid = (parseFloat(rangeMatch[1]) + parseFloat(rangeMatch[2])) / 2;
                return Math.round(2000 - mid);
            }
            // Single CE year "1912"
            const singleMatch = v.match(/^(\d{3,4})$/);
            if (singleMatch) return Math.round(2000 - parseFloat(singleMatch[1]));
        }
        return null; // period label text — use fallback position
    }

    _collectPhiItems(phi) {
        const items = [];
        (phi.materials || []).forEach(m => items.push({ label: m, confidence: 0.7 }));
        (phi.structural_features || []).forEach(f => items.push({ label: f, confidence: 0.6 }));
        const dims = phi.dimensions || {};
        const dimFields = ['diameter_ns_m', 'diameter_ew_m', 'length_m', 'width_m', 'height_m'];
        dimFields.forEach(k => {
            if (dims[k] != null) items.push({ label: `${k.replace(/_m$/, '')} ${dims[k]}m`, confidence: 0.8 });
        });
        if (phi.condition) items.push({ label: phi.condition.slice(0, 30), confidence: 0.5 });
        if (phi.visibility) items.push({ label: phi.visibility.slice(0, 30), confidence: 0.5 });
        return items;
    }

    _wrapText(ctx, text, x, y, maxW, lineH) {
        const words = text.split(' ');
        let line = '';
        let curY = y;
        for (const word of words) {
            const test = line ? line + ' ' + word : word;
            if (ctx.measureText(test).width > maxW && line) {
                ctx.fillText(line, x, curY);
                line = word;
                curY += lineH;
                if (curY > this.canvas.height - PAD_BOTTOM - 20) { ctx.fillText('…', x, curY); return; }
            } else {
                line = test;
            }
        }
        if (line) ctx.fillText(line, x, curY);
    }

    // ── highlight a phi tick by index (called from spectrograph hover) ────────
    highlightPhiTick(idx) {
        if (!this.feature) return;
        if (this._relatedData) this.renderWithRelations(this.feature, this._relatedData);
        else this.render(this.feature);
        const tick = this.phiTicks.find(t => t.idx === idx);
        if (!tick) return;
        const { ctx } = this;
        ctx.beginPath();
        ctx.moveTo(tick.x0, tick.y);
        ctx.lineTo(tick.x1, tick.y);
        ctx.strokeStyle = '#e8a835';
        ctx.lineWidth = 2;
        ctx.stroke();
    }

    clearHighlight() {
        if (!this.feature) return;
        if (this._relatedData) this.renderWithRelations(this.feature, this._relatedData);
        else this.render(this.feature);
    }

    _onMouseMove(e) {
        if (!this.feature) return;
        const rect = this.canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;

        // Check phi ticks
        let foundTick = null;
        for (const tick of this.phiTicks) {
            const minX = Math.min(tick.x0, tick.x1) - 4;
            const maxX = Math.max(tick.x0, tick.x1) + 4;
            if (mx >= minX && mx <= maxX && Math.abs(my - tick.y) < 5) {
                foundTick = tick.idx;
                break;
            }
        }
        this.canvas.style.cursor = foundTick != null ? 'crosshair' : 'default';
        if (this.onPhiHover) this.onPhiHover(foundTick);

        // Check relation bar hover — only redraw when hovered bar changes
        let hoveredBar = null;
        if (!foundTick && this._relBarTooltips?.length) {
            for (const bar of this._relBarTooltips) {
                if (Math.abs(mx - bar.x) < 8 && my >= bar.yTop - 4 && my <= bar.yBot + 4) {
                    this.canvas.style.cursor = 'crosshair';
                    hoveredBar = bar;
                    break;
                }
            }
        }

        if (hoveredBar !== this._activeBarTooltip) {
            this._activeBarTooltip = hoveredBar;
            this._redrawCanvas();
            if (hoveredBar) this._showBarTooltip(hoveredBar.x, hoveredBar.yTop, hoveredBar);
        }
    }

    _showBarTooltip(x, y, bar) {
        const { ctx } = this;
        const PAD = 4;
        ctx.save();
        ctx.font = '8px "JetBrains Mono", monospace';
        const w = ctx.measureText(bar.label).width + PAD * 2;
        const h = 14;
        const tx = Math.min(x + 10, this.canvas.width - w - 4);
        const ty = Math.max(y - h - 4, 4);
        ctx.fillStyle = 'rgba(20,20,20,0.85)';
        ctx.fillRect(tx, ty, w, h);
        ctx.fillStyle = bar.colour;
        ctx.textAlign = 'left';
        ctx.fillText(bar.label, tx + PAD, ty + h - 4);
        ctx.restore();
    }

    _redrawCanvas() {
        if (!this.feature) return;
        if (this._relatedData) {
            this._renderFrame(this.feature, this._frameMin, this._frameMax);
            this._drawRelationBars(this._relatedData, this._frameMin, this._frameMax, 12);
        } else {
            this.render(this.feature);
        }
    }

    _onMouseLeave() {
        this.canvas.style.cursor = 'default';
        if (this.onPhiHover) this.onPhiHover(null);
        if (this._activeBarTooltip) {
            this._activeBarTooltip = null;
            this._redrawCanvas();
        }
    }

    _onClick(e) {
        // tooltip on node click — future
    }

    clear() {
        this.feature = null;
        this.phiTicks = [];
        this._drawEmpty();
    }

    destroy() {
        this._resizeObs.disconnect();
        this.canvas.removeEventListener('mousemove', this._bound.mousemove);
        this.canvas.removeEventListener('mouseleave', this._bound.mouseleave);
        this.canvas.removeEventListener('click', this._bound.click);
    }
}
