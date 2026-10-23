const STORE = "croissant-calc/sound";
const SCALE = [0, 3, 5, 7, 10];
const ROOT = 130.81;
const CHORD_WINDOW = 120;
let ctx = null;
let master = null;
let air = null;
let enabled = (() => {
    try {
        return localStorage.getItem(STORE) !== "off";
    }
    catch {
        return true;
    }
})();
export const soundEnabled = () => enabled;
export function setSoundEnabled(on) {
    enabled = on;
    try {
        localStorage.setItem(STORE, on ? "on" : "off");
    }
    catch {
    }
    if (on)
        primeSound();
}
export function primeSound() {
    if (!enabled)
        return null;
    try {
        if (!ctx) {
            const Ctor = window.AudioContext ?? window.webkitAudioContext;
            if (!Ctor)
                return null;
            ctx = new Ctor();
            master = ctx.createGain();
            master.gain.value = 0.32;
            const comp = ctx.createDynamicsCompressor();
            comp.threshold.value = -18;
            comp.ratio.value = 6;
            master.connect(comp).connect(ctx.destination);
            air = ctx.createDelay(0.5);
            air.delayTime.value = 0.16;
            const feedback = ctx.createGain();
            feedback.gain.value = 0.22;
            const wet = ctx.createGain();
            wet.gain.value = 0.18;
            air.connect(feedback).connect(air);
            air.connect(wet).connect(master);
        }
        if (ctx.state === "suspended")
            void ctx.resume();
        return ctx;
    }
    catch {
        return null;
    }
}
function freq(degree) {
    const octave = Math.floor(degree / SCALE.length);
    const note = SCALE[((degree % SCALE.length) + SCALE.length) % SCALE.length];
    return ROOT * 2 ** (octave + note / 12);
}
function note(degree, o = {}) {
    const c = ctx;
    if (!c || !master)
        return;
    const { wave = "sine", attack = 0.005, decay = 0.35, gain = 0.5, at = 0, glide = 0, space = 0.25 } = o;
    const t0 = c.currentTime + at;
    const osc = c.createOscillator();
    osc.type = wave;
    osc.frequency.setValueAtTime(freq(degree), t0);
    if (glide)
        osc.frequency.exponentialRampToValueAtTime(freq(degree + glide), t0 + decay);
    const env = c.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
    osc.connect(env).connect(master);
    if (air && space > 0) {
        const send = c.createGain();
        send.gain.value = space;
        env.connect(send).connect(air);
    }
    osc.start(t0);
    osc.stop(t0 + attack + decay + 0.05);
}
function noise(o = {}) {
    const c = ctx;
    if (!c || !master)
        return;
    const { at = 0, decay = 0.08, gain = 0.3, freq: f = 1800, q = 1.2 } = o;
    const t0 = c.currentTime + at;
    const len = Math.ceil(c.sampleRate * (decay + 0.02));
    const buf = c.createBuffer(1, len, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++)
        data[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource();
    src.buffer = buf;
    const band = c.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = f;
    band.Q.value = q;
    const env = c.createGain();
    env.gain.setValueAtTime(gain, t0);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + decay);
    src.connect(band).connect(env).connect(master);
    src.start(t0);
    src.stop(t0 + decay + 0.02);
}
function knife(degree, o = {}) {
    const { at = 0, gain = 1 } = o;
    noise({ freq: 1500, q: 2.4, decay: 0.07, gain: 0.26 * gain, at });
    note(degree, { wave: "sine", attack: 0.002, decay: 0.12, gain: 0.35 * gain, at, space: 0.1 });
}
let walk = 0;
let windowStart = 0;
let windowStep = 0;
function degreeFor(base) {
    const now = performance.now();
    if (now - windowStart > CHORD_WINDOW) {
        windowStart = now;
        windowStep = 0;
        walk = (walk + 1) % (SCALE.length * 2);
    }
    else
        windowStep++;
    return base + windowStep;
}
export function phaseSound(kind, info) {
    if (!enabled || !primeSound())
        return;
    const base = degreeFor(info.step);
    switch (kind) {
        case "appear":
            note(base, { wave: "sine", attack: 0.09, decay: 0.5, gain: 0.3 });
            note(base + 2, { wave: "sine", attack: 0.12, decay: 0.45, gain: 0.18, at: 0.06 });
            break;
        case "place":
            note(base - 3, { wave: "sine", attack: 0.004, decay: 0.22, gain: 0.45 });
            noise({ freq: 420, decay: 0.05, gain: 0.12, q: 0.8 });
            break;
        case "wrap":
            note(base + 4, { wave: "triangle", attack: 0.01, decay: 0.45, gain: 0.26, glide: -4 });
            note(base - 4, { wave: "triangle", attack: 0.01, decay: 0.45, gain: 0.26, glide: 4 });
            note(base, { wave: "sine", attack: 0.02, decay: 0.5, gain: 0.3, at: 0.42 });
            break;
        case "roll":
            note(base, { wave: "sine", attack: 0.1, decay: 0.75, gain: 0.26, glide: 3 });
            note(base - 5, { wave: "sine", attack: 0.15, decay: 0.7, gain: 0.14, glide: 3 });
            break;
        case "trim":
        case "relax":
            knife(base - 2, { gain: 0.6 });
            knife(base - 2, { at: 0.11, gain: 0.5 });
            break;
        case "fold": {
            const n = Math.max(2, info.count);
            for (let k = 0; k < n; k++)
                note(base + (n - 1 - k) * 2, { wave: "triangle", attack: 0.004, decay: 0.26, gain: 0.3, at: k * 0.085 });
            note(base - 5, { wave: "sine", attack: 0.01, decay: 0.4, gain: 0.22, at: (n - 1) * 0.085 });
            break;
        }
        case "cut": {
            const cuts = Math.max(1, info.count - 1);
            for (let k = 0; k < cuts; k++)
                knife(base - 7, { at: k * 0.14 });
            break;
        }
        case "focus":
            note(base + 2, { wave: "sine", attack: 0.01, decay: 0.25, gain: 0.2 });
            note(base - 1, { wave: "sine", attack: 0.01, decay: 0.4, gain: 0.16, at: 0.1 });
            break;
        case "rotate":
            for (let k = 0; k < 6; k++)
                note(base + k, {
                    wave: "square",
                    attack: 0.001,
                    decay: 0.045,
                    gain: 0.14 * (1 - k * 0.1),
                    at: k * 0.055 * (1 - k / 18),
                    space: 0.05,
                });
            break;
        case "shape":
            for (let k = 0; k < 5; k++) {
                knife(base + 3 + k, { at: k * 0.1, gain: 0.5 });
                note(base + 3 + k, { wave: "triangle", attack: 0.003, decay: 0.2, gain: 0.2 - k * 0.02, at: k * 0.1 });
            }
            break;
    }
}
export function finishSound(step) {
    if (!enabled || !primeSound())
        return;
    const base = step + 2;
    [0, 2, 4].forEach((d, k) => note(base + d, { wave: "triangle", attack: 0.012, decay: 1.1, gain: 0.3 - k * 0.05, at: k * 0.07, space: 0.5 }));
    note(base - 5, { wave: "sine", attack: 0.02, decay: 1.3, gain: 0.2, space: 0.4 });
}
export function tickSound() {
    if (!enabled || !primeSound())
        return;
    note(7, { wave: "triangle", attack: 0.002, decay: 0.08, gain: 0.25 });
}
