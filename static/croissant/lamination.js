// Croissant lamination calculator — pure core, no dependencies (reusable in the browser).
//
// Model (all measures in cm, g, g/cm³):
//   0. package : dough wraps the butter like a book            -> W0 × lb × t0
//   then one **turn** per entry in `turns`, each of them the same three gestures:
//      roll along the bench (pin = the block's width) down to `sheet`, trim the ends,
//      fold in `fold`, give the block a quarter turn, and cut it into `split` pieces
//      (1 = carry the whole block on). A turn multiplies the layers by its own `fold`
//      and divides the volume in front of you by its own `split`.
//   last : pin = the last panel, roll along what is left down to finalThickness,
//          trim ends and sides -> strip (panel-2·trim) × (L-2·trim)
//
// Two turns — a 4 and then a 3 — is the course's croissant. Puff pastry is the same
// machine with more entries (3, 3, 2, 2 gives 36 butter layers), which is why the turns
// are a list and not a pair of parameters. See docs/domain.md.
//
// Volume is conserved at every roll-out; trimming (ends/sides) removes some.
// The length of each sheet follows from the piece's volume, so the widths
// under the roller are the variables that matter.
export const defaults = {
    doughMass: 3223,
    butterMass: 1000,
    doughDensity: 1.15,
    butterDensity: 0.911,
    rollerWidth: 34,
    benchLength: 150, // the work surface in use; the first bake was done on 120
    trim: 1,
    butterThickness: 0.8, // the course's figure: butter to 8 mm, which with this dough gives 10/8/10
    // The course's croissant: a fold in 4, the block cut in two, a fold in 3, each piece cut
    // in three. Puff pastry is the same list with more turns in it.
    turns: [
        { fold: 4, sheet: 1.0, split: 2 },
        { fold: 3, sheet: 1.0, split: 3 },
    ],
    finalThickness: 0.4,
    maxPassRatio: 1.7,
    // The course's own croissant rolls its final strip 2.3 times wider than it is long, so the
    // limit has to sit above that; at 4 a block cut into slices narrower than a quarter of their
    // own length is refused, which is what cutting a 7 cm block into four does.
    maxRollAspect: 4,
    croissantBase: 10,
    cutStyle: "diagonal",
    pacWidth: 5.5,
    wantPac: 0,
};
/** What the kitchen reaches for, and therefore what the page and the CLI assume unless told
 *  otherwise. The course's own pair is still one choice away. */
export const defaultLiquids = "semiSkimmed";
/** Volle melk, 3.5% fat. */
export const wholeMilk = { water: 0.878, fat: 0.035, solids: 0.087 };
/** Halfvolle melk, 1.5% fat. Taking the fat out concentrates the rest a little, which is why
 *  the solids are *higher* here than in whole milk. */
export const semiSkimmedMilk = { water: 0.896, fat: 0.015, solids: 0.089 };
/** Ordinary 82% butter, the kind that goes in the dough (the lamination butter is the same). */
export const doughButter = { water: 0.16, fat: 0.82, solids: 0.02 };
/** The stricter swap: the course's water + whole milk mixed from semi-skimmed while matching
 *  **all three** components, not two of them. It is not the rule the kitchen uses — it needs
 *  only 311 g of milk, so it is barely a change from the course at all — but it is what you
 *  reach for when the dough has to come out identical.
 *
 *  Two liquids cannot do it. Semi-skimmed has a different fat-to-solids ratio than whole
 *  milk, so any pair of (milk, water) that matches the water and the solids is short of fat.
 *  The third knob is the butter the dough already contains: a few grams more of it make the
 *  fat up, and because butter is not pure fat its own water and solids are counted too.
 *
 *  Solving it is two equations in two unknowns — the solids and the fat fix the milk and the
 *  butter, since water supplies neither — and then the water tops the hydration back up.
 *  Matching every component means the dough weighs exactly what it weighed: nothing was
 *  added, the same water, fat and solids merely arrive in different packages. */
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
/** **The swap this kitchen makes**, and the default: nearly all the liquid is semi-skimmed
 *  milk, with water added only to put the hydration back where the course had it. You say how
 *  much milk you want to use — 800 g, a carton — and the water follows from it.
 *
 *  The fat comes out right by itself (12 g against 11.2: half the fat in 2.5× the milk), and
 *  what does not match is the milk solids, ~43 g more of them. That is real dough, which is
 *  why this batch weighs more than the course's; in the oven it browns a little faster. */
