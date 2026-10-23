// The block's cross-section, as a centreline path of straights and arcs, plus one ribbon
// per layer offset from it. Pure geometry in real cm: no DOM, no three.js, no rendering —
// `three-view.ts` only extrudes what comes out of here across the width.
//
// Why a path and not a stack of boxes: at a fold the layers do not stop, they turn, and the
// outer ones ride a wider arc. Give every layer the same *material length* and walk it along
// its own concentric offset, and three things come out without being asked for:
//
//   - the rounded nose: there is no sharp corner anywhere, the silhouette curves;
//   - layers of different lengths: an outer layer spends more of itself on each corner and
//     so comes up short, which is the raggedness the margin takes off at the next roll-out;
//   - volume still conserved: a ribbon of constant thickness has area length·thickness
//     whether it is straight or bent, so bending costs nothing in the books.
//
// Conventions: x runs along the sheet, y is the thickness. The datum is the sheet's
// midplane; a layer's offset is signed, positive towards the left of the travel direction.
// An arc's `sweep` is signed too, positive turning left, and its centre sits at +normal·r,
// so a layer at offset +o rides radius r−o. See docs/3d-view.md.
export const foldStyle = (n) => (n % 2 === 0 ? "book" : "letter");
/** Total material along the datum. */
export const materialLength = (segs) => segs.reduce((m, s) => m + (s.kind === "line" ? s.len : s.r * Math.abs(s.sweep)), 0);
export const polylineLength = (pts) => {
    let m = 0;
    for (let i = 1; i < pts.length; i++)
        m += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    return m;
};
/** Walks the path offset by `offset` from the datum, for `material` of its own length, and
 *  returns it as a polyline. Stopping on the offset path's own arc length — not the
 *  datum's — is the whole point: that is what makes an outer layer fall short.
 *
 *  `arcSegments` is per π of sweep; the edge has to stay smooth with the camera a few
 *  centimetres from a crease, and this is the one place in the view worth spending geometry. */
/** How many points a straight panel is drawn with. See the note in `walk`. */
const LINE_STEPS = 16;
export function walk(segs, start, offset, material, arcSegments = 24) {
    let dir = start.dir;
    // The offset start sits on the normal (dir + 90°) of the datum start.
    let x = start.x + offset * -Math.sin(dir);
    let y = start.y + offset * Math.cos(dir);
    const out = [{ x, y }];
    let left = material;
    const step = (nx, ny, arc) => {
        out.push(arc === undefined ? { x: nx, y: ny } : { x: nx, y: ny, arc });
        x = nx;
        y = ny;
    };
    /** Counts the arcs that actually turn, so the tags line up with `creaseCentres`. */
    let arcIndex = -1;
    for (const s of segs) {
        if (left <= 1e-9)
            break;
        if (s.kind === "line") {
            const len = Math.min(s.len, left);
            // Subdivided, and **dense at both ends**: whatever makes room at a fold has to act on the
            // panel beside it as well as on the arc, and a panel drawn as one 27 cm segment gives it
            // nothing to act on — which is what left a notch where the arc met the straight. Cosine
            // spacing puts the points where they are needed and almost none in the middle.
            const x0 = x;
            const y0 = y;
            const steps = LINE_STEPS;
            for (let i = 1; i <= steps; i++) {
                const f = 0.5 * (1 - Math.cos((Math.PI * i) / steps));
                step(x0 + len * f * Math.cos(dir), y0 + len * f * Math.sin(dir));
            }
            left -= len;
            continue;
        }
        const sign = Math.sign(s.sweep) || 1;
        const turning = Math.abs(s.sweep) > 1e-6;
        if (turning)
            arcIndex++;
        // Turning left, the centre is at +normal·r; a layer at offset +o is that much nearer it.
        const r = s.r - sign * offset;
        const span = Math.abs(s.sweep);
        const arc = Math.abs(r) * span;
        const use = Math.min(arc, left);
        const used = arc > 1e-12 ? span * (use / arc) : span;
        // The centre sits on the normal, at this layer's own radius — which makes every layer's
        // arc concentric with the datum's, as a bent stack of dough is.
        const c = { x: x + sign * r * -Math.sin(dir), y: y + sign * r * Math.cos(dir) };
        const n = Math.max(2, Math.ceil((arcSegments * used) / Math.PI));
        const a0 = Math.atan2(y - c.y, x - c.x);
        const rad = Math.hypot(x - c.x, y - c.y);
        for (let i = 1; i <= n; i++) {
            const a = a0 + sign * used * (i / n);
            step(c.x + rad * Math.cos(a), c.y + rad * Math.sin(a), turning ? arcIndex : undefined);
        }
        dir += sign * used;
        left -= use;
        if (use < arc - 1e-9)
            break;
    }
    return out;
}
/** How long the path offset by `offset` from the datum is: a layer riding the inside of a
 *  bend has less of it to cover than the datum, one riding the outside more. The difference
 *  is what makes the ends of a fold ragged — and what a layer has to stretch by if it is to
 *  come out flush instead. */
