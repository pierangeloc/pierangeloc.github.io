import { solve, defaultLiquids, defaults, doughForButter, formulas, layersOf, recipe, round, search, stripsOf, suggestFix, wrapSandwich } from "../lamination.js";
import { strings, fill, issueText } from "./i18n.js";
import { el, numberField, choice, vec2, section } from "./controls.js";
import { animation } from "./anim.js";
import { threeView } from "./three-view.js";
const STORE = "croissant-calc/v1";
const initial = { butterSheet: { width: 31, length: 38 } };
const load = () => {
    const base = { lang: "it", params: { ...initial }, butterMode: "measure", doughMode: "recipe", liquids: defaultLiquids, target: 0, tab: "flat" };
    try {
        const raw = localStorage.getItem(STORE);
        if (!raw)
            return base;
        return { ...base, ...JSON.parse(raw) };
    }
    catch {
        return base;
    }
};
const save = (s) => {
    try {
        localStorage.setItem(STORE, JSON.stringify(s));
    }
    catch {
    }
};
function migrateTurns(p) {
    const legacy = ["foldA", "foldB", "splitA", "splitB", "sheetA", "sheetB"];
    if (!legacy.some((k) => k in p))
        return;
    if (!p.turns) {
        const n = (k, fallback) => (typeof p[k] === "number" ? p[k] : fallback);
        const [a, b] = defaults.turns;
        p.turns = [
            { fold: n("foldA", a.fold), sheet: n("sheetA", a.sheet), split: n("splitA", a.split) },
            { fold: n("foldB", b.fold), sheet: n("sheetB", b.sheet), split: n("splitB", b.split) },
        ];
    }
    for (const k of legacy)
        delete p[k];
}
const state = load();
migrateTurns(state.params);
if (!(state.liquids in formulas))
    state.liquids = defaultLiquids;
if (state.doughMode === "recipe")
    state.params.doughMass = doughForButter(state.params.butterMass ?? defaults.butterMass, state.liquids);
let t = strings[state.lang];
const q = (sel) => document.querySelector(sel);
const panel = q("#panel");
const out = q("#out");
const butterVolume = () => (state.params.butterMass ?? defaults.butterMass) / (state.params.butterDensity ?? defaults.butterDensity);
const thickness = () => state.params.butterThickness ?? defaults.butterThickness;
const plannedSheet = () => {
    const width = state.params.rollerWidth ?? defaults.rollerWidth;
    return { width, length: round(butterVolume() / (width * thickness())) };
};
const turns = () => state.params.turns ?? defaults.turns;
const strips = () => stripsOf(turns());
function stepLines(plan, str) {
    const out = [];
    let pieces = 1;
    for (const s of plan.steps) {
        if (s.kind === "split") {
            pieces *= s.pieces;
            out.push({ id: s.id, cut: fill(str.ui.optCutLine, { n: s.pieces, total: pieces }) });
        }
        else if (s.roll && s.from) {
            out.push({
                id: s.id,
                pin: String(round(s.from.w)),
                from: String(round(s.from.l)),
                to: String(round(s.roll.l)),
                mm: `${Math.round(s.roll.t * 10)} mm`,
            });
        }
    }
    return out;
}
const sameTurns = (a, b) => a.length === b.length && a.every((x, i) => x.fold === b[i].fold && x.sheet === b[i].sheet && x.split === b[i].split);
const presets = {
    presetCroissant: defaults.turns,
    presetSfoglia: [
        { fold: 3, sheet: 1.6, split: 1 },
        { fold: 3, sheet: 1.2, split: 1 },
        { fold: 2, sheet: 1.0, split: 1 },
        { fold: 2, sheet: 1.0, split: 1 },
    ],
};
const effective = () => ({ ...state.params });
const mm = (v) => String(Math.round(v * 10));
const stripWord = (n) => (n === 1 ? t.ui.stripOne : t.ui.strips);
const modifiedTitle = (v) => fill(t.ui.modified, { v });
function num(key, opts) {
    const ref = defaults[key];
    const scale = opts.asMm ? 10 : 1;
    return numberField({
        label: t.labels[key] ?? key,
        hint: t.hints[key],
        value: state.params[key] ?? ref,
        reference: ref,
        referenceNote: `${opts.asMm ? mm(ref) : ref}${opts.unit ? " " + opts.unit : ""}`,
        min: opts.min,
        max: opts.max,
        step: opts.step,
        unit: opts.unit,
        decimals: opts.asMm ? 0 : opts.decimals,
        scale,
        onInput: (v) => set(key, v),
        onRevert: () => {
            set(key, ref);
            render();
        },
    }, modifiedTitle);
}
function syncDough() {
    if (state.doughMode !== "recipe")
        return;
    state.params.doughMass = doughForButter(state.params.butterMass ?? defaults.butterMass, state.liquids);
}
function set(key, v) {
    state.params[key] = v;
    if (key === "butterMass")
        syncDough();
    save(state);
    refreshReset();
    refreshNotes();
    recompute();
}
const baselineOf = (k) => k === "butterSheet"
    ? initial.butterSheet
    :
        k === "doughMass" && state.doughMode === "recipe"
            ? doughForButter(defaults.butterMass, state.liquids)
            : defaults[k];
