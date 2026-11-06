/**
 * phi-spectrograph.js — Pure-φ fingerprint spectrograph (bottom strip).
 *
 * Renders phi observations as bottom-aligned vertical ticks across a
 * horizontal φ parameter space divided into four zones:
 *   materials (0–25%) | structural features (25–55%) | dimensions (55–80%) | condition (80–100%)
 *
 * Cross-highlights with worldline phi ticks via shared idx.
 */

const ZONES = [
    { label: 'materials',           start: 0.00, end: 0.25 },
    { label: 'structural features', start: 0.25, end: 0.55 },
    { label: 'dimensions',          start: 0.55, end: 0.80 },
    { label: 'condition',           start: 0.80, end: 1.00 },
];

const SRC_COLOUR   = '#4aad7a';
const TICK_BASE_H  = 15;
const TICK_CONF_H  = 45;
const CANVAS_PAD_H = 20; // headroom above tallest tick for axis labels
const AXIS_Y_OFFSET = 14; // label position from top of strip

export class PhiSpectrograph {
    constructor(canvasEl, onPhiHover) {
        this.canvas = canvasEl;
        this.ctx = canvasEl.getContext('2d');
        this.onPhiHover = onPhiHover;  // callback(idx | null)
        this.ticks = []; // [{x, h, idx, label, confidence}]
        this.feature = null;
        this._highlighted = null;

        this._bound = {
            mousemove: this._onMouseMove.bind(this),
            mouseleave: this._onMouseLeave.bind(this),
        };
        canvasEl.addEventListener('mousemove', this._bound.mousemove);
        canvasEl.addEventListener('mouseleave', this._bound.mouseleave);

        this._resizeObs = new ResizeObserver(() => this._resize());
        this._resizeObs.observe(canvasEl.parentElement);
        this._resize();
        this._drawEmpty();
    }

    _resize() {
        const parent = this.canvas.parentElement;
        this.canvas.width  = parent.clientWidth;
        this.canvas.height = parent.clientHeight;
        if (this.feature) this.render(this.feature);
        else this._drawEmpty();
    }

    _drawEmpty() {
        const { ctx, canvas } = this;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        this._drawAxes(ctx, canvas.width, canvas.height);
    }

    _drawAxes(ctx, W, H) {
        ctx.font = '8px "JetBrains Mono", monospace';
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ZONES.forEach(z => {
            const midPct = (z.start + z.end) / 2;
            const x = midPct * W;
            ctx.textAlign = 'center';
            ctx.fillText(z.label, x, AXIS_Y_OFFSET);
            // zone boundary (subtle vertical rule)
            if (z.start > 0) {
                ctx.strokeStyle = 'rgba(255,255,255,0.06)';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(z.start * W, AXIS_Y_OFFSET + 4);
                ctx.lineTo(z.start * W, H);
                ctx.stroke();
            }
        });
    }

    render(feature) {
        this.feature = feature;
        this._highlighted = null;
        this._buildTicks(feature);
        this._draw();
    }

    _buildTicks(feature) {
        const phi = (feature.properties.phi_data) || {};
        this.ticks = [];
        let idx = 0;

        // ── materials zone ──────────────────────────────────────────────────
        const mats = phi.materials || [];
        mats.forEach((m, i) => {
            if (!m) return;
            const pct = ZONES[0].start + (i + 0.5) / Math.max(mats.length, 1) * (ZONES[0].end - ZONES[0].start);
            this.ticks.push({ pct, confidence: 0.7, label: m, idx: idx++, zone: 0 });
        });

        // ── structural features zone ────────────────────────────────────────
        const feats = phi.structural_features || [];
        feats.forEach((f, i) => {
            if (!f) return;
            const pct = ZONES[1].start + (i + 0.5) / Math.max(feats.length, 1) * (ZONES[1].end - ZONES[1].start);
            this.ticks.push({ pct, confidence: 0.6, label: f, idx: idx++, zone: 1 });
        });

        // ── dimensions zone ─────────────────────────────────────────────────
        const dims = phi.dimensions || {};
        const dimEntries = [
            ['diameter_ns_m', dims.diameter_ns_m],
            ['diameter_ew_m', dims.diameter_ew_m],
            ['length_m',      dims.length_m],
            ['width_m',       dims.width_m],
            ['height_m',      dims.height_m],
        ].filter(([, v]) => v != null);
        dimEntries.forEach(([k, v], i) => {
            const pct = ZONES[2].start + (i + 0.5) / Math.max(dimEntries.length, 1) * (ZONES[2].end - ZONES[2].start);
            this.ticks.push({ pct, confidence: 0.85, label: `${k.replace(/_m$/, '')} ${v}m`, idx: idx++, zone: 2 });
        });

        // ── condition zone ──────────────────────────────────────────────────
        const condItems = [
            phi.condition && { label: phi.condition.slice(0, 40), confidence: 0.5 },
            phi.visibility && { label: phi.visibility.slice(0, 40), confidence: 0.5 },
        ].filter(Boolean);
        condItems.forEach((item, i) => {
            const pct = ZONES[3].start + (i + 0.5) / Math.max(condItems.length, 1) * (ZONES[3].end - ZONES[3].start);
            this.ticks.push({ pct, confidence: item.confidence, label: item.label, idx: idx++, zone: 3 });
        });
    }