export function pathLength(segs, offset) {
    let m = 0;
    for (const s of segs) {
        if (s.kind === "line")
            m += s.len;
        else
            m += Math.abs(s.r - (Math.sign(s.sweep) || 1) * offset) * Math.abs(s.sweep);
    }
    return m;
}
/** The creases of a fold in `n`, in material order: where along the sheet each one sits, the
 *  datum radius of its bend, and which way it turns.
 *
 *  The two folds are genuinely different geometry, not just a different tempo:
 *
 *  - a **letter fold** divides the strip in three, folds the far third in onto the middle one,
 *    and then brings the near third over the top of that (Pierangelo, 20 October 2026: *"it's
 *    not an S-shape, it's more of a 6 shape"*). So its creases all turn the **same** way, in the
 *    order the hands do them — the far one first — and each wraps one more layer than the last:
 *    the crease the middle third shares with the far third closes one sheet on itself, at `t/2`,
 *    while the one it shares with the near third has to get round the pair, at `t`. In general
 *    `(n − k)·t/2`, which for a letter fold in 3 is those two numbers and for anything longer is
 *    a strip rolled up a panel at a time. Turn them alternately instead and the walk zigzags: the
 *    panels still stack, but the gesture drawn is an accordion, which is not this fold.
 *  - a **book fold** brings the two outer panels in to meet at the centre and then shuts the
 *    block on itself about that centre. All its creases turn the same way, and the middle one
 *    is the **spine**: it wraps an already doubled sheet, so it bends at `(n−1)·t/2` and drops
 *    the walk back over what it has just built.
 *
 *  Which way the creases turn is not a matter of taste: turn either fold's creases any way but
 *  all the same and the panels no longer sit on each other — the block comes out `n·t` plus a
 *  gap, which `test.ts` asserts against. What decides whether the fold *looks*
 *  like the gesture is not the signs but **which part of the sheet is held still** while the
 *  rest comes over it: see `foldAnchor`. The panels end up interleaved — for a fold in
 *    4, bottom to top, panels 3, 4, 1, 2 — which is why the block is still `n·t` thick while
 *    one end carries two narrow noses and the other a single thick one. That is what it looks
 *    like on the bench, and those are the folds the relief cuts open.
 *
 *  Anything else opens a gap between the panels and makes the block thicker than `n·t`, which
 *  is the one thing the view exists to get right. */
export function creases(n, sheetLen, t, style = foldStyle(n)) {
    const out = [];
    for (let k = 1; k < n; k++) {
        const spine = style === "book" && k === n / 2;
        // A letter fold is rolled up a panel at a time, so each crease wraps one layer more than the
        // one after it; a book fold has one spine, in the middle, wrapping the doubled sheet.
        const r = style === "letter" ? ((n - k) * t) / 2 : spine ? ((n - 1) * t) / 2 : t / 2;
        out.push({ at: (sheetLen * k) / n, r, sign: 1 });
    }
    return out;
}
/** How far each crease has closed at overall progress `u`, in the order the hands do it:
 *  a letter fold brings the far third in onto the middle and then the near third over the top of
 *  it, a book fold closes the two outer creases together onto the centre and only then shuts the
 *  block on itself. */
/** Where the book fold's first beat ends and the spine's begins. Shared, because the anchor
 *  changes hands at exactly that moment. */
export const BOOK_BEAT = 0.55;
export function creaseProgress(n, u, style = foldStyle(n)) {
    const k = n - 1;
    const clamp = (x) => Math.min(1, Math.max(0, x));
    if (style === "book") {
        const mid = Math.floor(k / 2);
        // Two beats: the outer creases, then the spine.
        return Array.from({ length: k }, (_, i) => i === mid ? clamp((u - BOOK_BEAT) / (1 - BOOK_BEAT)) : clamp(u / BOOK_BEAT));
    }
    // One crease at a time, and the **far one first**: the third at the far end comes in onto the
    // middle, and only then does the near third come over the top of it.
    return Array.from({ length: k }, (_, i) => clamp(u * k - (k - 1 - i)));
}
/** The datum path of a sheet `sheetLen` long and `t` thick, folded in `n`, with the fold
 *  `u` of the way done (0 = flat, 1 = closed). The straights are shortened by half of each
 *  neighbouring arc so that the total material stays `sheetLen` exactly and every crease
 *  stays at its own position along the sheet. */
