import { buildPhases, butterFraction, chapterAt, chaptersOf, ease, lerp, r1 } from "./phases.js";
import * as P from "./profile.js";
import { trianglesInStrip } from "../lamination.js";
const THREE_VERSION = "0.180.0";
const CDN = `https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}`;
const EXAGGERATION_MAX = 8;
const LAYER_ELASTICITY = 0.9;
const FOV = 42;
const NOSE_OPENING = 1.2;
const noseOpening = (slabs) => NOSE_OPENING * 0.5 * slabs.reduce((m, sl) => Math.max(m, sl.to - sl.from), 0);
const CUT_GAP = 0.35;
const cutGap = (slabs) => CUT_GAP * slabs.reduce((m, sl) => Math.max(m, sl.to - sl.from), 0);
const RELIEF_PUSH = 0.5;
const reliefPush = (slabs) => RELIEF_PUSH * slabs.reduce((m, sl) => Math.max(m, sl.to - sl.from), 0);
const CUT_SHOWN = 0.25;
const CUT_FAN = 0.9;
const KNIFE_THICKNESS = 0.35;
const PANEL_STRAIGHT_SHARE = 0.5;
function exaggerationFor(phases) {
    let k = EXAGGERATION_MAX;
    for (const q of phases) {
        if (q.kind !== "fold" || q.pieces < 2 || q.a.t <= 0)
            continue;
        const panel = q.a.l / q.pieces;
        const cs = P.creases(q.pieces, q.a.l, 1);
        let eaten = 0;
        for (let j = 0; j < q.pieces; j++) {
            const before = cs[j - 1] ? (Math.PI * cs[j - 1].r) / 2 : 0;
            const after = cs[j] ? (Math.PI * cs[j].r) / 2 : 0;
            eaten = Math.max(eaten, before + after);
        }
        k = Math.min(k, (panel * (1 - PANEL_STRAIGHT_SHARE)) / (eaten * q.a.t));
        const creases = q.pieces - 1;
        const ragged = (P.foldStyle(q.pieces) === "book" ? creases : 1) * (1 - LAYER_ELASTICITY);
        if (ragged > 0)
            k = Math.min(k, panel / (2 * ragged * Math.PI * (q.a.t / 2)));
    }
    return Math.max(1, Math.round(k * 10) / 10);
}
const sandwichOf = (s, butterFrac, k, coarse = false) => {
    const sl = P.slabs(s.t * k, drawnLayers(s.layers), butterFrac);
    return coarse && sl.length > 2 ? [sl[0], sl[sl.length - 1]] : sl;
};
const MAX_DRAWN_LAYERS = 48;
function drawnLayers(layers) {
    if (layers <= MAX_DRAWN_LAYERS)
        return layers;
    for (let m = MAX_DRAWN_LAYERS; m > 1; m--)
        if (layers % m === 0)
            return m;
    return MAX_DRAWN_LAYERS;
}
function clipRibbons(rs, x0, x1) {
    const clip = (pts) => {
        const out = [];
        for (let i = 0; i < pts.length; i++) {
            const p = pts[i];
            const inside = p.x >= x0 - 1e-9 && p.x <= x1 + 1e-9;
            const prev = pts[i - 1];
            if (prev) {
                for (const edge of [x0, x1]) {
                    const a = prev.x - edge;
                    const b = p.x - edge;
                    if ((a < 0 && b > 0) || (a > 0 && b < 0)) {
                        const u = a / (a - b);
                        out.push({ x: edge, y: lerp(prev.y, p.y, u) });
                    }
                }
            }
            if (inside)
                out.push(p);
        }
        return out;
    };
    return rs
        .map((r) => ({ ...r, mid: clip(r.mid), lo: clip(r.lo), hi: clip(r.hi) }))
        .filter((r) => r.mid.length > 1);
}
function flatBlock(s, butterFrac, arcSeg, k, coarse = false) {
    return P.ribbons([{ kind: "line", len: s.l }], sandwichOf(s, butterFrac, k, coarse), s.t * k, s.l, arcSeg);
}
function wrapPieces(plan, u, kind, k) {
    const sheet = plan.doughSheet;
    const butter = plan.butterSheet;
    const half = butter.length;
    const flap = half / 2;
    const td = sheet.t * k;
    const tb = butter.thickness * k;
    const w = sheet.w;
    const strip = (len, kindOf, t, x, y) => P.ribbons([{ kind: "line", len }], [{ kind: kindOf, from: 0, to: t }], t, len, 6).map((r) => ({
        ...r,
        mid: r.mid.map((p) => ({ x: p.x + x, y: p.y + y })),
        lo: r.lo.map((p) => ({ x: p.x + x, y: p.y + y })),
        hi: r.hi.map((p) => ({ x: p.x + x, y: p.y + y })),
    }));
    const middle = strip(half, "dough", td, flap, 0);
    const slab = kind === "appear" ? [] : strip(half, "butter", tb, flap, td);
    const lift = kind === "wrap" ? u : 0;
    const rise = ease(Math.min(1, lift * 2)) * (tb + td);
    const slide = ease(Math.max(0, lift * 2 - 1)) * flap;
    const left = strip(flap, "dough", td, 0, 0);
    const right = strip(flap, "dough", td, flap + half, 0);
    const pieces = [
        { ribbons: [...middle, ...slab], width: w, offset: { x: 0, y: 0, z: 0 }, fade: 0 },
        { ribbons: left, width: w, offset: { x: slide, y: rise, z: 0 }, fade: 0 },
        { ribbons: right, width: w, offset: { x: -slide, y: rise, z: 0 }, fade: 0 },
    ];
    return pieces;
}
function noseOf(p, butterFrac) {
    const segs = P.foldSegments(p.pieces, p.a.l, p.a.t, 1, undefined, 1);
    const start = P.anchoredStart(segs, P.foldAnchor(segs, p.pieces));
    const slabs = P.slabs(p.a.t, drawnLayers(p.a.layers), butterFrac);
    const rs = P.openNoses(P.ribbons(segs, slabs, p.a.t, P.materialLength(segs), 16, LAYER_ELASTICITY, start), P.creaseCentres(segs, start), noseOpening(slabs));
    const ends = P.curvedEnds(rs);
    return { ragged: 0, round: Math.max(ends.left, ends.right) };
}
function sceneAt(plan, p, u, butterFrac, arcSeg, k, coarse = false) {
    const step = plan.steps.find((s) => s.id === p.step);
    const layers = u < 0.5 ? p.a.layers : p.b.layers;
    const vol = (s) => s.w * s.l * s.t;
    if (p.step === "0") {
        const pieces = wrapPieces(plan, u, p.kind, k);
        return { pieces, layers: 1, volume: vol(p.b), trim: null, nose: null };
    }
    if (p.kind === "roll") {
        const path = step?.thicknessPath?.length ? [p.a.t, ...step.thicknessPath] : [p.a.t, p.b.t];
        const last = path[path.length - 1];
        const pos = u * (path.length - 1);
        const i = Math.min(path.length - 2, Math.floor(pos));
        const t = lerp(path[i], path[i + 1], ease(pos - i));
        const v = vol(p.a);
        const s = { w: p.a.w, t, l: v / (p.a.w * t), layers: p.a.layers };
        const used = Math.abs(last - p.b.t) < 1e-9 ? s : { ...s, l: lerp(p.a.l, p.b.l, u) };
        return {
            pieces: [{ ribbons: flatBlock(used, butterFrac, arcSeg, k, coarse), width: used.w, offset: { x: 0, y: 0, z: 0 }, fade: 0 }],
            layers,
            volume: vol(p.a),
            trim: null,
            nose: null,
        };
    }
    if (p.kind === "trim") {
        const full = flatBlock(p.a, butterFrac, arcSeg, k, coarse);
        const cut = (p.a.l - p.b.l) / 2;
        const keep = clipRibbons(full, cut, p.a.l - cut);
        const head = clipRibbons(full, -1, cut);
        const tail = clipRibbons(full, p.a.l - cut, p.a.l + 1);
        const away = 6 * u;
        return {
            pieces: [
                { ribbons: keep, width: p.a.w, offset: { x: 0, y: 0, z: 0 }, fade: 0 },
                { ribbons: head, width: p.a.w, offset: { x: -away, y: 0, z: 0 }, fade: u },
                { ribbons: tail, width: p.a.w, offset: { x: away, y: 0, z: 0 }, fade: u },
            ],
            layers,
            volume: vol(p.b),
            trim: cut,
            nose: null,
        };
    }
    if (p.kind === "fold") {
        const n = p.pieces;
        const style = P.foldStyle(n);
        const segs = P.foldSegments(n, p.a.l, p.a.t * k, u, style, 1);
        const start = P.anchoredStart(segs, P.foldAnchor(segs, n, style));
        const slabs = sandwichOf(p.a, butterFrac, k, coarse);
        const rs = P.openNoses(P.ribbons(segs, slabs, p.a.t * k, P.materialLength(segs), arcSeg, LAYER_ELASTICITY, start), P.creaseCentres(segs, start), noseOpening(slabs));
        return {
            pieces: [{ ribbons: rs, width: p.a.w, offset: { x: 0, y: 0, z: 0 }, fade: 0 }],
            layers,
            volume: vol(p.a),
            trim: null,
            nose: noseOf(p, butterFrac),
        };
    }
    if (p.kind === "relax") {
        const n = p.pieces;
        const sheet = { ...p.a, t: p.a.t / n, l: p.a.l * n, layers: p.a.layers / n };
        const bite = ease(Math.min(1, u * 3));
        const give = ease(Math.max(0, (u - 1 / 3) * 1.5));
        const segs = P.foldSegments(n, sheet.l, sheet.t * k, 1, P.foldStyle(n), 1 - give);
        const start = P.anchoredStart(segs, P.foldAnchor(segs, n));
        const centres = P.creaseCentres(segs, start);
        const slabs = sandwichOf(sheet, butterFrac, k, coarse);
        const closed = P.openNoses(P.ribbons(segs, slabs, sheet.t * k, P.materialLength(segs), arcSeg, LAYER_ELASTICITY, start), centres, noseOpening(slabs) * (1 - give));
        const cuts = P.cutsOf(centres, P.bounds(closed));
        const rs = P.openCuts(P.flattenNoses(closed, cuts, give, reliefPush(slabs)), cuts, cutGap(slabs), give);
        const b = P.bounds(rs);
        const trueSegs = P.foldSegments(n, sheet.l, sheet.t, 1, undefined, 1);
        const trueStart = P.anchoredStart(trueSegs, P.foldAnchor(trueSegs, n));
        const trueSlabs = P.slabs(sheet.t, drawnLayers(sheet.layers), butterFrac);
        const real = P.curvedEnds(P.openNoses(P.ribbons(trueSegs, trueSlabs, sheet.t, P.materialLength(trueSegs), arcSeg, LAYER_ELASTICITY, trueStart), P.creaseCentres(trueSegs, trueStart), noseOpening(trueSlabs)));
        return {
            pieces: [{ ribbons: rs, width: p.a.w, offset: { x: 0, y: 0, z: 0 }, fade: 0 }],
            knife: cuts.map((c) => ({ y: c.y, from: c.edge + c.side * 0.5, to: c.x, bite })),
            layers: p.b.layers,
            volume: vol(p.b),
            trim: null,
            nose: null,
            relief: real,
        };
    }
    if (p.kind === "cut" || p.kind === "focus") {
        const n = Math.max(1, p.pieces);
        const across = p.cutAcross;
        const whole = p.a;
        const part = across ? { ...whole, w: whole.w / n } : { ...whole, l: whole.l / n };
        const gap = (p.kind === "cut" ? 1.5 * u : 1.5) * (across ? 1 : 1);
        const rs = flatBlock(part, butterFrac, arcSeg, k, coarse);
        const pieces = [];
        for (let i = 0; i < n; i++) {
            const keep = i === 0;
            const drift = p.kind === "focus" ? lerp(1, keep ? 0 : 5, u) : 1;
            const slot = (i - (n - 1) / 2) * ((across ? part.w : part.l) + gap * drift);
            pieces.push({
                ribbons: rs,
                width: part.w,
                offset: across ? { x: 0, y: 0, z: slot } : { x: slot, y: 0, z: 0 },
                fade: p.kind === "focus" && !keep ? 0.75 * u : 0,
            });
        }
        return { pieces, layers, volume: vol(whole) * (p.kind === "focus" ? 1 : 1), trim: null, nose: null };
    }
    if (p.kind === "shape") {
        const s = { ...p.b, l: lerp(p.a.l, p.b.l, u) };
        const rs = flatBlock(s, butterFrac, arcSeg, k, coarse);
        const whole = () => ({
            pieces: [{ ribbons: rs, width: s.w, offset: { x: 0, y: 0, z: 0 }, fade: 0 }],
            layers: p.b.layers,
            volume: vol(s),
            trim: null,
            nose: null,
        });
        if (u < CUT_SHOWN)
            return whole();
        const share = plan.allocation.stripBreakdown.find((b) => b.strip === 1);
        if (!share)
            return whole();
        const base = plan.croissant.base;
        const part = ease(Math.min(1, Math.max(0, (u - CUT_SHOWN) / (1 - CUT_SHOWN))));
        const gap = CUT_FAN * part;
        const half = s.w / 2;
        const pieces = [];
        let slot = 0;
        const piece = (x0, x1, width, z, taper, fade = 0) => {
            const ribbons = clipRibbons(rs, x0, x1);
            if (ribbons.length)
                pieces.push({ ribbons, width, offset: { x: gap * slot, y: 0, z }, fade, taper });
        };
        let at = 0;
        if (share.pac > 0) {
            const pw = plan.pac.width;
            const rows = Math.max(1, Math.round(plan.strip.height / plan.pac.height));
            const rh = s.w / rows;
            const cols = Math.ceil(share.pac / rows);
            for (let c = 0; c < cols; c++) {
                for (let r = 0; r < rows; r++) {
                    if (c * rows + r >= share.pac)
                        break;
                    piece(at + c * pw, at + (c + 1) * pw, rh, -half + (r + 0.5) * rh + gap * (r - (rows - 1) / 2));
                }
                slot++;
            }
            at += cols * pw;
        }
        const rest = s.l - at;
        const n = Math.min(share.croissants, trianglesInStrip(rest, base, plan.croissant.cutStyle));
        if (plan.croissant.cutStyle === "diagonal") {
            for (let i = 0; i < n; i++) {
                const fx = at + base * Math.floor(i / 2);
                const up = i % 2 === 0;
                piece(fx, fx + base, s.w, 0, {
                    x0: fx,
                    x1: fx + base,
                    lo: up ? [-half, half] : [-half, -half],
                    hi: up ? [half, half] : [-half, half],
                });
                slot++;
            }
            at += base * Math.ceil(n / 2);
        }
        else {
            const h = base / 2;
            for (let i = 0; i < n; i++) {
                const fx = at + h * i;
                const tip = i % 2 === 0 ? -half : half;
                const edge = -tip;
                const away = Math.sign(tip) * gap * 2.5;
                piece(fx, fx + h, s.w, away, { x0: fx, x1: fx + h, lo: [edge, Math.min(tip, edge)], hi: [edge, Math.max(tip, edge)] });
                piece(fx + h, fx + 2 * h, s.w, away, { x0: fx + h, x1: fx + 2 * h, lo: [Math.min(tip, edge), edge], hi: [Math.max(tip, edge), edge] });
            }
            at += h * n + (n > 0 ? h : 0);
            slot++;
        }
        if (s.l - at > 0.05)
            piece(at, s.l, s.w, 0, undefined, 0.5 * part);
        return pieces.length
            ? { pieces, layers: p.b.layers, volume: vol(s), trim: null, nose: null }
            : whole();
    }
    const s = p.kind === "rotate" ? p.a : { ...p.b, l: lerp(p.a.l, p.b.l, u) };
    return {
        pieces: [{ ribbons: flatBlock(s, butterFrac, arcSeg, k, coarse), width: s.w, offset: { x: 0, y: 0, z: 0 }, fade: 0 }],
        layers,
        volume: vol(s),
        trim: null,
        nose: null,
    };
}
async function loadThree() {
    const three = await import(`${CDN}/build/three.webgpu.js`);
    const controls = await import(`${CDN}/examples/jsm/controls/OrbitControls.js`);
    return { T: three, OrbitControls: controls.OrbitControls };
}
const emptyMesh = () => ({ positions: [], lines: [] });
function extrude(r, w, dx, dy, dz, out, taper) {
    const zAt = (x) => {
        if (!taper)
            return [-w / 2 + dz, w / 2 + dz];
        const span = taper.x1 - taper.x0;
        const q = Math.min(1, Math.max(0, span > 1e-9 ? (x - taper.x0) / span : 0));
        return [lerp(taper.lo[0], taper.lo[1], q) + dz, lerp(taper.hi[0], taper.hi[1], q) + dz];
    };
    const quad = (ax, ay, az, bx, by, bz, cx, cy, cz, ex, ey, ez) => {
        out.positions.push(ax, ay, az, bx, by, bz, cx, cy, cz, ax, ay, az, cx, cy, cz, ex, ey, ez);
    };
    const n = Math.min(r.lo.length, r.hi.length);
    for (let i = 1; i < n; i++) {
        const l0 = r.lo[i - 1];
        const l1 = r.lo[i];
        const h0 = r.hi[i - 1];
        const h1 = r.hi[i];
        const [a0, a1] = zAt(l0.x);
        const [b0, b1] = zAt(l1.x);
        quad(l0.x + dx, (l0.y + dy), a0, l1.x + dx, (l1.y + dy), b0, l1.x + dx, (l1.y + dy), b1, l0.x + dx, (l0.y + dy), a1);
        quad(h0.x + dx, (h0.y + dy), a0, h1.x + dx, (h1.y + dy), b0, h1.x + dx, (h1.y + dy), b1, h0.x + dx, (h0.y + dy), a1);
        quad(l0.x + dx, (l0.y + dy), a0, l1.x + dx, (l1.y + dy), b0, h1.x + dx, (h1.y + dy), b0, h0.x + dx, (h0.y + dy), a0);
        quad(l0.x + dx, (l0.y + dy), a1, l1.x + dx, (l1.y + dy), b1, h1.x + dx, (h1.y + dy), b1, h0.x + dx, (h0.y + dy), a1);
    }
    for (const [a, b] of [
        [r.lo[0], r.hi[0]],
        [r.lo[n - 1], r.hi[n - 1]],
    ])
        if (a && b) {
            const [c0, c1] = zAt(a.x);
            quad(a.x + dx, a.y + dy, c0, b.x + dx, b.y + dy, c0, b.x + dx, b.y + dy, c1, a.x + dx, a.y + dy, c1);
        }
    const edge = (pts, side) => {
        for (let i = 1; i < pts.length; i++)
            out.lines.push(pts[i - 1].x + dx, pts[i - 1].y + dy, zAt(pts[i - 1].x)[side], pts[i].x + dx, pts[i].y + dy, zAt(pts[i].x)[side]);
    };
    for (const side of [0, 1]) {
        edge(r.lo, side);
        edge(r.hi, side);
    }
    if (r.lo[0] && r.hi[0]) {
        const [c0, c1] = zAt(r.lo[0].x);
        out.lines.push(r.lo[0].x + dx, r.lo[0].y + dy, c0, r.hi[0].x + dx, r.hi[0].y + dy, c0);
        out.lines.push(r.lo[0].x + dx, r.lo[0].y + dy, c1, r.hi[0].x + dx, r.hi[0].y + dy, c1);
    }
    const la = r.lo[n - 1];
    const ha = r.hi[n - 1];
    if (la && ha) {
        const [c0, c1] = zAt(la.x);
        out.lines.push(la.x + dx, la.y + dy, c0, ha.x + dx, ha.y + dy, c0);
        out.lines.push(la.x + dx, la.y + dy, c1, ha.x + dx, ha.y + dy, c1);
    }
}
const fill = (s, vals) => s.replace(/\{(\w+)\}/g, (_, k) => String(vals[k] ?? ""));
const cssVar = (name, fallback) => {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
};
export function threeView(plan, str, masses, stepTitle) {
    const phases = buildPhases(plan, str, masses).flatMap((q) => q.kind === "fold" ? [q, { ...q, kind: "relax", label: str.relief, dur: 1.3, a: q.b, b: q.b }] : [q]);
    const chapters = chaptersOf(phases);
    const butterFrac = butterFraction(plan);
    const exaggeration = exaggerationFor(phases);
    const planTrim = (() => {
        const st = plan.steps.find((x) => x.roll && x.trimmed && x.trimmed.l < x.roll.l - 1e-9);
        return st ? (st.roll.l - st.trimmed.l) / 2 : null;
    })();
    const total = phases.reduce((n, q) => n + q.dur, 0);
    const cutShare = plan.allocation.stripBreakdown.find((b) => b.strip === 1) ?? null;
    const noses = new Map();
    for (const q of phases)
        if (q.kind === "fold")
            noses.set(q.step, noseOf(q, butterFrac));
    const root = document.createElement("div");
    root.className = "three";
    const canvasBox = document.createElement("div");
    canvasBox.className = "threestage";
    const hud = document.createElement("div");
    hud.className = "threehud";
    const note = document.createElement("div");
    note.className = "threenote";
    canvasBox.append(hud, note);
    root.appendChild(canvasBox);
    const bar = document.createElement("div");
    bar.className = "animbar";
    const playBtn = document.createElement("button");
    playBtn.type = "button";
    playBtn.className = "animbtn";
    const scrub = document.createElement("input");
    scrub.type = "range";
    scrub.min = "0";
    scrub.max = "1000";
    scrub.value = "0";
    scrub.className = "animscrub";
    const caption = document.createElement("span");
    caption.className = "animcap";
    bar.append(playBtn, scrub, caption);
    const tools = document.createElement("div");
    tools.className = "threetools";
    const mk = (label, title) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "animbtn";
        b.textContent = label;
        b.title = title;
        tools.appendChild(b);
        return b;
    };
    const resetBtn = mk("⌂", str.resetView);
    const faceBtn = mk("▭", str.cutFace);
    const scaleBtn = mk("", str.scaleSwitch);
    bar.appendChild(tools);
    root.appendChild(bar);
    const chapterBar = document.createElement("div");
    chapterBar.className = "chapters";
    const chips = chapters.map((c) => {
        const step = plan.steps.find((x) => x.id === c.step);
        const b = document.createElement("button");
        b.type = "button";
        b.className = "chapter";
        const title = stepTitle(step);
        b.textContent = `${step.id}. ${c.kind === "prep" ? fill(str.prep, { step: title }) : title}`;
        b.title = str.chapter;
        chapterBar.appendChild(b);
        return b;
    });
    root.appendChild(chapterBar);
    let time = 0;
    let playing = false;
    let stopAt = null;
    let exaggerate = true;
    let raf = 0;
    let disposed = false;
    let frame = null;
    const paintScale = () => {
        scaleBtn.textContent = exaggerate ? fill(str.exaggerated, { k: exaggeration }) : str.trueScale;
    };
    paintScale();
    const paintPlay = () => {
        playBtn.textContent = playing ? "❙❙" : time >= total - 1e-6 ? "↺" : "▶";
        playBtn.title = playing ? str.pause : time >= total - 1e-6 ? str.replay : str.play;
    };
    const phaseAt = (tm) => {
        let left = tm;
        let i = 0;
        while (i < phases.length - 1 && left > phases[i].dur)
            left -= phases[i++].dur;
        const p = phases[i];
        return { p, u: ease(Math.min(1, Math.max(0, left / p.dur))) };
    };
    note.textContent = str.loading;
    loadThree()
        .then(async ({ T, OrbitControls }) => {
        if (disposed)
            return;
        const renderer = new T.WebGPURenderer({ antialias: true, alpha: true });
        await renderer.init();
        if (disposed)
            return;
        renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
        renderer.domElement.style.width = "100%";
        renderer.domElement.style.height = "auto";
        canvasBox.insertBefore(renderer.domElement, hud);
        renderer.domElement.title = str.drag;
        const scene = new T.Scene();
        const group = new T.Group();
        scene.add(group);
        const camera = new T.PerspectiveCamera(FOV, 1, 0.1, 4000);
        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.08;
        canvasBox.addEventListener("wheel", (e) => {
            if (!e.metaKey && !e.ctrlKey)
                e.stopPropagation();
        }, { capture: true });
        const doughColor = new T.Color(cssVar("--dough", "#e9d9b6"));
        const butterColor = new T.Color(cssVar("--butter", "#f6edcd"));
        const lineColor = new T.Color(cssVar("--line", "#3a3a42"));
        const mat = (c) => new T.MeshBasicMaterial({ color: c, transparent: true, side: T.DoubleSide });
        const doughMat = mat(doughColor);
        const butterMat = mat(butterColor);
        const lineMat = new T.LineBasicMaterial({ color: lineColor, transparent: true, opacity: 0.75 });
        const knifeMat = new T.MeshBasicMaterial({
            color: new T.Color(cssVar("--bad", "#e4645a")),
            transparent: true,
            opacity: 0.6,
            side: T.DoubleSide,
            depthWrite: false,
        });
        const buildGeom = (pos) => {
            const g = new T.BufferGeometry();
            g.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
            return g;
        };
        let built = [];
        const clear = () => {
            for (const o of built) {
                group.remove(o);
                o.geometry.dispose();
                if (o.material !== doughMat && o.material !== butterMat && o.material !== lineMat && o.material !== knifeMat)
                    o.material.dispose();
            }
            built = [];
        };
        const extents = (() => {
            const out = [];
            const SAMPLES = 160;
            for (let i = 0; i <= SAMPLES; i++) {
                const { p: q, u } = phaseAt((i / SAMPLES) * total);
                const sc = sceneAt(plan, q, u, butterFrac, 6, exaggeration, true);
                let x0 = Infinity;
                let x1 = -Infinity;
                let y0 = Infinity;
                let y1 = -Infinity;
                let z0 = Infinity;
                let z1 = -Infinity;
                for (const piece of sc.pieces) {
                    if (!piece.ribbons.length)
                        continue;
                    const bb = P.bounds(piece.ribbons);
                    x0 = Math.min(x0, bb.x0 + piece.offset.x);
                    x1 = Math.max(x1, bb.x1 + piece.offset.x);
                    y0 = Math.min(y0, bb.y0 + piece.offset.y);
                    y1 = Math.max(y1, bb.y1 + piece.offset.y);
                    z0 = Math.min(z0, -piece.width / 2 + piece.offset.z);
                    z1 = Math.max(z1, piece.width / 2 + piece.offset.z);
                }
                if (Number.isFinite(x0)) {
                    const hx = (x1 - x0) / 2;
                    const hz = (z1 - z0) / 2;
                    const wide = q.kind === "rotate" ? Math.max(hx, hz) : hx;
                    out.push({ hx: wide, hy: (y1 - y0) / 2, hz: q.kind === "rotate" ? wide : hz });
                }
            }
            return out.length ? out : [{ hx: 1, hy: 1, hz: 1 }];
        })();
        const VIEW_DIR = (() => {
            const d = [0.7, 0.5, 1];
            const m = Math.hypot(...d);
            return d.map((c) => c / m);
        })();
        let box = { x: 0, y: 0, z: 0, dx: 2 * extents[0].hx, dy: 1, dz: 2 * extents[0].hz };
        const home = () => {
            const [dx, dy, dz] = VIEW_DIR;
            const right = [dz, 0, -dx];
            const rm = Math.hypot(right[0], right[2]) || 1;
            right[0] /= rm;
            right[2] /= rm;
            const upv = [
                right[1] * dz - right[2] * dy,
                right[2] * dx - right[0] * dz,
                right[0] * dy - right[1] * dx,
            ];
            const tv = Math.tan((FOV * Math.PI) / 360);
            const th = tv * Math.max(1, camera.aspect || 2);
            let dist = 1;
            for (const e of extents)
                for (const sx of [-1, 1])
                    for (const sy of [-1, 1])
                        for (const sz of [-1, 1]) {
                            const p = [sx * e.hx, sy * e.hy, sz * e.hz];
                            const depth = p[0] * dx + p[1] * dy + p[2] * dz;
                            const r = Math.abs(p[0] * right[0] + p[1] * right[1] + p[2] * right[2]);
                            const up = Math.abs(p[0] * upv[0] + p[1] * upv[1] + p[2] * upv[2]);
                            dist = Math.max(dist, depth + Math.max(r / th, up / tv));
                        }
            dist *= 1.06;
            camera.position.set(dx * dist, dy * dist, dz * dist);
            controls.target.set(0, 0, 0);
            controls.update();
        };
        home();
        resetBtn.addEventListener("click", home);
        faceBtn.addEventListener("click", () => {
            const face = Math.max(box.dz, box.dy) / (2 * Math.tan((FOV * Math.PI) / 360));
            camera.position.set(box.dx / 2 + face * 1.15, 0, 0);
            controls.target.set(0, 0, 0);
            controls.update();
        });
        const resize = () => {
            const w = canvasBox.clientWidth || 800;
            const h = Math.max(260, Math.round(w * 0.46));
            if (renderer.domElement.width === w && renderer.domElement.height === h)
                return;
            renderer.setSize(w, h, false);
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
        };
        let drawn = null;
        const render = () => {
            const { p, u } = phaseAt(time);
            const k = exaggerate ? exaggeration : 1;
            const key = `${p.step}|${p.kind}|${u}|${k}`;
            if (key === drawn) {
                resize();
                controls.update();
                renderer.render(scene, camera);
                return;
            }
            drawn = key;
            const sc = sceneAt(plan, p, u, butterFrac, 28, k);
            clear();
            const dough = emptyMesh();
            const butter = emptyMesh();
            const faded = [];
            for (const piece of sc.pieces) {
                const out = piece.fade > 0.01 ? { dough: emptyMesh(), butter: emptyMesh(), fade: piece.fade } : null;
                for (const r of piece.ribbons) {
                    const bucket = out ? (r.kind === "butter" ? out.butter : out.dough) : r.kind === "butter" ? butter : dough;
                    extrude(r, piece.width, piece.offset.x, piece.offset.y, piece.offset.z, bucket, piece.taper);
                }
                if (out)
                    faded.push(out);
            }
            const add = (m, material, opacity) => {
                if (m.positions.length) {
                    let use = material;
                    if (opacity < 1) {
                        use = material.clone();
                        use.opacity = opacity;
                    }
                    const mesh = new T.Mesh(buildGeom(m.positions), use);
                    group.add(mesh);
                    built.push(mesh);
                }
                if (m.lines.length) {
                    let lm = lineMat;
                    if (opacity < 1) {
                        lm = lineMat.clone();
                        lm.opacity = 0.75 * opacity;
                    }
                    const ln = new T.LineSegments(buildGeom(m.lines), lm);
                    group.add(ln);
                    built.push(ln);
                }
            };
            add(dough, doughMat, 1);
            add(butter, butterMat, 1);
            for (const f of faded) {
                add(f.dough, doughMat, 1 - f.fade);
                add(f.butter, butterMat, 1 - f.fade);
            }
            if (sc.knife?.length) {
                const pos = [];
                const w = sc.pieces[0]?.width ?? 0;
                const half = 0.5 *
                    KNIFE_THICKNESS *
                    Math.max(0.08, sc.pieces.reduce((m, pc) => pc.ribbons.reduce((n2, r) => Math.max(n2, r.thickness), m), 0));
                const quad = (ax, ay, az, bx, by, bz, cx, cy, cz, dx2, dy2, dz2) => {
                    pos.push(ax, ay, az, bx, by, bz, cx, cy, cz);
                    pos.push(ax, ay, az, cx, cy, cz, dx2, dy2, dz2);
                };
                for (const kf of sc.knife) {
                    if (kf.bite <= 0.01)
                        continue;
                    const tip = lerp(kf.from, kf.to, kf.bite);
                    const [x0, x1] = kf.from < tip ? [kf.from, tip] : [tip, kf.from];
                    const [z0, z1] = [-w / 2 - 0.4, w / 2 + 0.4];
                    const [y0, y1] = [kf.y - half, kf.y + half];
                    quad(x0, y1, z0, x1, y1, z0, x1, y1, z1, x0, y1, z1);
                    quad(x0, y0, z0, x1, y0, z0, x1, y0, z1, x0, y0, z1);
                    quad(x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0);
                    quad(x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1);
                    const edge = kf.from < tip ? x1 : x0;
                    quad(edge, y0, z0, edge, y0, z1, edge, y1, z1, edge, y1, z0);
                }
                if (pos.length) {
                    const m = new T.Mesh(buildGeom(pos), knifeMat);
                    group.add(m);
                    built.push(m);
                }
            }
            let x0 = Infinity;
            let x1 = -Infinity;
            let y0 = Infinity;
            let y1 = -Infinity;
            let z0 = Infinity;
            let z1 = -Infinity;
            for (const piece of sc.pieces) {
                if (!piece.ribbons.length)
                    continue;
                const b = P.bounds(piece.ribbons);
                x0 = Math.min(x0, b.x0 + piece.offset.x);
                x1 = Math.max(x1, b.x1 + piece.offset.x);
                y0 = Math.min(y0, b.y0 + piece.offset.y);
                y1 = Math.max(y1, b.y1 + piece.offset.y);
                z0 = Math.min(z0, -piece.width / 2 + piece.offset.z);
                z1 = Math.max(z1, piece.width / 2 + piece.offset.z);
            }
            if (Number.isFinite(x0)) {
                box = { x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: (z0 + z1) / 2, dx: x1 - x0, dy: y1 - y0, dz: z1 - z0 };
            }
            group.position.set(-box.x, -box.y, -box.z);
            group.rotation.y = p.kind === "rotate" ? (Math.PI / 2) * u : 0;
            hud.textContent = "";
            const line = (text, cls = "") => {
                const d = document.createElement("div");
                if (cls)
                    d.className = cls;
                d.textContent = text;
                hud.appendChild(d);
            };
            line(`${p.step}. ${p.label}`, "hudstep");
            line(fill(str.layersLabel, { n: sc.layers }), "hudbig");
            if (drawnLayers(sc.layers) < sc.layers)
                line(fill(str.layersGrouped, { n: Math.round(sc.layers / drawnLayers(sc.layers)) }), "hudnose");
            line(fill(str.volumeLabel, { v: r1(sc.volume) }));
            note.textContent = exaggerate ? fill(str.scaleNote, { k: exaggeration }) : str.scaleTrue;
            if (sc.nose)
                line(fill(str.noseNote, { nose: r1(Math.max(sc.nose.ragged, sc.nose.round)) }), "hudnose");
            if (sc.relief) {
                line(str.reliefCut, "hudnose");
                line(fill(str.reliefDepth, {
                    cut: r1(Math.max(sc.relief.left, sc.relief.right)),
                    trim: planTrim === null ? "—" : r1(planTrim),
                }));
            }
            if (sc.trim !== null)
                line(fill(str.trimNote, { trim: r1(sc.trim) }), "hudnose");
            if (p.kind === "shape" && u > CUT_SHOWN && cutShare) {
                line(fill(str.share, { n: plan.strips, pac: cutShare.pac, cro: cutShare.croissants }), "hudnose");
                if (plan.strips > 1)
                    line(fill(str.shareAll, { pacAll: plan.allocation.pac, croAll: plan.allocation.croissants }));
            }
            resize();
            controls.update();
            renderer.render(scene, camera);
        };
        frame = (dt) => {
            if (playing) {
                time = Math.min(total, time + dt);
                if (stopAt !== null && time >= stopAt) {
                    time = stopAt;
                    playing = false;
                    stopAt = null;
                    paintPlay();
                }
                if (time >= total) {
                    playing = false;
                    paintPlay();
                }
                scrub.value = String(Math.round((time / total) * 1000));
            }
            render();
        };
        note.textContent = "";
        render();
    })
        .catch(() => {
        if (!disposed)
            note.textContent = str.unsupported;
    });
    playBtn.addEventListener("click", () => {
        if (time >= total - 1e-6)
            time = 0;
        playing = !playing;
        stopAt = null;
        paintPlay();
    });
    scrub.addEventListener("input", () => {
        time = (Number(scrub.value) / 1000) * total;
        playing = false;
        stopAt = null;
        paintPlay();
    });
    scaleBtn.addEventListener("click", () => {
        exaggerate = !exaggerate;
        paintScale();
    });
    chips.forEach((b, i) => {
        b.addEventListener("click", () => {
            time = chapters[i].from;
            stopAt = chapters[i].to;
            playing = true;
            paintPlay();
        });
    });
    paintPlay();
    let last = performance.now();
    let complained = false;
    const loop = (now) => {
        const dt = Math.min(0.1, (now - last) / 1000);
        last = now;
        const { p } = phaseAt(time);
        const i = chapterAt(chapters, time);
        chips.forEach((b, k) => b.classList.toggle("on", k === i));
        caption.textContent = `${p.step}. ${p.label}`;
        try {
            frame?.(dt);
        }
        catch (e) {
            if (!complained) {
                complained = true;
                console.error("3D view: a frame failed; the animation keeps running", e);
            }
        }
        raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return {
        node: root,
        destroy() {
            disposed = true;
            cancelAnimationFrame(raf);
            frame = null;
            root.remove();
        },
    };
}
