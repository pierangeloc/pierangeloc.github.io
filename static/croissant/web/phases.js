import { wrapSandwich } from "../lamination.js";
export const lerp = (a, b, u) => a + (b - a) * u;
export const ease = (u) => (u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2);
export const r1 = (x) => Math.round(x * 10) / 10;
export const snap = (d, layers) => ({ w: d.w, l: d.l, t: d.t, layers });
export const isPackage = (p) => p.kind === "appear" || p.kind === "place" || p.kind === "wrap";
export function phasesOf(s, layersBefore, layersAfter, str) {
    const out = [];
    const push = (kind, label, dur, a, b, extra = {}) => out.push({ step: s.id, kind, label, dur, a, b, pieces: 1, cutAcross: true, gA: 0, gB: 0, nA: 1, nB: 1, ...extra });
    if (s.kind === "package") {
        const sheet = snap(s.roll, 1);
        push("appear", str.roll, 1.2, { ...sheet, l: sheet.l * 0.45, t: sheet.t * 2.2 }, sheet);
        push("place", str.place, 0.9, sheet, sheet);
        push("wrap", str.wrap, 1.3, sheet, snap(s.result, 1));
        return out;
    }
    const from = snap(s.from, layersBefore);
    if (s.roll)
        push("roll", str.roll, 1.4, from, snap(s.roll, layersBefore));
    if (s.trimmed && s.roll && s.trimmed.l < s.roll.l - 1e-9)
        push("trim", str.trim, 0.8, snap(s.roll, layersBefore), snap(s.trimmed, layersBefore));
    const start = s.trimmed ?? s.roll ?? s.from;
    if (s.kind === "final") {
        push("shape", str.shape, 2.4, snap(start, layersAfter), snap(s.result, layersAfter));
    }
    else if (s.pieces > 1) {
        const across = s.result.w < s.from.w - 1e-9;
        push("cut", str.cut, 1.3, snap(s.from, layersBefore), snap(s.from, layersBefore), {
            pieces: s.pieces,
            cutAcross: across,
        });
        push("focus", str.keep, 1.0, snap(s.from, layersBefore), snap(s.result, layersBefore), {
            pieces: s.pieces,
            cutAcross: across,
        });
    }
    else if (s.result) {
        const n = Math.round(layersAfter / layersBefore);
        const folded = { w: start.w, l: start.l / n, t: s.result.t };
        push("fold", `${str.fold} ${n}`, 1.2, snap(start, layersBefore), snap(folded, layersAfter), { pieces: n });
    }
    return out;
}
function grams(s, plan, masses, dough) {
    const v = s.w * s.l * s.t;
    if (!dough)
        return v * plan.rhoLaminate;
    const vDough = plan.doughSheet.w * plan.doughSheet.l * plan.doughSheet.t;
    return (v / vDough) * masses.dough;
}
export const turned = (a, d) => Math.abs(a.w - d.l) < 1e-6 && Math.abs(a.l - d.w) < 1e-6 && Math.abs(d.w - d.l) > 1e-6;
export function buildPhases(plan, str, masses) {
    const out = [];
    let layers = 1;
    for (const s of plan.steps) {
        const bench = out[out.length - 1]?.b;
        if (bench && s.from && turned(bench, s.from))
            out.push({
                step: s.id,
                kind: "rotate",
                label: str.rotate,
                dur: 0.9,
                a: bench,
                b: { ...bench, w: bench.l, l: bench.w },
                pieces: 1,
                cutAcross: true,
                gA: 0,
                gB: 0,
                nA: 1,
                nB: 1,
            });
        const next = s.kind !== "package" && s.roll && s.result ? layers * Math.round(s.result.t / s.roll.t) : layers;
        out.push(...phasesOf(s, layers, next, str));
        layers = next;
    }
    for (const q of out) {
        const doughOnly = q.kind === "appear" || q.kind === "place";
        q.gA = grams(q.a, plan, masses, doughOnly);
        q.gB = grams(q.b, plan, masses, doughOnly);
    }
    const appear = out.find((q) => q.kind === "appear");
    if (appear) {
        appear.gA = masses.dough;
        appear.gB = masses.dough;
    }
    let batch = 1;
    for (const q of out) {
        q.nA = batch;
        if (q.kind === "focus")
            batch *= q.pieces;
        q.nB = batch;
    }
    const place = out.find((q) => q.kind === "place");
    if (place)
        place.gB = masses.dough + masses.butter;
    const wrap = out.find((q) => q.kind === "wrap");
    if (wrap)
        wrap.gA = masses.dough + masses.butter;
    return out;
}
const isGesture = (p) => p.kind === "wrap" || p.kind === "fold" || p.kind === "cut" || p.kind === "shape";
export function chaptersOf(phases) {
    const out = [];
    let at = 0;
    let step = "";
    let gesture = false;
    for (const q of phases) {
        if (q.step !== step) {
            step = q.step;
            gesture = false;
        }
        if (isGesture(q))
            gesture = true;
        const kind = gesture ? "main" : "prep";
        const last = out[out.length - 1];
        if (last && last.step === q.step && last.kind === kind)
            last.to = at + q.dur;
        else
            out.push({ step: q.step, kind, from: at, to: at + q.dur });
        at += q.dur;
    }
    return out;
}
export function chapterAt(chapters, time) {
    const i = chapters.findIndex((c) => time < c.to - 1e-9);
    return i < 0 ? chapters.length - 1 : i;
}
export const butterFraction = (plan) => {
    const s = wrapSandwich(plan);
    return s.butter / s.total;
};
