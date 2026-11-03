// CONSTANTS
const HALF_LIFE_HOURS = 5;
const HOURS_TO_PLOT = 24;
const LOW_THRESHOLD_MG = 50;
const MIN_MG = 0;
const MAX_MG = 600;
const STEP_MG = 5;
const CX = 150, CY = 150, R = 120;   // must match the SVG path

const STORAGE_KEY = 'caffeine-log-v1';
const MAX_STORED = 200;              // cap so the log can't grow forever
const MAX_LOG_ROWS = 12;             // most recent entries shown on screen
const ACTIVE_HOURS = 36;             // after this a dose is below 1% and ignored
const PLOT_LOOKBACK_HOURS = 12;      // how far back the chart's x-axis reaches


// ELEMENTS
const submitButton = document.getElementById('action-btn');
const clock = document.getElementById('clock');
const summary = document.getElementById('summary');
const canvas = document.getElementById('chart');
const ctx = canvas.getContext('2d');
const gauge = document.getElementById('gauge');
const gaugeProgress = document.getElementById('gauge-progress');
const gaugeHandle = document.getElementById('gauge-handle');
const gaugeValue = document.getElementById('gauge-value');
const targetTimeInput = document.getElementById('target-time');
const reverseButton = document.getElementById('reverse-btn');
const reverseResult = document.getElementById('reverse-result');
const drinkOptions = document.getElementById('drink-options');
const saveButton = document.getElementById('save-btn');
const logHeading = document.getElementById('log-heading');
const logEntries = document.getElementById('log-entries');
const clearLogButton = document.getElementById('clear-log-btn');



// STATE
let doses = [];        // saved, persisted: { id, amount, time }
let preview = null;    // unsaved "what if" from Calculate: { amount, time }
let logRows = [];      // { dose, leftEl } so the per-second tick can update text
let storageWorks = true;


// STORAGE
// localStorage rather than cookies: cookies are capped near 4 KB and get sent
// with every HTTP request, neither of which suits a log that only the page reads.
function loadLog() {
    let raw;

    // Reading at all can throw when storage is blocked. That's a different
    // problem from unreadable contents, so the two are caught separately.
    try {
        raw = localStorage.getItem(STORAGE_KEY);
    } catch (err) {
        console.warn('Storage is unavailable:', err);
        storageWorks = false;
        return [];
    }

    if (!raw) return [];

    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];

        return parsed
            .map((e) => ({
                id: String(e && e.id),
                amount: Number(e && e.amount),
                time: new Date(e && e.time)
            }))
            .filter((e) => e.amount > 0 && isFinite(e.amount) && !isNaN(e.time.getTime()))
            .sort((a, b) => a.time - b.time);
    } catch (err) {
        // Unreadable contents: start clean rather than wedging the page.
        console.warn('Saved log was unreadable, starting empty:', err);
        return [];
    }
}

function saveLog() {
    try {
        const payload = doses.slice(-MAX_STORED).map((d) => ({
            id: d.id,
            amount: d.amount,
            time: d.time.toISOString()
        }));
        localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
        storageWorks = true;
    } catch (err) {
        console.warn('Could not save the log:', err);
        storageWorks = false;
    }
}

function newId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}


// MATH
function caffeineRemaining(initialAmount, hoursPassed) {
    return initialAmount * Math.pow(0.5, hoursPassed / HALF_LIFE_HOURS);
}

function hoursSince(time) {
    return (Date.now() - time.getTime()) / 3600000;
}

// Doses old enough to contribute less than ~1% are dropped from the maths,
// but they stay in storage so the log keeps its history.
function activeDoses() {
    return doses.filter((d) => hoursSince(d.time) <= ACTIVE_HOURS);
}

// Total on board at a given moment (ms), summing every dose already taken.
function totalAt(ms, list) {
    return list.reduce((sum, d) => {
        const hours = (ms - d.time.getTime()) / 3600000;
        return hours < 0 ? sum : sum + caffeineRemaining(d.amount, hours);
    }, 0);
}

// Every dose is in the past, so the total only falls from here — which means a
// binary search finds the crossing point without a closed-form inverse.
function timeBelowThreshold(list, fromMs) {
    if (!list.length) return null;
    if (totalAt(fromMs, list) < LOW_THRESHOLD_MG) return null;

    let lo = fromMs;
    let hi = fromMs + 48 * 3600000;
    if (totalAt(hi, list) >= LOW_THRESHOLD_MG) return null;   // still high in 48 h

    for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2;
        if (totalAt(mid, list) >= LOW_THRESHOLD_MG) lo = mid;
        else hi = mid;
    }
    return new Date(hi);
}

