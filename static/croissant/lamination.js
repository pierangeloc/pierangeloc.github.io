export const defaults = {
    doughMass: 3223,
    butterMass: 1000,
    doughDensity: 1.15,
    butterDensity: 0.911,
    rollerWidth: 34,
    benchLength: 150,
    trim: 1,
    butterThickness: 0.8,
    turns: [
        { fold: 4, sheet: 1.0, split: 2 },
        { fold: 3, sheet: 1.0, split: 3 },
    ],
    finalThickness: 0.4,
    maxPassRatio: 1.7,
    maxRollAspect: 4,
    croissantBase: 10,
    cutStyle: "diagonal",
    pacWidth: 5.5,
    wantPac: 0,
};
export const defaultLiquids = "semiSkimmed";
export const wholeMilk = { water: 0.878, fat: 0.035, solids: 0.087 };
export const semiSkimmedMilk = { water: 0.896, fat: 0.015, solids: 0.089 };
export const doughButter = { water: 0.16, fat: 0.82, solids: 0.02 };
export function swapKeepingEverything(water, whole, butter) {
    const target = {
        water: water + whole * wholeMilk.water,
        fat: whole * wholeMilk.fat,
        solids: whole * wholeMilk.solids,
    };
    const det = semiSkimmedMilk.solids * doughButter.fat - semiSkimmedMilk.fat * doughButter.solids;
    const milk = (target.solids * doughButter.fat - target.fat * doughButter.solids) / det;
    const extraButter = (semiSkimmedMilk.solids * target.fat - semiSkimmedMilk.fat * target.solids) / det;
    return {
        milk,
        water: target.water - milk * semiSkimmedMilk.water - extraButter * doughButter.water,
        butter: butter + extraButter,
        extraButter,
    };
}
export function swapKeepingHydration(water, whole, milk) {
    const targetWater = water + whole * wholeMilk.water;
    return { milk, water: targetWater - milk * semiSkimmedMilk.water };
}
export const courseFormula = {
    ingredients: [
        { key: "flour", grams: 1820, pct: 100 },
        { key: "water", grams: 480, pct: 26.4 },
        { key: "milk", grams: 320, pct: 17.6 },
        { key: "butter", grams: 320, pct: 17.6 },
        { key: "sugar", grams: 180, pct: 9.9 },
        { key: "yeast", grams: 70, pct: 3.8 },
        { key: "salt", grams: 33, pct: 1.8 },
    ],
    dough: 3223,
    butter: 1000,
};
function formulaOf(grams, order) {
    const flour = grams.flour;
    const ingredients = order
        .filter((k) => grams[k] !== undefined)
        .map((k) => ({ key: k, grams: round(grams[k], 0), pct: round((grams[k] / flour) * 100, 1) }));
    return {
        ingredients,
        dough: ingredients.reduce((n, i) => n + i.grams, 0),
        butter: courseFormula.butter,
    };
}
const courseGrams = Object.fromEntries(courseFormula.ingredients.map((i) => [i.key, i.grams]));
const order = ["flour", "semiSkimmedMilk", "water", "milk", "butter", "sugar", "yeast", "salt"];
export const semiSkimmedMatchedFormula = (() => {
    const sw = swapKeepingEverything(courseGrams.water, courseGrams.milk, courseGrams.butter);
    return formulaOf({ ...courseGrams, milk: undefined, water: sw.water, semiSkimmedMilk: sw.milk, butter: sw.butter }, order);
})();
export const semiSkimmedFormula = (() => {
    const c = swapKeepingHydration(courseGrams.water, courseGrams.milk, 800);
    return formulaOf({ ...courseGrams, milk: undefined, water: c.water, semiSkimmedMilk: c.milk }, order);
})();
export const formulas = {
    whole: courseFormula,
    semiSkimmed: semiSkimmedFormula,
    semiSkimmedMatched: semiSkimmedMatchedFormula,
};
export const doughPerButter = (liquids = defaultLiquids) => formulas[liquids].dough / formulas[liquids].butter;
export const doughForButter = (butterMass, liquids = defaultLiquids) => round(butterMass * doughPerButter(liquids), 0);
export function recipe(doughMass, liquids = defaultLiquids) {
    const f = formulas[liquids];
    const k = doughMass / f.dough;
    return f.ingredients.map((i) => ({ ...i, grams: round(i.grams * k, 0) }));
}
function round(x, d = 1) {
    const f = 10 ** d;
    return Math.round(x * f) / f;
}
export function trianglesInStrip(len, base, style = "diagonal") {
    if (base <= 0 || len <= 0)
        return 0;
    if (style === "diagonal")
        return 2 * Math.floor(len / base + 1e-9);
    return Math.max(0, Math.floor((2 * len) / base + 1e-9) - 1);
}
export function thicknessPath(from, to, ratio) {
    const out = [round(from, 2)];
    let cur = from;
    let guard = 0;
    while (cur > to * 1.0001 && guard++ < 20) {
        cur = Math.max(to, cur / ratio);
        out.push(round(cur, 2));
    }
    if (out[out.length - 1] !== round(to, 2))
        out.push(round(to, 2));
    return out;
}
export function triangleRun(n, base, style = "diagonal") {
    if (n <= 0)
        return 0;
    return style === "diagonal" ? (n / 2) * base : ((n + 1) * base) / 2;
}
function allocate(stripSet, base, pacW, pacH, wantPac, style) {
    let left = wantPac;
    const breakdown = stripSet.map((s) => {
        const rows = Math.max(1, Math.floor(s.height / pacH + 1e-9));
        const roomCols = Math.floor(s.length / pacW + 1e-9);
        const cols = Math.min(roomCols, Math.ceil(left / rows));
        const pac = Math.max(0, Math.min(left, cols * rows));
        left -= pac;
        const rest = s.length - cols * pacW;
        const croissants = trianglesInStrip(rest, base, style);
        return {
            strip: s.strip,
            croissants,
            pac,
            leftover: round(Math.max(0, rest - triangleRun(croissants, base, style)), 2),
        };
    });
    return {
        feasible: left <= 0,
        pac: breakdown.reduce((n, b) => n + b.pac, 0),
        croissants: breakdown.reduce((n, b) => n + b.croissants, 0),
        stripBreakdown: breakdown,
    };
}
export function solve(input = {}) {
    const p = { ...defaults, ...input };
    const warnings = [];
    const issues = [];
    const steps = [];
    let feasible = true;
    const note = (msg, code, values, step) => {
        warnings.push(msg);
        issues.push({ code, step, values });
    };
    const bad = (msg, code, values, step) => {
        feasible = false;
        note(msg, code, values, step);
    };
    const vDough = p.doughMass / p.doughDensity;
    const vButter = p.butterMass / p.butterDensity;
    const vTot = vDough + vButter;
    const massTot = p.doughMass + p.butterMass;
    const rho = massTot / vTot;
    const W0 = p.packageWidth ?? (p.butterSheet ? p.butterSheet.width : p.rollerWidth);
    const wb = p.butterSheet?.width ?? W0;
    const lb = p.butterSheet?.length ?? vButter / (wb * p.butterThickness);
    const tb = vButter / (wb * lb);
    const packLen = lb;
    const doughLen = 2 * packLen;
    const tDough = vDough / (W0 * doughLen);
    const t0 = vTot / (W0 * packLen);
    const doughSheet = { w: W0, l: doughLen, t: tDough };
    const layerRatio = tDough / tb;
    if (layerRatio < 1)
        note(`Il burro (${round(tb * 10, 1)} mm) è più spesso di ogni strato d'impasto (${round(tDough * 10, 1)} mm): ` +
            `servono almeno ${round((2 * vButter * p.doughDensity) / 1000, 1)} kg d'impasto per questo burro.`, "butterThickerThanDough", { ratio: layerRatio, butter: tb, dough: tDough, needDough: 2 * vButter * p.doughDensity }, "0");
    if (W0 > p.rollerWidth + 1e-9)
        bad(`Il pacchetto è largo ${round(W0)} cm, più del mattarello (${p.rollerWidth}).`, "packageTooWide", { width: W0, limit: p.rollerWidth }, "0");
    if (doughLen > p.benchLength + 1e-9)
        bad(`Passo 0: foglio lungo ${round(doughLen)} cm, il piano è ${p.benchLength}.`, "benchExceeded", { length: doughLen, limit: p.benchLength }, "0");
    steps.push({
        id: "0",
        kind: "package",
        turn: null,
        title: "Avvolgi il burro",
        pin: W0,
        rollAlong: null,
        from: null,
        roll: doughSheet,
        trimmed: null,
        thicknessPath: [],
        result: { w: W0, l: packLen, t: t0 },
        pieces: 1,
        rotate90: false,
        rest: "30 min",
        note: `Stendi l'impasto a ${round(W0)}×${round(doughLen)} (${round(tDough * 10, 0)} mm). ` +
            `Metti il panetto ${round(wb)}×${round(lb)} (≈${round(tb * 10, 0)} mm) al centro, ` +
            `ripiega i due lembi esterni sopra il burro fino a farli combaciare in mezzo, e sigilla.`,
    });
    let pin = W0;
    let along = packLen;
    let t = t0;
    let vPiece = vTot;
    let layers = 1;
    let strips = 1;
    let panel = packLen;
    if (!p.turns.length)
        bad("Nessuna piega: servono almeno una piega e una sfoglia finale.", "noTurns", {});
    for (const [i, turn] of p.turns.entries()) {
        const id = String(steps.length);
        const L = vPiece / (pin * turn.sheet);
        const Lt = L - 2 * p.trim;
        panel = Lt / turn.fold;
        const tBlock = turn.fold * turn.sheet;
        if (!(turn.fold >= 2) || !(turn.sheet > 0) || !(turn.split >= 1))
            bad(`Passo ${id}: piega non valida.`, "invalidTurn", { fold: turn.fold, sheet: turn.sheet, split: turn.split }, id);
        if (i > 0 && pin > p.rollerWidth + 1e-9)
            bad(`Passo ${id}: sotto il mattarello ci sono ${round(pin)} cm, il limite è ${p.rollerWidth}.`, "rollerExceeded", { width: pin, limit: p.rollerWidth }, id);
        if (pin > p.maxRollAspect * along + 1e-9)
            bad(`Passo ${id}: il pezzo è largo ${round(pin)} cm sotto il mattarello e lungo solo ${round(along)}: si tirerebbe il lato corto.`, "shortSideRoll", { width: pin, length: along, limit: p.maxRollAspect }, id);
        if (L > p.benchLength + 1e-9)
            bad(`Passo ${id}: foglio lungo ${round(L)} cm, il piano è ${p.benchLength}.`, "benchExceeded", { length: L, limit: p.benchLength }, id);
        if (panel <= 2 * p.trim)
            bad(`Passo ${id}: la striscia dopo la piega è troppo stretta.`, "stripTooNarrow", { width: panel }, id);
        steps.push({
            id,
            kind: "fold",
            turn: i,
            title: `Piega a ${turn.fold}`,
            pin,
            rollAlong: along,
            from: { w: pin, l: along, t },
            roll: { w: pin, l: L, t: turn.sheet },
            trimmed: { w: pin, l: Lt, t: turn.sheet },
            thicknessPath: thicknessPath(t, turn.sheet, p.maxPassRatio),
            result: { w: pin, l: panel, t: tBlock },
            pieces: 1,
            rotate90: true,
            rest: i === p.turns.length - 1 ? "45-60 min" : "30 min",
            note: null,
        });
        layers *= turn.fold;
        t = tBlock;
        vPiece = pin * panel * tBlock;
        if (turn.split > 1) {
            const cut = String(steps.length);
            const wPiece = pin / turn.split;
            strips *= turn.split;
            steps.push({
                id: cut,
                kind: "split",
                turn: i,
                title: `Dividi in ${turn.split}`,
                pin: null,
                rollAlong: null,
                from: { w: pin, l: panel, t },
                roll: null,
                trimmed: null,
                thicknessPath: [],
                result: { w: wPiece, l: panel, t },
                pieces: turn.split,
                rotate90: false,
                rest: "gli altri pezzi in frigo, affiancati",
                note: `Taglio parallelo al lato da ${round(panel)} cm. In totale ${strips} pezzi.`,
            });
            pin = wPiece;
            vPiece /= turn.split;
        }
        [pin, along] = [panel, pin];
    }
    const b = pin;
    const lPiece = along;
    const H = b - 2 * p.trim;
    const pacH = p.pacHeight ?? H;
    const t5 = p.finalThickness;
    if (!(t5 > 0))
        bad("Spessore finale non valido.", "invalidFinalThickness", {}, String(steps.length));
    const L5 = (vPiece / b) / t5;
    const finalId = String(steps.length);
    if (b > p.rollerWidth + 1e-9)
        bad(`Passo ${finalId}: sotto il mattarello ci sono ${round(b)} cm, il limite è ${p.rollerWidth}.`, "rollerExceeded", { width: b, limit: p.rollerWidth }, finalId);
    if (b > p.maxRollAspect * lPiece + 1e-9)
        bad(`Passo ${finalId}: il pezzo è largo ${round(b)} cm sotto il mattarello e lungo solo ${round(lPiece)}: si tirerebbe il lato corto.`, "shortSideRoll", { width: b, length: lPiece, limit: p.maxRollAspect }, finalId);
    if (L5 > p.benchLength + 1e-9)
        bad(`Passo ${finalId}: foglio lungo ${round(L5)} cm, il piano è ${p.benchLength}.`, "benchExceeded", { length: L5, limit: p.benchLength }, finalId);
    const stripLen = L5 - 2 * p.trim;
    const rows = Math.max(1, Math.floor(H / pacH + 1e-9));
    const stripSet = Array.from({ length: strips }, (_, i) => ({
        strip: i + 1,
        thickness: t5,
        height: H,
        length: stripLen,
        croissants: trianglesInStrip(stripLen, p.croissantBase, p.cutStyle),
        pac: rows * Math.floor(stripLen / p.pacWidth + 1e-9),
        grams: H * stripLen * t5 * rho,
    }));
    const ref = stripSet[0];
    steps.push({
        id: finalId,
        kind: "final",
        turn: null,
        title: "Taglio",
        pin: b,
        rollAlong: lPiece,
        from: { w: b, l: lPiece, t },
        roll: { w: b, l: L5, t: ref.thickness },
        trimmed: { w: H, l: ref.length, t: ref.thickness },
        thicknessPath: thicknessPath(t, ref.thickness, p.maxPassRatio),
        result: { w: H, l: ref.length, t: ref.thickness },
        pieces: 1,
        rotate90: false,
        rest: "tra le passate se il burro unge o la pasta si ritira",
        note: "Rifila teste e lati: la striscia che resta è quella da tagliare.",
    });
    const perStrip = ref.croissants;
    const triGrams = ((p.croissantBase * H) / 2) * ref.thickness * rho;
    const pacPerStrip = ref.pac;
    const pacGrams = p.pacWidth * pacH * ref.thickness * rho;
    const allocation = allocate(stripSet, p.croissantBase, p.pacWidth, pacH, p.wantPac, p.cutStyle);
    const maxPac = stripSet.reduce((n, s) => n + s.pac, 0);
    if (!allocation.feasible)
        bad(`Non bastano le strisce per ${p.wantPac} pain au chocolat (max ${maxPac}).`, "notEnoughStripsForPac", { want: p.wantPac, max: maxPac });
    if (H <= 0 || stripSet.some((s) => s.length <= 0))
        bad("Striscia finale di dimensioni non valide.", "invalidStrip", { height: H }, "5");
    if (stripSet.some((s) => s.croissants === 0))
        bad("La base scelta non entra nella striscia.", "baseTooWide", { base: p.croissantBase }, "5");
    const usedGrams = stripSet.reduce((n, s) => n + s.grams, 0);
    return {
        feasible,
        warnings,
        issues,
        rhoLaminate: rho,
        butterSheet: { width: wb, length: lb, thickness: tb },
        layerRatio,
        doughSheet,
        steps,
        strips,
        strip: { height: H, length: ref.length, thickness: ref.thickness },
        stripSet,
        layers,
        croissant: {
            base: p.croissantBase,
            height: H,
            cutStyle: p.cutStyle,
            perStrip,
            total: stripSet.reduce((n, s) => n + s.croissants, 0),
            grams: triGrams,
        },
        pac: { width: p.pacWidth, height: pacH, perStrip: pacPerStrip, total: maxPac, grams: pacGrams },
        allocation,
        usedGrams,
        trimmedGrams: massTot - usedGrams,
    };
}
export function wrapSandwich(plan) {
    const doughLayer = plan.doughSheet.t;
    const butter = plan.butterSheet.thickness;
    return { doughLayer, butter, total: 2 * doughLayer + butter };
}
function combos(lists) {
    return lists.reduce((acc, list) => acc.flatMap((c) => list.map((v) => [...c, v])), [[]]);
}
const turnsIn = (p) => p.turns ?? defaults.turns;
export const layersOf = (turns) => turns.reduce((n, t) => n * t.fold, 1);
export const stripsOf = (turns) => turns.reduce((n, t) => n * t.split, 1);
export function search(base = {}, opts = {}) {
    const thick = opts.thicknesses ?? [0.8, 1.0, 1.2, 1.5, 2.0];
    const given = turnsIn(base);
    const plans = opts.foldPlans ?? [given.map((t) => t.fold)];
    const out = [];
    for (const folds of plans) {
        const free = (i) => i >= folds.length - 2;
        const sheets = folds.map((_, i) => (free(i) ? thick : [given[i]?.sheet ?? defaults.turns[0].sheet]));
        const splits = folds.map((_, i) => {
            if (!free(i))
                return [given[i]?.split ?? 1];
            const max = i === folds.length - 1 ? (opts.maxSplitLast ?? 6) : (opts.maxSplit ?? 4);
            return Array.from({ length: max }, (_, k) => k + 1);
        });
        for (const sheet of combos(sheets))
            for (const split of combos(splits)) {
                const turns = folds.map((fold, i) => ({ fold, sheet: sheet[i], split: split[i] }));
                const plan = solve({ ...base, turns });
                if (!plan.feasible)
                    continue;
                if (opts.minHeight !== undefined && plan.strip.height < opts.minHeight)
                    continue;
                out.push({ params: { turns }, plan });
            }
    }
    const t = opts.targetHeight;
    out.sort((x, y) => {
        if (t !== undefined) {
            const d = Math.abs(x.plan.strip.height - t) - Math.abs(y.plan.strip.height - t);
            if (Math.abs(d) > 0.75)
                return d;
        }
        return y.plan.croissant.total - x.plan.croissant.total || x.plan.layers - y.plan.layers;
    });
    return out.slice(0, opts.maxResults ?? 8);
}
export function suggestFix(base = {}, opts = {}) {
    const p = { ...defaults, ...base };
    const thicknesses = opts.thicknesses ?? [0.8, 1.0, 1.2, 1.5, 2.0];
    const asked = p.turns;
    if (!asked.length)
        return null;
    const choices = [];
    asked.forEach((turn, i) => {
        const max = i === asked.length - 1 ? (opts.maxSplitLast ?? 6) : (opts.maxSplit ?? 4);
        for (const sheet of [...new Set(thicknesses)])
            if (Math.abs(sheet - turn.sheet) > 1e-9)
                choices.push({ turn: i, field: "sheet", from: turn.sheet, to: sheet });
        for (let split = 1; split <= max; split++)
            if (split !== turn.split)
                choices.push({ turn: i, field: "split", from: turn.split, to: split });
    });
    const apply = (changes) => asked.map((turn, i) => {
        const out = { ...turn };
        for (const c of changes)
            if (c.turn === i)
                out[c.field] = c.to;
        return out;
    });
    const moved = (changes) => changes.reduce((n, c) => n + Math.abs(c.to - c.from), 0);
    const depth = Math.max(1, Math.min(opts.maxChanges ?? 3, choices.length));
    for (let d = 1; d <= depth; d++) {
        const out = [];
        const walkSets = (from, acc) => {
            if (acc.length === d) {
                const turns = apply(acc);
                const plan = solve({ ...base, turns });
                if (plan.feasible)
                    out.push({ params: { turns }, changes: acc.slice(), strips: stripsOf(turns), plan });
                return;
            }
            for (let i = from; i < choices.length; i++) {
                const c = choices[i];
                if (acc.some((a) => a.turn === c.turn && a.field === c.field))
                    continue;
                acc.push(c);
                walkSets(i + 1, acc);
                acc.pop();
            }
        };
        walkSets(0, []);
        if (!out.length)
            continue;
        out.sort((x, y) => x.strips - y.strips || moved(x.changes) - moved(y.changes));
        return out[0];
    }
    return null;
}
export function bestButterSheet(base = {}, opts = {}) {
    const p = { ...defaults, ...base };
    const t = opts.thickness ?? p.butterThickness;
    const step = opts.step ?? 0.5;
    const minWidth = opts.minWidth ?? 12;
    if (!(t > 0) || !(p.rollerWidth > 0))
        return null;
    const vButter = p.butterMass / p.butterDensity;
    const out = [];
    for (let w = p.rollerWidth; w >= minWidth; w -= step) {
        const width = round(w, 2);
        const length = vButter / (width * t);
        const plan = solve({ ...base, butterSheet: { width, length } });
        if (!plan.feasible)
            continue;
        out.push({ width, length, thickness: t, trimmedGrams: plan.trimmedGrams, plan });
    }
    out.sort((x, y) => x.trimmedGrams - y.trimmedGrams || y.width - x.width);
    return out[0] ?? null;
}
export { round };