export function swapKeepingHydration(water, whole, milk) {
    const targetWater = water + whole * wholeMilk.water;
    return { milk, water: targetWater - milk * semiSkimmedMilk.water };
}
/** The course formula as written in the recipe book, with the course's own liquids: 3223 g of
 *  dough for 1000 g of lamination butter. Nothing here is a guess of ours. */
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
/** A formula from weights you would actually put on the scale: rounded to the gram, with the
 *  percentages read off the flour and the dough total being what the rows add up to — so the
 *  table on the page adds up at the bench. */
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
// The milk is the main liquid in both swaps, so it heads the list; the course's own formula
// is written out above in the recipe book's order, water first.
const order = ["flour", "semiSkimmedMilk", "water", "milk", "butter", "sugar", "yeast", "salt"];
/** The stricter variant: 481 g of water, 311 g of milk and 8 g more butter in place of the
 *  course's 480 + 320 whole + 320. The weights barely move — semi-skimmed *is* whole milk with
 *  2% of its fat taken out — and the batch still totals **3223 g per 1000 g of butter**,
 *  because every component was matched. It is the course's dough to the gram, but it is not
 *  the substitution the kitchen wanted: the point there was to use milk instead of water, and
 *  this uses less milk than the course did. Ours, not the course's. */
export const semiSkimmedMatchedFormula = (() => {
    const sw = swapKeepingEverything(courseGrams.water, courseGrams.milk, courseGrams.butter);
    return formulaOf({ ...courseGrams, milk: undefined, water: sw.water, semiSkimmedMilk: sw.milk, butter: sw.butter }, order);
})();
/** **The default.** The rule as it is said in the kitchen — "800 g of halfvolle melk + about
 *  40 g of water" for the course's 480 + 320 — with the water computed instead of guessed:
 *  44 g, which is what the "about" was rounding. The 43 g of extra milk solids make the batch
 *  **3267 g per 1000 g of butter** instead of 3223; that is real dough, so the plan scales
 *  by it. */
export const semiSkimmedFormula = (() => {
    const c = swapKeepingHydration(courseGrams.water, courseGrams.milk, 800);
    return formulaOf({ ...courseGrams, milk: undefined, water: c.water, semiSkimmedMilk: c.milk }, order);
})();
export const formulas = {
    whole: courseFormula,
    semiSkimmed: semiSkimmedFormula,
    semiSkimmedMatched: semiSkimmedMatchedFormula,
};
/** How much dough the formula makes per gram of lamination butter: 3.223 with the course's
 *  water and whole milk, 3.267 with the kitchen's semi-skimmed swap (the extra milk solids are
 *  dough too), and the same 3.223 again with the matched variant. The course states the ratio
 *  loosely as
 *  "about 3000 g of dough per 1000 g of butter"; this is what the weights actually add up
 *  to, and it is the number the page scales by. */
export const doughPerButter = (liquids = defaultLiquids) => formulas[liquids].dough / formulas[liquids].butter;
/** The dough the formula gives for this much lamination butter. */
export const doughForButter = (butterMass, liquids = defaultLiquids) => round(butterMass * doughPerButter(liquids), 0);
/** The formula scaled to a batch of dough. Linear: a baker's percentage does not care how
 *  big the bowl is. The weights are rounded to the gram — at this size a gram of salt is
 *  within the scale's error anyway. */
export function recipe(doughMass, liquids = defaultLiquids) {
    const f = formulas[liquids];
    const k = doughMass / f.dough;
    return f.ingredients.map((i) => ({ ...i, grams: round(i.grams * k, 0) }));
}
// A function declaration, not a const: the formulas above are derived at module load and
// round their weights, which a `const` down here would not yet have initialised.
function round(x, d = 1) {
    const f = 10 ** d;
    return Math.round(x * f) / f;
}
/** Triangles of base `base` in a strip of length `len`. */
export function trianglesInStrip(len, base, style = "diagonal") {
    if (base <= 0 || len <= 0)
        return 0;
    // Rectangles across the strip, two triangles out of each.
    if (style === "diagonal")
        return 2 * Math.floor(len / base + 1e-9);
    // N triangles occupy (N+1)·base/2: the two ends are half-triangle offcuts.
    return Math.max(0, Math.floor((2 * len) / base + 1e-9) - 1);
}
/** Intermediate thicknesses from `from` to `to`, with max reduction `ratio` per pass. */
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
/** The length a run of `n` triangles takes up. Diagonal cuts fill whole bases; zigzag ones
 *  share a base between every two triangles, with half a base at each end. */
