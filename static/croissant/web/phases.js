// What happens to the block, step by step, as a flat list of phases — shared by the two
// views so neither can disagree with the other or with `Plan.steps`.
//
// It was all inside `anim.ts` first; the 3D view needs the same phases (and above all the
// same layer count, which the plan does not carry), so it lives here instead of being
// written a second time. Nothing in this module touches the DOM.
import { wrapSandwich } from "../lamination.js";
export const lerp = (a, b, u) => a + (b - a) * u;
/** Ease in/out: the dough does not start and stop abruptly. */
export const ease = (u) => (u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2);
export const r1 = (x) => Math.round(x * 10) / 10;
export const snap = (d, layers) => ({ w: d.w, l: d.l, t: d.t, layers });
/** Whether a phase belongs to the package — the one step drawn layer by layer, where the
 *  dough and the slab are still separate things. These three kinds happen nowhere else, so
 *  no view has to know which number the package step carries. */
export const isPackage = (p) => p.kind === "appear" || p.kind === "place" || p.kind === "wrap";
/** The phases of one step, in the order the hands do them. */
export function phasesOf(s, layersBefore, layersAfter, str) {
    const out = [];
    const push = (kind, label, dur, a, b, extra = {}) => out.push({ step: s.id, kind, label, dur, a, b, pieces: 1, cutAcross: true, gA: 0, gB: 0, nA: 1, nB: 1, ...extra });
    if (s.kind === "package") {
        // The butter slab is already laminated and keeps its size; the dough is rolled to twice
        // its length, the slab goes in the middle, and the two outer flaps fold over it until
        // they meet in the centre and cover it exactly.
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
        push("shape", str.shape, 1.2, snap(start, layersAfter), snap(s.result, layersAfter));
    }
    else if (s.pieces > 1) {
        // A cut: the block keeps its size, the pieces come apart. Which way the knife goes
        // follows from which side shrank.
        const across = s.result.w < s.from.w - 1e-9;
        push("cut", str.cut, 1.3, snap(s.from, layersBefore), snap(s.from, layersBefore), {
            pieces: s.pieces,
            cutAcross: across,
        });
        // You carry on with one piece and the rest go in the fridge; without this the next
        // step would start on a block that silently changed size.
        push("focus", str.keep, 1.0, snap(s.from, layersBefore), snap(s.result, layersBefore), {
            pieces: s.pieces,
            cutAcross: across,
        });
    }
    else if (s.result) {
        // The panels come down along the length that was just rolled, so the block ends as wide
        // as it was and as long as one panel. The plan sometimes names that same block the other
        // way round, because the turn before the next roll-out is already folded into its
        // numbers; the turn is a gesture of its own and buildPhases puts it where it happens.
        const n = Math.round(layersAfter / layersBefore);
        const folded = { w: start.w, l: start.l / n, t: s.result.t };
        push("fold", `${str.fold} ${n}`, 1.2, snap(start, layersBefore), snap(folded, layersAfter), { pieces: n });
    }
    return out;
}
/** What a block of these dimensions weighs. Before the butter is on it is dough at its own
 *  density; from the package onwards everything is laminate, dough and butter together. */
function grams(s, plan, masses, dough) {
    const v = s.w * s.l * s.t;
    if (!dough)
        return v * plan.rhoLaminate;
    const vDough = plan.doughSheet.w * plan.doughSheet.l * plan.doughSheet.t;
    return (v / vDough) * masses.dough;
}
/** Two dimensions that are each other's, swapped: the block has been given a quarter turn. */
export const turned = (a, d) => Math.abs(a.w - d.l) < 1e-6 && Math.abs(a.l - d.w) < 1e-6 && Math.abs(d.w - d.l) > 1e-6;
export function buildPhases(plan, str, masses) {
    const out = [];
    let layers = 1;
    for (const s of plan.steps) {
        // A step that starts on the block the other way round is a step you turned the block
        // for. Reading the turn off the dimensions, instead of off the rotate90 flag, puts it
        // where the hands do it — after the cut, not before — and the orientation then carries
        // through the rest of the step instead of being undone by the next phase.
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
        // A fold multiplies the layers by its own count, which is the block thickness divided
        // by the sheet it was rolled to: step 1 by foldA, step 3 by foldB. Step 0 is a wrap,
        // not a fold — the butter is still one layer.
        const next = s.kind !== "package" && s.roll && s.result ? layers * Math.round(s.result.t / s.roll.t) : layers;
        out.push(...phasesOf(s, layers, next, str));
        layers = next;
    }
    // The dough is alone on the bench until the slab goes on; after that it is all laminate.
    for (const q of out) {
        const doughOnly = q.kind === "appear" || q.kind === "place";
        q.gA = grams(q.a, plan, masses, doughOnly);
        q.gB = grams(q.b, plan, masses, doughOnly);
    }
    // The first roll-out only spreads the dough; it does not make more of it.
    const appear = out.find((q) => q.kind === "appear");
    if (appear) {
        appear.gA = masses.dough;
        appear.gB = masses.dough;
    }
    // A split multiplies the batch: from there on, every step is done once per piece. The
    // counter keeps the total honest — 2078 g ×2 is the same 4156 g that went into the cut.
    let batch = 1;
    for (const q of out) {
        q.nA = batch;
        if (q.kind === "focus")
            batch *= q.pieces;
        q.nB = batch;
    }
    // Placing the slab is the one moment mass arrives rather than leaves.
    const place = out.find((q) => q.kind === "place");
    if (place)
        place.gB = masses.dough + masses.butter;
    const wrap = out.find((q) => q.kind === "wrap");
    if (wrap)
        wrap.gA = masses.dough + masses.butter;
    return out;
}
/** The phase a step is named after. Everything a step does before this one is preparation:
 *  you are not yet folding in 4, you are getting the block ready to be folded in 4. */
const isGesture = (p) => p.kind === "wrap" || p.kind === "fold" || p.kind === "cut" || p.kind === "shape";
/** The chapters a step is watched in: the preparation and then the gesture itself, so the
 *  fold can be replayed without sitting through the roll-out that leads to it. Both views use
 *  the same cuts. */
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
/** Which chapter a moment falls in. The boundaries are half-open, so a time sitting exactly
 *  on one belongs to the chapter that is starting, not to the one that just ended. */
export function chapterAt(chapters, time) {
    const i = chapters.findIndex((c) => time < c.to - 1e-9);
    return i < 0 ? chapters.length - 1 : i;
}
/** Butter's share of the block's thickness, invariant from the package onwards: rolling
 *  thins dough and butter alike, folding multiplies both. */
export const butterFraction = (plan) => {
    const s = wrapSandwich(plan);
    return s.butter / s.total;
};