function formatTime(date) {
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

// Round the y-axis top up to a tidy number
function niceMax(value) {
    const step = Math.pow(10, Math.floor(Math.log10(value)) - 1) * 5 || 1;
    return Math.ceil(value / step) * step;
}


// SLIDER
let caffeineValue = 95;

function setValue(v) {
    v = Math.round(v / STEP_MG) * STEP_MG;
    caffeineValue = Math.min(MAX_MG, Math.max(MIN_MG, v));

    const t = (caffeineValue - MIN_MG) / (MAX_MG - MIN_MG);
    const angle = Math.PI * (1 - t);   // pi at the left end, 0 at the right

    gaugeProgress.style.strokeDashoffset = 100 - t * 100;
    gaugeHandle.setAttribute('cx', CX + R * Math.cos(angle));
    gaugeHandle.setAttribute('cy', CY - R * Math.sin(angle));
    gaugeValue.textContent = caffeineValue;
    gauge.setAttribute('aria-valuenow', caffeineValue);
}

function valueFromPointer(clientX, clientY) {
    const rect = gauge.getBoundingClientRect();
    const scale = 300 / rect.width;             // viewBox width / rendered width
    const dx = (clientX - rect.left) * scale - CX;
    const dy = CY - (clientY - rect.top) * scale;  // flip y so up is positive

    let angle = Math.atan2(dy, dx);
    if (angle < 0) angle = dx >= 0 ? 0 : Math.PI;  // below the flat edge: snap to an end

    const t = 1 - angle / Math.PI;
    return MIN_MG + t * (MAX_MG - MIN_MG);
}

let dragging = false;

gauge.addEventListener('pointerdown', (e) => {
    preview = null;            // the old preview no longer matches the slider
    dragging = true;
    gauge.setPointerCapture(e.pointerId);
    setValue(valueFromPointer(e.clientX, e.clientY));
});

gauge.addEventListener('pointermove', (e) => {
    if (dragging) setValue(valueFromPointer(e.clientX, e.clientY));
});

gauge.addEventListener('pointerup', () => { dragging = false; });
gauge.addEventListener('pointercancel', () => { dragging = false; });

gauge.addEventListener('keydown', (e) => {
    const keys = {
        ArrowRight: STEP_MG, ArrowUp: STEP_MG,
        ArrowLeft: -STEP_MG, ArrowDown: -STEP_MG,
        PageUp: STEP_MG * 5, PageDown: -STEP_MG * 5
    };
    if (e.key in keys) setValue(caffeineValue + keys[e.key]);
    else if (e.key === 'Home') setValue(MIN_MG);
    else if (e.key === 'End') setValue(MAX_MG);
    else return;
    preview = null;
    e.preventDefault();
});

setValue(caffeineValue);
// HANDLE CAFFEINE INPUT
// Calculate only previews: nothing is written to storage until Save is pressed.
function handleSubmit() {
    if (caffeineValue <= 0) {
        alert('Set an amount greater than 0 mg.');
        return;
    }

    preview = { amount: caffeineValue, time: new Date() };
    reverseResult.textContent = '';   // the old recommendation no longer matches
    clearDrinkOptions();
    render();
}

submitButton.addEventListener('click', handleSubmit);


// SAVING DOSES
function saveDose() {
    const amount = preview ? preview.amount : caffeineValue;
    if (amount <= 0) {
        alert('Set an amount greater than 0 mg.');
        return;
    }

    // Stamped with the moment Save is pressed, not when Calculate was.
    doses.push({ id: newId(), amount: amount, time: new Date() });
    doses.sort((a, b) => a.time - b.time);
    preview = null;

    saveLog();
    renderLog();
    render();
}

function removeDose(id) {
    doses = doses.filter((d) => d.id !== id);
    saveLog();
    renderLog();
    render();
}

function clearLog() {
    if (!doses.length) return;
    if (!confirm('Delete every saved dose? This cannot be undone.')) return;

    doses = [];
    saveLog();
    renderLog();
    render();
}

saveButton.addEventListener('click', saveDose);
clearLogButton.addEventListener('click', clearLog);


// LOG LIST
// Rebuilt only when the log changes; the per-second tick just rewrites the
// "mg left" text, so the Remove buttons aren't destroyed mid-click.
function formatDateTime(date) {
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);

    if (date.getTime() >= midnight.getTime()) return formatTime(date);
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ', ' + formatTime(date);
}

