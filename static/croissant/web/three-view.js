// The 3D view of the block: the butter layers you can count, and the volume that never
// changes. It answers *where does the butter go*, which is the one question the flat view
// cannot — its edge view is deliberately out of scale. See docs/3d-view.md.
//
// Everything here is a diagram, not a render: no lights, no shading, no material response.
// Roundness comes from silhouette and line work alone, because a lit picture would suggest a
// realism the model does not have.
//
// It shares `phases.ts` with the flat view (so the two can never disagree about what happens
// when, or about how many layers there are) and takes all its geometry from `profile.ts`.
// It must not import `anim.ts`, and `anim.ts` must not import it.
import { buildPhases, butterFraction, chapterAt, chaptersOf, ease, lerp, r1 } from "./phases.js";
import * as P from "./profile.js";
const THREE_VERSION = "0.180.0";
const CDN = `https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}`;
/** Vertical exaggeration, at most. 12 layers of 1 mm in a 60 cm sheet are invisible at true
 *  scale, which is exactly why the toggle exists: one declared factor, named in the frame.
 *
 *  It cannot be picked freely. The crease radius is the thickness of the stack being bent, so
 *  thickening the sheet thickens the corners too, and past a point a fold in 4 has no straight
 *  left between its creases and rolls up like a scroll instead. `exaggerationFor` takes the
 *  largest factor that leaves every fold in the run reading as a fold — one number for the
 *  whole run, as the design note asks, derived rather than guessed. */
const EXAGGERATION_MAX = 8;
/** How much the layers drag each other round a crease instead of each keeping its own length.
 *  An inextensible ribbon model (0) leaves the outer layers centimetres short of the inner
 *  ones, which draws as single layers sliding off on their own and as tongues of sheet left
 *  pointing into the air mid-fold — neither of which happens to dough. Dough stretches, and
 *  the layers in a fold come round together.
 *
 *  **An estimate, not a measurement** (CLAUDE.md), and an explicit one rather than a quiet
 *  fudge of the geometry: 0.9 leaves a tenth of the ribbon model's raggedness, which is still
 *  a visible nose to cut and still the number the frame prints. See `P.ribbons`. */
const LAYER_ELASTICITY = 0.9;
/** The camera's vertical field of view, in degrees. The framing is derived from it, so the
 *  two cannot drift apart. */
const FOV = 42;
/** The clearance at the heart of a closed fold, as a multiple of the thickest layer's
 *  half-thickness — the room the dough is stretched to make (see `P.openNoses`). 1 is the least
 *  that keeps the innermost layer from being turned inside out; above that it is just a bigger
 *  eye at the fold. */
const NOSE_OPENING = 1.2;
/** The clearance in cm for a given sandwich: derived from the layers themselves, so it is
 *  whatever those layers need and not a number anyone picked. */
const noseOpening = (slabs) => NOSE_OPENING * 0.5 * slabs.reduce((m, sl) => Math.max(m, sl.to - sl.from), 0);
/** How far the dough springs apart along a relief cut, as a multiple of the thickest layer: the
 *  gap is nothing where the knife stopped and this wide at the end of the block. Licence, like
 *  `NOSE_OPENING`, and the reason the cut can be seen at all. */
const CUT_GAP = 0.35;
const cutGap = (slabs) => CUT_GAP * slabs.reduce((m, sl) => Math.max(m, sl.to - sl.from), 0);
/** How much further out the end face lands once a closed fold has been laid down, as a multiple
 *  of the thickest layer: the "push it a bit further out" of Pierangelo's sketch (20 October
 *  2026). The rest of where the face lands is derived — the fold's own outermost radius — so
 *  this is only the overshoot, and licence like `CUT_GAP`. See `P.flattenNoses`. */
const RELIEF_PUSH = 0.5;
const reliefPush = (slabs) => RELIEF_PUSH * slabs.reduce((m, sl) => Math.max(m, sl.to - sl.from), 0);
/** How thick the knife is drawn, as a fraction of the thickest layer. A hairline is invisible —
 *  WebGL ignores line widths — and a slab hides the dough it is cutting; a third of a layer
 *  reads as a blade at any zoom. */
