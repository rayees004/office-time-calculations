document.addEventListener('DOMContentLoaded', () => {
    const punchList = document.getElementById('punch-list');
    const addBtn = document.getElementById('add-btn');
    const resetBtn = document.getElementById('reset-btn');
    const calcBtn = document.getElementById('calc-btn');
    const resultsCard = document.getElementById('results');
    const totalWorkEl = document.getElementById('total-work');
    const totalBreakEl = document.getElementById('total-break');
    const netWorkEl = document.getElementById('net-work');
    const statusBadge = document.getElementById('current-status');

    // Load data from localStorage on startup
    loadData();

    // Event Listeners
    addBtn.addEventListener('click', () => {
        const now = new Date();
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const timeString = `${hours}:${minutes}`;
        addPunchInput(timeString);
        saveData(); // Save immediately after adding
    });

    resetBtn.addEventListener('click', reset);
    calcBtn.addEventListener('click', calculate);

    function addPunchInput(value = '') {
        const div = document.createElement('div');
        div.className = 'punch-item';

        const label = document.createElement('span');
        label.className = 'punch-label';

        const input = document.createElement('input');
        input.type = 'time';
        input.className = 'punch-input';
        input.value = value;

        // Save data whenever the input changes
        input.addEventListener('change', () => {
            updateStatus();
            saveData();
        });

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'delete-btn';
        deleteBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>';
        deleteBtn.onclick = () => {
            div.remove();
            updateLabels();
            updateStatus();
            saveData(); // Save after deletion
        };

        div.appendChild(label);
        div.appendChild(input);
        div.appendChild(deleteBtn);
        punchList.appendChild(div);

        updateLabels();
        updateStatus();
    }

    function updateLabels() {
        const items = punchList.querySelectorAll('.punch-item');
        items.forEach((item, index) => {
            const label = item.querySelector('.punch-label');
            if (index === 0) {
                label.textContent = "Start Work";
            } else if (index % 2 === 1) {
                label.textContent = "Start Break / Out";
            } else {
                label.textContent = "Resume Work / In";
            }
        });
    }

    function reset() {
        if (confirm("Are you sure you want to reset all data?")) {
            punchList.innerHTML = '';
            localStorage.removeItem('punchTimes');
            // Add one empty input to start fresh, or user can click Add Punch
            // User requested: "reset button click time cokies data remove and the add the new puch time button click"
            // So we clear everything. We can leave it empty or add one. 
            // Let's add one empty one to be friendly, or just clear. 
            // Actually, best specific behavior: clear list.

            resultsCard.classList.add('hidden');
            updateStatus();
            // Don't save empty list implies removal, which we did.
        }
    }

    function calculate() {
        const inputs = Array.from(punchList.querySelectorAll('.punch-input'));
        const times = inputs.map(input => input.value).filter(val => val !== '');

        if (times.length < 2) {
            alert("Please enter at least a Start and End time.");
            return;
        }

        // Sort times chronologically to handle out-of-order inputs gracefully
        times.sort();

        let totalWorkMinutes = 0;
        let totalBreakMinutes = 0;

        for (let i = 0; i < times.length - 1; i++) {
            const start = timeToMinutes(times[i]);
            let end = timeToMinutes(times[i + 1]);

            if (end < start) {
                // Handle midnight crossover if needed, though with sorting this implies next day
                end += 1440;
            }

            const duration = end - start;

            if (i % 2 === 0) {
                // Even index (0, 2...) -> Start of Work segment
                totalWorkMinutes += duration;
            } else {
                // Odd index (1, 3...) -> Start of Break segment
                totalBreakMinutes += duration;
            }
        }

        const netWorkMinutes = totalWorkMinutes;
        const grossMinutes = totalWorkMinutes + totalBreakMinutes;

        totalWorkEl.textContent = minutesToHM(grossMinutes);
        totalBreakEl.textContent = minutesToHM(totalBreakMinutes);
        netWorkEl.textContent = minutesToHM(totalWorkMinutes);

        resultsCard.classList.remove('hidden');
        updateStatus();
    }

    function updateStatus() {
        const inputs = Array.from(punchList.querySelectorAll('.punch-input'));
        const filledInputs = inputs.filter(i => i.value !== '').length;

        if (filledInputs === 0) {
            statusBadge.textContent = "Not Started";
            statusBadge.style.background = "rgba(255, 255, 255, 0.2)";
            statusBadge.style.color = "white";
        } else if (filledInputs % 2 === 1) {
            statusBadge.textContent = "Currently Working";
            statusBadge.style.background = "#dcfce7";
            statusBadge.style.color = "#166534";
        } else {
            statusBadge.textContent = "On Break / Ended";
            statusBadge.style.background = "#ffedd5";
            statusBadge.style.color = "#9a3412";
        }
    }

    function timeToMinutes(timeStr) {
        const [hours, minutes] = timeStr.split(':').map(Number);
        return hours * 60 + minutes;
    }

    function minutesToHM(minutes) {
        const h = Math.floor(minutes / 60);
        const m = minutes % 60;
        return `${h}h ${m.toString().padStart(2, '0')}m`;
    }

    // Persistence Functions
    function saveData() {
        const inputs = Array.from(punchList.querySelectorAll('.punch-input'));
        const values = inputs.map(input => input.value);
        localStorage.setItem('punchTimes', JSON.stringify(values));
    }

    function loadData() {
        const saved = localStorage.getItem('punchTimes');
        if (saved) {
            const values = JSON.parse(saved);
            if (values.length > 0) {
                // If we have saved data, restore it
                values.forEach(val => addPunchInput(val));
                // If the user had calculated results open, we could restore them, but let's just restore inputs.
                // We could auto-calculate if complete? Maybe later.
            }
        }
    }
});