const sameAsBaseline = (k) => JSON.stringify(state.params[k]) === JSON.stringify(baselineOf(k));
function changed() {
    const out = Object.keys(state.params).filter((k) => !sameAsBaseline(k));
    return out;
}
let sections = [];
let notes = [];
function derived(body, update) {
    const line = el("p", "secnote");
    const run = () => update(line);
    run();
    notes.push(run);
    body.append(line);
}
function refreshNotes() {
    for (const n of notes)
        n();
}
function refreshReset() {
    const n = changed().length;
    const btn = q("#resetAll");
    btn.disabled = n === 0;
    btn.querySelector(".txt").textContent = t.ui.resetAll;
    btn.querySelector(".count").textContent = n ? String(n) : "";
    btn.title = n === 0 ? t.ui.nothingChanged : `${t.ui.resetHint} · ${n === 1 ? t.ui.changedOne : fill(t.ui.changedMany, { n })}`;
    for (const s of sections) {
        const dirty = s.keys.some((k) => k in state.params && !sameAsBaseline(k));
        s.node.classList.toggle("dirty", dirty);
    }
}
function buildPanel() {
    panel.replaceChildren();
    sections = [];
    notes = [];
    const add = (title, keys, build) => {
        const s = section(title, t.ui.reset, () => {
            for (const k of keys)
                delete state.params[k];
            save(state);
            render();
        });
        build(s.body);
        panel.appendChild(s.node);
        sections.push({ node: s.node, keys: keys });
    };
    add(t.sections.dough, ["doughMass", "butterMass", "doughDensity", "butterDensity"], (b) => {
        b.append(choice({
            label: t.ui.doughMode,
            hint: t.ui.doughModeHint,
            value: state.doughMode,
            options: [
                { value: "recipe", label: t.ui.doughFromRecipe },
                { value: "free", label: t.ui.doughFree },
            ],
            onInput: (v) => {
                state.doughMode = v;
                if (v === "recipe")
                    syncDough();
                save(state);
                render();
            },
        }, modifiedTitle).node);
        b.append(choice({
            label: t.ui.liquids,
            hint: t.ui.liquidsHint,
            value: state.liquids,
            options: [
                { value: "semiSkimmed", label: t.ui.liquidsSemi },
                { value: "semiSkimmedMatched", label: t.ui.liquidsMatched },
                { value: "whole", label: t.ui.liquidsWhole },
            ],
            onInput: (v) => {
                state.liquids = v;
                syncDough();
                save(state);
                render();
            },
        }, modifiedTitle).node);
        b.append(num("butterMass", { min: 100, max: 3000, step: 1, unit: "g", decimals: 0 }).node);
        if (state.doughMode === "free")
            b.append(num("doughMass", { min: 500, max: 8000, step: 1, unit: "g", decimals: 0 }).node);
        b.append(num("doughDensity", { min: 0.9, max: 1.4, step: 0.01, unit: "g/cm³", decimals: 2 }).node, num("butterDensity", { min: 0.85, max: 1.0, step: 0.001, unit: "g/cm³", decimals: 3 }).node);
        derived(b, (line) => {
            const plan = solve(effective());
            const sandwich = wrapSandwich(plan);
            line.classList.toggle("bad", plan.layerRatio < 1);
            line.textContent = fill(t.ui.layersLine, {
                d: round(sandwich.doughLayer * 10, 1),
                b: round(sandwich.butter * 10, 1),
                r: round(plan.layerRatio, 2),
            });
        });
    });
    add(t.sections.tools, ["rollerWidth", "benchLength", "trim", "maxRollAspect"], (b) => {
        b.append(num("rollerWidth", { min: 20, max: 60, step: 0.5, unit: "cm" }).node, num("benchLength", { min: 60, max: 200, step: 1, unit: "cm", decimals: 0 }).node, num("trim", { min: 0, max: 3, step: 0.1, unit: "cm" }).node, num("maxRollAspect", { min: 1, max: 20, step: 0.5, unit: "\u00d7" }).node);
    });
    add(t.sections.butter, ["butterSheet", "butterThickness"], (b) => {
        b.append(choice({
            label: t.labels.butterMode,
            hint: t.hints.butterMode,
            value: state.butterMode,
            options: [
                { value: "plan", label: t.ui.butterPlan },
                { value: "measure", label: t.ui.butterMeasure },
            ],
            onInput: (v) => {
                state.butterMode = v;
                if (v === "plan")
                    delete state.params.butterSheet;
                else
                    state.params.butterSheet = state.params.butterSheet ?? { ...plannedSheet() };
                save(state);
                render();
            },
        }, modifiedTitle).node);
        if (state.butterMode === "plan") {
            b.append(num("butterThickness", { min: 0.4, max: 1.5, step: 0.05, unit: "mm", asMm: true }).node);
            derived(b, (line) => {
                const sheet = plannedSheet();
                line.textContent = fill(t.ui.plannedSlab, {
                    w: round(sheet.width),
                    l: round(sheet.length),
                    mm: mm(thickness()),
                });
            });
            return;
        }
        const bs = state.params.butterSheet ?? plannedSheet();
        b.append(vec2({
            label: t.labels.butterSheet,
            hint: t.hints.butterSheet,
            value: [bs.width, bs.length],
            names: ["W", "L"],
            min: 10,
            max: 60,
            step: 0.5,
            unit: "cm",
            swap: true,
            swapTitle: t.ui.swapSides,
            onInput: ([w, l]) => set("butterSheet", { width: w, length: l }),
        }, modifiedTitle).node);
        derived(b, (line) => {
            const sheet = state.params.butterSheet ?? plannedSheet();
            const v = butterVolume() / (sheet.width * sheet.length);
            line.textContent = fill(t.ui.measuredSlab, { mm: round(v * 10, 1) });
        });
    });
    add(t.sections.folds, ["turns"], (b) => {
        const write = (next) => {
            set("turns", next);
            render();
        };
        const edit = (i, patch) => write(turns().map((turn, k) => (k === i ? { ...turn, ...patch } : turn)));
        const base = (i, field) => defaults.turns[i]?.[field] ?? turns()[i][field];
        turns().forEach((turn, i) => {
            const box = el("div", "turn");
            box.appendChild(el("h4", undefined, fill(t.ui.turnTitle, { n: i + 1 })));
            box.append(numberField({
                label: t.labels.sheet,
                value: turn.sheet,
                reference: base(i, "sheet"),
                referenceNote: `${base(i, "sheet")} cm`,
                min: 0.4,
                max: 3.0,
                step: 0.1,
                unit: "cm",
                onInput: (v) => edit(i, { sheet: v }),
                onRevert: () => edit(i, { sheet: base(i, "sheet") }),
            }, modifiedTitle).node, choice({
                label: t.labels.fold,
                value: turn.fold,
                reference: base(i, "fold"),
                options: [2, 3, 4].map((v) => ({ value: v, label: String(v) })),
                onInput: (v) => edit(i, { fold: v }),
                onRevert: () => edit(i, { fold: base(i, "fold") }),
            }, modifiedTitle).node, choice({
                label: t.labels.split,
                value: turn.split,
                reference: base(i, "split"),
                options: [1, 2, 3, 4, 5, 6].map((v) => ({ value: v, label: String(v) })),
                onInput: (v) => edit(i, { split: v }),
                onRevert: () => edit(i, { split: base(i, "split") }),
            }, modifiedTitle).node);
            if (turns().length > 1 && i === turns().length - 1) {
                const rm = el("button", "turnrm", "×");
                rm.type = "button";
                rm.title = t.ui.removeTurn;
                rm.addEventListener("click", () => write(turns().slice(0, -1)));
                box.appendChild(rm);
            }
            b.appendChild(box);
        });
        const addBtn = el("button", "addturn", t.ui.addTurn);
        addBtn.type = "button";
        addBtn.addEventListener("click", () => {
            const list = turns();
            write([...list, { fold: 3, sheet: list[list.length - 1]?.sheet ?? 1.0, split: 1 }]);
        });
        b.appendChild(addBtn);
        const row = el("div", "presets");
        row.appendChild(el("span", "label", t.ui.presets));
        for (const [key, plan] of Object.entries(presets)) {
            const btn = el("button", "preset", t.ui[key]);
            btn.type = "button";
            btn.addEventListener("click", () => write(plan.map((x) => ({ ...x }))));
            row.appendChild(btn);
        }
        b.appendChild(row);
        b.appendChild(el("p", "secnote", t.ui.presetsHint));
        derived(b, (line) => {
            const list = turns();
            const n = stripsOf(list);
            line.textContent = fill(t.ui.turnsLine, { turns: list.length, layers: layersOf(list), strips: n, strip: stripWord(n) });
        });
    });
    {
        const s = section(t.sections.goal, t.ui.reset, () => {
            state.target = 0;
            save(state);
            render();
        });
        s.body.appendChild(numberField({
            label: t.labels.targetHeight,
            hint: t.hints.targetHeight,
            value: state.target,
            min: 0,
            max: 32,
            step: 0.5,
            unit: "cm",
            onInput: (v) => {
                state.target = v;
                save(state);
                recompute();
            },
        }, modifiedTitle).node);
        s.node.classList.toggle("dirty", state.target > 0);
        panel.appendChild(s.node);
    }
    add(t.sections.final, ["finalThickness"], (b) => {
        b.append(num("finalThickness", { min: 0.2, max: 1.0, step: 0.05, unit: "mm", asMm: true }).node);
    });
    add(t.sections.products, ["croissantBase", "pacWidth", "wantPac", "cutStyle"], (b) => {
        b.append(num("croissantBase", { min: 6, max: 16, step: 0.5, unit: "cm" }).node, num("pacWidth", { min: 3, max: 10, step: 0.5, unit: "cm" }).node, num("wantPac", { min: 0, max: 120, step: 1, unit: "", decimals: 0 }).node);
        b.append(choice({
            label: t.labels.cutStyle,
            hint: t.hints.cutStyle,
            value: state.params.cutStyle ?? defaults.cutStyle,
            reference: undefined,
            options: [
                { value: "diagonal", label: t.ui.cutDiagonal },
                { value: "zigzag", label: t.ui.cutZigzag },
            ],
            onInput: (v) => set("cutStyle", v),
        }, modifiedTitle).node);
    });
}
const dim = (d) => d ? `${round(d.w)}×${round(d.l)}×${round(d.t, 1)}` : "—";
function stepTitle(s, p) {
    const turn = s.turn !== null ? (p.turns ?? defaults.turns)[s.turn] : undefined;
    const n = s.kind === "fold" ? (turn?.fold ?? 0) : s.kind === "split" ? (turn?.split ?? 0) : 0;
    return fill(t.steps[s.kind], { n });
}
function note(s, plan) {
    const bs = plan.butterSheet;
    switch (s.kind) {
        case "package": {
            const d = plan.doughSheet;
            return fill(t.notes.wrap, {
                dw: round(d.w),
                dl: round(d.l),
                dmm: round(d.t * 10, 0),
                w: round(bs.width),
                l: round(bs.length),
                mm: round(bs.thickness * 10, 0),
            });
        }
        case "split":
            return fill(t.notes.split, { a: round(s.from.l), n: Math.round(plan.strips / piecesAfter(plan, s)) });
        case "final":
            return t.notes.final;
        default:
            return "";
    }
}
function mmPath(path) {
    return path.map((t) => Math.round(t * 10)).join(" → ") + " mm";
}
function piecesAfter(plan, s) {
    let after = 1;
    let seen = false;
    for (const x of plan.steps) {
        if (seen && x.kind === "split")
            after *= x.pieces;
        if (x === s)
            seen = true;
    }
    return after;
}
function restOf(s, plan) {
    if (s.kind !== "fold")
        return t.rest[s.kind] ?? "";
    const folds = plan.steps.filter((x) => x.kind === "fold");
    return s === folds[folds.length - 1] ? t.rest.foldLast : t.rest.fold;
}
function operation(s, plan) {
    if (s.kind === "package" || s.kind === "split")
        return note(s, plan);
    const last = s.kind === "final";
    const parts = [fill(t.ui.rollAlong, { n: round(s.rollAlong ?? 0) }) + ` → ${dim(s.roll)}`];
    if (s.trimmed)
        parts.push(fill(t.ui.trimTo, { n: last ? dim(s.trimmed) : round(s.trimmed.l) }));
    if (s.thicknessPath.length > 1)
        parts.push(`(${mmPath(s.thicknessPath)})`);
    return parts.join(", ") + (last ? ` — ${note(s, plan)}` : "");
}
function table(head, rows) {
    const tbl = el("table");
    const thead = el("thead");
    const hr = el("tr");
    head.forEach((h) => hr.appendChild(el("th", undefined, h)));
    thead.appendChild(hr);
    const tbody = el("tbody");
    rows.forEach((r) => {
        const tr = el("tr");
        r.forEach((c) => tr.appendChild(el("td", undefined, c)));
        tbody.appendChild(tr);
    });
    tbl.append(thead, tbody);
    return tbl;
}
const changeText = (c) => fill(c.field === "sheet" ? t.ui.changeSheet : t.ui.changeSplit, { n: c.turn + 1, v: c.to });
function fixLine(p) {
    const fix = suggestFix(p);
    if (!fix)
        return el("p", "fix none", t.ui.noFix);
    const how = fix.changes.map(changeText).join(", ");
    const line = el("p", "fix");
    line.appendChild(el("span", undefined, fill(t.ui.suggestion, { how, strips: fix.strips, total: fix.plan.croissant.total })));
    const btn = el("button", "applyfix", t.ui.applyFix);
    btn.type = "button";
    btn.addEventListener("click", () => {
        state.params.turns = fix.params.turns;
        save(state);
        render();
    });
    line.appendChild(btn);
    return line;
}
let anim = null;
let view3d = null;
const animStrings = () => ({
    roll: t.ui.animRoll,
    trim: t.ui.animTrim,
    fold: t.ui.animFold,
    cut: t.ui.animCut,
    rotate: t.ui.animRotate,
    wrap: t.ui.animWrap,
    place: t.ui.animPlace,
    shape: t.ui.animShape,
    play: t.ui.animPlay,
    pause: t.ui.animPause,
    replay: t.ui.animReplay,
    keep: t.ui.animKeep,
    layers: t.ui.animLayers,
    edge: t.ui.animEdge,
    chapter: t.ui.animChapter,
    prep: t.ui.animPrep,
    soundOn: t.ui.animSoundOn,
    soundOff: t.ui.animSoundOff,
    onBench: t.ui.animOnBench,
    waste: t.ui.animWaste,
    toFridge: t.ui.animToFridge,
    inAll: t.ui.animInAll,
    speed: t.ui.animPlay,
    share: t.ui.animShare,
    shareAll: t.ui.animShareAll,
});
const threeStrings = () => ({
    roll: t.ui.animRoll,
    trim: t.ui.animTrim,
    fold: t.ui.animFold,
    cut: t.ui.animCut,
    rotate: t.ui.animRotate,
    wrap: t.ui.animWrap,
    place: t.ui.animPlace,
    shape: t.ui.animShape,
    keep: t.ui.animKeep,
    play: t.ui.animPlay,
    pause: t.ui.animPause,
    replay: t.ui.animReplay,
    chapter: t.ui.animChapter,
    prep: t.ui.animPrep,
    resetView: t.ui.d3ResetView,
    cutFace: t.ui.d3CutFace,
    trueScale: t.ui.d3True,
    exaggerated: t.ui.d3Exaggerated,
    scaleTrue: t.ui.d3ScaleTrue,
    scaleSwitch: t.ui.d3ScaleSwitch,
    scaleNote: t.ui.d3ScaleNote,
    layersLabel: t.ui.d3Layers,
    layersGrouped: t.ui.d3LayersGrouped,
    volumeLabel: t.ui.d3Volume,
    noseNote: t.ui.d3Nose,
    relief: t.ui.d3Relief,
    reliefCut: t.ui.d3ReliefCut,
    reliefDepth: t.ui.d3ReliefDepth,
    trimNote: t.ui.d3Trim,
    loading: t.ui.d3Loading,
    unsupported: t.ui.d3Unsupported,
    drag: t.ui.d3Drag,
});
let lastKey = "";
let lastHits = [];
function options(p) {
    const box = el("div", "options");
    box.appendChild(el("h3", undefined, `${t.ui.options}: ${round(state.target)} cm`));
    const key = JSON.stringify([p, state.target]);
    if (key !== lastKey) {
        lastKey = key;
        lastHits = search(p, { targetHeight: state.target, maxResults: 6 });
    }
    const hits = lastHits;
    if (!hits.length) {
        box.appendChild(el("p", "muted", t.ui.noOptions));
        return box;
    }
    const tbl = el("table", "opts");
    const thead = el("thead");
    const hr = el("tr");
    for (const h of [t.ui.optStep, t.ui.optPin, t.ui.optRoll, t.ui.optTo, t.ui.optThick, t.ui.optStrip, t.ui.optCro, ""])
        hr.appendChild(el("th", undefined, h));
    thead.appendChild(hr);
    const tbody = el("tbody");
    for (const { params: q, plan } of hits) {
        const mine = sameTurns(turns(), q.turns);
        const lines = stepLines(plan, t);
        lines.forEach((ln, j) => {
            const tr = el("tr", [mine ? "applied" : "", j === 0 ? "first" : "", j === lines.length - 1 ? "last" : ""].join(" ").trim());
            tr.appendChild(el("td", "n", `${ln.id}.`));
            if (ln.cut !== undefined) {
                const td = el("td", "cut", ln.cut);
                td.colSpan = 4;
                tr.appendChild(td);
            }
            else {
                tr.append(el("td", "pin", ln.pin), el("td", "from", ln.from), el("td", "to", ln.to), el("td", "mm", ln.mm));
            }
            if (j === 0) {
                const span = (cls, text) => {
                    const td = el("td", cls, text);
                    td.rowSpan = lines.length;
                    return td;
                };
                const act = span("act", "");
                const btn = el("button", "applyfix", mine ? t.ui.optInUse : t.ui.optUse);
                btn.type = "button";
                btn.disabled = mine;
                btn.addEventListener("click", () => {
                    Object.assign(state.params, q);
                    save(state);
                    render();
                });
                act.appendChild(btn);
                tr.append(span("strip", `${round(plan.strip.height)}×${round(plan.strip.length)}`), span(undefined, String(plan.croissant.total)), act);
            }
            tbody.appendChild(tr);
        });
    }
    tbl.append(thead, tbody);
    const scroll = el("div", "tablescroll");
    scroll.appendChild(tbl);
    box.appendChild(scroll);
    box.appendChild(el("p", "muted", t.ui.optNote));
    return box;
}
function renderOut(plan, p) {
    out.replaceChildren();
    const status = el("div", `status ${plan.feasible ? "ok" : "bad"}`);
    status.appendChild(el("span", "tag", plan.feasible ? t.ui.feasible : t.ui.notFeasible));
    out.appendChild(status);
    if (plan.issues.length) {
        const box = el("div", "warnings");
        box.appendChild(el("h3", undefined, t.ui.warnings));
        const ul = el("ul");
        for (const i of plan.issues)
            ul.appendChild(el("li", undefined, issueText(i.code, i.step, i.values, state.lang)));
        box.appendChild(ul);
        if (!plan.feasible)
            box.appendChild(fixLine(p));
        out.appendChild(box);
    }
    if (state.target > 0)
        out.appendChild(options(p));
    anim?.destroy();
    view3d?.destroy();
    view3d = null;
    const masses = { dough: p.doughMass ?? defaults.doughMass, butter: p.butterMass ?? defaults.butterMass };
    anim = animation(plan, animStrings(), masses, (s) => stepTitle(s, p));
    const animBox = el("div", "animbox");
    const head = el("div", "animhead");
    head.appendChild(el("h3", undefined, t.ui.anim));
    const tabs = el("div", "animtabs");
    const flatPane = el("div", "animpane");
    flatPane.appendChild(anim.node);
    const threePane = el("div", "animpane");
    threePane.hidden = true;
    const tabFlat = el("button", "animtab on", t.ui.tabFlat);
    const tab3d = el("button", "animtab", t.ui.tab3d);
    tabFlat.type = "button";
    tab3d.type = "button";
    tab3d.title = t.ui.tab3dHint;
    const show3d = (on) => {
        tab3d.classList.toggle("on", on);
        tabFlat.classList.toggle("on", !on);
        threePane.hidden = !on;
        flatPane.hidden = on;
        if (on && !view3d) {
            view3d = threeView(plan, threeStrings(), masses, (s) => stepTitle(s, p));
            threePane.appendChild(view3d.node);
        }
        state.tab = on ? "3d" : "flat";
        save(state);
    };
    tabFlat.addEventListener("click", () => show3d(false));
    tab3d.addEventListener("click", () => show3d(true));
    tabs.append(tabFlat, tab3d);
    head.appendChild(tabs);
    animBox.append(head, flatPane, threePane);
    out.appendChild(animBox);
    if (state.tab === "3d")
        show3d(true);
    out.appendChild(table([t.ui.step, t.ui.underPin, t.ui.operation, t.ui.result, t.ui.then], plan.steps.map((s) => [
        `${s.id}. ${stepTitle(s, p)}`,
        s.pin === null ? "—" : String(round(s.pin)),
        operation(s, plan),
        dim(s.result) + (s.pieces > 1 ? ` ×${s.pieces}` : ""),
        [s.rotate90 ? t.ui.rotate : "", restOf(s, plan) ? `${t.ui.rest} ${restOf(s, plan)}` : ""].filter(Boolean).join(", "),
    ])));
    const w = wrapSandwich(plan);
    const wd = round(w.doughLayer * 10, 0);
    const wb = round(w.butter * 10, 0);
    out.appendChild(el("p", "line", fill(t.ui.sandwich, { d: wd, b: wb, total: 2 * wd + wb })));
    const c = plan.croissant;
    out.appendChild(el("p", "line", `${t.ui.finalStrip}: ${round(plan.strip.height)}×${round(plan.strip.length)} cm · ${plan.strips} ${stripWord(plan.strips)} · ${plan.layers} ${t.ui.layers}`));
    const yieldBox = el("div", "yield");
    yieldBox.appendChild(el("p", "big", `${t.ui.croissants}: ` +
        fill(t.ui.croissantLine, { base: round(c.base), height: round(c.height), perStrip: c.perStrip, total: c.total }) +
        ` · ${round(c.grams, 0)} g`));
    yieldBox.appendChild(el("p", undefined, `${t.ui.pac}: ` +
        fill(t.ui.pacLine, {
            w: round(plan.pac.width),
            h: round(plan.pac.height),
            perStrip: plan.pac.perStrip,
            total: plan.pac.total,
        }) +
        ` · ${round(plan.pac.grams, 0)} g`));
    const total = (p.doughMass ?? defaults.doughMass) + (p.butterMass ?? defaults.butterMass);
    yieldBox.appendChild(el("p", "muted", fill(t.ui.used, {
        used: round(plan.usedGrams, 0),
        trim: round(plan.trimmedGrams, 0),
        pct: round((plan.trimmedGrams / total) * 100, 0),
    })));
    out.appendChild(yieldBox);
    out.appendChild(cutPlan(plan));
    out.appendChild(recipeBox(p));
}
function recipeBox(p) {
    const dough = p.doughMass ?? defaults.doughMass;
    const butter = p.butterMass ?? defaults.butterMass;
    const box = el("div", "options");
    box.appendChild(el("h3", undefined, fill(t.ui.recipeTitle, { dough: round(dough, 0) })));
    const name = {
        flour: t.ui.ingFlour,
        water: t.ui.ingWater,
        milk: t.ui.ingMilk,
        semiSkimmedMilk: t.ui.ingSemiSkimmedMilk,
        butter: t.ui.ingButter,
        sugar: t.ui.ingSugar,
        yeast: t.ui.ingYeast,
        salt: t.ui.ingSalt,
    };
    const ing = recipe(dough, state.liquids);
    const tbl = table([t.ui.recipeIng, t.ui.recipeG, t.ui.recipePct], [
        ...ing.map((i) => [name[i.key], String(i.grams), `${i.pct}%`]),
        [t.ui.recipeTotal, String(round(dough, 0)), ""],
        [t.ui.recipeLam, String(round(butter, 0)), `${round((butter / ing[0].grams) * 100, 1)}%`],
    ]);
    box.appendChild(tbl);
    const yeast = ing.find((i) => i.key === "yeast");
    box.appendChild(el("p", "muted", fill(t.ui.recipeNote, { summer: round((yeast.grams * 60) / 70, 0) })));
    if (state.liquids !== "whole")
        box.appendChild(el("p", "muted", state.liquids === "semiSkimmed" ? t.ui.recipeSemiNote : t.ui.recipeMatchedNote));
    return box;
}
function cutPlan(plan) {
    const box = el("div", "options");
    box.appendChild(el("h3", undefined, t.ui.cutPlan));
    const rows = [];
    for (const s of plan.allocation.stripBreakdown) {
        const last = rows[rows.length - 1];
        if (last && last.pac === s.pac && last.cro === s.croissants)
            last.to = s.strip;
        else
            rows.push({ from: s.strip, to: s.strip, pac: s.pac, cro: s.croissants, left: s.leftover });
    }
    box.appendChild(table([t.ui.cutStrips, t.ui.cutPacCol, t.ui.cutCroCol, t.ui.cutLeftCol], rows.map((r) => [
        r.from === r.to ? fill(t.ui.cutOne, { n: r.from }) : fill(t.ui.cutRange, { a: r.from, b: r.to }),
        r.pac ? String(r.pac) : "—",
        r.cro ? String(r.cro) : "—",
        `${round(r.left, 1)} cm`,
    ])));
    box.appendChild(el("p", "muted", fill(plan.croissant.cutStyle === "zigzag" ? t.ui.cutHowZigzag : t.ui.cutHow, {
        w: round(plan.pac.width),
        b: round(plan.croissant.base),
    })));
    return box;
}
function recompute() {
    const p = effective();
    renderOut(solve(p), p);
}
function render() {
    t = strings[state.lang];
    q("#title").textContent = t.title;
    q("#subtitle").textContent = t.subtitle;
    buildPanel();
    refreshReset();
    recompute();
}
for (const b of document.querySelectorAll("[data-lang]")) {
    b.addEventListener("click", () => {
        state.lang = b.dataset.lang;
        save(state);
        for (const o of document.querySelectorAll("[data-lang]"))
            o.classList.toggle("on", o === b);
        render();
    });
    b.classList.toggle("on", b.dataset.lang === state.lang);
}
q("#resetAll").addEventListener("click", () => {
    state.params = { ...initial };
    state.butterMode = "measure";
    state.liquids = defaultLiquids;
    syncDough();
    save(state);
    render();
});
document.addEventListener("keydown", (e) => {
    if (!/^[1-9]$/.test(e.key))
        return;
    if (document.activeElement?.closest(".seg"))
        return;
    const row = document.querySelector(".row.choice:hover");
    if (!row)
        return;
    const btns = row.querySelectorAll(".segbtn");
    btns[Number(e.key) - 1]?.click();
});
render();
