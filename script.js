// CONSTANTS
const HALF_LIFE_HOURS = 5;
const HOURS_TO_PLOT = 24;
const LOW_THRESHOLD_MG = 50;
const MIN_MG = 0;
const MAX_MG = 600;
const STEP_MG = 5;
const CX = 150, CY = 150, R = 120;   // must match the SVG path


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



// STATE
let dose = null; // { amount, time }

// MATH
function caffeineRemaining(initialAmount, hoursPassed) {
    return initialAmount * Math.pow(0.5, hoursPassed / HALF_LIFE_HOURS);
}

function hoursSince(time) {
    return (Date.now() - time.getTime()) / 3600000;
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
    e.preventDefault();
});

setValue(caffeineValue);
// HANDLE CAFFEINE INPUT
function handleSubmit() {
    if (caffeineValue <= 0) {
        alert('Set an amount greater than 0 mg.');
        return;
    }

    dose = { amount: caffeineValue, time: new Date() };
    render();
}

submitButton.addEventListener('click', handleSubmit);

// SUMMARY TEXT
function updateSummary() {
    if (!dose) {
        summary.textContent = '';
        return;
    }

    const left = caffeineRemaining(dose.amount, hoursSince(dose.time));
    let text = `Right now: ${left.toFixed(1)} mg of ${dose.amount} mg`;

    if (dose.amount > LOW_THRESHOLD_MG) {
        const hours = HALF_LIFE_HOURS * Math.log2(dose.amount / LOW_THRESHOLD_MG);
        const when = new Date(dose.time.getTime() + hours * 3600000);
        text += ` — drops below ${LOW_THRESHOLD_MG} mg around ${formatTime(when)}`;
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

    if (!dose) {
        ctx.fillStyle = '#888';
        ctx.font = '14px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Enter an amount to see the graph', W / 2, H / 2);
        return;
    }

    const pad = { top: 16, right: 16, bottom: 34, left: 48 };
    const plotW = W - pad.left - pad.right;
    const plotH = H - pad.top - pad.bottom;
    const yMax = niceMax(dose.amount);

    const xFor = (h) => pad.left + (h / HOURS_TO_PLOT) * plotW;
    const yFor = (mg) => pad.top + (1 - mg / yMax) * plotH;

    // Horizontal grid lines + y labels
    ctx.strokeStyle = '#ddd';
    ctx.fillStyle = '#666';
    ctx.font = '12px sans-serif';
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

    // X labels every 4 hours
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let h = 0; h <= HOURS_TO_PLOT; h += 4) {
        const label = new Date(dose.time.getTime() + h * 3600000);
        ctx.fillText(formatTime(label), xFor(h), pad.top + plotH + 8);
    }

    // The decay curve
    ctx.beginPath();
    for (let h = 0; h <= HOURS_TO_PLOT; h += 0.1) {
        const x = xFor(h);
        const y = yFor(caffeineRemaining(dose.amount, h));
        if (h === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = '#67320a';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Shade under it
    ctx.lineTo(xFor(HOURS_TO_PLOT), yFor(0));
    ctx.lineTo(xFor(0), yFor(0));
    ctx.closePath();
    ctx.fillStyle = 'rgba(192, 86, 43, 0.12)';
    ctx.fill();

    // "Now" marker, as long as it's still on screen
    const elapsed = hoursSince(dose.time);
    if (elapsed >= 0 && elapsed <= HOURS_TO_PLOT) {
        const x = xFor(elapsed);
        const y = yFor(caffeineRemaining(dose.amount, elapsed));
        ctx.beginPath();
        ctx.moveTo(x, pad.top);
        ctx.lineTo(x, pad.top + plotH);
        ctx.strokeStyle = '#3b7dd8';
        ctx.setLineDash([4, 4]);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#3b7dd8';
        ctx.fill();
    }
}

function render() {
    updateSummary();
    drawChart();
}

// UPDATE CLOCK
function updateClock() {
    const now = new Date();
    clock.textContent = `Current time: ${now.toLocaleTimeString()}`;
    render(); // keeps the "now" marker and mg readout moving
}

updateClock();
setInterval(updateClock, 1000);
window.addEventListener('resize', drawChart);