export function triangleRun(n, base, style = "diagonal") {
    if (n <= 0)
        return 0;
    return style === "diagonal" ? (n / 2) * base : ((n + 1) * base) / 2;
}
/** Where the pain au chocolat go: the first strip is cut entirely into pain au chocolat, and
 *  so is the next, and the next, until the order is filled; the strip that finishes it gives
 *  the rest of its length to croissants, and the strips after it are all croissants. That is
 *  how they are cut at the bench — you do not want to count pieces strip by strip — and it
 *  keeps the pain au chocolat together in the order they come off the block.
 *
 *  It is not the arrangement with the highest yield. Every strip has some slack at the end,
 *  shorter than one triangle base, that would be thrown away, and a pain au chocolat taken
 *  out of that slack would cost no croissant; spreading them that way can give a few
 *  croissants more. It also makes every strip different, which is worse at the bench.
 *
 *  A column is `pacW` wide and holds one piece per row, so a strip tall enough for two rows
 *  gives two pain au chocolat per column. */
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
    // ---- volumes and density
    const vDough = p.doughMass / p.doughDensity;
    const vButter = p.butterMass / p.butterDensity;
    const vTot = vDough + vButter;
    const massTot = p.doughMass + p.butterMass;
    const rho = massTot / vTot;
    // ---- package
    // The dough is pulled to the butter's own footprint: no planned margin around it.
    // Whatever overlap the sealing needs in practice comes out of imperfect execution,
    // not out of extra dough rolled on purpose.
    const W0 = p.packageWidth ?? (p.butterSheet ? p.butterSheet.width : p.rollerWidth);
    const wb = p.butterSheet?.width ?? W0;
    const lb = p.butterSheet?.length ?? vButter / (wb * p.butterThickness);
    const tb = vButter / (wb * lb);
    const packLen = lb;
    const doughLen = 2 * packLen;
    const tDough = vDough / (W0 * doughLen);
    const t0 = vTot / (W0 * packLen);
    const doughSheet = { w: W0, l: doughLen, t: tDough };
    // Each dough layer should be a little thicker than the butter it wraps. That ratio is
    // V_dough / (2·V_butter): the footprint cancels, so no slab size can fix it — only the
    // recipe can. Below ~2.5 kg of dough per kg of butter it goes the wrong way.
    const layerRatio = tDough / tb;
    if (layerRatio < 1)
        note(`Il burro (${round(tb * 10, 1)} mm) è più spesso di ogni strato d'impasto (${round(tDough * 10, 1)} mm): ` +
            `servono almeno ${round((2 * vButter * p.doughDensity) / 1000, 1)} kg d'impasto per questo burro.`, "butterThickerThanDough", { ratio: layerRatio, butter: tb, dough: tDough, needDough: 2 * vButter * p.doughDensity }, "0");
    if (W0 > p.rollerWidth + 1e-9)
        bad(`Il pacchetto è largo ${round(W0)} cm, più del mattarello (${p.rollerWidth}).`, "packageTooWide", { width: W0, limit: p.rollerWidth }, "0");
    // The dough is rolled out full length first, then folded in half over the butter,
    // so the bench has to take the open sheet, not just the closed package.
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
    // ---- the turns
    //
    // One pass of this loop is one turn, and every turn is the same three gestures. The block
    // in front of you is `pin` across (that is what goes under the rolling pin, and it cannot
    // change during a roll-out) by `along` down the bench; rolling it to `turn.sheet` makes it
    // as long as its own volume says, the ends are trimmed, and the fold divides what is left
    // by `turn.fold`.
    //
    // The block is then given a quarter turn, so the panel becomes the next width under the
    // pin and the old width becomes the length to roll along. Each step's `result` is named
    // the way the block lies **before** that quarter turn — width still the pin, length the
    // panel — and `rotate90` says the turn happens; the animations read the rotation off the
    // two steps' dimensions and put the gesture where the hands do it, after the cut.
    let pin = W0;
    let along = packLen;
    let t = t0;
    let vPiece = vTot;
    let layers = 1;
    let strips = 1;
    // The panel the last turn leaves: its width is what the final strip is cut out of.
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
        // The pin at the first turn is the package's own width, and that was checked at step 0;
        // from the second turn on it is the panel the turn before left, which nothing has
        // checked yet.
        if (i > 0 && pin > p.rollerWidth + 1e-9)
            bad(`Passo ${id}: sotto il mattarello ci sono ${round(pin)} cm, il limite è ${p.rollerWidth}.`, "rollerExceeded", { width: pin, limit: p.rollerWidth }, id);
        // Rolling stretches `along`; `pin` cannot change. A piece much wider than it is long is
        // being pulled the short way — after a split into too many pieces, usually.
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
            // The rest is the dough's, not the plan's: half an hour between turns, and longer
            // before the last roll-out, when the block has the most layers to relax.
            rest: i === p.turns.length - 1 ? "45-60 min" : "30 min",
            note: null,
        });
        layers *= turn.fold;
        t = tBlock;
        // What is in front of you now, read off the block itself: the trimmed ends are gone,
        // and every sheet after this one is as long as this volume says.
        vPiece = pin * panel * tBlock;
        // The cut divides the side that is about to be rolled along, so each piece is a shorter
        // sheet; the panel stays whole, because it is the next width under the pin. A split of 1
        // is not a step: there is nothing to cut and nothing to put in the fridge.
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
        // The quarter turn: the panel goes under the pin, what was under the pin is rolled along.
        [pin, along] = [panel, pin];
    }
    // ---- final sheet
    // Every strip leaves the last split alike and they are all rolled to the same thickness,
    // so they are all the same strip. Volume fixes the length: thinner = longer.
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
    // ---- yield
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
/** Dough and butter share one footprint, so the package is a uniform slab and the three
 *  layers add up exactly to the thickness step 0 reports. */