const KNIFE_THICKNESS = 0.35;
/** How much of a panel has to still be straight once its creases have eaten into it. Below
 *  about half, a fold stops reading as a fold and starts reading as a scroll: the panels are
 *  all curve and the block comes out as two spirals with a bridge between them. */
const PANEL_STRAIGHT_SHARE = 0.5;
/** The largest honest factor. Two things break if it is too big, and both are about the
 *  creases. The first is decisive: a crease spends `π·r` of the sheet, and `foldSegments`
 *  takes half of each neighbouring arc out of the straight beside it, so a panel next to the
 *  **spine** of a book fold — which bends at `(n−1)·t/2`, not `t/2` — loses `π·n·t/4` of
 *  itself. Blow the thickness up far enough and there is nothing left of the panel but the
 *  two arcs, which is exactly the scroll. The second is the raggedness: for a book fold, whose
 *  creases all turn the same way, the ends can come out more ragged than the panel is long — though with the layers elastic this barely bites now.
 *  Both limits scale with the drawn thickness, so both have to be in here; the alternative is
 *  a picture that contradicts itself. */
function exaggerationFor(phases) {
    let k = EXAGGERATION_MAX;
    for (const q of phases) {
        if (q.kind !== "fold" || q.pieces < 2 || q.a.t <= 0)
            continue;
        const panel = q.a.l / q.pieces;
        // What the creases eat out of the worst panel, per cm of drawn thickness.
        const cs = P.creases(q.pieces, q.a.l, 1);
        let eaten = 0;
        for (let j = 0; j < q.pieces; j++) {
            const before = cs[j - 1] ? (Math.PI * cs[j - 1].r) / 2 : 0;
            const after = cs[j] ? (Math.PI * cs[j].r) / 2 : 0;
            eaten = Math.max(eaten, before + after);
        }
        k = Math.min(k, (panel * (1 - PANEL_STRAIGHT_SHARE)) / (eaten * q.a.t));
        // Each crease costs the outermost layer about π·t/2 and, in a book fold, they add up.
        const creases = q.pieces - 1;
        const ragged = (P.foldStyle(q.pieces) === "book" ? creases : 1) * (1 - LAYER_ELASTICITY);
        if (ragged > 0)
            k = Math.min(k, panel / (2 * ragged * Math.PI * (q.a.t / 2)));
    }
    return Math.max(1, Math.round(k * 10) / 10);
}
/** The sandwich of a block, with the thickness blown up by the declared factor. The
 *  exaggeration is applied *inside* the cross-section, not by scaling the finished picture:
 *  scaling a bent stack vertically would turn a crease into an ellipse, and a panel standing
 *  up mid-fold into a tongue eight times too tall. Thicken the layers and the arcs that carry
 *  them instead, and every angle in the fold stays the one the hands make. */
const sandwichOf = (s, butterFrac, k, coarse = false) => {
    const sl = P.slabs(s.t * k, drawnLayers(s.layers), butterFrac);
    // For the camera's framing only the outermost layers matter: every other one is inside
    // them by construction, because each is walked along its own concentric offset. Building
    // five hundred ribbons a hundred and sixty times over to arrive at the same box is what
    // would otherwise make a deep block take seconds to open. (The clearance at the heart of a
    // fold is read off the thickest layer, and a coarse stack has no butter slab to offer, so
    // the box can come out a hair generous — which only ever frames a little wider.)
    return coarse && sl.length > 2 ? [sl[0], sl[sl.length - 1]] : sl;
};
/** How many butter layers the view draws one at a time. Twelve are a picture you can count;
 *  thirty-six still are. Seven hundred and twenty-nine are a grey block whose geometry costs
 *  sixteen megabytes a frame, and no amount of zoom makes them countable, because at that
 *  depth a layer is thinner than the line that would draw it.
 *
 *  Past the cap the stack is drawn as **bands**, each standing for the same number of real
 *  layers. The butter keeps its share of the thickness, so the picture is still honest about
 *  where the butter is and how much of it there is; there are simply fewer lines in it than
 *  the plan counts, and the frame says exactly how many each line stands for. Licence, named,
 *  like `CUT_GAP` and `RELIEF_PUSH`. */