function renderLog() {
    logEntries.textContent = '';
    logRows = [];
    clearLogButton.hidden = !doses.length;

    if (!doses.length) {
        logHeading.textContent = storageWorks
            ? 'No doses saved yet. Press Save dose to start logging.'
            : 'No doses saved yet — this browser is blocking storage, so nothing will persist.';
        return;
    }

    const shown = doses.slice().reverse().slice(0, MAX_LOG_ROWS);
    logHeading.textContent = `Saved doses: ${doses.length}` +
        (shown.length < doses.length ? ` (showing the latest ${shown.length})` : '') +
        (storageWorks ? '' : ' — storage is blocked, so these will vanish on reload');

    shown.forEach((d) => {
        const row = document.createElement('p');

        const label = document.createElement('span');
        label.textContent = `${formatDateTime(d.time)} — ${d.amount} mg, `;

        const leftEl = document.createElement('span');

        const removeBtn = document.createElement('button');
        removeBtn.textContent = 'Remove';
        removeBtn.addEventListener('click', () => removeDose(d.id));

        row.append(label, leftEl, document.createTextNode(' '), removeBtn);
        logEntries.appendChild(row);
        logRows.push({ dose: d, leftEl: leftEl });
    });

    updateLogValues();
}

function updateLogValues() {
    const now = Date.now();
    logRows.forEach((row) => {
        const left = caffeineRemaining(row.dose.amount, (now - row.dose.time.getTime()) / 3600000);
        row.leftEl.textContent = `${left.toFixed(1)} mg left`;
    });
}


// KNOWN DRINKS
// Figures are per standard serving. Brewed coffee varies a lot with beans and
// brew method; the rest are label values and are fairly consistent.
const DRINKS = [
    { name: 'espresso shot', mg: 64 },
    { name: 'Starbucks grande matcha latte', mg: 65 },
    { name: 'Red Bull (8.4 oz)', mg: 80 },
    { name: 'brewed coffee (8 oz)', mg: 95 },
    { name: 'Monster Energy (16 oz)', mg: 160 }
];

const MAX_DRINKS_PER_PLAN = 3;
const PLANS_TO_SHOW = 3;

// Walk every combination of up to MAX_DRINKS_PER_PLAN drinks and rank them by
// how close they land to the target.
function bestCombos(targetMg) {
    const combos = [];
    const counts = new Array(DRINKS.length).fill(0);

    (function walk(i, used, total) {
        if (i === DRINKS.length) {
            if (used > 0) combos.push({ counts: counts.slice(), total: total, used: used });
            return;
        }
        for (let n = 0; used + n <= MAX_DRINKS_PER_PLAN; n++) {
            counts[i] = n;
            walk(i + 1, used + n, total + n * DRINKS[i].mg);
        }
        counts[i] = 0;
    })(0, 0, 0);

    combos.forEach((c) => {
        c.diff = c.total - targetMg;
        // Undershooting means waking up early, so weight it worse than overshooting.
        // The small per-drink term breaks ties toward the simpler plan.
        c.score = (c.diff >= 0 ? c.diff : -c.diff * 1.5) + c.used * 2;
    });

    combos.sort((a, b) => a.score - b.score || a.used - b.used);

    // Keep one plan per distinct total, so the list shows real alternatives
    // rather than three ways of adding up to the same number.
    const seenTotals = new Set();
    const picks = [];
    for (const c of combos) {
        if (seenTotals.has(c.total)) continue;
        seenTotals.add(c.total);
        picks.push(c);
        if (picks.length === PLANS_TO_SHOW) break;
    }
    return picks;
}

function describeCombo(combo) {
    const parts = [];
    combo.counts.forEach((n, i) => {
        if (n > 0) parts.push(`${n} × ${DRINKS[i].name}`);
    });
    return parts.join(' + ');
}

function addLine(text) {
    const p = document.createElement('p');
    p.textContent = text;
    drinkOptions.appendChild(p);
}

function clearDrinkOptions() {
    drinkOptions.textContent = '';
}