export function foldSegments(n, sheetLen, t, u, style = foldStyle(n), room = 0) {
    if (n < 2)
        return [{ kind: "line", len: sheetLen }];
    const cs = creases(n, sheetLen, t, style);
    const prog = creaseProgress(n, u, style);
    const segs = [];
    let done = 0; // material already placed
    cs.forEach((c, i) => {
        const sweep = Math.PI * prog[i] * c.sign;
        const arc = c.r * Math.abs(sweep);
        // At `room` 0 the arc is paid for out of the panels beside it, so the datum measures
        // exactly `sheetLen` however far the fold has got. At `room` 1 the panels keep their full
        // length and the arc is extra, which is the dough being stretched in the middle to make
        // space for the fold — see the note above. In between, the dough is giving the room back:
        // that is the relief cut letting a fold settle to the block the plan says it is.
        const spare = ((1 - room) * arc) / 2;
        segs.push({ kind: "line", len: Math.max(0, c.at - done - spare) });
        segs.push({ kind: "arc", r: c.r, sweep });
        done = c.at + spare;
    });
    segs.push({ kind: "line", len: Math.max(0, sheetLen - done) });
    return segs;
}
/** Where the datum has got to after `at` of material, walking from the origin facing +x. */
export function poseAt(segs, at) {
    let x = 0;
    let y = 0;
    let dir = 0;
    let left = at;
    for (const sg of segs) {
        if (left <= 1e-12)
            break;
        if (sg.kind === "line") {
            const len = Math.min(sg.len, left);
            x += len * Math.cos(dir);
            y += len * Math.sin(dir);
            left -= len;
            continue;
        }
        const sign = Math.sign(sg.sweep) || 1;
        const span = Math.abs(sg.sweep);
        const arc = sg.r * span;
        const used = arc > 1e-12 ? span * Math.min(1, left / arc) : span;
        const c = { x: x + sign * sg.r * -Math.sin(dir), y: y + sign * sg.r * Math.cos(dir) };
        const a = Math.atan2(y - c.y, x - c.x) + sign * used;
        x = c.x + sg.r * Math.cos(a);
        y = c.y + sg.r * Math.sin(a);
        dir += sign * used;
        left -= arc;
    }
    return { x, y, dir };
}
/** The start pose that puts the material at `at` flat on the x axis, facing +x.
 *
 *  This is what decides **which part of the sheet the hands are holding**. A fold walked from
 *  the origin holds its *first* panel still and swings everything else around it, which is not
 *  how anyone folds anything: you keep a part flat on the bench and bring the rest over it.
 *  Anchoring on the part that stays makes the picture the gesture. */
export function anchoredStart(segs, at) {
    const p = poseAt(segs, at);
    const c = Math.cos(p.dir);
    const sn = Math.sin(p.dir);
    return { x: -(p.x * c + p.y * sn), y: -(-p.x * sn + p.y * c), dir: -p.dir };
}
/** Which panel the hands hold flat on the bench while the rest comes over it.
 *
 *  - a **book fold** keeps the half that does not move down throughout: the panel just past the
 *    spine. In the first beat it is part of the central half, which stays flat while the two
 *    outer quarters come up to meet at the centre; in the second it is the half that stays down
 *    while the other shuts over the top of it. One hold for the whole fold, so nothing can jump
 *    between the beats.
 *  - a **letter fold** is a roll onto a growing stack, and the stack is what stays: the panel
 *    just past the first crease never moves again.
 *
 *  The result is the block growing upwards off a part that never moves, instead of pivoting
 *  about its own first panel or — worse — about a crease, which stands it on end. */
export const holdPanel = (n, style = foldStyle(n)) => (style === "book" ? n / 2 : 1);
/** Where that panel's middle is, in material along `segs`.
 *
 *  It has to be read off the segments and not computed from the sheet, because with `room` the
 *  arcs add material as the fold closes, so a panel's middle drifts along the material by
 *  however much arc has been inserted before it. Computed from the sheet, the hold ended up
 *  inside the spine at the end of a book fold — which made the *spine* horizontal and splayed
 *  the two halves symmetrically into a V, instead of laying one half flat and folding the other
 *  onto it. */
