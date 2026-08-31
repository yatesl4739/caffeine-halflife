// CONSTANTS
const HALF_LIFE_HOURS = 5;
const HOURS_TO_PLOT = 24;
const LOW_THRESHOLD_MG = 50;

// ELEMENTS
const submitButton = document.getElementById('action-btn');
const textBox = document.getElementById('caffeine-input');
const clock = document.getElementById('clock');
const summary = document.getElementById('summary');
const canvas = document.getElementById('chart');
const ctx = canvas.getContext('2d');

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

// HANDLE CAFFEINE INPUT
function handleSubmit() {
    const caffeineAmount = parseFloat(textBox.value);

    if (isNaN(caffeineAmount) || caffeineAmount <= 0) {
        alert('Please enter a valid caffeine amount greater than 0.');
        return;
    }

    dose = { amount: caffeineAmount, time: new Date() };
    render();
}

submitButton.addEventListener('click', handleSubmit);
textBox.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleSubmit();
});

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
    ctx.strokeStyle = '#c0562b';
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