function showDrinkOptions(targetMg, target) {
    clearDrinkOptions();

    const picks = bestCombos(targetMg);
    if (!picks.length) return;

    addLine(`Ways to get there, closest first:`);

    picks.forEach((c, i) => {
        const gap = c.diff === 0
            ? 'right on target'
            : `${c.diff > 0 ? '+' : '−'}${Math.abs(c.diff)} mg`;
        addLine(`${i === 0 ? 'Best match: ' : ''}${describeCombo(c)} = ${c.total} mg (${gap})`);
    });

    // What the top pick actually buys you
    const best = picks[0];
    if (best.total > LOW_THRESHOLD_MG) {
        const hours = HALF_LIFE_HOURS * Math.log2(best.total / LOW_THRESHOLD_MG);
        const until = new Date(Date.now() + hours * 3600000);
        const verdict = until.getTime() >= target.getTime()
            ? `carries you past ${formatTime(target)}, to about ${formatTime(until)}`
            : `runs out around ${formatTime(until)}, a little short of ${formatTime(target)}`;
        addLine(`The best match ${verdict}.`);
    }

    addLine('Per serving: ' + DRINKS.map((d) => `${d.name} ${d.mg} mg`).join(', ') + '.');
}


// REVERSE CALCULATION
// "Awake until X" is modelled as "still have LOW_THRESHOLD_MG on board at X".
// Inverting the decay formula: dose = threshold * 2^(hours / half-life)
const DAILY_CEILING_MG = 400;

function targetDateFrom(value) {
    const parts = String(value).split(':');
    const h = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    if (isNaN(h) || isNaN(m)) return null;

    const target = new Date();
    target.setHours(h, m, 0, 0);
    if (target.getTime() <= Date.now()) {
        target.setDate(target.getDate() + 1);   // time already passed today, assume tomorrow
    }
    return target;
}

function doseNeededFor(hours) {
    return LOW_THRESHOLD_MG * Math.pow(2, hours / HALF_LIFE_HOURS);
}

reverseButton.addEventListener('click', () => {
    reverseResult.style.color = "#000000";
    reverseResult.style.textDecoration = "none"
    const target = targetDateFrom(targetTimeInput.value);
    if (!target) {
        alert('Pick a time first.');
        return;
    }

    const hours = (target.getTime() - Date.now()) / 3600000;
    const exact = doseNeededFor(hours);
    const rounded = Math.ceil(exact / STEP_MG) * STEP_MG;   // round up so you clear the threshold

    if (rounded > MAX_MG) {
        clearDrinkOptions();
        reverseResult.textContent =
            `Staying above ${LOW_THRESHOLD_MG} mg until ${formatTime(target)} ` +
            `(${hours.toFixed(1)} h away) would take roughly ${Math.round(exact)} mg in one go — ` +
            `past the ${MAX_MG} mg this calculator handles. A smaller dose later in the day gets you ` +
            `there with far less caffeine.`;
        return;
    }

    setValue(rounded);
    preview = { amount: caffeineValue, time: new Date() };   // still unsaved
    render();

    let text =
        `Drink about ${caffeineValue} mg now to still have ${LOW_THRESHOLD_MG} mg on board at ` +
        `${formatTime(target)}, ${hours.toFixed(1)} h from now.`;

    if (caffeineValue > DAILY_CEILING_MG) {
        reverseResult.style.color = "#d11212";
        reverseResult.style.textDecoration = "underline"
        text += ` THAT IS ABOVE the ${DAILY_CEILING_MG} mg a day most guidance treats as a ceiling for adults.`;
    }

    reverseResult.textContent = text;
    showDrinkOptions(caffeineValue, target);
});


// SUMMARY TEXT
function updateSummary() {
    const now = Date.now();
    const saved = activeDoses();

    if (!saved.length && !preview) {
        summary.textContent = '';
        return;
    }

    let text;

    if (saved.length) {
        const onBoard = totalAt(now, saved);
        text = `Right now: ${onBoard.toFixed(1)} mg from ${saved.length} dose${saved.length === 1 ? '' : 's'}`;

        const clearsAt = timeBelowThreshold(saved, now);
        if (clearsAt) text += ` — below ${LOW_THRESHOLD_MG} mg around ${formatTime(clearsAt)}`;
    } else {
        text = 'Right now: nothing on board';
    }

    if (preview) {
        const clearsAt = timeBelowThreshold(saved.concat([preview]), now);
        text += `. Previewing ${preview.amount} mg more`;
        if (clearsAt) text += `, which would hold you to about ${formatTime(clearsAt)}`;
        text += ' (not saved)';
    }

    summary.textContent = text;
}