export function foldAnchor(segs, n, style = foldStyle(n)) {
    if (n < 2)
        return materialLength(segs) / 2;
    const want = holdPanel(n, style);
    let at = 0;
    let panel = 0;
    for (const sg of segs) {
        const len = sg.kind === "line" ? sg.len : sg.r * Math.abs(sg.sweep);
        if (sg.kind === "line") {
            if (panel === want)
                return at + len / 2;
            panel++;
        }
        at += len;
    }
    return at / 2;
}
/** Offsets a polyline by `d` along its local normal. Good enough here because every layer is
 *  far thinner than the radius of the arc it rides (the crease radius is the thickness of the
 *  whole stack), so neighbouring normals never cross. */
export function offsetPolyline(pts, d) {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
        const a = pts[Math.max(0, i - 1)];
        const b = pts[Math.min(pts.length - 1, i + 1)];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const m = Math.hypot(dx, dy) || 1;
        const q = { x: pts[i].x + (d * -dy) / m, y: pts[i].y + (d * dx) / m };
        if (pts[i].arc !== undefined)
            q.arc = pts[i].arc;
        out.push(q);
    }
    return out;
}
/** Where the centre of every closed crease sits, walking from `start`. This is where the knife
 *  goes in for a relief cut: horizontally, into the closed fold, at the height the fold turns
 *  about. Only creases that have actually turned are reported — a flat sheet has none. */
export function creaseCentres(segs, start = { x: 0, y: 0, dir: 0 }) {
    let { x, y, dir } = start;
    const out = [];
    for (const sg of segs) {
        if (sg.kind === "line") {
            x += sg.len * Math.cos(dir);
            y += sg.len * Math.sin(dir);
            continue;
        }
        const sign = Math.sign(sg.sweep) || 1;
        const c = { x: x + sign * sg.r * -Math.sin(dir), y: y + sign * sg.r * Math.cos(dir) };
        if (Math.abs(sg.sweep) > 1e-6)
            out.push(c);
        const a = Math.atan2(y - c.y, x - c.x) + sg.sweep;
        x = c.x + sg.r * Math.cos(a);
        y = c.y + sg.r * Math.sin(a);
        dir += sg.sweep;
    }
    return out;
}
/** The sandwich at a given moment: `layers` butter sheets with dough between them and on
 *  both faces, so 2·layers+1 slabs. The butter keeps `butterFrac` of the thickness however
 *  many times it has been folded, which is what lets one function serve every step. */
export function slabs(t, layers, butterFrac) {
    const butter = (t * butterFrac) / layers;
    const dough = (t * (1 - butterFrac)) / (layers + 1);
    const out = [];
    let y = 0;
    for (let i = 0; i < layers; i++) {
        out.push({ kind: "dough", from: y, to: y + dough });
        y += dough;
        out.push({ kind: "butter", from: y, to: y + butter });
        y += butter;
    }
    out.push({ kind: "dough", from: y, to: y + dough });
    return out;
}
/** Every layer of the block, walked along the given path.
 *
 *  With `elasticity` 0 every layer carries exactly the same material length, so where the
 *  path bends they end at different places: the outer ones spent more of themselves on the
 *  corners and come up short. That is the ragged end the margin takes off at the next roll-out,
 *  and it is the honest limit of an **inextensible** sheet.
 *
 *  Dough is not inextensible. Pressed into a crease the layers drag each other round and
 *  stretch rather than slide apart, so the ends come out far less ragged than the ribbon
 *  model predicts. `elasticity` is that effect as an explicit parameter — **an estimate, not
 *  a measurement** (CLAUDE.md: never a hidden factor): 0 lets every layer keep its length and
 *  fall where it falls, 1 stretches each one to exactly the path it has to cover, so the
 *  whole stack ends flush and no layer moves on its own.
 *
 *  A stretched layer **thins** in proportion, because dough does not compress: thickness
 *  times length is the same before and after, so the cross-section area — and with it the
 *  volume the plan accounts for — is conserved at any elasticity. */
export function ribbons(segs, slabsIn, t, material, arcSegments = 24, elasticity = 0, start = { x: 0, y: 0, dir: 0 }) {
    // A run-out after the last segment, so that a layer which spends *less* than the datum on
    // the corners can overshoot instead of being cut off by the end of the path. What ends a
    // layer is its own material, nothing else.
    const path = [...segs, { kind: "line", len: material }];
    return slabsIn.map((s) => {
        const offset = (s.from + s.to) / 2 - t / 2;
        const needed = pathLength(segs, offset);
        const len = material + (needed - material) * elasticity;
        // Stretching thins, shrinking thickens: length · thickness is an invariant.
        const thickness = ((s.to - s.from) * material) / (len || 1);
        const mid = walk(path, start, offset, len, arcSegments);
        return {
            kind: s.kind,
            thickness,
            mid,
            lo: offsetPolyline(mid, -thickness / 2),
            hi: offsetPolyline(mid, thickness / 2),
        };
    });
}
/** Maps every point that is turning round a closed fold, leaving the straight panels alone.
 *  `f` is given the point's radius from the fold's centre and which side of it the point is on,
 *  and returns the new radius and the new angle fraction — see the two users below. */
