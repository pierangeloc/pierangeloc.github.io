export const foldStyle = (n) => (n % 2 === 0 ? "book" : "letter");
export const materialLength = (segs) => segs.reduce((m, s) => m + (s.kind === "line" ? s.len : s.r * Math.abs(s.sweep)), 0);
export const polylineLength = (pts) => {
    let m = 0;
    for (let i = 1; i < pts.length; i++)
        m += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    return m;
};
const LINE_STEPS = 16;
export function walk(segs, start, offset, material, arcSegments = 24) {
    let dir = start.dir;
    let x = start.x + offset * -Math.sin(dir);
    let y = start.y + offset * Math.cos(dir);
    const out = [{ x, y }];
    let left = material;
    const step = (nx, ny, arc) => {
        out.push(arc === undefined ? { x: nx, y: ny } : { x: nx, y: ny, arc });
        x = nx;
        y = ny;
    };
    let arcIndex = -1;
    for (const s of segs) {
        if (left <= 1e-9)
            break;
        if (s.kind === "line") {
            const len = Math.min(s.len, left);
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
        const r = s.r - sign * offset;
        const span = Math.abs(s.sweep);
        const arc = Math.abs(r) * span;
        const use = Math.min(arc, left);
        const used = arc > 1e-12 ? span * (use / arc) : span;
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
export function creases(n, sheetLen, t, style = foldStyle(n)) {
    const out = [];
    for (let k = 1; k < n; k++) {
        const spine = style === "book" && k === n / 2;
        const r = style === "letter" ? ((n - k) * t) / 2 : spine ? ((n - 1) * t) / 2 : t / 2;
        out.push({ at: (sheetLen * k) / n, r, sign: 1 });
    }
    return out;
}
export const BOOK_BEAT = 0.55;
export function creaseProgress(n, u, style = foldStyle(n)) {
    const k = n - 1;
    const clamp = (x) => Math.min(1, Math.max(0, x));
    if (style === "book") {
        const mid = Math.floor(k / 2);
        return Array.from({ length: k }, (_, i) => i === mid ? clamp((u - BOOK_BEAT) / (1 - BOOK_BEAT)) : clamp(u / BOOK_BEAT));
    }
    return Array.from({ length: k }, (_, i) => clamp(u * k - (k - 1 - i)));
}
export function foldSegments(n, sheetLen, t, u, style = foldStyle(n), room = 0) {
    if (n < 2)
        return [{ kind: "line", len: sheetLen }];
    const cs = creases(n, sheetLen, t, style);
    const prog = creaseProgress(n, u, style);
    const segs = [];
    let done = 0;
    cs.forEach((c, i) => {
        const sweep = Math.PI * prog[i] * c.sign;
        const arc = c.r * Math.abs(sweep);
        const spare = ((1 - room) * arc) / 2;
        segs.push({ kind: "line", len: Math.max(0, c.at - done - spare) });
        segs.push({ kind: "arc", r: c.r, sweep });
        done = c.at + spare;
    });
    segs.push({ kind: "line", len: Math.max(0, sheetLen - done) });
    return segs;
}
export const rollSweep = (rolled, t, core) => t <= 1e-12 ? 0 : ((Math.sqrt(core * core + (Math.max(0, rolled) * t) / Math.PI) - core) * 2 * Math.PI) / t;
export const rollTurns = (rolled, t, core) => rollSweep(rolled, t, core) / (2 * Math.PI);
export function rollSegments(sheetLen, t, core, rolled, arcsPerTurn = 24) {
    const m = Math.max(0, Math.min(sheetLen, rolled));
    const segs = [];
    const sweep = rollSweep(m, t, core);
    if (sweep > 1e-9) {
        const steps = Math.max(1, Math.ceil((sweep * arcsPerTurn) / (2 * Math.PI)));
        const d = sweep / steps;
        for (let i = 0; i < steps; i++)
            segs.push({ kind: "arc", r: core + (t * (i * d + d / 2)) / (2 * Math.PI), sweep: d });
    }
    const flat = sheetLen - m;
    if (flat > 1e-9)
        segs.push({ kind: "line", len: flat });
    return segs.length ? segs : [{ kind: "line", len: sheetLen }];
}
export function pacRoll(sheetLen, t, bar, rolled) {
    const m = Math.max(0, Math.min(sheetLen, rolled));
    const span = 2 * bar.w + t;
    const alone = [
        { len: bar.w, turn: Math.PI / 2, r: 0 },
        { len: bar.h, turn: Math.PI / 2, r: 0 },
        { len: bar.w, turn: Math.PI / 2, r: 0 },
        { len: bar.h + t, turn: Math.PI / 2, r: 0 },
    ];
    const slope = Math.atan2(2 * t, bar.w);
    const cut = t * Math.tan(slope / 2);
    const together = [
        { len: span, turn: Math.PI / 2, r: 0 },
        { len: bar.h, turn: Math.PI / 2 - slope, r: 0 },
        { len: Math.hypot(bar.w, 2 * t) - cut, turn: slope, r: t },
        { len: bar.w + 2 * t - cut - t, turn: Math.PI / 2, r: t },
        { len: bar.h + t, turn: Math.PI / 2, r: t },
    ];
    const offsetOf = (lap) => t / 2 + Math.max(0, lap - 1) * t;
    const firstTurn = 2 * (bar.w + bar.h) + t + Math.PI * t;
    const reach = firstTurn + bar.w + t;
    const segs = [];
    let used = 0;
    outer: for (let lap = 0; lap < 100 && used < m - 1e-9; lap++) {
        const d = offsetOf(lap);
        for (const c of lap === 0 ? alone : together) {
            const take = Math.min(c.len, m - used);
            if (take > 1e-12) {
                segs.push({ kind: "line", len: take });
                used += take;
            }
            if (take < c.len - 1e-12)
                break outer;
            const r = c.r + d;
            const arc = c.turn * r;
            const bite = Math.min(arc, m - used);
            if (bite <= 1e-12)
                break outer;
            segs.push({ kind: "arc", r, sweep: c.turn * (bite / arc) });
            used += bite;
            if (bite < arc - 1e-12)
                break outer;
        }
    }
    const flat = sheetLen - used;
    if (flat > 1e-9)
        segs.push({ kind: "line", len: flat });
    const path = segs.length ? segs : [{ kind: "line", len: sheetLen }];
    const put = (from, along) => {
        const p = poseAt(path, from);
        const u = { x: Math.cos(p.dir), y: Math.sin(p.dir) };
        const n = { x: -Math.sin(p.dir), y: Math.cos(p.dir) };
        const out = t / 2 + bar.h / 2;
        return {
            at: { x: p.x + u.x * along + n.x * out, y: p.y + u.y * along + n.y * out },
            dir: p.dir,
            wrapped: m >= from + along - bar.w / 2 - 1e-9,
        };
    };
    const batons = [put(0, bar.w / 2)];
    if (sheetLen >= reach + bar.w)
        batons.push(put(firstTurn, 1.5 * bar.w + t));
    return { segs: path, batons, firstTurn };
}
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
export function anchoredStart(segs, at) {
    const p = poseAt(segs, at);
    const c = Math.cos(p.dir);
    const sn = Math.sin(p.dir);
    return { x: -(p.x * c + p.y * sn), y: -(-p.x * sn + p.y * c), dir: -p.dir };
}
export const holdPanel = (n, style = foldStyle(n)) => (style === "book" ? n / 2 : 1);
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
export function ribbons(segs, slabsIn, t, material, arcSegments = 24, elasticity = 0, start = { x: 0, y: 0, dir: 0 }) {
    const path = [...segs, { kind: "line", len: material }];
    return slabsIn.map((s) => {
        const offset = (s.from + s.to) / 2 - t / 2;
        const needed = pathLength(segs, offset);
        const len = material + (needed - material) * elasticity;
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
        const fade = 0.5 * (1 + Math.cos((Math.PI * d) / reach));
        const push = (Math.hypot(d, r0) - d) * fade;
        if (d < 1e-9)
            return p;
        const q = { x: p.x + ((p.x - c.x) / d) * push, y: p.y + ((p.y - c.y) / d) * push };
        if (p.arc !== undefined)
            q.arc = p.arc;
        return q;
    });
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
export function cutsOf(centres, b) {
    return centres.map((c) => {
        const right = c.x - b.x0 >= b.x1 - c.x;
        return { y: c.y, x: c.x, side: right ? 1 : -1, edge: right ? b.x1 : b.x0 };
    });
}
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
export function flattenNoses(rs, cuts, v, push = 0) {
    if (v <= 0 || !cuts.length)
        return rs;
    const w = Math.min(1, v);
    const reach = cuts.map(() => 0);
    for (const r of rs)
        for (const face of [r.mid, r.lo, r.hi])
            for (const p of face)
                if (p.arc !== undefined && cuts[p.arc])
                    reach[p.arc] = Math.max(reach[p.arc], Math.hypot(p.x - cuts[p.arc].x, p.y - cuts[p.arc].y));
    const angle = (p, cut) => Math.atan2(p.y - cut.y, cut.side * (p.x - cut.x));
    const map = (pts) => {
        const half = halves(pts, cuts);
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
    return rs
        .flatMap((r) => cutAtTips(r, [r.mid, r.lo, r.hi], cuts))
        .map((r) => ({ ...r, mid: map(r.mid), lo: map(r.lo), hi: map(r.hi) }));
}
function cutAtTips(r, src, cuts) {
    const breaks = [];
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
export function openCuts(rs, cuts, gap, u) {
    if (u <= 0 || gap <= 0 || !cuts.length)
        return rs;
    const map = (pts) => pts.map((p) => {
        let y = p.y;
        for (const c of cuts) {
            const past = c.side * (p.x - c.x);
            if (past <= 0)
                continue;
            const span = Math.abs(c.edge - c.x) || 1;
            const hinge = Math.min(1, past / span) ** 2;
            y += (p.y >= c.y ? 1 : -1) * gap * u * hinge;
        }
        return p.arc === undefined ? { x: p.x, y } : { x: p.x, y, arc: p.arc };
    });
    return rs.map((r) => ({ ...r, mid: map(r.mid), lo: map(r.lo), hi: map(r.hi) }));
}
export function noseDepth(rs, segs, t) {
    const ends = rs.map((r) => r.mid[r.mid.length - 1].x);
    const ragged = rs.length ? Math.max(...ends) - Math.min(...ends) : 0;
    const round = segs.reduce((m, s) => (s.kind === "arc" && Math.abs(s.sweep) > 1e-6 ? Math.max(m, s.r + t / 2) : m), 0);
    return { ragged, round };
}
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
export function curvedEnds(rs, flat = 0.02) {
    const b = bounds(rs);
    const mid = (b.x0 + b.x1) / 2;
    let left = 0;
    let right = 0;
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
        for (const x of [r.mid[0].x, r.mid[r.mid.length - 1].x])
            note(x, x);
    }
    return { left, right };
}