export function wrapSandwich(plan) {
    const doughLayer = plan.doughSheet.t;
    const butter = plan.butterSheet.thickness;
    return { doughLayer, butter, total: 2 * doughLayer + butter };
}
/** Every combination of one choice per list. */
function combos(lists) {
    return lists.reduce((acc, list) => acc.flatMap((c) => list.map((v) => [...c, v])), [[]]);
}
const turnsIn = (p) => p.turns ?? defaults.turns;
/** Butter layers a fold plan gives: every turn multiplies what came before it. */
export const layersOf = (turns) => turns.reduce((n, t) => n * t.fold, 1);
/** Strips a fold plan gives: every cut multiplies the batch. */
export const stripsOf = (turns) => turns.reduce((n, t) => n * t.split, 1);
export function search(base = {}, opts = {}) {
    const thick = opts.thicknesses ?? [0.8, 1.0, 1.2, 1.5, 2.0];
    const given = turnsIn(base);
    // The fold order is not up for discussion: the course does a 4 and then a 3, and the
    // kitchen follows it. The search varies what is actually free — the cuts and the sheet
    // thicknesses — unless a caller explicitly asks for other fold orders.
    const plans = opts.foldPlans ?? [given.map((t) => t.fold)];
    const out = [];
    for (const folds of plans) {
        // Only the **last two turns** are varied. For the course's croissant that is both of
        // them, so this is the whole grid it always was; for a puff pastry of four turns it
        // keeps the search to the same few hundred plans, and the last turns are the ones that
        // decide the strip — its height is the last panel, less the margin.
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
/** When a step overflows the bench or the roller, the cure is almost always one of two
 *  knobs: cut the block into more pieces (each one comes out shorter), or stop a turn at a
 *  thicker sheet (same volume over less length). This tries both on every turn and returns
 *  the nearest combination that makes the whole plan feasible, or null when neither helps —
 *  a package wider than the roller, say, is a dough problem, and a step-0 sheet longer than
 *  the bench can only be fixed by less dough or a shorter panetto.
 *
 *  It searches by **how many knobs it has to move**, one first, then two, then three, and
 *  stops at the first depth that works: the smallest change to what you asked for, and a
 *  grid that stays small however many turns the plan has (a full product over six turns is
 *  millions of plans). */
export function suggestFix(base = {}, opts = {}) {
    const p = { ...defaults, ...base };
    const thicknesses = opts.thicknesses ?? [0.8, 1.0, 1.2, 1.5, 2.0];
    const asked = p.turns;
    if (!asked.length)
        return null;
    // The alternatives for each knob, the value already in use excluded: a candidate is a
    // choice of some of them, so "change nothing" is not one.
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
        // Every set of d changes, each on a different knob.
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
        // Fewest pieces (every extra piece is another block to roll), then the smallest move
        // away from the splits and thicknesses you asked for.
        out.sort((x, y) => x.strips - y.strips || moved(x.changes) - moved(y.changes));
        return out[0];
    }
    return null;
}
/** The butter slab that wastes least.
 *
 *  The dough is pulled to the butter's own footprint, so the slab's width *is* the width
 *  under the pin for the first turn, and a narrower package has to be rolled longer to hold
 *  the same volume — more passes, more relief cuts, more bench. Width is therefore the whole
 *  question, and the answer is almost always "as wide as the pin allows"; this searches
 *  rather than assuming it, because the bench and the roller checks further down the chain
 *  can rule a width out.
 *
 *  The thickness does **not** change the waste: volume is conserved, so rolling the butter
 *  thinner only makes the slab longer. It changes the bench, though — the dough sheet at
 *  step 0 is twice the slab's length — so it stays the cook's choice, 8 mm from the course.
 */
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
    // Least waste, and on a tie the wider slab: it is the shorter sheet to roll.
    out.sort((x, y) => x.trimmedGrams - y.trimmedGrams || y.width - x.width);
    return out[0] ?? null;
}
export { round };