function overNoses(rs, centres, f) {
    if (!centres.length)
        return rs;
    const map = (pts) => pts.map((p, i) => {
        if (p.arc === undefined)
            return p;
        const c = centres[p.arc];
        if (!c)
            return p;
        const d = Math.hypot(p.x - c.x, p.y - c.y);
        if (d >= 1e-9)
            return f(p, c, d);
        // A point sitting exactly on the centre is the one that most needs moving — it is the
        // layer crushed to a point — but it has no direction of its own, so it borrows the
        // nearest neighbour's and is nudged a hair off the centre first. A whole run of them can
        // be crushed together, so the search walks outwards until it finds one with a direction.
        for (let step = 1; step < pts.length; step++)
            for (const q of [pts[i - step], pts[i + step]]) {
                if (!q)
                    continue;
                const m = Math.hypot(q.x - c.x, q.y - c.y);
                if (m < 1e-9)
                    continue;
                const eps = 1e-6;
                const nudged = { x: c.x + ((q.x - c.x) / m) * eps, y: c.y + ((q.y - c.y) / m) * eps };
                if (p.arc !== undefined)
                    nudged.arc = p.arc;
                return f(nudged, c, eps);
            }
        return p;
    });
    return rs.map((r) => ({ ...r, mid: map(r.mid), lo: map(r.lo), hi: map(r.hi) }));
}
/** Makes room at the heart of every closed fold.
 *
 *  A crease of radius `t/2` closes the sheet on itself exactly, which is what keeps the folded
 *  block `n·t` thick — and it puts the **inner face of the fold at radius zero**. On paper that
 *  is a tidy limit; drawn, it is a layer crushed to a point with slivers of it poking through
 *  the others, which is not what a folded piece of dough looks like.
 *
 *  Pierangelo, 20 October 2026: on the bench you *stretch the dough a bit to make room* for the
 *  fold, or pull it outwards as you fold it over. So the fold has an eye at its heart, and the
 *  dough around it is thinner for it. That is what this does: every radius `d` becomes
 *  `hypot(d, r0)`, which is strictly increasing — so no two faces can ever cross — and equals
 *  `r0` at the centre.
 *
 *  It is applied by **distance, not by tag**, and faded smoothly to nothing by `reach`, because
 *  the panel beside a fold has to move with the fold: pushing the arc alone and leaving the
 *  straight where it was is what put a notch at the junction, and several layers' worth of notch
 *  is the cross Pierangelo saw at a half-closed crease. `reach` stays well inside the block, so
 *  the layers at the far end of a book fold's spine are never caught by it.
 *
 *  `r0` is **derived, not chosen**: the thickest layer's half-thickness, which is exactly the
 *  clearance the innermost layer needs to get round without being turned inside out. */
export function openNoses(rs, centres, r0, reach = 4 * r0) {
    if (r0 <= 0 || !centres.length)
        return rs;
    const map = (pts) => pts.map((p) => {
        let c = null;
        let d = Infinity;
        for (const q of centres) {
            const m = Math.hypot(p.x - q.x, p.y - q.y);
            if (m < d) {
                d = m;
                c = q;
            }
        }
        if (!c || d > reach)
            return p;
        // Smooth to nothing at `reach`, so nothing steps at the edge of the effect.
        const fade = 0.5 * (1 + Math.cos((Math.PI * d) / reach));
        const push = (Math.hypot(d, r0) - d) * fade;
        if (d < 1e-9)
            return p; // handled below, by direction borrowed from a neighbour
        const q = { x: p.x + ((p.x - c.x) / d) * push, y: p.y + ((p.y - c.y) / d) * push };
        if (p.arc !== undefined)
            q.arc = p.arc;
        return q;
    });
    // The crushed points, which have no direction of their own, are pushed out along their
    // neighbours' — done after the rest so the neighbours are already where they belong.
    const fix = (pts, src) => pts.map((p, i) => {
        let c = null;
        let d = Infinity;
        for (const q of centres) {
            const m = Math.hypot(src[i].x - q.x, src[i].y - q.y);
            if (m < d) {
                d = m;
                c = q;
            }
        }
        if (!c || d >= 1e-9)
            return p;
        for (let step = 1; step < src.length; step++)
            for (const j of [i - step, i + step]) {
                const s2 = src[j];
                if (!s2)
                    continue;
                const m = Math.hypot(s2.x - c.x, s2.y - c.y);
                if (m < 1e-9)
                    continue;
                const out = { x: c.x + ((s2.x - c.x) / m) * r0, y: c.y + ((s2.y - c.y) / m) * r0 };
                if (p.arc !== undefined)
                    out.arc = p.arc;
                return out;
            }
        return p;
    });
    return rs.map((r) => ({
        ...r,
        mid: fix(map(r.mid), r.mid),
        lo: fix(map(r.lo), r.lo),
        hi: fix(map(r.hi), r.hi),
    }));
}
/** The relief cuts of a folded block, read off its closed folds and its own extent. */
export function cutsOf(centres, b) {
    return centres.map((c) => {
        const right = c.x - b.x0 >= b.x1 - c.x;
        return { y: c.y, x: c.x, side: right ? 1 : -1, edge: right ? b.x1 : b.x0 };
    });
}
/** Which half of its fold each point of a layer is in: above its centre or below it, 0 for a
 *  point that is in no fold at all.
 *
 *  Normally a point's own height above the fold's centre says so. Where a crease of `t/2` has
 *  crushed a face to a point, and `openNoses` has pushed the whole crushed run back out along
 *  one neighbour, every point of that run sits at the same height and the answer would come down
 *  to the sign of a zero — which would put consecutive points of the same layer on opposite
 *  sides of the fold. There it is taken from the nearest dough that does have a side. */