const MAX_DRAWN_LAYERS = 48;
/** The largest number of bands within the cap that divides the layers evenly, so no band
 *  stands for more of the block than its neighbour. A fold plan multiplies 2s, 3s and 4s, so
 *  there is always a good divisor to find. */
function drawnLayers(layers) {
    if (layers <= MAX_DRAWN_LAYERS)
        return layers;
    for (let m = MAX_DRAWN_LAYERS; m > 1; m--)
        if (layers % m === 0)
            return m;
    return MAX_DRAWN_LAYERS;
}
/** Clips every ribbon to `x0..x1`, which is what the margin's cut plane does. */
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
/** A flat block: one straight run, every layer the same length. */
function flatBlock(s, butterFrac, arcSeg, k, coarse = false) {
    return P.ribbons([{ kind: "line", len: s.l }], sandwichOf(s, butterFrac, k, coarse), s.t * k, s.l, arcSeg);
}
/** The cross-section of step 0. The dough sheet is twice the butter, so the slab covers its
 *  middle **half** and the two flaps left over are half a butter-length each: put side by
 *  side they cover the slab exactly, which is what makes the package come out as long as the
 *  butter and three layers thick.
 *
 *  The flaps are **cut off and laid on top**, not folded over: that is how it is done on the
 *  bench (Pierangelo, 20 October 2026), and it is why the top of the package has a seam in
 *  the middle rather than two hinges at the ends. The plan's own step text still says to fold
 *  them — see docs/roadmap.md, it is an open question for the model, not for the picture. */