    _draw(highlightIdx = null) {
        const { ctx, canvas } = this;
        const W = canvas.width, H = canvas.height;
        ctx.clearRect(0, 0, W, H);
        this._drawAxes(ctx, W, H);

        const baseY = H - 4; // ticks hang from bottom

        this.ticks.forEach(tick => {
            const x = Math.round(tick.pct * W);
            const h = TICK_BASE_H + tick.confidence * TICK_CONF_H;
            const isHL = tick.idx === highlightIdx;

            ctx.beginPath();
            ctx.moveTo(x, baseY);
            ctx.lineTo(x, baseY - h);
            ctx.strokeStyle = isHL ? '#e8a835' : SRC_COLOUR;
            ctx.lineWidth = isHL ? 2 : 1;
            ctx.globalAlpha = isHL ? 1.0 : 0.5;
            ctx.stroke();
            ctx.globalAlpha = 1;

            if (isHL) {
                // cap circle
                ctx.beginPath();
                ctx.arc(x, baseY - h, 3, 0, Math.PI * 2);
                ctx.fillStyle = '#e8a835';
                ctx.fill();
                // tooltip label
                ctx.fillStyle = 'rgba(255,255,255,0.7)';
                ctx.font = '7px "JetBrains Mono", monospace';
                ctx.textAlign = x > W * 0.8 ? 'right' : 'center';
                ctx.fillText(tick.label.slice(0, 40), x, baseY - h - 6);
            }
        });
    }

    // Called by worldline hover — highlights the matching tick
    highlightTick(idx) {
        this._highlighted = idx;
        this._draw(idx);
    }

    clearHighlight() {
        this._highlighted = null;
        this._draw(null);
    }

    _tickAt(mx, my) {
        const W = this.canvas.width, H = this.canvas.height;
        const baseY = H - 4;
        for (const tick of this.ticks) {
            const x = tick.pct * W;
            const h = TICK_BASE_H + tick.confidence * TICK_CONF_H;
            if (Math.abs(mx - x) < 6 && my >= baseY - h - 4 && my <= baseY + 4) {
                return tick.idx;
            }
        }
        return null;
    }

    _onMouseMove(e) {
        if (!this.feature) return;
        const rect = this.canvas.getBoundingClientRect();
        const idx = this._tickAt(e.clientX - rect.left, e.clientY - rect.top);
        this.canvas.style.cursor = idx != null ? 'crosshair' : 'default';
        if (idx !== this._highlighted) {
            this._highlighted = idx;
            this._draw(idx);
            if (this.onPhiHover) this.onPhiHover(idx);
        }
    }

    _onMouseLeave() {
        this.canvas.style.cursor = 'default';
        if (this._highlighted != null) {
            this._highlighted = null;
            this._draw(null);
            if (this.onPhiHover) this.onPhiHover(null);
        }
    }

    clear() {
        this.feature = null;
        this.ticks = [];
        this._highlighted = null;
        this._drawEmpty();
    }

    destroy() {
        this._resizeObs.disconnect();
        this.canvas.removeEventListener('mousemove', this._bound.mousemove);
        this.canvas.removeEventListener('mouseleave', this._bound.mouseleave);
    }
}
