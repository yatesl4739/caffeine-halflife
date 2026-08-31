// CONSTANTS
const HALF_LIFE_HOURS = 5;

// ELEMENTS
const submitButton = document.getElementById('action-btn');
const textBox = document.getElementById('caffeine-input');
const clock = document.getElementById('clock');


// HANDLE CAFFEINE INPUT
submitButton.addEventListener('click', () => {
    const caffeineAmount = parseFloat(textBox.value);

    // Validate input
    if (isNaN(caffeineAmount) || caffeineAmount <= 0) {
        alert('Please enter a valid caffeine amount greater than 0.');
        return;
    }

    console.log(`Caffeine amount entered: ${caffeineAmount} mg`);

    // Example: caffeine remaining after one half-life
    const caffeineAfterOneHalfLife = caffeineAmount / 2;

    console.log(
        `After ${HALF_LIFE_HOURS} hours: ${caffeineAfterOneHalfLife} mg`
    );
});


// UPDATE CLOCK
function updateClock() {
    const now = new Date();
    clock.textContent = `Current time: ${now.toLocaleTimeString()}`;
}

// Update immediately
updateClock();

// Then update every second
setInterval(updateClock, 1000);
function caffeineRemaining(initialAmount, hoursPassed) {
    return initialAmount * Math.pow(0.5, hoursPassed / HALF_LIFE_HOURS);
}


updateClock();