function wrapPieces(plan, u, kind, k) {
    const sheet = plan.doughSheet;
    const butter = plan.butterSheet;
    const half = butter.length; // the slab's footprint, half the dough sheet
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
    // The dough under the butter stays put; the flaps are the two ends.
    const middle = strip(half, "dough", td, flap, 0);
    const slab = kind === "appear" ? [] : strip(half, "butter", tb, flap, td);
    // Cut, lift, carry inwards, land: the flap rises clear of the slab, moves in by its own
    // length and comes down on top, meeting its twin in the middle. Nothing bends.
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
/** The noses a fold leaves, measured on the real thickness: the numbers in the frame are cm
 *  of dough, never cm of the picture. */
function noseOf(p, butterFrac) {
    // Measured the same way the relief cuts measure it, and on the same real thickness, so the
    // two beats cannot quote different numbers for the same distance.
    const segs = P.foldSegments(p.pieces, p.a.l, p.a.t, 1, undefined, 1);
    const start = P.anchoredStart(segs, P.foldAnchor(segs, p.pieces));
    const slabs = P.slabs(p.a.t, drawnLayers(p.a.layers), butterFrac);
    const rs = P.openNoses(P.ribbons(segs, slabs, p.a.t, P.materialLength(segs), 16, LAYER_ELASTICITY, start), P.creaseCentres(segs, start), noseOpening(slabs));
    const ends = P.curvedEnds(rs);
    return { ragged: 0, round: Math.max(ends.left, ends.right) };
}
/** The block at time `u` inside phase `p`: this is where every gesture is turned into a
 *  cross-section. Volume is read off the dimensions the plan gives, never invented here. */
function sceneAt(plan, p, u, butterFrac, arcSeg, k, coarse = false) {
    const step = plan.steps.find((s) => s.id === p.step);
    const layers = u < 0.5 ? p.a.layers : p.b.layers;
    const vol = (s) => s.w * s.l * s.t;
    if (p.step === "0") {
        const pieces = wrapPieces(plan, u, p.kind, k);
        return { pieces, layers: 1, volume: vol(p.b), trim: null, nose: null };
    }
    if (p.kind === "roll") {
        // Several squeezes, not one: the thickness walks down `thicknessPath` and the length
        // follows from the volume, which is how the model builds it (L = V/(W·t)).
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
        // The margin: the only moment anything leaves the block, so it has to be seen leaving.
        // The planes go through the ends the previous fold left: they are ragged because the outer layers
        // came up short, and that raggedness is part of what the margin squares up.
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
        // Held where the hands hold it: the central half of a book fold while its two quarters come
        // up, then the half that stays down while the other shuts over it.
        const start = P.anchoredStart(segs, P.foldAnchor(segs, n, style));
        const slabs = sandwichOf(p.a, butterFrac, k, coarse);
        const rs = P.openNoses(P.ribbons(segs, slabs, p.a.t * k, P.materialLength(segs), arcSeg, LAYER_ELASTICITY, start), P.creaseCentres(segs, start), noseOpening(slabs));
        return {
            pieces: [{ ribbons: rs, width: p.a.w, offset: { x: 0, y: 0, z: 0 }, fade: 0 }],
            layers,
            volume: vol(p.a),
            trim: null,
            // The nose is printed in real cm, so it is measured on the real thickness, not on the
            // exaggerated one that is only there to be seen.
            nose: noseOf(p, butterFrac),
        };
    }
    if (p.kind === "relax") {
        // The relief cuts — *tagli di sfogo*. Not the margin, and **nothing leaves the block**
        // (Pierangelo, 20 October 2026): the knife goes in **horizontally**, at the height each
        // closed fold turns about, so the layers that were wrapped round the fold are free to lie
        // down and the tension in them goes. What you see is the rounded surface at each end
        // becoming flat and falling into line with the dough it was continuous with — slowly, over
        // the whole beat — with the length, the volume and the mass all exactly as they were, and
        // the straight middle of the block never moving at all.
        //
        // The block this beat starts from is the fold's result, so the sheet that was folded was
        // `n` times as long and `n` times thinner.
        const n = p.pieces;
        const sheet = { ...p.a, t: p.a.t / n, l: p.a.l * n, layers: p.a.layers / n };
        // The knife first, then the dough: the cut has to exist before anything can give way, so
        // the first third of the beat is the blade going in and the rest is the release.
        const bite = ease(Math.min(1, u * 3));
        const give = ease(Math.max(0, (u - 1 / 3) * 1.5));
        // And the room goes back as the dough lets go. The fold was given room — the panels kept
        // their full length and the creases were added on top, so that the layers could get round
        // each other without crossing — and that left the block half as long again as the plan says
        // it is, with the fold's eye standing open at the end of it. The relief cut is where the
        // dough gives it back: at `give` = 1 the creases are paid for out of the panels again, so
        // the block measures exactly what the next step rolls, and the eye has closed. Nothing
        // crosses on the way, because the noses are being laid flat over the same beat.
        const segs = P.foldSegments(n, sheet.l, sheet.t * k, 1, P.foldStyle(n), 1 - give);
        const start = P.anchoredStart(segs, P.foldAnchor(segs, n));
        const centres = P.creaseCentres(segs, start);
        const slabs = sandwichOf(sheet, butterFrac, k, coarse);
        // The eye at the heart of the fold goes as the cut lets the dough down: it was the room the
        // dough was stretched to leave *while being folded*, and the knife has just taken the reason
        // for it away. It has to go, and not only at the fold itself: `openNoses` bulges the panels
        // for `reach` either side of a crease, and a bulge left behind while the nose goes flat
        // draws as a long funnel narrowing to the knife's tip. Fading it with `give` leaves the
        // panels straight and the severed faces touching, which is what a relieved fold looks like.
        const closed = P.openNoses(P.ribbons(segs, slabs, sheet.t * k, P.materialLength(segs), arcSeg, LAYER_ELASTICITY, start), centres, noseOpening(slabs) * (1 - give));
        const cuts = P.cutsOf(centres, P.bounds(closed));
        // Lay the noses down first, then part: each rounded end goes flat — the half-circle
        // cancelled progressively from the panel end and pushed a bit further out, until the end of
        // the block is a square face — and the two stacks either side of each cut spring open.
        const rs = P.openCuts(P.flattenNoses(closed, cuts, give, reliefPush(slabs)), cuts, cutGap(slabs), give);
        const b = P.bounds(rs);
        // How deep the fold is still closed, measured on the **real** thickness: that is how far
        // the knife has to reach, and it is the number worth printing.
        const trueSegs = P.foldSegments(n, sheet.l, sheet.t, 1, undefined, 1);
        const trueStart = P.anchoredStart(trueSegs, P.foldAnchor(trueSegs, n));
        const trueSlabs = P.slabs(sheet.t, drawnLayers(sheet.layers), butterFrac);
        const real = P.curvedEnds(P.openNoses(P.ribbons(trueSegs, trueSlabs, sheet.t, P.materialLength(trueSegs), arcSeg, LAYER_ELASTICITY, trueStart), P.creaseCentres(trueSegs, trueStart), noseOpening(trueSlabs)));
        return {
            pieces: [{ ribbons: rs, width: p.a.w, offset: { x: 0, y: 0, z: 0 }, fade: 0 }],
            // Where the knife goes in: horizontally, at the centre of each closed fold, in from
            // whichever end that fold is at and as far as its own centre.
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
            // You carry on with the first piece; the others walk off to the fridge, and the one
            // you keep comes back to the centre so the next step does not start on a block that
            // silently changed place.
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
    // rotate and shape: one block, the turn is applied to the whole group by the caller.
    const s = p.kind === "rotate" ? p.a : { ...p.b, l: lerp(p.a.l, p.b.l, u) };
    return {
        pieces: [{ ribbons: flatBlock(s, butterFrac, arcSeg, k, coarse), width: s.w, offset: { x: 0, y: 0, z: 0 }, fade: 0 }],
        layers,
        volume: vol(s),
        trim: null,
        nose: null,
    };
}
// ---------------------------------------------------------------------------
// Rendering. Everything above is plain geometry and could be tested in node;
// everything below needs a canvas.
/** three.js comes from a CDN, never npm, and only when the tab is opened: the page has to
 *  stay useful when it cannot be loaded at all. The specifier is a variable on purpose, so
 *  `tsc` leaves the import alone instead of trying to resolve a URL. */
async function loadThree() {
    const three = await import(/* @vite-ignore */ `${CDN}/build/three.webgpu.js`);
    const controls = await import(/* @vite-ignore */ `${CDN}/examples/jsm/controls/OrbitControls.js`);
    return { T: three, OrbitControls: controls.OrbitControls };
}
const emptyMesh = () => ({ positions: [], lines: [] });
/** Extrudes one ribbon across the width: two faces, two sides, two end caps, and the edge
 *  lines that make a curve read as a curve. Profile extrusion rather than deformed meshes —
 *  a 12-layer block is 25 ribbons, so rebuilding it from the path every frame is affordable
 *  and much simpler than animating vertices. */
function extrude(r, w, dx, dy, dz, out) {
    const z0 = -w / 2 + dz;
    const z1 = w / 2 + dz;
    const quad = (ax, ay, az, bx, by, bz, cx, cy, cz, ex, ey, ez) => {
        out.positions.push(ax, ay, az, bx, by, bz, cx, cy, cz, ax, ay, az, cx, cy, cz, ex, ey, ez);
    };
    const n = Math.min(r.lo.length, r.hi.length);
    for (let i = 1; i < n; i++) {
        const l0 = r.lo[i - 1];
        const l1 = r.lo[i];
        const h0 = r.hi[i - 1];
        const h1 = r.hi[i];
        // the two faces
        quad(l0.x + dx, (l0.y + dy), z0, l1.x + dx, (l1.y + dy), z0, l1.x + dx, (l1.y + dy), z1, l0.x + dx, (l0.y + dy), z1);
        quad(h0.x + dx, (h0.y + dy), z0, h1.x + dx, (h1.y + dy), z0, h1.x + dx, (h1.y + dy), z1, h0.x + dx, (h0.y + dy), z1);
        // the two cut faces, where the layers are counted
        quad(l0.x + dx, (l0.y + dy), z0, l1.x + dx, (l1.y + dy), z0, h1.x + dx, (h1.y + dy), z0, h0.x + dx, (h0.y + dy), z0);
        quad(l0.x + dx, (l0.y + dy), z1, l1.x + dx, (l1.y + dy), z1, h1.x + dx, (h1.y + dy), z1, h0.x + dx, (h0.y + dy), z1);
    }
    // end caps
    for (const [a, b] of [
        [r.lo[0], r.hi[0]],
        [r.lo[n - 1], r.hi[n - 1]],
    ])
        if (a && b)
            quad(a.x + dx, a.y + dy, z0, b.x + dx, b.y + dy, z0, b.x + dx, b.y + dy, z1, a.x + dx, a.y + dy, z1);
    // Line work: each layer's edge on both cut faces, so the curve at a crease is a curve and
    // the layer count is readable with the camera close in.
    const edge = (pts, z) => {
        for (let i = 1; i < pts.length; i++)
            out.lines.push(pts[i - 1].x + dx, pts[i - 1].y + dy, z, pts[i].x + dx, pts[i].y + dy, z);
    };
    for (const z of [z0, z1]) {
        edge(r.lo, z);
        edge(r.hi, z);
    }
    if (r.lo[0] && r.hi[0]) {
        out.lines.push(r.lo[0].x + dx, r.lo[0].y + dy, z0, r.hi[0].x + dx, r.hi[0].y + dy, z0);
        out.lines.push(r.lo[0].x + dx, r.lo[0].y + dy, z1, r.hi[0].x + dx, r.hi[0].y + dy, z1);
    }
    const la = r.lo[n - 1];
    const ha = r.hi[n - 1];
    if (la && ha) {
        out.lines.push(la.x + dx, la.y + dy, z0, ha.x + dx, ha.y + dy, z0);
        out.lines.push(la.x + dx, la.y + dy, z1, ha.x + dx, ha.y + dy, z1);
    }
}
/** The same {placeholder} filling as the rest of the page, kept local so this module stays
 *  independent of i18n.ts. */
const fill = (s, vals) => s.replace(/\{(\w+)\}/g, (_, k) => String(vals[k] ?? ""));
const cssVar = (name, fallback) => {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
};
export function threeView(plan, str, masses, stepTitle) {
    // The shared phases, plus one beat the flat view has no way to draw: right after a fold, the
    // relief cuts open the closed folds at the ends — the knife in horizontally, nothing taken
    // away — and the section that was turning becomes horizontal again. It carries the same step id and follows the
    // fold, so it lands in that step's own chapter; only this view's timeline is a little longer.
    const phases = buildPhases(plan, str, masses).flatMap((q) => q.kind === "fold" ? [q, { ...q, kind: "relax", label: str.relief, dur: 1.3, a: q.b, b: q.b }] : [q]);
    const chapters = chaptersOf(phases);
    const butterFrac = butterFraction(plan);
    const exaggeration = exaggerationFor(phases);
    // What the plan takes off each end at a roll-out. `Plan` does not carry the parameter, but
    // every trimmed step shows it, so it is read off the first one rather than passed in again.
    const planTrim = (() => {
        const st = plan.steps.find((x) => x.roll && x.trimmed && x.trimmed.l < x.roll.l - 1e-9);
        return st ? (st.roll.l - st.trimmed.l) / 2 : null;
    })();
    const total = phases.reduce((n, q) => n + q.dur, 0);
    // What each fold's noses measure, closed. The trim that follows is supposed to go straight
    // through them, so the view can hold the two numbers up against each other instead of
    // assuming they agree.
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
    // Controls: deliberately the same vocabulary as the flat view — a second set of controls
    // behaving differently would be worse than no 3D view at all.
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
        // WebGPU where it exists, WebGL2 where it does not: the renderer falls back by itself,
        // and if neither is there `init` rejects and the tab says so.
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
        // A near plane at 1 mm: counting layers and looking into a crease both mean getting the
        // camera a few centimetres from the block, and clipping there would make the view
        // useless exactly where it matters.
        const camera = new T.PerspectiveCamera(FOV, 1, 0.1, 4000);
        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.08;
        const doughColor = new T.Color(cssVar("--dough", "#e9d9b6"));
        const butterColor = new T.Color(cssVar("--butter", "#f6edcd"));
        const lineColor = new T.Color(cssVar("--line", "#3a3a42"));
        const mat = (c) => new T.MeshBasicMaterial({ color: c, transparent: true, side: T.DoubleSide });
        const doughMat = mat(doughColor);
        const butterMat = mat(butterColor);
        const lineMat = new T.LineBasicMaterial({ color: lineColor, transparent: true, opacity: 0.75 });
        // The knife, for the relief cuts. The same red the flat view uses for a cut, so the two
        // views say "knife" in the same colour.
        const knifeMat = new T.MeshBasicMaterial({
            color: new T.Color(cssVar("--bad", "#e4645a")),
            transparent: true,
            // See-through enough that the dough it is cutting still reads through it.
            opacity: 0.6,
            side: T.DoubleSide,
            depthWrite: false,
        });
        const buildGeom = (pos) => {
            const g = new T.BufferGeometry();
            g.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
            return g;
        };
        // One mesh per material per piece group, rebuilt every frame and disposed with it.
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
        // How much room the whole run needs, sampled rather than guessed from the plan's
        // dimensions. A block halfway through a book fold stands on end — both outer panels are
        // up in the air at once — so it is taller than anything in the table and walks straight
        // out of a frame placed for the flat sheet; a long flat sheet, on the other hand, is
        // mostly foreshortened at the three-quarter angle the view opens on, and framing for its
        // length would leave everything else a thumbnail. So what is kept is the half-extent of
        // every beat, and the distance is worked out from the corners of those boxes against the
        // actual field of view: one framing for the whole run, as the design note asks, as close
        // in as it can be without ever cropping.
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
                // A rotation turns the block inside its own box, so the box has to hold either way.
                if (Number.isFinite(x0)) {
                    const hx = (x1 - x0) / 2;
                    const hz = (z1 - z0) / 2;
                    const wide = q.kind === "rotate" ? Math.max(hx, hz) : hx;
                    out.push({ hx: wide, hy: (y1 - y0) / 2, hz: q.kind === "rotate" ? wide : hz });
                }
            }
            return out.length ? out : [{ hx: 1, hy: 1, hz: 1 }];
        })();
        /** The camera's own axes, for the one direction the view opens on. */
        const VIEW_DIR = (() => {
            const d = [0.7, 0.5, 1];
            const m = Math.hypot(...d);
            return d.map((c) => c / m);
        })();
        // The block's real extent this frame, in cm. The plan's dimensions are not it: a block
        // in the middle of a fold is a quarter of the length the plan names, and the camera
        // would end up inside it. The orbit target follows this, as the note asks.
        let box = { x: 0, y: 0, z: 0, dx: 2 * extents[0].hx, dy: 1, dz: 2 * extents[0].hz };
        /** Where the camera has to sit for every corner of every beat to be inside the frustum:
         *  a corner at `p` is in view from distance `D` when `D ≥ p·view + |p·up|/tan(fov/2)`,
         *  and the same sideways against the aspect. The largest such `D` over the whole run is
         *  the one framing, and it only ever has to be computed when the view is reset. */
        const home = () => {
            const [dx, dy, dz] = VIEW_DIR;
            // right = view × up, up' = right × view, with world up +y.
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
            // Square to the short side: the one view in which the layer count is readable. Framed
            // on the cut face itself rather than on the run, so the layers are as large as they
            // can be — and far enough out along x to clear the block instead of sitting inside it.
            const face = Math.max(box.dz, box.dy) / (2 * Math.tan((FOV * Math.PI) / 360));
            camera.position.set(box.dx / 2 + face * 1.15, 0, 0);
            controls.target.set(0, 0, 0);
            controls.update();
        });
        /** The canvas follows the box it sits in, whether or not anything was rebuilt. */
        const resize = () => {
            const w = canvasBox.clientWidth || 800;
            const h = Math.max(260, Math.round(w * 0.46));
            if (renderer.domElement.width === w && renderer.domElement.height === h)
                return;
            renderer.setSize(w, h, false);
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
        };
        /** What the block drawn in the scene depends on. While this does not change there is
         *  nothing to rebuild: the camera still moves, and `renderer.render` still runs every
         *  frame, but the dough is exactly the dough already in the group.
         *
         *  Without this the view rebuilt every layer of a 16-layer block sixty times a second
         *  while **paused** — which is most of the time anyone spends with it, since reading the
         *  frame is the point. Measured in the browser, the heap climbed about 30 MB a second on a
         *  picture that could not have changed, until an allocation failed and the frame threw.
         *  That is the other half of Pierangelo's *"sometimes it is stuck"*: the loop guard keeps
         *  the clock running when a frame fails, and this is what stops the frames failing. */
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
            // A piece on its way out keeps its own layers, just dimmer: the pieces in the fridge
            // are the same laminate as the one you carry on with, and drawing them plain would
            // say otherwise.
            const faded = [];
            for (const piece of sc.pieces) {
                const out = piece.fade > 0.01 ? { dough: emptyMesh(), butter: emptyMesh(), fade: piece.fade } : null;
                for (const r of piece.ribbons) {
                    const bucket = out ? (r.kind === "butter" ? out.butter : out.dough) : r.kind === "butter" ? butter : dough;
                    extrude(r, piece.width, piece.offset.x, piece.offset.y, piece.offset.z, bucket);
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
            // The relief cuts: a horizontal line at the height each closed fold turns about,
            // reaching in from the end as the knife goes. Drawn across the whole width, because
            // that is the direction the knife travels, and drawn on both faces of the block so it
            // reads from any angle. It cuts and nothing comes away — which is the whole point.
            if (sc.knife?.length) {
                // A blade, not a hairline: WebGL ignores line widths, so the knife is a thin slab of
                // its own — wide across the block, because that is the way the knife travels, and
                // thick enough to be seen against layers a couple of centimetres apart.
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
                    // Top and bottom, then the two long sides and the blunt end: a flat blade.
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
            // The block is modelled in real cm and only exaggerated on the way to the screen, by
            // one declared factor that is always named in the frame. It is centred on what is
            // actually there this frame, so that the camera keeps looking at the block through a
            // fold, a cut and a turn alike.
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
            // Past the cap the view draws bands, not layers. The count above is still the plan's;
            // this says what a line in the picture is, so nobody counts the lines and believes them.
            if (drawnLayers(sc.layers) < sc.layers)
                line(fill(str.layersGrouped, { n: Math.round(sc.layers / drawnLayers(sc.layers)) }), "hudnose");
            line(fill(str.volumeLabel, { v: r1(sc.volume) }));
            note.textContent = exaggerate ? fill(str.scaleNote, { k: exaggeration }) : str.scaleTrue;
            // At a fold: how deep its ends are still closed — which is how far a relief cut has to
            // reach, not how much anything loses. At a roll-out: the margin, which is the only cut
            // in the whole plan that takes material away.
            if (sc.nose)
                line(fill(str.noseNote, { nose: r1(Math.max(sc.nose.ragged, sc.nose.round)) }), "hudnose");
            if (sc.relief) {
                // Said twice over, because it is the thing that was being got wrong: the knife opens
                // the folds and takes nothing, and the margin is a different cut with a number of
                // its own.
                line(str.reliefCut, "hudnose");
                line(fill(str.reliefDepth, {
                    cut: r1(Math.max(sc.relief.left, sc.relief.right)),
                    trim: planTrim === null ? "—" : r1(planTrim),
                }));
            }
            if (sc.trim !== null)
                line(fill(str.trimNote, { trim: r1(sc.trim) }), "hudnose");
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
        // A frame that throws must not stop the clock. Everything in `frame` is rebuilt from scratch
        // each time, so a failure is almost always about the moment it was asked for — a renderer out
        // of memory after a long session, most of all — and the next frame has every chance of being
        // fine. Letting it through killed the `requestAnimationFrame` chain for good: the slider still
        // moved, the picture never changed again, and nothing short of a reload brought it back, which
        // is what Pierangelo saw as *"it doesn't roll back and sometimes it is stuck"*. It is reported
        // rather than swallowed, and only once, so a frame that keeps failing says so without filling
        // the console sixty times a second.
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