function halves(pts, cuts) {
    const half = pts.map((p) => {
        if (p.arc === undefined || !cuts[p.arc])
            return 0;
        const c = cuts[p.arc];
        return Math.abs(p.y - c.y) > 1e-9 ? (p.y > c.y ? 1 : -1) : 0;
    });
    for (let i = 0; i < pts.length; i++) {
        if (pts[i].arc === undefined || half[i] !== 0)
            continue;
        for (let j = 1; half[i] === 0 && j < pts.length; j++)
            for (const k of [i - j, i + j])
                if (half[k])
                    half[i] = half[k];
        if (half[i] === 0)
            half[i] = 1;
    }
    return half;
}
/** Lays the closed folds down, `v` of the way: the relief cuts letting the rounded ends go flat.
 *
 *  A relief cut severs the layers at the heart of the fold, so the dough that was wrapped round
 *  it is free to lie down. What that has to look like is Pierangelo's sketch of 20 October 2026:
 *  **the half-circle is cancelled progressively, starting from the horizontal part where the nose
 *  joins its panel, and pushed a bit further out until it has disappeared and everything is
 *  horizontal.** The end of the block stops being round and becomes a flat, square face.
 *
 *  So each nose point is described by two things that between them say where it belongs once the
 *  fold is gone: its radius `d` from the fold's centre, which is its place in the stack, and how
 *  far round the nose it is, `tau = (π/2 − |a|)/(π/2)`, which is 0 where it joins the panel and 1
 *  at the tip. Flat, it sits at its own stack height, `c.y ± d`, and `tau` of the way out to the
 *  end face at `reach` from the centre. The point travels from where the fold had it to there,
 *  in step with `v`.
 *
 *  Three properties make this safe to animate. The junction (`|a| = π/2`) is already its own flat
 *  position, so the nose never comes away from its panel — and the panels themselves never move,
 *  because they carry no tag. The flat height is strictly ordered by `d`, so no two layers can
 *  cross. And every layer reaches the same `reach` at the same `tau`, so the end comes out square
 *  rather than ragged.
 *
 *  **This is licence, like `openNoses` and `openCuts`, and the one place in the view where dough
 *  is neither conserved nor inextensible.** Honest alternatives were tried and are worse:
 *
 *  - Mapping each point to its flat height and leaving its `x` alone drags the **tip** of the
 *    nose, which starts level with the centre, all the way out to the outermost layer: the fold
 *    grows a vertical flare instead of lying down.
 *  - A true **unroll** — keeping each layer's length, so the curl straightens into a run of its
 *    own arc length — is exact, and unusable: a layer at radius `d` reaches `d·π/2`, so the spine
 *    of a book fold, drawn at 8.9 cm, throws a 14 cm tongue out of the end of a 31 cm block. Real
 *    dough does not unroll when you cut it; the tension goes and the end settles flat. Keeping
 *    the look costs the length, and the length is not what this beat is about.
 *
 *  `reach` is **derived, not chosen**: the fold's own outermost radius, so the end face lands
 *  where the round end already was, plus `push` — the explicit "bit further out" of the sketch,
 *  which the caller supplies in cm. */
