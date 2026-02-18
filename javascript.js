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

    // Initialize with one input
    addPunchInput();

    // Event Listeners
    addBtn.addEventListener('click', () => addPunchInput());
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
        input.addEventListener('change', updateStatus); // Update status on input change

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'delete-btn';
        deleteBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>';
        deleteBtn.onclick = () => {
            div.remove();
            updateLabels();
            updateStatus();
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
        punchList.innerHTML = '';
        addPunchInput();
        resultsCard.classList.add('hidden');
        updateStatus();
    }

    function calculate() {
        const inputs = Array.from(punchList.querySelectorAll('.punch-input'));
        const times = inputs.map(input => input.value).filter(val => val !== '');

        if (times.length < 2) {
            alert("Please enter at least a Start and End time.");
            return;
        }

        // Sort times? Assuming user enters chronologically for now, but simple sort helps
        // times.sort(); 

        let totalWorkMinutes = 0;
        let totalBreakMinutes = 0;

        for (let i = 0; i < times.length - 1; i++) {
            const start = timeToMinutes(times[i]);
            const end = timeToMinutes(times[i + 1]);

            if (end < start) {
                // Handle midnight crossover
                end += 1440; // Add 24 hours (24 * 60)
            }

            const duration = end - start;

            if (i % 2 === 0) {
                // Even index (0, 2...) -> Start of Work. (0->1, 2->3 are work segments)
                totalWorkMinutes += duration;
            } else {
                // Odd index (1, 3...) -> Start of Break. (1->2, 3->4 are break segments)
                totalBreakMinutes += duration;
            }
        }

        const netWorkMinutes = totalWorkMinutes;
        // Wait, "Total Work" usually means Gross? 
        // Plan said: 
        // Gross Work = Out - In (Total time from first punch to last punch)
        // Total Break = Sum of breaks
        // Net Work = Gross - Break

        // BUT my simplified sequential logic calculates ACTUAL work segments and ACTUAL break segments directly.
        // So 'totalWorkMinutes' accumulation above IS the Net Work.
        // 'totalBreakMinutes' accumulation above IS the Total Break.
        // Gross Work would be Net + Break.

        // Let's align with the requested output:
        // "Total Work Duration" (implied Gross or Net? User asked for "total working time calculation" and "total breaks calculation")
        // Usually, "Working Time" = Net.
        // "Gross" = Shift duration.

        // Let's display:
        // Total Shift Time (Gross)
        // Total Break Time
        // Actual Working Time (Net)

        // My loop calculated Net Work and Total Break.
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

        // Logic:
        // 0 inputs: Not Started
        // Odd number (1, 3, 5) -> In Work (waiting for Out) -> "Working"
        // Even number (2, 4, 6) -> Out (waiting for In) -> "On Break / Ended"

        if (filledInputs === 0) {
            statusBadge.textContent = "Not Started";
            statusBadge.style.background = "rgba(255, 255, 255, 0.2)";
            statusBadge.style.color = "white";
        } else if (filledInputs % 2 === 1) {
            statusBadge.textContent = "Currently Working";
            statusBadge.style.background = "#dcfce7"; // Green-ish
            statusBadge.style.color = "#166534";
        } else {
            statusBadge.textContent = "On Break / Ended";
            statusBadge.style.background = "#ffedd5"; // Orange-ish
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
});
