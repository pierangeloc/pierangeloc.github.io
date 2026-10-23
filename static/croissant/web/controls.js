const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls)
        n.className = cls;
    if (text !== undefined)
        n.textContent = text;
    return n;
};
function rowShell(o, modifiedTitle) {
    const row = el("div", "row");
    const fill = el("div", "fill");
    const label = el("span", "label", o.label);
    const dot = el("button", "dot");
    dot.type = "button";
    dot.tabIndex = -1;
    dot.addEventListener("click", (e) => {
        e.stopPropagation();
        o.onRevert?.();
    });
    label.appendChild(dot);
    row.append(fill, label);
    if (o.hint)
        row.title = o.hint;
    const setModified = (on, refText) => {
        row.classList.toggle("modified", on);
        dot.title = on ? modifiedTitle(refText) : "";
    };
    return { row, fill, label, setModified };
}
const chevron = (up) => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 10 6");
    svg.setAttribute("aria-hidden", "true");
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("d", up ? "M1 5L5 1l4 4" : "M1 1l4 4 4-4");
    p.setAttribute("fill", "none");
    p.setAttribute("stroke", "currentColor");
    p.setAttribute("stroke-width", "1.5");
    p.setAttribute("stroke-linecap", "round");
    p.setAttribute("stroke-linejoin", "round");
    svg.appendChild(p);
    return svg;
};
export function numberField(o, modifiedTitle) {
    const scale = o.scale ?? 1;
    const dec = o.decimals ?? 1;
    const field = el("div", "field");
    const label = el("label", "flabel", o.label);
    const dot = el("button", "dot");
    dot.type = "button";
    dot.tabIndex = -1;
    dot.addEventListener("click", (e) => {
        e.stopPropagation();
        o.onRevert?.();
    });
    label.appendChild(dot);
    const box = el("div", "box");
    const input = el("input", "num");
    input.type = "text";
    input.inputMode = "decimal";
    input.autocomplete = "off";
    const unit = o.unit ? el("span", "unit", o.unit) : null;
    const steppers = el("div", "steppers");
    const up = el("button", "stepbtn");
    const down = el("button", "stepbtn");
    up.type = down.type = "button";
    up.tabIndex = down.tabIndex = -1;
    up.appendChild(chevron(true));
    down.appendChild(chevron(false));
    steppers.append(up, down);
    box.append(input, ...(unit ? [unit] : []), steppers);
    const helper = el("p", "helper");
    const range = `${fmtN(o.min * scale, dec)} – ${fmtN(o.max * scale, dec)}${o.unit ? " " + o.unit : ""}`;
    helper.textContent = o.hint ?? "";
    field.append(label, box, helper);
    let value = o.value;
    const quant = (v) => Number((Math.round(v / o.step) * o.step).toFixed(6));
    const show = () => {
        input.value = fmtN(value * scale, dec);
    };
    const paint = () => {
        const bad = value < o.min - 1e-9 || value > o.max + 1e-9;
        field.classList.toggle("error", bad);
        helper.textContent = bad ? range : (o.hint ?? "");
        up.disabled = value >= o.max - 1e-9;
        down.disabled = value <= o.min + 1e-9;
        if (o.reference !== undefined)
            field.classList.toggle("modified", Math.abs(value - o.reference) > 1e-9);
        dot.title = o.reference === undefined ? "" : modifiedTitle(o.referenceNote ?? fmtN(o.reference * scale, dec));
    };
    const commit = (v, redraw = true) => {
        const next = Math.max(o.min, Math.min(o.max, quant(v)));
        if (Math.abs(next - value) < 1e-12) {
            paint();
            return;
        }
        value = next;
        if (redraw)
            show();
        paint();
        o.onInput(value);
    };
    input.addEventListener("input", () => {
        const parsed = Number(input.value.replace(",", "."));
        if (input.value.trim() === "" || !Number.isFinite(parsed))
            return;
        commit(parsed / scale, false);
    });
    input.addEventListener("blur", show);
    input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            show();
            input.blur();
        }
        else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            commit(value + (e.key === "ArrowUp" ? 1 : -1) * o.step * (e.shiftKey ? 10 : 1));
        }
    });
    input.addEventListener("wheel", (e) => {
        if (document.activeElement !== input)
            return;
        e.preventDefault();
        commit(value - Math.sign(e.deltaY) * o.step * (e.shiftKey ? 10 : 1));
    }, { passive: false });
    const hold = (btn, dir) => {
        let timer = 0;
        let repeat = 0;
        const stop = () => {
            clearTimeout(timer);
            clearInterval(repeat);
        };
        btn.addEventListener("pointerdown", (e) => {
            e.preventDefault();
            commit(value + dir * o.step * (e.shiftKey ? 10 : 1));
            timer = setTimeout(() => {
                repeat = setInterval(() => commit(value + dir * o.step * (e.shiftKey ? 10 : 1)), 55);
            }, 380);
        });
        for (const ev of ["pointerup", "pointerleave", "pointercancel"])
            btn.addEventListener(ev, stop);
    };
    hold(up, 1);
    hold(down, -1);
    let dragging = false;
    let startX = 0;
    let startV = 0;
    label.addEventListener("pointerdown", (e) => {
        if (e.target.closest(".dot"))
            return;
        dragging = true;
        startX = e.clientX;
        startV = value;
        label.setPointerCapture(e.pointerId);
        label.classList.add("scrubbing");
    });
    label.addEventListener("pointermove", (e) => {
        if (!dragging)
            return;
        const gain = o.step * (e.shiftKey ? 0.25 : 1);
        commit(startV + Math.round((e.clientX - startX) / 4) * gain);
    });
    const endScrub = (e) => {
        if (!dragging)
            return;
        dragging = false;
        label.classList.remove("scrubbing");
        label.releasePointerCapture(e.pointerId);
    };
    label.addEventListener("pointerup", endScrub);
    label.addEventListener("pointercancel", endScrub);
    show();
    paint();
    return {
        node: field,
        set: (v) => {
            value = v;
            show();
            paint();
        },
    };
}
function fmtN(v, dec) {
    return (Math.round(v * 10 ** dec) / 10 ** dec).toFixed(dec);
}
export function choice(o, modifiedTitle) {
    const { row, setModified } = rowShell(o, modifiedTitle);
    row.classList.add("choice");
    const group = el("div", "seg");
    group.setAttribute("role", "radiogroup");
    if (o.label)
        group.setAttribute("aria-label", o.label);
    const buttons = o.options.map((opt, i) => {
        const b = el("button", "segbtn", opt.label);
        b.type = "button";
        b.setAttribute("role", "radio");
        b.tabIndex = -1;
        if (i < 9)
            b.appendChild(el("span", "badge", String(i + 1)));
        b.addEventListener("click", () => pick(i));
        group.appendChild(b);
        return b;
    });
    row.appendChild(group);
    const pick = (i) => {
        const opt = o.options[i];
        if (!opt)
            return;
        o.onInput(opt.value);
        paint(opt.value);
        buttons[i].focus();
    };
    group.addEventListener("keydown", (e) => {
        const here = buttons.findIndex((b) => b === document.activeElement);
        const n = buttons.length;
        if (/^[1-9]$/.test(e.key)) {
            if (Number(e.key) > n)
                return;
            e.preventDefault();
            pick(Number(e.key) - 1);
        }
        else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
            e.preventDefault();
            pick((Math.max(0, here) + 1) % n);
        }
        else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
            e.preventDefault();
            pick((Math.max(0, here) - 1 + n) % n);
        }
        else if (e.key === "Home") {
            e.preventDefault();
            pick(0);
        }
        else if (e.key === "End") {
            e.preventDefault();
            pick(n - 1);
        }
    });
    const paint = (v) => {
        let sel = o.options.findIndex((opt) => opt.value === v);
        if (sel < 0)
            sel = 0;
        o.options.forEach((opt, i) => {
            const on = opt.value === v;
            buttons[i].classList.toggle("on", on);
            buttons[i].setAttribute("aria-checked", String(on));
            buttons[i].tabIndex = i === sel ? 0 : -1;
        });
        if (o.reference !== undefined)
            setModified(Number(v) !== o.reference, o.referenceNote ?? String(o.reference));
    };
    paint(o.value);
    return { node: row, set: paint };
}
export function toggle(o, modifiedTitle) {
    const { row, setModified } = rowShell(o, modifiedTitle);
    row.classList.add("toggle");
    const sw = el("button", "switch");
    sw.type = "button";
    sw.appendChild(el("span", "knob"));
    row.appendChild(sw);
    let value = o.value;
    const paint = () => {
        sw.classList.toggle("on", value);
        setModified(false, "");
    };
    sw.addEventListener("click", () => {
        value = !value;
        paint();
        o.onInput(value);
    });
    paint();
    return { node: row, set: (v) => ((value = v), paint()) };
}
export function vec2(o, modifiedTitle) {
    const wrap = el("div", "pair");
    let value = [...o.value];
    let linked = false;
    const link = el("button", "link");
    link.type = "button";
    link.textContent = o.swap ? "⇄" : "⛓";
    if (o.swapTitle)
        link.title = o.swapTitle;
    link.addEventListener("click", () => {
        if (o.swap) {
            value = [value[1], value[0]];
            setters[0](value[0]);
            setters[1](value[1]);
            o.onInput([...value]);
            return;
        }
        linked = !linked;
        link.classList.toggle("on", linked);
    });
    const setters = [];
    [0, 1].forEach((i) => {
        const f = numberField({
            label: `${o.label} ${o.names[i]}`,
            hint: i === 0 ? o.hint : undefined,
            value: value[i],
            min: o.min,
            max: o.max,
            step: o.step,
            unit: o.unit,
            decimals: 0,
            onInput: (v) => {
                const prev = value[i];
                value[i] = v;
                if (linked && prev !== 0) {
                    const other = Math.max(o.min, Math.min(o.max, Math.round((value[1 - i] * (v / prev)) / o.step) * o.step));
                    value[1 - i] = other;
                    setters[1 - i]?.(other);
                }
                o.onInput([...value]);
            },
        }, modifiedTitle);
        setters[i] = f.set;
        wrap.appendChild(f.node);
        if (i === 0)
            wrap.appendChild(link);
    });
    return {
        node: wrap,
        set: (v) => {
            value = [...v];
            setters[0](v[0]);
            setters[1](v[1]);
        },
    };
}
export function section(title, resetLabel, onReset) {
    const wrap = el("section", "sec");
    const head = el("div", "sechead");
    head.appendChild(el("h2", undefined, title));
    const rst = el("button", "iconbtn", "↺");
    rst.type = "button";
    rst.title = resetLabel;
    rst.addEventListener("click", onReset);
    head.appendChild(rst);
    const body = el("div", "secbody");
    wrap.append(head, body);
    return { node: wrap, body };
}
export { el };