export function flattenNoses(rs, cuts, v, push = 0) {
    if (v <= 0 || !cuts.length)
        return rs;
    const w = Math.min(1, v);
    // How far each fold reaches now, measured over every face of every layer: the end face is put
    // there, so that laying the nose down neither shortens the block nor stretches it further than
    // `push` says.
    const reach = cuts.map(() => 0);
    for (const r of rs)
        for (const face of [r.mid, r.lo, r.hi])
            for (const p of face)
                if (p.arc !== undefined && cuts[p.arc])
                    reach[p.arc] = Math.max(reach[p.arc], Math.hypot(p.x - cuts[p.arc].x, p.y - cuts[p.arc].y));
    /** How far round the nose a point is: 0 where it joins its panel, 1 at the tip. `tip` is the
     *  smallest angle this layer was actually sampled at, not zero, so that every layer reaches
     *  the end face exactly — sampling the arc coarsely would otherwise leave each of them a few
     *  millimetres short of it, by its own amount, and the end would come out as a handful of
     *  crossing slivers instead of one clean face. */
    const angle = (p, cut) => Math.atan2(p.y - cut.y, cut.side * (p.x - cut.x));
    const map = (pts) => {
        const half = halves(pts, cuts);
        // How far round the nose this face was sampled, per fold: see `tau`. Per face of each
        // severed piece, because the two faces of a nose turn at different radii and so are sampled
        // at their own angles — and each has to be snapped to the end face on its own, or it stops a
        // sample short of it and the end draws as a fan of slivers instead of one wall.
        const tip = cuts.map(() => [Math.PI / 2, Math.PI / 2]);
        pts.forEach((p, i) => {
            if (p.arc === undefined || !cuts[p.arc])
                return;
            const h = half[i] > 0 ? 0 : 1;
            tip[p.arc][h] = Math.min(tip[p.arc][h], Math.abs(angle(p, cuts[p.arc])));
        });
        return pts.map((p, i) => {
            if (p.arc === undefined)
                return p;
            const cut = cuts[p.arc];
            if (!cut)
                return p;
            const d = Math.hypot(p.x - cut.x, p.y - cut.y);
            if (d < 1e-9)
                return p;
            const side = half[i];
            const span = Math.PI / 2 - tip[p.arc][side > 0 ? 0 : 1];
            const off = Math.PI / 2 - Math.abs(angle(p, cut));
            const tau = span > 1e-9 ? Math.max(0, Math.min(1, off / span)) : off >= 0 ? 1 : 0;
            const flat = { x: cut.x + cut.side * (reach[p.arc] + push) * tau, y: cut.y + side * d };
            const q = { x: p.x + (flat.x - p.x) * w, y: p.y + (flat.y - p.y) * w };
            q.arc = p.arc;
            return q;
        });
    };
    // The layer is **severed** at each tip first, because that is what the knife did: a wrapped
    // layer becomes two flat ones. Left joined, the tip would drag a zero-width web across the
    // whole end of the block — the degenerate face that reads as a stray sliver of dough standing
    // on end — and the two halves would have to share one account of where the tip was, which
    // neither of them can snap to on its own.
    return rs
        .flatMap((r) => cutAtTips(r, [r.mid, r.lo, r.hi], cuts))
        .map((r) => ({ ...r, mid: map(r.mid), lo: map(r.lo), hi: map(r.hi) }));
}
/** Splits a layer wherever it turns through the tip of a fold — where a relief cut has severed
 *  it — using `src`, the layer's faces as they were before being laid down, to find the tips. */
function cutAtTips(r, src, cuts) {
    const breaks = [];
    // Every face of the layer has its say: the two faces of a nose turn at different radii, so
    // they can cross the tip an index apart, and a tip left in the middle of a face is a wall of
    // dough standing across the end of the block.
    for (const face of src) {
        const half = halves(face, cuts);
        for (let i = 1; i < face.length; i++)
            if (face[i].arc !== undefined && face[i - 1].arc === face[i].arc && half[i] !== half[i - 1] && !breaks.includes(i))
                breaks.push(i);
    }
    breaks.sort((a, b) => a - b);
    if (!breaks.length)
        return [r];
    const out = [];
    let from = 0;
    for (const at of [...breaks, r.mid.length]) {
        if (at - from >= 2)
            out.push({ ...r, mid: r.mid.slice(from, at), lo: r.lo.slice(from, at), hi: r.hi.slice(from, at) });
        from = at;
    }
    return out.length ? out : [r];
}
/** Lets the dough open along the relief cuts, `u` of the way.
 *
 *  This is Pierangelo's drawing (20 October 2026): the knife goes in horizontally, and what was
 *  one closed fold becomes two stacks that **spring apart** — hinged where the cut stops, so the
 *  gap is nothing at the depth the knife reached and widest at the end of the block, exactly as
 *  a cut sheet opens. Away from the cut, nothing moves.
 *
 *  Everything on a cut's side of the block opens, not only the dough that was turning: a relief
 *  cut through a book fold's spine runs through the whole mid-plane of that end, so both halves
 *  of it are free. `gap` is as much licence as `openNoses` is — the block is that much thicker
 *  at its ends while this is being shown — and it is what makes the cut visible at all. */
