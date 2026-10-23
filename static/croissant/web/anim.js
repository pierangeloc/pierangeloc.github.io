import { trianglesInStrip } from "../lamination.js";
import { buildPhases, butterFraction, chapterAt, chaptersOf, ease, isPackage, lerp, r1 } from "./phases.js";
import { finishSound, phaseSound, primeSound, setSoundEnabled, soundEnabled, tickSound } from "./sound.js";
const SVGNS = "http://www.w3.org/2000/svg";
const svgEl = (tag, attrs = {}) => {
    const n = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs))
        n.setAttribute(k, String(v));
    return n;
};
const fillIn = (s, vals) => s.replace(/\{(\w+)\}/g, (_, k) => String(vals[k] ?? ""));
export function animation(plan, str, masses, stepTitle) {
    const phases = buildPhases(plan, str, masses);
    const base = plan.croissant.base;
    const share = plan.allocation.stripBreakdown.find((s) => s.strip === 1) ?? {
        strip: 1,
        croissants: plan.stripSet[0]?.croissants ?? 0,
        pac: 0,
    };
    const chapters = chaptersOf(phases);
    const degreeOf = (id) => plan.steps.findIndex((s) => s.id === id);
    const butterFrac = butterFraction(plan);
    const total = phases.reduce((n, p) => n + p.dur, 0);
    const root = document.createElement("div");
    root.className = "anim";
    const svg = svgEl("svg", { viewBox: "0 0 1000 430", class: "stage" });
    root.appendChild(svg);
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
    const muteBtn = document.createElement("button");
    muteBtn.type = "button";
    muteBtn.className = "animbtn mute";
    const paintMute = () => {
        muteBtn.textContent = soundEnabled() ? "♪" : "✕";
        muteBtn.title = soundEnabled() ? str.soundOn : str.soundOff;
        muteBtn.classList.toggle("off", !soundEnabled());
    };
    muteBtn.addEventListener("click", () => {
        setSoundEnabled(!soundEnabled());
        paintMute();
        if (soundEnabled())
            tickSound();
    });
    paintMute();
    bar.append(playBtn, scrub, caption, muteBtn);
    root.appendChild(bar);
    const chapterBar = document.createElement("div");
    chapterBar.className = "chapters";
    const chips = chapters.map((c) => {
        const step = plan.steps.find((x) => x.id === c.step);
        const b = document.createElement("button");
        b.type = "button";
        b.className = "chapter";
        const title = stepTitle(step);
        b.textContent = `${step.id}. ${c.kind === "prep" ? fillIn(str.prep, { step: title }) : title}`;
        b.title = str.chapter;
        chapterBar.appendChild(b);
        return b;
    });
    root.appendChild(chapterBar);
    const span = (f, g) => phases.reduce((m, p) => {
        const pick = p.kind === "rotate" ? Math.max(f(p.a), g(p.a)) : Math.max(f(p.a), f(p.b));
        return Math.max(m, pick);
    }, 1);
    const maxL = span((s) => s.l, (s) => s.w);
    const maxW = span((s) => s.w, (s) => s.l);
    const PAD = 70;
    const scale = Math.min((1000 - 2 * PAD) / maxL, (300 - 2 * PAD) / maxW);
    const CX = 500;
    const CY = 150;
    const EDGE_Y = 370;
    const maxT = phases.reduce((m, q) => Math.max(m, q.a.t, q.b.t), 0.1);
    const tScale = 54 / maxT;
    const g = svgEl("g");
    svg.appendChild(g);
    const draw = (time) => {
        let left = time;
        let i = 0;
        while (i < phases.length - 1 && left > phases[i].dur)
            left -= phases[i++].dur;
        const p = phases[i];
        const u = ease(Math.min(1, Math.max(0, left / p.dur)));
        g.replaceChildren();
        const w = lerp(p.a.w, p.b.w, u);
        const l = lerp(p.a.l, p.b.l, u);
        const t = lerp(p.a.t, p.b.t, u);
        const layers = u > 0.6 ? p.b.layers : p.a.layers;
        const whole = p.kind === "cut";
        const turning = p.kind === "rotate";
        const topL = turning || whole ? p.a.l : l;
        const topW = turning || whole ? p.a.w : w;
        const pw = topL * scale;
        const ph = topW * scale;
        const x = CX - pw / 2;
        const y = CY - ph / 2;
        const rot = p.kind === "rotate" ? 90 * u : 0;
        const body = svgEl("g", { transform: `rotate(${rot} ${CX} ${CY})` });
        g.appendChild(body);
        if (p.kind === "fold") {
            const n = p.pieces;
            const full = p.a.l * scale;
            const panel = full / n;
            const fx0 = CX - full / 2;
            for (let k = 0; k < n; k++) {
                const home = fx0 + panel * k;
                const stacked = CX - panel / 2;
                const px = lerp(home, stacked, u);
                body.appendChild(svgEl("rect", {
                    x: px,
                    y: y - k * 2 * u,
                    width: panel,
                    height: ph,
                    rx: 3,
                    class: "sheet panel",
                    "fill-opacity": 0.35 + 0.1 * k,
                }));
                if (k > 0)
                    body.appendChild(svgEl("line", { x1: px, y1: y - k * 2 * u, x2: px, y2: y + ph - k * 2 * u, class: "foldline" }));
            }
        }
        else if (p.kind === "cut" || p.kind === "focus") {
            const n = p.pieces;
            const cutting = p.kind === "cut";
            const fullW = p.a.l * scale;
            const fullH = p.a.w * scale;
            const fx0 = CX - fullW / 2;
            const fy0 = CY - fullH / 2;
            const slice = (p.cutAcross ? fullH : fullW) / n;
            const gap = cutting ? Math.max(0, u - 0.45) * 24 : 12 + 120 * u;
            const keepOff = (-(n - 1) / 2) * gap;
            const shift = cutting ? 0 : -keepOff * u;
            for (let k = 0; k < n; k++) {
                const off = (k - (n - 1) / 2) * gap + shift;
                const keep = k === 0;
                const rect = p.cutAcross
                    ? { x: fx0, y: fy0 + k * slice + off, width: fullW, height: slice }
                    : { x: fx0 + k * slice + off, y: fy0, width: slice, height: fullH };
                body.appendChild(svgEl("rect", { ...rect, rx: 3, class: `sheet ${keep ? "keep" : "aside"}`, opacity: keep || cutting ? 1 : Math.max(0, 1 - 1.4 * u) }));
            }
            if (cutting && u < 0.6)
                for (let k = 1; k < n; k++) {
                    const at = k * slice;
                    const line = p.cutAcross
                        ? { x1: fx0, y1: fy0 + at, x2: fx0 + fullW, y2: fy0 + at }
                        : { x1: fx0 + at, y1: fy0, x2: fx0 + at, y2: fy0 + fullH };
                    body.appendChild(svgEl("line", { ...line, class: "knife" }));
                }
        }
        else {
            const baseW = p.kind === "wrap" ? plan.butterSheet.length * scale : pw;
            body.appendChild(svgEl("rect", { x: CX - baseW / 2, y, width: baseW, height: ph, rx: 3, class: "sheet" }));
            if (p.kind === "trim") {
                const cut = ((p.a.l - p.b.l) / 2) * scale * (1 - u);
                for (const sx of [x - cut, x + pw])
                    if (cut > 0.5)
                        body.appendChild(svgEl("rect", { x: sx, y, width: cut, height: ph, rx: 2, class: "offcut" }));
            }
            if (isPackage(p) && p.kind !== "appear") {
                const bl = plan.butterSheet.length * scale;
                const bw2 = plan.butterSheet.width * scale;
                const appear = p.kind === "place" ? Math.min(1, u * 1.6) : 1;
                body.appendChild(svgEl("rect", {
                    x: CX - bl / 2,
                    y: CY - bw2 / 2,
                    width: bl,
                    height: bw2,
                    rx: 2,
                    class: "butter",
                    opacity: appear,
                }));
                if (p.kind === "wrap")
                    for (const side of [-1, 1]) {
                        const flap = bl / 2;
                        const fromX = side < 0 ? CX - bl : CX + bl / 2;
                        const toX = side < 0 ? CX - flap : CX;
                        body.appendChild(svgEl("rect", { x: lerp(fromX, toX, u), y: CY - bw2 / 2, width: flap, height: bw2, rx: 2, class: "sheet flap" }));
                    }
            }
            if (p.kind === "shape" && u > 0.55) {
                const note = svgEl("text", { x: CX, y: CY + ph / 2 + 54, class: "sharenote" });
                note.textContent =
                    fillIn(str.share, { n: plan.strips, pac: share.pac, cro: share.croissants }) +
                        (plan.strips > 1
                            ? ` · ${fillIn(str.shareAll, { pacAll: plan.allocation.pac, croAll: plan.allocation.croissants })}`
                            : "");
                note.setAttribute("opacity", String(Math.min(1, (u - 0.55) * 6)));
                g.appendChild(note);
                let at = x;
                if (share.pac > 0) {
                    const pw2 = plan.pac.width * scale;
                    const rows = Math.max(1, Math.round(plan.strip.height / plan.pac.height));
                    const cols = Math.ceil(share.pac / rows);
                    const rh = ph / rows;
                    for (let c = 0; c < cols; c++)
                        for (let r = 0; r < rows; r++) {
                            if (c * rows + r >= share.pac)
                                break;
                            body.appendChild(svgEl("rect", { x: at + c * pw2, y: y + r * rh, width: pw2, height: rh, class: "pac" }));
                        }
                    at += cols * pw2;
                }
                const rest = (x + pw - at) / scale;
                if (share.croissants > 0 && rest > 0) {
                    const n = Math.min(share.croissants, trianglesInStrip(rest, base, plan.croissant.cutStyle));
                    if (plan.croissant.cutStyle === "diagonal") {
                        const bw3 = base * scale;
                        for (let k = 0; k < Math.ceil(n / 2); k++) {
                            const fx = at + bw3 * k;
                            body.appendChild(svgEl("polygon", { points: `${fx},${y} ${fx},${y + ph} ${fx + bw3},${y + ph}`, class: "tri" }));
                            if (2 * k + 1 < n)
                                body.appendChild(svgEl("polygon", { points: `${fx},${y} ${fx + bw3},${y} ${fx + bw3},${y + ph}`, class: "tri" }));
                        }
                    }
                    else {
                        const half = (base / 2) * scale;
                        for (let k = 0; k < n; k++) {
                            const fx = at + half * k;
                            const pts = k % 2 === 0
                                ? `${fx},${y + ph} ${fx + 2 * half},${y + ph} ${fx + half},${y}`
                                : `${fx},${y} ${fx + 2 * half},${y} ${fx + half},${y + ph}`;
                            body.appendChild(svgEl("polygon", { points: pts, class: "tri" }));
                        }
                    }
                }
            }
        }
        const dimLine = (x1, y1, x2, y2, text, anchor) => {
            g.appendChild(svgEl("line", { x1, y1, x2, y2, class: "dim" }));
            const label = svgEl("text", {
                x: anchor === "mid" ? (x1 + x2) / 2 : x1 - 8,
                y: anchor === "mid" ? y1 - 7 : (y1 + y2) / 2,
                class: `dimtext ${anchor}`,
            });
            label.textContent = text;
            g.appendChild(label);
        };
        const lw = turning && u > 0.5 ? topW : topL;
        const lh = turning && u > 0.5 ? topL : topW;
        const bw = (turning ? Math.max(pw, ph) : pw) / 2;
        const bh = (turning ? Math.max(pw, ph) : ph) / 2;
        dimLine(CX - bw, CY + bh + 26, CX + bw, CY + bh + 26, `${r1(lw)} cm`, "mid");
        dimLine(CX - bw - 16, CY - bh, CX - bw - 16, CY + bh, `${r1(lh)} cm`, "left");
        let eh = Math.max(2, t * tScale);
        let el2 = (turning ? lerp(p.a.l, p.b.l, u) : lw) * scale;
        let ex = CX - el2 / 2;
        let ey = EDGE_Y - eh;
        if (isPackage(p)) {
            const dth = plan.doughSheet.t * tScale;
            const bth = plan.butterSheet.thickness * tScale;
            const fullL = plan.doughSheet.l * scale;
            const midL = plan.butterSheet.length * scale;
            const placed = p.kind !== "appear";
            const wrapping = p.kind === "wrap";
            const stack = plan.doughSheet.t + (placed ? plan.butterSheet.thickness : 0) + (wrapping ? plan.doughSheet.t * u : 0);
            eh = stack * tScale;
            el2 = (p.kind === "appear" ? l * scale : wrapping ? lerp(fullL, midL, u) : fullL);
            ex = CX - el2 / 2;
            ey = EDGE_Y - eh;
            const baseL = wrapping ? midL : el2;
            const baseH = p.kind === "appear" ? Math.max(2, t * tScale) : dth;
            g.appendChild(svgEl("rect", { x: CX - baseL / 2, y: EDGE_Y - baseH, width: baseL, height: baseH, rx: 1, class: "edgeblock" }));
            if (placed)
                g.appendChild(svgEl("rect", {
                    x: CX - midL / 2,
                    y: EDGE_Y - dth - bth,
                    width: midL,
                    height: bth,
                    class: "edgebutter",
                    opacity: p.kind === "place" ? Math.min(1, u * 1.6) : 1,
                }));
            if (wrapping)
                for (const side of [-1, 1]) {
                    const flap = midL / 2;
                    const fromX = side < 0 ? CX - fullL / 2 : CX + midL / 2;
                    const toX = side < 0 ? CX - midL / 2 : CX;
                    const lift = Math.sin(Math.PI * u) * 14;
                    g.appendChild(svgEl("rect", {
                        x: lerp(fromX, toX, u),
                        y: lerp(EDGE_Y - dth, EDGE_Y - dth - bth - dth, u) - lift,
                        width: flap,
                        height: dth,
                        rx: 1,
                        class: "edgeblock flap",
                    }));
                }
        }
        else {
            g.appendChild(svgEl("rect", { x: ex, y: ey, width: el2, height: eh, rx: 1, class: "edgeblock" }));
            const bth = (eh * butterFrac) / layers;
            const dth = (eh * (1 - butterFrac)) / (layers + 1);
            for (let k = 0; k < layers; k++) {
                const by = ey + dth * (k + 1) + bth * k;
                g.appendChild(bth >= 0.9
                    ? svgEl("rect", { x: ex, y: by, width: el2, height: bth, class: "edgebutter" })
                    : svgEl("line", { x1: ex, y1: by + bth / 2, x2: ex + el2, y2: by + bth / 2, class: "edgelayer" }));
            }
        }
        g.appendChild(svgEl("line", { x1: ex - 14, y1: ey, x2: ex - 14, y2: EDGE_Y, class: "dim" }));
        const tTxt = svgEl("text", { x: ex - 20, y: ey + eh / 2, class: "dimtext left" });
        tTxt.textContent = `${Math.round((isPackage(p) ? eh / tScale : t) * 10)} mm`;
        g.appendChild(tTxt);
        const edgeNote = svgEl("text", { x: CX, y: EDGE_Y + 20, class: "edgenote" });
        edgeNote.textContent = layers > 1 ? `${str.edge} — ${layers} ${str.layers}` : str.edge;
        g.appendChild(edgeNote);
        const gNow = lerp(p.gA, p.gB, u);
        const n = p.kind === "focus" ? (u > 0.45 ? p.nB : p.nA) : p.nA;
        const counter = svgEl("text", { x: PAD - 10, y: 38, class: "counter" });
        const amount = svgEl("tspan");
        amount.textContent = `${Math.round(gNow)} g`;
        counter.appendChild(amount);
        if (n > 1) {
            const times = svgEl("tspan", { class: "countertimes", dx: 7 });
            times.textContent = `×${n}`;
            counter.appendChild(times);
        }
        g.appendChild(counter);
        const label = svgEl("text", { x: PAD - 10, y: 56, class: "counterlabel" });
        const all = p.kind === "focus" ? p.gA : gNow * n;
        label.textContent = n > 1 ? `${str.onBench} · ${Math.round(all)} g ${str.inAll}` : str.onBench;
        g.appendChild(label);
        if (p.gB < p.gA - 0.5) {
            const aside = p.kind === "focus";
            const gone = svgEl("text", { x: PAD - 10, y: 78, class: `counterdrop${aside ? " aside" : ""}` });
            gone.textContent = `−${Math.round(p.gA - gNow)} g ${aside ? str.toFridge : str.waste}`;
            gone.setAttribute("opacity", String(Math.min(1, u * 3)));
            g.appendChild(gone);
        }
        const step = plan.steps.find((s) => s.id === p.step);
        caption.textContent = `${step.id}. ${stepTitle(step)} — ${p.label}`;
        chips.forEach((b, k) => b.classList.toggle("on", k === chapterAt(chapters, time)));
        return i;
    };
    let time = 0;
    let playing = false;
    let raf = 0;
    let last = 0;
    let stopAt = total;
    const setPlaying = (on) => {
        playing = on;
        playBtn.textContent = on ? "⏸" : time >= total - 1e-6 ? "↺" : "▶";
        playBtn.title = on ? str.pause : time >= total - 1e-6 ? str.replay : str.play;
    };
    let sounded = -1;
    const frame = (now) => {
        const dt = last ? (now - last) / 1000 : 0;
        last = now;
        if (playing) {
            time = Math.min(stopAt, time + dt);
            scrub.value = String((time / total) * 1000);
            const at = draw(time);
            if (at !== sounded) {
                sounded = at;
                const q = phases[at];
                phaseSound(q.kind, { step: degreeOf(q.step), count: q.pieces });
            }
            if (time >= stopAt) {
                setPlaying(false);
                if (time >= total - 1e-6)
                    finishSound(plan.steps.length);
            }
        }
        raf = requestAnimationFrame(frame);
    };
    const playRange = (from, to) => {
        primeSound();
        sounded = -1;
        stopAt = to < total ? to - 1e-3 : to;
        time = from;
        scrub.value = String((from / total) * 1000);
        draw(time);
        setPlaying(true);
    };
    playBtn.addEventListener("click", () => {
        if (playing) {
            setPlaying(false);
            return;
        }
        playRange(time >= total - 1e-6 ? 0 : time, total);
    });
    chips.forEach((b, i) => b.addEventListener("click", () => playRange(chapters[i].from, chapters[i].to)));
    scrub.addEventListener("input", () => {
        setPlaying(false);
        stopAt = total;
        time = (Number(scrub.value) / 1000) * total;
        draw(time);
    });
    draw(0);
    setPlaying(false);
    raf = requestAnimationFrame(frame);
    return { node: root, destroy: () => cancelAnimationFrame(raf) };
}