// CHART
function drawChart() {
    // Match the canvas backing store to its CSS size so it isn't blurry
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const W = rect.width;
    const H = rect.height;
    ctx.clearRect(0, 0, W, H);

    const now = Date.now();
    const saved = activeDoses();
    const projected = preview ? saved.concat([preview]) : saved;

    if (!projected.length) {
        ctx.fillStyle = '#888';
        ctx.font = '14px Oswald, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Save a dose, or press Calculate to preview one', W / 2, H / 2);
        return;
    }

    // The window is anchored to now, not to a single dose: back as far as the
    // oldest dose still on board (capped), and HOURS_TO_PLOT forward.
    const earliest = Math.min.apply(null, projected.map((d) => d.time.getTime()));
    const start = Math.min(now, Math.max(earliest, now - PLOT_LOOKBACK_HOURS * 3600000));
    const end = now + HOURS_TO_PLOT * 3600000;
    const spanMs = end - start;

    const pad = { top: 16, right: 16, bottom: 34, left: 48 };
    const plotW = W - pad.left - pad.right;
    const plotH = H - pad.top - pad.bottom;

    const xFor = (ms) => pad.left + ((ms - start) / spanMs) * plotW;

    // Pre-pass for the peak, since with several doses the maximum isn't just
    // the largest one — overlapping curves stack.
    const SAMPLES = 240;
    let peak = 0;
    for (let i = 0; i <= SAMPLES; i++) {
        peak = Math.max(peak, totalAt(start + (spanMs * i) / SAMPLES, projected));
    }
    const yMax = Math.max(niceMax(peak), 10);
    const yFor = (mg) => pad.top + (1 - mg / yMax) * plotH;

    // Horizontal grid lines + y labels
    ctx.strokeStyle = '#ddd';
    ctx.fillStyle = '#666';
    ctx.font = '12px Oswald, sans-serif';
    ctx.lineWidth = 1;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    for (let i = 0; i <= 4; i++) {
        const mg = (yMax / 4) * i;
        const y = yFor(mg);
        ctx.beginPath();
        ctx.moveTo(pad.left, y);
        ctx.lineTo(pad.left + plotW, y);
        ctx.stroke();
        ctx.fillText(Math.round(mg), pad.left - 8, y);
    }

    // X labels: pick an hour step that keeps the axis to about six labels,
    // then start from a whole hour so the times read cleanly.
    const spanHours = spanMs / 3600000;
    const STEP_CHOICES = [1, 2, 3, 4, 6, 8, 12, 24];
    const stepHours = STEP_CHOICES.find((s) => spanHours / s <= 7) || 24;

    const firstLabel = new Date(start);
    firstLabel.setMinutes(0, 0, 0);
    if (firstLabel.getTime() < start) firstLabel.setHours(firstLabel.getHours() + 1);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let ms = firstLabel.getTime(); ms <= end; ms += stepHours * 3600000) {
        ctx.fillText(formatTime(new Date(ms)), xFor(ms), pad.top + plotH + 8);
    }

    // Trace the summed curve for a set of doses
    function traceCurve(list) {
        ctx.beginPath();
        for (let i = 0; i <= SAMPLES; i++) {
            const ms = start + (spanMs * i) / SAMPLES;
            const x = xFor(ms);
            const y = yFor(totalAt(ms, list));
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
    }

    // The preview sits on top of the saved total, drawn dashed so it reads as
    // "what would happen" rather than "what is logged".
    if (preview) {
        traceCurve(projected);
        ctx.strokeStyle = '#67320a';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
    }

    if (saved.length) {
        traceCurve(saved);
        ctx.strokeStyle = '#67320a';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Shade under it
        ctx.lineTo(xFor(end), yFor(0));
        ctx.lineTo(xFor(start), yFor(0));
        ctx.closePath();
        ctx.fillStyle = 'rgba(192, 86, 43, 0.12)';
        ctx.fill();
    }

    // "Now" marker
    const nowX = xFor(now);
    ctx.beginPath();
    ctx.moveTo(nowX, pad.top);
    ctx.lineTo(nowX, pad.top + plotH);
    ctx.strokeStyle = '#3b7dd8';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.beginPath();
    ctx.arc(nowX, yFor(totalAt(now, saved)), 4, 0, Math.PI * 2);
    ctx.fillStyle = '#3b7dd8';
    ctx.fill();
}

function render() {
    updateSummary();
    updateLogValues();
    drawChart();
}

// UPDATE CLOCK
function updateClock() {
    const now = new Date();
    clock.textContent = `Current time: ${now.toLocaleTimeString()}`;
    render(); // keeps the "now" marker and mg readouts moving
}

// STARTUP
doses = loadLog();
renderLog();

// A second tab may have logged a dose; pick it up without a reload.
window.addEventListener('storage', (e) => {
    if (e.key !== STORAGE_KEY) return;
    doses = loadLog();
    renderLog();
    render();
});

updateClock();
setInterval(updateClock, 1000);
window.addEventListener('resize', drawChart);