export function openCuts(rs, cuts, gap, u) {
    if (u <= 0 || gap <= 0 || !cuts.length)
        return rs;
    const map = (pts) => pts.map((p) => {
        let y = p.y;
        for (const c of cuts) {
            // How far past the end of the cut this point is, as a fraction of the cut's reach.
            const past = c.side * (p.x - c.x);
            if (past <= 0)
                continue;
            const span = Math.abs(c.edge - c.x) || 1;
            // Squared, not linear: a cut opens as a crack, widest at the mouth and barely parted
            // for most of its depth. Linear in the hinge draws as the whole end of the block bending
            // up, which is not what a knife does to it.
            const hinge = Math.min(1, past / span) ** 2;
            y += (p.y >= c.y ? 1 : -1) * gap * u * hinge;
        }
        return p.arc === undefined ? { x: p.x, y } : { x: p.x, y, arc: p.arc };
    });
    return rs.map((r) => ({ ...r, mid: map(r.mid), lo: map(r.lo), hi: map(r.hi) }));
}
/** How ragged and how round a fold's ends are, in cm along the sheet, as two separate things:
 *
 *  - `ragged`: the spread between the layer that reaches furthest and the one that falls
 *    shortest, because the outer ones spent more of themselves getting round the corners;
 *  - `round`: how deep the curved part of a nose reaches in from the end of the block, which
 *    is the outermost crease radius.
 *
 *  Neither is what the **margin** (`trim`) takes off — that is 1 cm of out-of-square end,
 *  decided before any of this — and neither is removed by the **relief cuts**, which remove
 *  nothing. What they measure is how deep into the block the fold is still closed, which is how
 *  far the knife has to reach. */
export function noseDepth(rs, segs, t) {
    const ends = rs.map((r) => r.mid[r.mid.length - 1].x);
    const ragged = rs.length ? Math.max(...ends) - Math.min(...ends) : 0;
    const round = segs.reduce((m, s) => (s.kind === "arc" && Math.abs(s.sweep) > 1e-6 ? Math.max(m, s.r + t / 2) : m), 0);
    return { ragged, round };
}
/** The bounding box of a set of ribbons, in cm. */
export function bounds(rs) {
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const r of rs)
        for (const p of [...r.lo, ...r.hi]) {
            x0 = Math.min(x0, p.x);
            x1 = Math.max(x1, p.x);
            y0 = Math.min(y0, p.y);
            y1 = Math.max(y1, p.y);
        }
    return { x0, x1, y0, y1 };
}
/** How far in from each end of a folded block the layers are still turning: everything beyond
 *  that is a flat stack. This is how deep a relief cut has to reach: past this, the layers are
 *  already parallel and there is no tension left to release.
 *
 *  Measured, not assumed: a face counts as turning while its slope is above `flat`, and the
 *  ragged ends of the layers count too, since a layer that falls short leaves as much of a
 *  hollow as a curve does. */
export function curvedEnds(rs, flat = 0.02) {
    const b = bounds(rs);
    const mid = (b.x0 + b.x1) / 2;
    let left = 0;
    let right = 0;
    /** Each feature belongs to the end it is nearer, and counts as deep as it reaches in. */
    const note = (x0, x1) => {
        if ((x0 + x1) / 2 < mid)
            left = Math.max(left, x1 - b.x0);
        else
            right = Math.max(right, b.x1 - x0);
    };
    for (const r of rs) {
        for (const face of [r.lo, r.hi])
            for (let i = 1; i < face.length; i++) {
                const dx = face[i].x - face[i - 1].x;
                const dy = face[i].y - face[i - 1].y;
                if (Math.abs(dy) > flat * Math.abs(dx))
                    note(Math.min(face[i].x, face[i - 1].x), Math.max(face[i].x, face[i - 1].x));
            }
        // A layer that comes up short leaves the same kind of hollow as a bend does.
        for (const x of [r.mid[0].x, r.mid[r.mid.length - 1].x])
            note(x, x);
    }
    return { left, right };
}
