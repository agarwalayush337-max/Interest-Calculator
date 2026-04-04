// ======================================================
// INTEREST CALCULATOR PWA - FULL SCRIPT
// Features: 360-Day Logic, AI OCR, Forensic Eraser, 
// Sorted List Gen (Mobile/PC Smart Export)
// ======================================================

// --- 1. SERVICE WORKER & CONFIG ---
/* --- DISABLED FOR DEVELOPMENT ---
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./service-worker.js')
            .then(reg => console.log('Service Worker registered'))
            .catch(err => console.log('Service Worker registration failed', err));
    });
}
-------------------------------- */

const firebaseConfig = {
    apiKey: "AIzaSyA7_nnw_BRziSVyjbZ-2UMxTKIKVW_K_JQ",
    authDomain: "ayush337.netlify.app",
    projectId: "interest-calculator-8d997",
    storageBucket: "interest-calculator-8d997.appspot.com",
    messagingSenderId: "187925519090",
    appId: "1:187925519090:web:c875d2fb788d02b5bf4e6b"
};
// --- CONFIGURATION ---
// PASTE YOUR GOOGLE SHEET CSV LINK HERE
// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();
let user = null;
let reportsCollection = null;
let localDb = null;
let cachedReports = [];
let cachedFinalisedReports = [];
let activeInventory = []; // NEW: Stores active stock
let loanSearchCache = new Map();
let pieChartInstance, barChartInstance;
let currentGrowthTimeframe = 'ALL'; // Default setting
let currentlyEditingReportId = null; 

// --- GLOBALS FOR SCANNING & SHEETS ---
let currentScanCoordinates = []; 
let scanCanvas = null;           
let scanCtx = null;              
let currentPreviousDues = 0; // Stored silently
let currentPreviousDuesDate = ''; // NEW: Stores the date of the dues
let pendingReportIdToFinalise = null;

// --- Real-time Sync Variables ---
let liveStateUnsubscribe = null;
let isUpdatingFromListener = false;
const sessionClientId = Date.now().toString() + Math.random().toString();

// --- DOM Elements ---
const loginOverlay = document.getElementById('loginOverlay');
const appContainer = document.getElementById('appContainer');
const authStatusEl = document.getElementById('authStatus');
const todayDateEl = document.getElementById('todayDate');
const interestRateEl = document.getElementById('interestRate');
const loanTableBody = document.querySelector('#loanTable tbody');
const totalPrincipalEl = document.getElementById('totalPrincipal');
const totalInterestEl = document.getElementById('totalInterest');
const finalTotalEl = document.getElementById('finalTotal');
const recentTransactionsListEl = document.getElementById('recentTransactionsList');
const recentTransactionsLoader = document.getElementById('recentTransactionsLoader');
const mainActionBar = document.getElementById('mainActionBar');
const viewModeActionBar = document.getElementById('viewModeActionBar');
const googleSignInBtn = document.getElementById('googleSignInBtn');
const loginMessage = document.getElementById('loginMessage');
const signOutBtn = document.getElementById('signOutBtn');
const addRowBtn = document.getElementById('addRowBtn');
const saveBtn = document.getElementById('saveBtn');
const clearSheetBtn = document.getElementById('clearSheetBtn');
const exitViewModeBtn = document.getElementById('exitViewModeBtn');
const confirmModal = document.getElementById('confirmModal');
const confirmTitleEl = document.getElementById('confirmTitle');
const confirmMessageEl = document.getElementById('confirmMessage');
const confirmOkBtn = document.getElementById('confirmOkBtn');
const confirmCancelBtn = document.getElementById('confirmCancelBtn');
const exportPdfBtn = document.getElementById('exportPdfBtn');
const exportViewPdfBtn = document.getElementById('exportViewPdfBtn');
const reportSearchInput = document.getElementById('reportSearchInput');
const syncStatusEl = document.getElementById('syncStatus');
const dashboardLoader = document.getElementById('dashboardLoader');
const dashboardMessage = document.getElementById('dashboardMessage');
const scanImageBtn = document.getElementById('scanImageBtn');
const imageUploadInput = document.getElementById('imageUploadInput');
const dashboardStartDateEl = document.getElementById('dashboardStartDate');
const dashboardEndDateEl = document.getElementById('dashboardEndDate');
const last30DaysBtn = document.getElementById('last30DaysBtn');
const currentFyBtn = document.getElementById('currentFyBtn');
const prevFyBtn = document.getElementById('prevFyBtn');
const applyDateFilterBtn = document.getElementById('applyDateFilterBtn');
const clearSearchSheetBtn = document.getElementById('clearSearchSheetBtn');
// --- DOM Elements for Loan Search ---
const addSearchRowBtn = document.getElementById('addSearchRowBtn');
const loanSearchTableBody = document.querySelector('#loanSearchTable tbody');
const scanNumbersBtn = document.getElementById('scanNumbersBtn');
const numberImageUploadInput = document.getElementById('numberImageUploadInput');
const loanSearchLoader = document.getElementById('loanSearchLoader');
const searchFiltersContainer = document.querySelector('.search-filters');


// --- Debounce function ---
const debounce = (func, delay) => {
    let timeout;
    return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), delay);
    };
};

// --- Offline Database (IndexedDB) Setup ---
async function initLocalDb() {
    localDb = await idb.openDB('interest-calculator-db', 1, {
        upgrade(db) {
            if (!db.objectStoreNames.contains('unsyncedReports')) {
                db.createObjectStore('unsyncedReports', { keyPath: 'localId' });
            }
            if (!db.objectStoreNames.contains('deletionsQueue')) {
                db.createObjectStore('deletionsQueue', { keyPath: 'docId' });
            }
        },
    });
}

// --- Syncing Logic ---
const updateSyncStatus = () => {
    if (navigator.onLine) {
        syncStatusEl.className = 'online';
        syncStatusEl.textContent = 'Online';
        syncData();
    } else {
        syncStatusEl.className = 'offline';
        syncStatusEl.textContent = 'Offline';
    }
};

const syncData = async () => {
    if (!navigator.onLine || !localDb || !reportsCollection) return;
    syncStatusEl.textContent = 'Syncing...';
    const unsynced = await localDb.getAll('unsyncedReports');
    for (const report of unsynced) {
        try {
            const reportToSave = { ...report };
            delete reportToSave.localId;
            await reportsCollection.add(reportToSave);
            await localDb.delete('unsyncedReports', report.localId);
        } catch (error) { console.error('Failed to sync new report:', error); }
    }
    const deletions = await localDb.getAll('deletionsQueue');
    for (const item of deletions) {
        try {
            await reportsCollection.doc(item.docId).delete();
            await localDb.delete('deletionsQueue', item.docId);
        } catch (error) { console.error('Failed to sync deletion:', error); }
    }
    
    syncStatusEl.textContent = 'Online';
    
    if (document.querySelector('.tab-button[data-tab="recentTransactionsTab"].active')) {
        loadRecentTransactions();
    }
};

// --- Custom Modal Logic ---
let resolveConfirm;
const showConfirm = (title, message, showCancel = true) => {
    confirmTitleEl.textContent = title;
    confirmMessageEl.textContent = message;
    confirmCancelBtn.style.display = showCancel ? 'inline-flex' : 'none';
    confirmModal.style.display = 'flex';
    return new Promise(resolve => { resolveConfirm = resolve; });
};
const closeConfirm = (value) => {
    confirmModal.style.display = 'none';
    if (resolveConfirm) resolveConfirm(value);
};

// --- Date & Calculation Logic ---
const parseDate = (dateString) => {
    if (!dateString) return null;
    const parts = String(dateString).match(/(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
    if (!parts) return null;
    let day = parseInt(parts[1], 10), month = parseInt(parts[2], 10), year = parseInt(parts[3], 10);
    if (year < 100) {
        year += (new Date().getFullYear() - (new Date().getFullYear() % 100)) - (year > (new Date().getFullYear() % 100) ? 100 : 0);
    }
    if (day > 0 && day <= 31 && month > 0 && month <= 12) { return new Date(year, month - 1, day); }
    return null;
};
const formatDateToDDMMYYYY = (date) => {
    if (!date || isNaN(date.getTime())) return '';
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
};
const roundToNearest = (num, nearest) => Math.round(num / nearest) * nearest;

// --- NEW: Series-Specific Interest Rate Helper ---
const getInterestRateForLoan = (loanNo, defaultRate) => {
    if (!loanNo) return defaultRate;
    const cleanNo = loanNo.trim().toUpperCase();
    const match = cleanNo.match(/^([A-Z]+)/);
    
    if (match) {
        const series = match[1];
        // Apply 1.70% specifically for Series R
        if (series === 'R') {
            return 1.70; 
        }
        // You can easily add more series here later if needed
        // else if (series === 'A') { return 1.80; }
    }
    return defaultRate; // Fallback to 1.75% for A, B, D, etc.
};

const days360 = (startDate, endDate) => {
    if (!startDate || !endDate || startDate > endDate) return 0;
    let d1 = startDate.getDate(), m1 = startDate.getMonth() + 1, y1 = startDate.getFullYear();
    let d2 = endDate.getDate(), m2 = endDate.getMonth() + 1, y2 = endDate.getFullYear();
    if (d1 === 31) d1 = 30;
    if (d2 === 31 && d1 === 30) d2 = 30;
    return (y2 - y1) * 360 + (m2 - m1) * 30 + (d2 - d1);
};

const getFinancialYear = (refDate = new Date()) => {
    const year = refDate.getFullYear();
    const month = refDate.getMonth(); // 0-11
    const startYear = month >= 3 ? year : year - 1; // FY starts in April (month 3)
    return {
        startDate: new Date(startYear, 3, 1), // April 1st
        endDate: new Date(startYear + 1, 2, 31) // March 31st
    };
};

const calculateInterest = (principal, rate, durationInDays) => {
    const effectiveDuration = (durationInDays > 0 && durationInDays < 30) ? 30 : durationInDays;
    return principal * (rate / 100 / 30) * effectiveDuration;
};

const updateAllCalculations = () => {
    const todayDate = parseDate(todayDateEl.value);
    const interestRate = parseFloat(interestRateEl.value) || 0;
    let totalPrincipal = 0, totalInterestRaw = 0;
    document.querySelectorAll('#loanTable tbody tr').forEach(row => {
        const principal = parseFloat(row.querySelector('.principal').value) || 0;
        const loanNo = row.querySelector('.no').value; // NEW: Get loan number
        const loanDate = parseDate(row.querySelector('.date').value);
        const durationEl = row.querySelector('.duration');
        const interestEl = row.querySelector('.interest');
        
        // NEW: Calculate specific rate for this row
        const actualRate = getInterestRateForLoan(loanNo, interestRate);
        
        const duration = days360(loanDate, todayDate);
        const interest = calculateInterest(principal, actualRate, duration); // Use actualRate
        const roundedInterest = roundToNearest(interest, 5);
        const displayDuration = (duration > 0 && duration < 30) ? 30 : duration;

        durationEl.textContent = displayDuration > 0 ? displayDuration : '';
        interestEl.textContent = roundedInterest > 0 ? Math.round(roundedInterest) : '';
        
        totalPrincipal += principal;
        totalInterestRaw += interest;
    });
    
    const roundedTotalInterest = roundToNearest(totalInterestRaw, 10);
    totalPrincipalEl.textContent = Math.round(totalPrincipal);
    totalInterestEl.textContent = Math.round(roundedTotalInterest);
    finalTotalEl.textContent = Math.round(totalPrincipal + roundedTotalInterest);
    
    if (!isUpdatingFromListener) {
        debouncedUpdateLiveState();
    }
};

// --- Table Management ---
const addRow = (loan = { no: '', principal: '', date: '' }) => {
    const rowCount = loanTableBody.rows.length;
    const row = loanTableBody.insertRow();
    row.innerHTML = `
        <td>${rowCount + 1}</td>
        <td><input type="text" class="no" value="${loan.no}"></td>
        <td><input type="number" class="principal" placeholder="0" value="${loan.principal}"></td>
        <td><input type="text" class="date" placeholder="DD/MM/YYYY" value="${loan.date}"></td>
        <td class="read-only duration"></td>
        <td class="read-only interest"></td>
        <td><button class="btn btn-danger" aria-label="Remove Row" onclick="removeRow(this)">X</button></td>`;
    renumberRows();
    if (!isUpdatingFromListener) {
        updateAllCalculations();
    }
};
const removeRow = (button) => {
    const row = button.closest('tr');
    if (loanTableBody.rows.length > 1) { row.remove(); renumberRows(); updateAllCalculations(); }
};
const renumberRows = () => {
    document.querySelectorAll('#loanTable tbody tr').forEach((r, index) => { r.cells[0].textContent = index + 1; });
};
const cleanAndSortTable = () => {
    Array.from(loanTableBody.querySelectorAll('tr')).forEach(row => {
        if (!row.querySelector('.principal').value.trim() && loanTableBody.rows.length > 1) row.remove();
    });
    const sortedRows = Array.from(loanTableBody.querySelectorAll('tr')).sort((a, b) =>
        a.querySelector('.no').value.trim().toLowerCase().localeCompare(b.querySelector('.no').value.trim().toLowerCase(), undefined, { numeric: true })
    );
    sortedRows.forEach(row => loanTableBody.appendChild(row));
    renumberRows();
};

// --- Image Scanning (Calculator Tab) ---
const fillTableFromScan = (loans) => {
    if (!loans || loans.length === 0) {
        showConfirm('Scan Results', 'The custom model did not find any complete loan entries.', false);
        return;
    }
    
    const emptyRows = Array.from(loanTableBody.querySelectorAll('tr')).filter(r => 
        !r.querySelector('.principal').value && !r.querySelector('.no').value
    );
    
    let emptyRowIndex = 0;
    
    loans.forEach((loan) => {
        // 1. Clean up the scanned number (e.g. B.673 -> B/673)
        let cleanNo = String(loan.no).toUpperCase();
        cleanNo = cleanNo.replace(/([A-Z])[\.\-\s]+(\d)/g, '$1/$2');
        if (/^[A-Z]\d+$/.test(cleanNo)) {
             cleanNo = cleanNo.replace(/([A-Z])(\d)/, '$1/$2');
        }

        // 2. Prepare default scanned values
        let finalPrincipal = String(loan.principal).replace(/,/g, '');
        let finalDate = formatDateToDDMMYYYY(parseDate(loan.date));

        // --- NEW: Database Lookup (Priority Override) ---
        // Check if this loan exists in your Active Inventory
        const dbMatch = activeInventory.find(item => 
            normalizeLoanNo(item.no) === normalizeLoanNo(cleanNo)
        );

        if (dbMatch) {
            // Found! Use the Database values instead of the Image values
            finalPrincipal = dbMatch.principal;
            finalDate = dbMatch.date;
            // Optional: You could also fix the 'cleanNo' casing to match DB if needed
            cleanNo = dbMatch.no;
        }
        // ------------------------------------------------

        const formattedLoan = {
            no: cleanNo,
            principal: finalPrincipal,
            date: finalDate
        };
        
        if (emptyRowIndex < emptyRows.length) {
            const targetRow = emptyRows[emptyRowIndex];
            targetRow.querySelector('.no').value = formattedLoan.no;
            targetRow.querySelector('.principal').value = formattedLoan.principal;
            targetRow.querySelector('.date').value = formattedLoan.date;
            emptyRowIndex++;
        } else {
            addRow(formattedLoan);
        }
    });
    
    updateAllCalculations();
    showConfirm('Scan Complete', `${loans.length} loan(s) were successfully added to the table.`, false);
};

const handleImageScan = async (fileOrEvent) => {
    const file = fileOrEvent.target ? fileOrEvent.target.files[0] : fileOrEvent;

    if (!file) return;
    showConfirm('Scanning Image...', 'Please wait while the document is being analyzed.', false);
    
    try {
        const reader = new FileReader();
        reader.onload = async () => {
            try {
                const base64Image = reader.result.split(',')[1];
                const response = await fetch('/.netlify/functions/scanImage', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ image: base64Image, mimeType: file.type })
                });
                closeConfirm();
                if (!response.ok) {
                    const errorInfo = await response.json();
                    throw new Error(errorInfo.error || 'The scan failed. The server responded with an error.');
                }
                const result = await response.json();
                fillTableFromScan(result.loans);
            } catch (fetchError) {
                console.error("ERROR inside onload:", fetchError);
                closeConfirm();
                await showConfirm('Error', fetchError.message, false);
            }
        };
        reader.onerror = (error) => {
            console.error("CRITICAL: FileReader failed with an error.", error);
            closeConfirm();
            showConfirm('Error', 'Could not read the selected image file.', false);
        };
        reader.readAsDataURL(file);
    } catch (error) {
        console.error("CRITICAL: An error was caught in the outer try/catch block.", error);
        closeConfirm();
        await showConfirm('Error', error.message, false);
    }
    
    if (fileOrEvent.target) {
        imageUploadInput.value = '';
    }
};

// --- Tabs ---
// REPLACE your entire existing showTab function with this:
const showTab = (tabId) => {
    // 1. Intercept "Transactions" click if we are currently VIEWING a report there
    if (tabId === 'transactionsTab') {
        const wrapper = document.getElementById('calculatorMainContent');
        const mount = document.getElementById('transactionCalculatorMount');
        // If calculator is currently hijacked inside Transactions tab...
        if (wrapper && wrapper.parentNode === mount) {
            // ...then "Back" to list instead of reloading tab
            exitViewMode(); 
            return; 
        }
    }

    // 2. If switching to ANY other tab (e.g. Dashboard), ensure calculator is put back
    if (tabId !== 'transactionsTab') {
        restoreCalculator();
    }

    // 3. Standard Logic
    document.querySelectorAll('.tab-content, .tab-button').forEach(el => el.classList.remove('active'));
    document.getElementById(tabId).classList.add('active');
    document.querySelector(`[data-tab="${tabId}"]`).classList.add('active');

    if (user) {
        if (tabId === 'transactionsTab') {
            toggleTxView('pending');
            loadRecentTransactions(); 
            if (cachedFinalisedReports.length === 0) loadFinalisedTransactions();
        }
        if (tabId === 'dashboardTab') renderDashboard();
        
        // --- UPDATED INVENTORY TAB LOGIC ---
        if (tabId === 'inventoryTab') {
            loadInventory();
            toggleInventoryView('search'); 
            
            // 1. Ensure Search Table has rows (Existing logic)
            if (loanSearchTableBody.rows.length === 0) {
                for (let i = 0; i < 3; i++) addSearchRow();
            }

            // 2. FIX: Ensure Batch (Entry) Table has rows (MISSING PART)
            const batchBody = document.querySelector('#batchTable tbody');
            if (batchBody && batchBody.rows.length === 0) {
                for(let i=0; i<3; i++) {
                    if (typeof addBatchRow === 'function') addBatchRow();
                }
            }

            if (cachedFinalisedReports.length === 0) loadFinalisedTransactions().then(buildLoanSearchCache);
            else buildLoanSearchCache();
        }
    }
};


const toggleTxView = (mode) => {
    const isPending = (mode === 'pending');
    document.getElementById('txPending').checked = isPending;
    document.getElementById('txFinalised').checked = !isPending;
    
    document.getElementById('pendingView').style.display = isPending ? 'block' : 'none';
    document.getElementById('finalisedView').style.display = !isPending ? 'block' : 'none';
};

// NEW: Toggle between Search and Entry Views
const toggleInventoryView = (mode) => {
    const isSearch = (mode === 'search');
    document.getElementById('invSearch').checked = isSearch;
    document.getElementById('invEntry').checked = !isSearch;
    
    document.getElementById('invSearchView').style.display = isSearch ? 'block' : 'none';
    document.getElementById('invEntryView').style.display = !isSearch ? 'block' : 'none';

    // If switching to Entry, auto-fill today's date
    if (!isSearch && !document.getElementById('batchDate').value) {
        document.getElementById('batchDate').value = formatDateToDDMMYYYY(new Date());
    }
};

// NEW: Batch Table Logic
const batchTableBody = document.querySelector('#batchTable tbody');

// REPLACE your existing addBatchRow function with this:
// Search for: const addBatchRow = () => {
// Replace with:

const addBatchRow = () => {
    const batchTableBody = document.querySelector('#batchTable tbody');
    if (!batchTableBody) return;

    const rowCount = batchTableBody.rows.length;
    const row = batchTableBody.insertRow();
    
    row.innerHTML = `
        <td>${rowCount + 1}</td>
        <td>
            <input type="text" class="batch-no" placeholder="ENTER LOAN NO" style="text-transform: uppercase; width: 100%;">
        </td>
        <td>
            <input type="number" class="batch-principal" placeholder="0" oninput="updateBatchTotal()">
        </td>
        <td>
            <select class="batch-type" style="border:none; background:transparent; font-weight:900; font-size: 0.9rem; padding: 5px;">
                <option value="G">G</option>
                <option value="S">S</option>
            </select>
        </td>
        <td><input type="text" class="batch-note" placeholder="Details"></td>
        <td style="text-align: center;">
            <button class="btn btn-danger btn-sm" onclick="this.closest('tr').remove(); renumberBatchRows(); updateBatchTotal();" style="padding: 5px 12px; font-size: 1.5rem; line-height: 1;">&times;</button>
        </td>
    `;
};

// NEW: Auto-Add Row Logic for SEARCH Table
const searchTableBody = document.querySelector('#loanSearchTable tbody');

if (searchTableBody) {
    searchTableBody.addEventListener('input', (e) => {
        // Only trigger if typing in an Input field
        if (e.target.tagName === 'INPUT') {
            const currentRow = e.target.closest('tr');
            const lastRow = searchTableBody.rows[searchTableBody.rows.length - 1];

            // If user types in the LAST row, add a new one
            if (currentRow === lastRow) {
                if (e.target.value.trim() !== '') {
                    // Call your existing function to add a search row
                    if (typeof addSearchRow === 'function') addSearchRow();
                }
            }
        }
    });
}

const renumberBatchRows = () => {
    Array.from(batchTableBody.rows).forEach((row, index) => {
        row.cells[0].textContent = index + 1;
    });
};

// Listeners (Ensure these run after DOM load)
const addBatchBtn = document.getElementById('addBatchRowBtn');
if(addBatchBtn) addBatchBtn.addEventListener('click', addBatchRow);

const loadInventory = async () => {
    if (!user) return;
    

    try {
        const snapshot = await db.collection('activeInventory').get();
        
        // 1. Load Data into Global Variable
        activeInventory = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));

        // 2. Sort Data (A-Z)
        activeInventory.sort((a, b) => {
            return String(a.no).localeCompare(String(b.no), undefined, { numeric: true, sensitivity: 'base' });
        });

        // 3. (Line Removed: renderInventoryTable) - Not needed.

        // --- PRE-RENDER DASHBOARD INSTANTLY ---
        // We calculate the stats NOW, while the user is still on the Calculator tab.
        // So when they click "Dashboard", the numbers are already waiting.
        if (typeof renderDashboard === 'function') {
            await renderDashboard(); 
        }
        // -----------------------------------------------

    } catch (error) {
        console.error("Error loading inventory:", error);
    }
};

// --- NEW HELPER: Reuse Dues Modal for Batch Entry ---
const askDuesForBatch = (currentVal) => {
    return new Promise((resolve, reject) => {
        const modal = document.getElementById('duesModal');
        const input = document.getElementById('duesInput');
        const confirmBtn = document.getElementById('duesConfirmBtn');
        const cancelBtn = document.getElementById('duesCancelBtn');
        const title = modal.querySelector('h2');
        const msg = modal.querySelector('p');

        // 1. Save original text to restore later
        const origTitle = title.textContent;
        const origMsg = msg.textContent;
        const origBtn = confirmBtn.textContent;

        // 2. Customize Modal for Batch Entry
        title.textContent = "Update Dues Amount";
        msg.textContent = "Confirm the total pending dues before saving:";
        confirmBtn.textContent = "Save Entry";
        input.value = currentVal;

        // 3. Show Modal
        modal.style.display = 'flex';
        input.focus();

        // 4. Define Temporary Handlers
        const onConfirm = () => {
            const val = parseFloat(input.value);
            cleanup();
            // Resolve with new value (or 0 if empty)
            resolve(isNaN(val) ? 0 : val);
        };

        const onCancel = () => {
            cleanup();
            reject('cancelled'); // Reject Promise to stop saving
        };

        // 5. Cleanup Function (Restores UI & Removes Listeners)
        const cleanup = () => {
            modal.style.display = 'none';
            confirmBtn.removeEventListener('click', onConfirm);
            cancelBtn.removeEventListener('click', onCancel);
            
            // Restore Original Text for Finalise Report
            title.textContent = origTitle;
            msg.textContent = origMsg;
            confirmBtn.textContent = origBtn;
        };

        // 6. Attach Listeners
        confirmBtn.addEventListener('click', onConfirm);
        cancelBtn.addEventListener('click', onCancel);
    });
};

// --- Add this to your script.js ---

const saveBatchEntries = async () => {
    if (!user) return showConfirm("Error", "You must be logged in to save.", false);
    
    const batchBody = document.querySelector('#batchTable tbody');
    const rows = Array.from(batchBody.querySelectorAll('tr'));
    
    // 1. Prepare Data
    const entries = [];
    rows.forEach(row => {
        let rawNo = row.querySelector('.batch-no').value.trim().toUpperCase();
        const principal = row.querySelector('.batch-principal').value;
        const type = row.querySelector('.batch-type').value; 
        const details = row.querySelector('.batch-note').value.trim();

        if (rawNo && principal) {
            const cleanNo = normalizeLoanNo(rawNo);
            entries.push({
                no: cleanNo,
                principal: principal,
                type: type,
                details: details,
                date: document.getElementById('batchDate').value || formatDateToDDMMYYYY(new Date()),
                userId: user.uid,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        }
    });

    if (entries.length === 0) {
        return showConfirm("Empty Batch", "Please enter at least one loan.", false);
    }

    // 2. Duplicate Check
    const duplicates = entries.filter(newEntry => 
        activeInventory.some(existing => normalizeLoanNo(existing.no) === newEntry.no)
    );

    if (duplicates.length > 0) {
        const proceed = await showConfirm(
            "Duplicate Warning", 
            `Loans already exist: ${duplicates.map(d => d.no).join(', ')}. Overwrite?`
        );
        if (!proceed) return;
    }

    // --- NEW: POPUP FOR DUES (Async) ---
    let finalDues = currentPreviousDues;
    let finalDuesDate = currentPreviousDuesDate;

    try {
        // This opens the modal and waits for your click
        const newDuesVal = await askDuesForBatch(currentPreviousDues);
        
        // If we get here, you clicked "Save Entry"
        if (newDuesVal !== currentPreviousDues) {
            finalDues = newDuesVal;
            finalDuesDate = document.getElementById('batchDate').value;
            if (!finalDuesDate) finalDuesDate = formatDateToDDMMYYYY(new Date());
        }
    } catch (error) {
        // If we get here, you clicked "Cancel"
        // We stop the function. Data remains in the table.
        return; 
    }
    // -----------------------------------

    // 3. Save to Firestore
    showConfirm("Saving...", "Uploading...", false);
    const batch = db.batch();
    
    entries.forEach(entry => {
        const docId = `${user.uid}_${entry.no.replace(/\//g, '-')}`;
        const docRef = db.collection('activeInventory').doc(docId);
        batch.set(docRef, entry);
    });

    // Update Shared Dues Globally
    const sharedDuesRef = db.collection('globalSettings').doc('sharedDues');
    batch.set(sharedDuesRef, {
        previousDues: finalDues,
        previousDuesDate: finalDuesDate
    }, { merge: true });

    // --- NEW: Save to Permanent History Ledger ---
    const duesHistoryRef = db.collection('duesHistory').doc(); // Auto-generates unique ID
    batch.set(duesHistoryRef, {
        amount: finalDues,
        date: finalDuesDate,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        source: 'Batch Entry',
        updatedBy: user.email || user.uid
    });
    // ---------------------------------------------

    // Mirror to live state just to keep legacy code happy
    const liveStateRef = db.collection('liveCalculatorState').doc(user.uid);
    batch.set(liveStateRef, {
        previousDues: finalDues,
        previousDuesDate: finalDuesDate
    }, { merge: true });

    try {
        await batch.commit();
        
        // Update Local State
        currentPreviousDues = finalDues;
        currentPreviousDuesDate = finalDuesDate;

        await showConfirm("Success", `Saved ${entries.length} items. Dues: ₹${finalDues}`, false);
        
        // Clear Table and Reset
        batchBody.innerHTML = ''; 
        for(let i=0; i<3; i++) addBatchRow(); 
        
        if(document.getElementById('batchTotalDisplay')) {
            document.getElementById('batchTotalDisplay').textContent = '₹0';
        }
        loadInventory(); 

    } catch (error) {
        console.error("Batch Save Error:", error);
        await showConfirm("Error", "Failed to save. Check internet.", false);
    }
};


// NEW: Auto-Add Row Logic for Batch Table
const batchTable = document.querySelector('#batchTable tbody');

if (batchTable) {
    batchTable.addEventListener('input', (e) => {
        // We only care if the user is typing in an input field
        if (e.target.tagName === 'INPUT') {
            const currentRow = e.target.closest('tr');
            const lastRow = batchTable.rows[batchTable.rows.length - 1];

            // If the user is typing in the LAST row, add a new empty row automatically
            if (currentRow === lastRow) {
                // Check if the row actually has some data (don't add if they just clicked it)
                if (e.target.value.trim() !== '') {
                    addBatchRow();
                }
            }
        }
    });
}

const resetCalculatorState = () => {
    if (!user) return;
    const defaultLoans = Array(3).fill({ no: '', principal: '', date: '' });
    const liveStateRef = db.collection('liveCalculatorState').doc(user.uid);

    liveStateRef.set({
        todayDate: formatDateToDDMMYYYY(new Date()),
        interestRate: '1.75',
        loans: defaultLoans,
        previousDues: currentPreviousDues,      // Keep Amount
        previousDuesDate: currentPreviousDuesDate, // <--- Keep Date
        lastUpdatedBy: sessionClientId + '_reset'
    });
    currentlyEditingReportId = null;
};

// --- Actions: Save, Print, Clear, PDF ---
const getCurrentLoans = () => Array.from(document.querySelectorAll('#loanTable tbody tr'))
    .map(row => ({
        no: row.querySelector('.no').value,
        principal: row.querySelector('.principal').value,
        date: row.querySelector('.date').value,
        duration: row.querySelector('.duration').textContent,
        interest: row.querySelector('.interest').textContent
    })).filter(loan => loan.principal && parseFloat(loan.principal) > 0);

const generatePDF = async (action = 'save') => {
    // 1. Prepare Data
    cleanAndSortTable();
    updateAllCalculations(); 
    const loans = getCurrentLoans();
    
    if (loans.length === 0) {
        showConfirm("Cannot Generate PDF", "Please add loan data to generate a report.", false);
        return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    // 2. Header
    doc.setFontSize(12);
    doc.setFont("helvetica", "normal");
    doc.text(`Date- ${todayDateEl.value}`, 190, 20, { align: 'right' });

    // 3. Table Data
    const tableBodyData = loans.map((loan, i) => {
        const principal = parseFloat(loan.principal) || 0;
        const interest = parseFloat(loan.interest) || 0;
        const total = Math.round(principal + interest);
        
        return [
            i + 1, 
            String(loan.no).toUpperCase(), 
            loan.principal, 
            loan.date, 
            loan.duration, 
            loan.interest, 
            String(total)
        ];
    });

    // --- NEW: Calculate Footer Totals ---
    const tPrincipal = parseFloat(totalPrincipalEl.textContent) || 0;
    const tInterest = parseFloat(totalInterestEl.textContent) || 0;
    const tTableTotal = Math.round(tPrincipal + tInterest);

    // 4. Draw Table with Footer
    doc.autoTable({
        startY: 30,
        head: [['SL', 'No', 'Principal', 'Date', 'Duration (Days)', 'Interest', 'Total']],
        body: tableBodyData,
        // NEW: Add the footer row here
        foot: [[
            '', 
            'TOTAL', 
            String(tPrincipal), 
            '', 
            '', 
            String(tInterest), 
            ''
        ]],
        theme: 'striped',
        headStyles: { halign: 'center', fontStyle: 'bold' },
        // NEW: Style the footer row (Bold text, specific colors if you want)
        footStyles: { halign: 'center', fontStyle: 'bold', textColor: [0, 0, 0], fillColor: [240, 240, 240] },
        styles: { halign: 'center' }
    });

    const finalY = doc.autoTable.previous.finalY;

    // ==========================================
    // 5. TOTALS SECTION (Summary below table)
    // ==========================================
    doc.setFontSize(12);
    doc.setFont("helvetica", "normal");
    const numberColumnX = 160;
    const labelColumnX = 165;
    
    // Base Y Position
    let currentY = finalY + 10;

    // Get Values for Final Calculation
    const pDues = parseFloat(currentPreviousDues) || 0;
    const pdfFinalTotal = Math.round(tTableTotal + pDues);  // Final Amount including dues

    // Line 1: Total Principal
    currentY += 7;
    doc.text(String(tPrincipal), numberColumnX, currentY, { align: 'right' });
    doc.text('Total Principal', labelColumnX, currentY, { align: 'left' });
    
    // Line 2: Total Interest
    currentY += 7;
    doc.text(String(tInterest), numberColumnX, currentY, { align: 'right' });
    doc.text('Total Interest', labelColumnX, currentY, { align: 'left' });

    // Line 3: Total (Subtotal)
    currentY += 7;
    doc.setFont("helvetica", "bold");
    doc.text(String(tTableTotal), numberColumnX, currentY, { align: 'right' });
    doc.text('Total', labelColumnX, currentY, { align: 'left' });
    doc.setFont("helvetica", "normal"); // Reset font

    // Lines 4 & 5: Previous Dues & Date
    if (pDues > 0) {
        currentY += 7;
        doc.text(String(pDues), numberColumnX, currentY, { align: 'right' });
        doc.text('Previous Dues', labelColumnX, currentY, { align: 'left' });

        if (currentPreviousDuesDate) {
            currentY += 5; 
            doc.setFontSize(10); 
            doc.setTextColor(100); 
            doc.text(`of ${currentPreviousDuesDate}`, labelColumnX, currentY, { align: 'left' });
            doc.setFontSize(12);
            doc.setTextColor(0);
        } else {
            currentY += 2; 
        }

        currentY += 7; 
        doc.setFont("helvetica", "bold");
        doc.text(String(pdfFinalTotal), numberColumnX, currentY, { align: 'right' });
        doc.text('Total Amount', labelColumnX, currentY, { align: 'left' });
    } else {
        currentY += 7;
        doc.setFont("helvetica", "bold");
        doc.text(String(pdfFinalTotal), numberColumnX, currentY, { align: 'right' });
        doc.text('Total Amount', labelColumnX, currentY, { align: 'left' });
    }

    // 6. Save/Share Logic
    const fileName = `Interest_Report_${todayDateEl.value.replace(/\//g, '-')}.pdf`;
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

    if (isMobile && navigator.share && navigator.canShare) {
        const pdfBlob = doc.output('blob');
        const pdfFile = new File([pdfBlob], fileName, { type: 'application/pdf' });
        if (navigator.canShare({ files: [pdfFile] })) {
            try {
                await navigator.share({ files: [pdfFile] });
                return; 
            } catch (error) { console.error('Share API failed:', error); }
        }
    }

    if (action === 'print' && !isMobile) {
        doc.autoPrint();
        doc.output('dataurlnewwindow');
    } else {
        doc.save(fileName);
    }
};

const isDuplicateReport = (newReport, reportList) => {
    const normalizeLoansForComparison = (loans) => {
        return loans.map(l => ({
            no: l.no.trim().toUpperCase(),
            principal: parseFloat(l.principal) || 0,
            date: l.date
        })).sort((a, b) => a.no.localeCompare(b.no));
    };

    const newReportLoansString = JSON.stringify(normalizeLoansForComparison(newReport.loans));
    const newInterestRate = parseFloat(newReport.interestRate) || 0;

    return reportList.some(existingReport => {
        const existingInterestRate = parseFloat(existingReport.interestRate) || 0;
        if (newReport.reportDate !== existingReport.reportDate || newInterestRate !== existingInterestRate) {
            return false;
        }
        const existingReportLoansString = JSON.stringify(normalizeLoansForComparison(existingReport.loans));
        return newReportLoansString === existingReportLoansString;
    });
};

const saveReport = async (silent = false) => {
    await loadRecentTransactions(); 
    cleanAndSortTable();
    updateAllCalculations();
    const loans = getCurrentLoans().map(({ no, principal, date }) => ({ no, principal, date }));
    if (loans.length === 0) {
        if (!silent) showConfirm("Cannot Save", "Please add at least one loan with a principal amount.", false);
        return false;
    }

    const reportDate = todayDateEl.value;
    const report = {
        reportDate,
        interestRate: interestRateEl.value,
        loans,
        lastUpdatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        status: 'pending',
        totals: { principal: totalPrincipalEl.textContent, interest: totalInterestEl.textContent, final: finalTotalEl.textContent }
    };

    let success = false;
    if (currentlyEditingReportId) {
        if (navigator.onLine && reportsCollection) {
            try {
                await reportsCollection.doc(currentlyEditingReportId).update(report);
                success = true;
            } catch (error) {
                console.error("Error updating report:", error);
                if (!silent) await showConfirm("Error", "Failed to update the report.", false);
            }
        } else {
            if (!silent) await showConfirm("Offline", "You must be online to update an existing report.", false);
        }
    } else {
        if (isDuplicateReport(report, cachedReports)) {
            if (!silent) await showConfirm("Already Saved", "This exact report already exists and will not be saved again.", false);
            return false;
        }
        
        if (navigator.onLine && reportsCollection) {
            const baseName = `Summary of ${reportDate}`;
            const querySnapshot = await reportsCollection.where("reportDate", "==", reportDate).get();
            report.reportName = querySnapshot.size > 0 ? `${baseName} (${querySnapshot.size + 1})` : baseName;
            report.createdAt = firebase.firestore.FieldValue.serverTimestamp();
            delete report.lastUpdatedAt;
            
            try {
                report.isDeleted = false;
                await reportsCollection.add(report);
                success = true;
            } catch (error) { console.error("Error saving online:", error); }
        } else {
            report.localId = `local_${Date.now()}`;
            report.reportName = `(Unsynced) Summary of ${reportDate}`;
            report.createdAt = new Date();
            report.isDeleted = false;
            delete report.lastUpdatedAt;
            await localDb.put('unsyncedReports', report);
            if (!silent) await showConfirm("Offline", "Report saved locally. It will sync when you're back online.", false);
            success = true;
        }
    }
    
    if (success) {
        loadRecentTransactions();
        let shouldClear = false;
        if (silent) {
            shouldClear = true;
        } else {
            shouldClear = await showConfirm(
                "Save Successful", 
                "Your report has been saved. Would you like to clear the sheet for a new entry?"
            );
        }
        if (shouldClear) {
            resetCalculatorState();
        }
        listenForLiveStateChanges();
    }
    return success;
};

const exportToPDF = async () => {
    const isViewMode = viewModeActionBar.style.display !== 'none';
    if (isViewMode) {
        generatePDF('save');
    } else {
        // Prevent silent save from wiping the UI/state before PDF grabs the data.
        // Check if there are loans, generate the PDF first, and THEN save the report.
        const currentLoans = getCurrentLoans();
        if (currentLoans.length === 0) {
            showConfirm("Cannot Generate PDF", "Please add loan data to generate a report.", false);
            return;
        }
        
        await generatePDF('save');
        await saveReport(true); 
    }
};

const clearSheet = async () => {
    const confirmed = await showConfirm("Clear Sheet", "Are you sure? This action cannot be undone.");
    if (confirmed) {
        resetCalculatorState();
        listenForLiveStateChanges();
    }
};

const clearSearchTable = async () => {
    const confirmed = await showConfirm(
        "Clear Search Sheet", 
        "Are you sure you want to clear all search rows?"
    );
    if (confirmed) {
        loanSearchTableBody.innerHTML = '';
        for (let i = 0; i < 3; i++) {
            addSearchRow();
        }
    }
};

// --- Recent & Finalised Transactions ---
const renderRecentTransactions = (filter = '') => {
    recentTransactionsListEl.innerHTML = '';
    const searchTerm = filter.toLowerCase();
    const filteredReports = cachedReports.filter(report => {
        if (!searchTerm) return true;
        if (report.reportName?.toLowerCase().includes(searchTerm)) return true;
        return report.loans?.some(loan =>
            loan.no?.toLowerCase().includes(searchTerm) ||
            loan.principal?.toLowerCase().includes(searchTerm)
        );
    });

    if (filteredReports.length === 0) {
        recentTransactionsListEl.innerHTML = '<li>No matching transactions found.</li>';
        return;
    }

    filteredReports.forEach(report => {
        const li = document.createElement('li');
        if (report.isLocal) li.classList.add('unsynced');
        li.dataset.reportId = report.id;
        li.innerHTML = `
            <span>${report.reportName || `Report from ${report.reportDate}`}</span>
            <div class="button-group">
                <button class="btn btn-secondary" onclick="viewReport('${report.id}', false, false, 'recentTransactionsTab')">View</button>
                <button class="btn btn-primary" onclick="viewReport('${report.id}', true, false, 'recentTransactionsTab')">Edit</button>
                <button class="btn btn-success" onclick="finaliseReport('${report.id}')">Finalise</button>
                <button class="btn btn-danger" onclick="deleteReport('${report.id}')">Delete</button>
            </div>`;
        recentTransactionsListEl.appendChild(li);
    });
};

const loadRecentTransactions = async () => {
    if (!user || !reportsCollection) return;

    // --- FIX 1: INSTANT LOAD (Cache-First) ---
    // If we have data in memory, show it IMMEDIATELY. Don't wait for internet.
    if (cachedReports.length > 0) {
        renderRecentTransactions(reportSearchInput.value);
        recentTransactionsLoader.style.display = 'none';
    } else {
        // Only show spinner if the screen is completely empty
        recentTransactionsLoader.style.display = 'flex';
    }

    let onlineReports = [];
    
    // --- FIX 2: BACKGROUND FETCH ---
    if (navigator.onLine) {
        try {
            const snapshot = await reportsCollection
                .where("isDeleted", "!=", true)
                .where("status", "==", "pending")
                .orderBy("isDeleted")
                .orderBy("createdAt", "desc")
                .get();
            onlineReports = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id, isLocal: false }));
        } catch (error) {
            console.error("Error loading online reports:", error);
        }
    }
    
    const local = (localDb) ? (await localDb.getAll('unsyncedReports')).map(r => ({ ...r, id: r.localId, isLocal: true })) : [];
    
    // Update memory with fresh data
    cachedReports = [...local, ...onlineReports].sort((a, b) => {
        const dateA = a.createdAt?.toDate?.() || 0;
        const dateB = b.createdAt?.toDate?.() || 0;
        return dateB - dateA;
    });

    // Render again with the fresh data
    recentTransactionsLoader.style.display = 'none';
    renderRecentTransactions(reportSearchInput.value);
};


const renderFinalisedTransactions = (filter = '') => {
    const listEl = document.getElementById('finalisedTransactionsList');
    listEl.innerHTML = '';
    const searchTerm = filter.toLowerCase();
    const filteredReports = cachedFinalisedReports.filter(report => {
        if (!searchTerm) return true;
        if (report.reportName?.toLowerCase().includes(searchTerm)) return true;
        return report.loans?.some(loan =>
            loan.no?.toLowerCase().includes(searchTerm) ||
            loan.principal?.toLowerCase().includes(searchTerm)
        );
    });
    if (filteredReports.length === 0) {
        listEl.innerHTML = '<li>No finalised transactions found.</li>';
        return;
    }
    filteredReports.forEach(report => {
        const li = document.createElement('li');
        li.dataset.reportId = report.id;

        let creationDate = '';
        if (report.createdAt && report.createdAt.toDate) {
            creationDate = report.createdAt.toDate().toLocaleString('en-IN', {
                day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
            }).toLowerCase();
        }

        li.innerHTML = `
            <div style="flex-grow: 1;">
                <span style="font-weight: 600;">${report.reportName || `Report from ${report.reportDate}`}</span>
                <div style="font-size: 0.8rem; color: var(--subtle-text-color);">${creationDate}</div>
            </div>
            <div class="button-group">
                <button class="btn btn-secondary" onclick="viewReport('${report.id}', false, true, 'finalisedTransactionsTab')">View</button>
                <button class="btn btn-danger" onclick="deleteReport('${report.id}', true)">Delete</button>
            </div>`;
        listEl.appendChild(li);
    });
};

const loadFinalisedTransactions = async () => {
    if (!user || !navigator.onLine) return;

    // --- FIX 1: INSTANT LOAD ---
    if (cachedFinalisedReports.length > 0) {
        renderFinalisedTransactions(document.getElementById('finalisedReportSearchInput').value);
        document.getElementById('finalisedTransactionsLoader').style.display = 'none';
    } else {
        document.getElementById('finalisedTransactionsLoader').style.display = 'flex';
    }

    try {
        const snapshot = await reportsCollection
            .where("isDeleted", "!=", true)
            .where("status", "==", "finalised")
            .get();
            
        let reports = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id, isLocal: false }));
        
        reports.sort((a, b) => {
            const dateA = parseDate(a.reportDate);
            const dateB = parseDate(b.reportDate);
            if (!dateA) return 1;
            if (!dateB) return -1;
            return dateB - dateA; 
        });

        cachedFinalisedReports = reports;

    } catch (error) {
        console.error("Error loading finalised reports:", error);
    }
    
    document.getElementById('finalisedTransactionsLoader').style.display = 'none';
    renderFinalisedTransactions(document.getElementById('finalisedReportSearchInput').value);
};

const setViewMode = (isViewOnly) => {
    const isEditable = !isViewOnly;
    mainActionBar.style.display = isEditable ? 'flex' : 'none';
    viewModeActionBar.style.display = isViewOnly ? 'flex' : 'none';
    todayDateEl.readOnly = isViewOnly;
    interestRateEl.readOnly = isViewOnly;
    document.querySelectorAll('#loanTable tbody tr').forEach(row => {
        row.querySelectorAll('input').forEach(input => input.readOnly = isViewOnly);
        const deleteBtn = row.querySelector('.btn-danger');
        if (deleteBtn) deleteBtn.style.display = isEditable ? 'inline-flex' : 'none';
    });
};

const exitViewMode = () => {
    setViewMode(false);
    resetCalculatorState();
    listenForLiveStateChanges();
    
    // NEW: Always try to restore DOM when exiting view mode
    restoreCalculator();
    restoreDefaultBackButton(); // Reset button text
};
const restoreDefaultBackButton = () => {
    exitViewModeBtn.textContent = 'Back to Calculator';
    exitViewModeBtn.onclick = exitViewMode;
};

// --- NEW: DOM Moving Logic ---
const moveCalculatorToTransactions = () => {
    const wrapper = document.getElementById('calculatorMainContent');
    const mount = document.getElementById('transactionCalculatorMount');
    if (!wrapper || !mount) return;

    // Move the actual DOM element
    mount.appendChild(wrapper);
    mount.style.display = 'block';

    // Hide the Transaction Lists & Toggle to avoid clutter
    const pendingView = document.getElementById('pendingView');
    const finalisedView = document.getElementById('finalisedView');
    const toggle = document.querySelector('#transactionsTab .toggle-container');

    if (pendingView) pendingView.style.display = 'none';
    if (finalisedView) finalisedView.style.display = 'none';
    if (toggle) toggle.style.display = 'none';
};

const restoreCalculator = () => {
    const wrapper = document.getElementById('calculatorMainContent');
    const originalParent = document.getElementById('calculatorTab');
    const mount = document.getElementById('transactionCalculatorMount');
    
    // Only move back if it is currently in the mount point
    if (wrapper && originalParent && wrapper.parentNode === mount) {
        originalParent.appendChild(wrapper);
        mount.style.display = 'none';
        
        // Restore Transaction Tab UI
        const toggle = document.querySelector('#transactionsTab .toggle-container');
        if (toggle) toggle.style.display = 'flex';
        
        // Re-trigger view toggle to show the correct list
        const mode = document.getElementById('txPending').checked ? 'pending' : 'finalised';
        toggleTxView(mode);
    }
};

const viewReport = (reportId, isEditable, isFinalised = false, originTab = 'calculatorTab') => {
    const report = (isFinalised ? cachedFinalisedReports : cachedReports).find(r => r.id === reportId);
    if (!report) return showConfirm("Error", "Report not found!", false);
    
    if (liveStateUnsubscribe) {
        liveStateUnsubscribe();
        liveStateUnsubscribe = null;
    }

    // --- UPDATED LOGIC ---
    // Condition A: EDIT MODE -> Always go to Calculator Tab
    if (isEditable) {
        // Ensure calculator is back in its original tab
        restoreCalculator(); 
        restoreDefaultBackButton();
        showTab('calculatorTab');
        
        // Setup Editing
        currentlyEditingReportId = reportId;
        setViewMode(false); // Enable inputs
    } 
    // Condition B: VIEW MODE (from Transactions) -> Stay in Transactions Tab
    else if (originTab === 'recentTransactionsTab' || originTab === 'finalisedTransactionsTab') {
        moveCalculatorToTransactions(); // Bring calculator here
        
        // Configure "Back" button to return to list
        exitViewModeBtn.textContent = 'Back to List';
        exitViewModeBtn.onclick = () => {
            exitViewMode(); 
        };
        
        currentlyEditingReportId = null;
        setViewMode(true); // Disable inputs (Read-Only)
    }
    // Condition C: VIEW MODE (from Search/Other) -> Standard Behavior
    else if (originTab === 'loanSearchTab') {
        restoreCalculator();
        showTab('calculatorTab');
        exitViewModeBtn.textContent = 'Back to Loan Search';
        exitViewModeBtn.onclick = () => {
            showTab('inventoryTab'); 
            toggleInventoryView('search');
            restoreDefaultBackButton();
        };
        currentlyEditingReportId = null;
        setViewMode(true);
    } 
    // Condition D: Fallback
    else {
        restoreCalculator();
        showTab('calculatorTab');
        restoreDefaultBackButton();
        currentlyEditingReportId = null;
        setViewMode(true);
    }

    // --- POPULATE DATA (Common for all) ---
    todayDateEl.value = report.reportDate;
    interestRateEl.value = report.interestRate;
    loanTableBody.innerHTML = '';
    
    isUpdatingFromListener = true;
    if (report.loans) report.loans.forEach(loan => addRow(loan));
    isUpdatingFromListener = false;
    
    // If editing, add a blank row at the bottom for convenience
    if (isEditable) {
        addRow({ no: '', principal: '', date: '' });
    }
    
    updateAllCalculations();
};

const deleteReport = async (docId, isFinalised = false) => {
    if (isFinalised) {
        const key = prompt("This is a finalised transaction. Please enter the security key to delete.");
        
        if (key === null) return; // User clicked Cancel on prompt

        // --- NEW: Verify Key Securely via Netlify Function ---
        try {
            showConfirm("Verifying...", "Checking security key...", false);
            
            const response = await fetch('/.netlify/functions/verifyKey', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key: key })
            });

            // Close the "Verifying..." popup
            document.getElementById('confirmModal').style.display = 'none';

            if (!response.ok) {
                await showConfirm("Access Denied", "The security key is incorrect. Deletion cancelled.", false);
                return;
            }

        } catch (error) {
            console.error("Verification Error:", error);
            await showConfirm("Error", "Could not verify security key. Check internet.", false);
            return;
        }
        // -----------------------------------------------------
    }

    const confirmed = await showConfirm("Delete Report", "Are you sure you want to permanently delete this report?");
    if (!confirmed) return;

    if (navigator.onLine && reportsCollection) {
        try {
            await reportsCollection.doc(docId).update({
                isDeleted: true,
                deletedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            await showConfirm("Success", "The report has been deleted.", false);
        } catch (error) {
            console.error("Error deleting report:", error);
            await showConfirm("Error", "Failed to delete the report.", false);
        }
    } else {
        await showConfirm("Offline", "You must be online to delete reports.", false);
        return;
    }
    
    if (isFinalised) {
        loadFinalisedTransactions();
    } else {
        loadRecentTransactions();
    }
};


// --- Loan Search Feature Functions ---
// Aggressive Normalizer (Fixes Matching Issues) e.g., A/052 -> A/52
const normalizeLoanNo = (loanNo) => {
    if (!loanNo) return '';
    
    // 1. Clean basic junk (spaces, uppercase)
    const cleanStr = loanNo.trim().toUpperCase();

    // 2. INTELLIGENT REGEX
    // Capture Letters -> Ignore Middle Junk -> Capture Numbers
    const match = cleanStr.match(/^([A-Z]+)[^A-Z0-9]*([0-9]+)$/);

    if (match) {
        const prefix = match[1];      // e.g., "R"
        const number = parseInt(match[2], 10); // e.g., "01" becomes 1
        
        // 3. FORCE STANDARD FORMAT (Always add '/')
        return `${prefix}/${number}`;
    }

    // Fallback: If it's just numbers "123" or weird symbols, leave it alone.
    return cleanStr; 
};

const buildLoanSearchCache = () => {
    loanSearchCache.clear();
    if (cachedFinalisedReports.length === 0) return;

    console.log("Building Cache..."); 

    cachedFinalisedReports.forEach(report => {
        if (report.loans && Array.isArray(report.loans)) {
            report.loans.forEach(loan => {
                const originalLoanNo = loan.no?.trim();
                if (originalLoanNo) {
                    const key = normalizeLoanNo(originalLoanNo);
                    
                    if (!loanSearchCache.has(key)) {
                        loanSearchCache.set(key, {
                            principal: loan.principal,
                            reportDate: report.reportDate,
                            reportId: report.id
                        });
                    }
                }
            });
        }
    });
    console.log(`Cache Built. Total unique loans in DB: ${loanSearchCache.size}`);
};

// --- NEW: Smart Liquidation (Auto-Fill Old Loans) ---
const injectOldLoans = () => {
    // 1. Clear any previously auto-added rows (prevents duplicate adding on double-clicks)
    document.querySelectorAll('.auto-added-row').forEach(row => row.remove());
    renumberSearchRows();

    // 2. Get currently visible loans in the table so we don't duplicate them
    const currentTableLoans = getAvailableLoansFromTable().map(l => l.no);

    // 3. Prep data to calculate age and value
    const today = new Date();
    const globalRate = parseFloat(interestRateEl.value) || 1.75;

    // Filter, Calculate, and Sort Active Inventory
    let availableOldLoans = activeInventory.filter(loan => !currentTableLoans.includes(normalizeLoanNo(loan.no))).map(loan => {
        const loanDate = parseDate(loan.date);
        let days = loanDate ? days360(loanDate, today) : 0;
        if (days < 0) days = 0;
        
        const actualRate = getInterestRateForLoan(loan.no, globalRate);
        const p = parseFloat(loan.principal) || 0;
        const calcDays = (days > 0 && days < 30) ? 30 : days;
        const interest = (p * actualRate * calcDays) / 3000;
        
        return {
            ...loan,
            days: days,
            totalValue: p + interest
        };
    });

    // Sort by oldest (highest days first)
    availableOldLoans.sort((a, b) => b.days - a.days);

    // 4. Greedy Algorithm: Add up to ₹50k (±10% variance)
    let addedTotal = 0;
    const targetMin = 45000;
    const targetMax = 55000;
    const selectedLoans = [];

    for (let i = 0; i < availableOldLoans.length; i++) {
        if (addedTotal >= targetMin) break; // Reached minimum sweet spot

        const loan = availableOldLoans[i];
        
        // Option A Logic: If it fits under the max, add it. If not, skip to a smaller one.
        if (addedTotal + loan.totalValue <= targetMax) {
            selectedLoans.push(loan);
            addedTotal += loan.totalValue;
        }
    }

    // 5. Inject selected loans into the physical table
    if (selectedLoans.length > 0) {
        selectedLoans.forEach(loan => {
            const extraData = {
                principal: String(loan.principal),
                date: loan.date
            };
            
            // Add row
            addSearchRow(loan.no, null, extraData);
            
            // Trigger search to populate "Available" badge
            const newRowInputs = document.querySelectorAll('#loanSearchTable .search-no');
            const lastInput = newRowInputs[newRowInputs.length - 1];
            performLoanSearch(lastInput);
            
            // Highlight row visually
            lastInput.closest('tr').classList.add('auto-added-row');
        });
        renumberSearchRows();
        console.log(`Auto-added ${selectedLoans.length} old loans. Total Value: ₹${Math.round(addedTotal)}`);
    }
    updateSearchTotals(); // <--- ADD THIS LINE HERE
};

// --- NEW: Remove Auto-Added Old Loans ---
const removeOldLoans = () => {
    document.querySelectorAll('.auto-added-row').forEach(row => row.remove());
    renumberSearchRows();
    updateSearchTotals(); // Recalculate totals after removing
};

// --- NEW: Calculate Totals for Search Tab ---
const updateSearchTotals = () => {
    let totalPrin = 0;
    let totalInt = 0;
    const globalRate = parseFloat(interestRateEl.value) || 1.75;
    const today = new Date();

    const rows = document.querySelectorAll('#loanSearchTable tbody tr');
    
    rows.forEach(row => {
        const statusCell = row.querySelector('.status-cell');
        const input = row.querySelector('.search-no');
        const principalCell = row.querySelector('.principal-result');
        
        // Only sum rows that are "Available", have a loan number typed in, and are not hidden by filters
        if (statusCell && statusCell.classList.contains('status-available') && input.value.trim() && row.style.display !== 'none') {
            const p = parseFloat(principalCell.textContent.replace(/,/g, '')) || 0;
            const loanNo = input.value.trim().toUpperCase();

            // Find date from activeInventory to calculate interest accurately
            let loanDate = null;
            const match = activeInventory.find(inv => normalizeLoanNo(inv.no) === normalizeLoanNo(loanNo));
            if (match) loanDate = parseDate(match.date);

            let days = loanDate ? days360(loanDate, today) : 0;
            if (days < 0) days = 0;

            const actualRate = getInterestRateForLoan(loanNo, globalRate);
            const calcDays = (days > 0 && days < 30) ? 30 : days;
            const interest = (p * actualRate * calcDays) / 3000;

            totalPrin += p;
            totalInt += interest;
        }
    });

    const searchTotalPrinEl = document.getElementById('searchTotalPrincipal');
    const searchTotalIntEl = document.getElementById('searchTotalInterest');
    const searchFinalTotalEl = document.getElementById('searchFinalTotal');

    if (searchTotalPrinEl) searchTotalPrinEl.textContent = `₹${Math.round(totalPrin).toLocaleString('en-IN')}`;
    if (searchTotalIntEl) searchTotalIntEl.textContent = `₹${Math.round(totalInt).toLocaleString('en-IN')}`;
    if (searchFinalTotalEl) searchFinalTotalEl.textContent = `₹${Math.round(totalPrin + totalInt).toLocaleString('en-IN')}`;
};

// UPDATED: addSearchRow now stores scan data (Principal/Date) for the report
// Updated: Stores scan data in memory (row.scanData) but DOES NOT fill the UI cells
const addSearchRow = (loanNo = '', box = null, extraData = null) => {
    const rowCount = loanSearchTableBody.rows.length;
    const row = loanSearchTableBody.insertRow();
    
    // 1. Store Coordinates (for Eraser)
    if (box) row.eraseBox = box;

    // 2. Store Extra Data (Hidden from UI, used for Download)
    if (extraData) {
        row.scanData = {
            principal: extraData.principal || '-',
            date: extraData.date || '-'
        };
    } else {
        row.scanData = { principal: '-', date: '-' };
    }

    // 3. Render Row (Cells for Principal/Date are LEFT EMPTY purposely)
    row.innerHTML = `
        <td>${rowCount + 1}</td>
        <td class="read-only status-cell"></td>
        <td><input type="text" class="search-no" placeholder="Enter Loan No..." value="${loanNo}"></td>
        <td class="read-only principal-result"></td>
        <td class="read-only date-result"></td>
        <td><button class="btn btn-danger" aria-label="Remove Row" onclick="removeSearchRow(this)">X</button></td>`;
    renumberSearchRows();
};

const removeSearchRow = (button) => {
    const row = button.closest('tr');
    if (loanSearchTableBody.rows.length > 0) {
        row.remove();
        renumberSearchRows();
        updateSearchTotals(); // <--- ADD THIS
    }
};

const renumberSearchRows = () => {
    document.querySelectorAll('#loanSearchTable tbody tr').forEach((r, index) => {
        r.cells[0].textContent = index + 1;
    });
};

// Updated: Shows Sheet Detail (G/S/?) inside the Status Column
// UPDATED: UI COLORS (G=Yellow, S=Black)
const performLoanSearch = (inputElement) => {
    if (!inputElement) return;
    
    const row = inputElement.closest('tr');
    const userInput = inputElement.value.trim().toUpperCase();
    const principalCell = row.querySelector('.principal-result');
    const dateCell = row.querySelector('.date-result');
    const statusCell = row.querySelector('.status-cell');

    // Reset cells
    principalCell.textContent = '';
    dateCell.textContent = '';
    statusCell.innerHTML = '';
    statusCell.className = 'read-only status-cell';

    if (!userInput) return;

    const normalizedKey = normalizeLoanNo(userInput);

    // --- CHECK 1: FINALISED REPORTS (Sold/Closed) ---
    if (loanSearchCache.has(normalizedKey)) {
        const data = loanSearchCache.get(normalizedKey);
        principalCell.textContent = data.principal;
        dateCell.textContent = data.reportDate; 
        statusCell.classList.add('status-not-available');
        statusCell.innerHTML = `
            <span>Not Available</span>
            <button class="btn btn-secondary btn-sm btn-flat-sm" onclick="viewReport('${data.reportId}', false, true, 'loanSearchTab')">
                View
            </button>`;
        return; 
    }

    // --- CHECK 2: ACTIVE INVENTORY (Firestore) ---
    // We look for the loan in your loaded Active Inventory list
    const inventoryMatch = activeInventory.find(item => 
        item.no === userInput || normalizeLoanNo(item.no) === normalizedKey
    );

    if (inventoryMatch) {
        statusCell.classList.add('status-available');
        
        // Show Principal. Date is left blank for active loans.
        principalCell.textContent = inventoryMatch.principal || '-';
        dateCell.textContent = ''; 

        // Color Logic for G/S (From Firestore Data)
        let colorStyle = '#333';
        if(inventoryMatch.type === 'G') colorStyle = '#f1c40f'; // Yellow
        if(inventoryMatch.type === 'S') colorStyle = '#000000'; // Black

        statusCell.innerHTML = `<span>Available</span><span style="margin-left:8px; font-weight:900; font-size:1.1em; color:${colorStyle};">[${inventoryMatch.type || '?'}]</span>`;
        return; 
    }

    // --- CHECK 3: NOT FOUND ---
    // If not in Finalised and not in Active, it's unknown.
    statusCell.classList.add('status-searching'); // Grey background
    statusCell.innerHTML = `<span style="font-size:0.9em; opacity:0.7;">Unknown</span>`;
};

// Handle Image Scan for Loan Search Tab
const handleNumberScan = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    // 1. Setup Canvas
    scanCanvas = document.getElementById('scanCanvas');
    scanCtx = scanCanvas.getContext('2d');
    const img = new Image();
    
    showConfirm('Scanning...', 'Analyzing document structure...', false);

    const reader = new FileReader();
    reader.onload = async () => {
        try {
            // Load image into Image Object and Canvas
            img.src = reader.result;
            await new Promise(r => img.onload = r);
            
            // Resize canvas to match image
            scanCanvas.width = img.width;
            scanCanvas.height = img.height;
            scanCtx.drawImage(img, 0, 0);

            // Send to Gemini
            const base64Image = reader.result.split(',')[1];
            const response = await fetch('/.netlify/functions/scanImage', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ image: base64Image, mimeType: file.type, scanType: 'loan_numbers' })
            });
            
            closeConfirm();
            if (!response.ok) throw new Error((await response.json()).error);
            
            const result = await response.json();
            
            currentScanCoordinates = result.loanNumbers || [];
            
            fillSearchTableFromScan(result.loanNumbers);
            
        } catch (error) {
            closeConfirm();
            await showConfirm('Error', error.message, false);
        }
    };
    reader.readAsDataURL(file);
    numberImageUploadInput.value = '';
};

// "Smart Edge Detector" (Solves Black Bars & Streaks)
const eraseRegion = (box) => {
    if (!scanCtx || !scanCanvas || !box) return;

    // 1. Coordinates
    const ymin = Math.max(0, box[0]);
    const ymax = Math.min(1000, box[2]);
    if (ymax <= ymin) return;

    // 2. Dimensions & Adaptive Padding
    const width = scanCanvas.width;
    const height = scanCanvas.height;
    const y = Math.floor((ymin / 1000) * height);
    const h = Math.ceil(((ymax - ymin) / 1000) * height);
    const padding = Math.ceil(h * 0.12); 
    const drawY = Math.max(0, y - padding);
    const drawH = h + (padding * 2);

    try {
        // STEP 1: FIND THE PAPER (Avoid the Black Border)
        // We start at the far right edge and walk left until we find bright paper.
        let safeX = width - 10; 
        const minX = width * 0.80; 
        let foundCleanPaper = false;

        const getAverageBrightness = (imageData) => {
            let sum = 0;
            const data = imageData.data;
            for (let i = 0; i < data.length; i += 16) { 
                sum += (data[i] + data[i+1] + data[i+2]) / 3;
            }
            return sum / (data.length / 16);
        };

        while (safeX > minX) {
            const sample = scanCtx.getImageData(safeX, drawY, 5, drawH);
            const brightness = getAverageBrightness(sample);
            if (brightness > 120) {
                foundCleanPaper = true;
                break; 
            }
            safeX -= 10;
        }

        // STEP 2: ERASE
        if (foundCleanPaper) {
            // Capture and Stretch
            const texture = scanCtx.getImageData(safeX, drawY, 5, drawH);
            const tempC = document.createElement('canvas');
            tempC.width = 5;
            tempC.height = drawH;
            tempC.getContext('2d').putImageData(texture, 0, 0);
            scanCtx.drawImage(tempC, 0, 0, 5, drawH, 0, drawY, width, drawH);
        } else {
            // Fallback: Solid Fill
            try {
                const p = scanCtx.getImageData(20, 20, 1, 1).data;
                scanCtx.fillStyle = `rgb(${p[0]}, ${p[1]}, ${p[2]})`;
            } catch (e) {
                scanCtx.fillStyle = '#f5f5f5'; 
            }
            scanCtx.fillRect(0, drawY, width, drawH);
        }

    } catch (e) {
        console.warn("Eraser failed, using white fallback");
        scanCtx.fillStyle = '#fff';
        scanCtx.fillRect(0, drawY, width, drawH);
    }
};

const filterSearchResults = (filter) => {
    const rows = document.querySelectorAll('#loanSearchTable tbody tr');
    rows.forEach(row => {
        const statusCell = row.querySelector('.status-cell');
        let isVisible = false;
        if (filter === 'all') {
            isVisible = true;
        } else if (filter === 'available' && statusCell.classList.contains('status-available')) {
            isVisible = true;
        } else if (filter === 'not-available' && statusCell.classList.contains('status-not-available')) {
            isVisible = true;
        }
        row.style.display = isVisible ? '' : 'none';
    });
};

const clearSearchSheet = async () => {
    const confirmed = await showConfirm("Clear Search Sheet", "Are you sure you want to clear all search rows?");
    if (confirmed) {
        resetCalculatorState();
        listenForLiveStateChanges();
    }
};

// ==========================================
// MASTER DASHBOARD CONTROLLER (Fixed & Enhanced)
// ==========================================

// Global variables for Chart instances
let histPieInstance = null;
let histBarInstance = null;

// 1. THE WRAPPER FUNCTION
const renderDashboard = async () => {
    const loader = document.getElementById('dashboardLoader');
    if (loader) loader.style.display = 'block';

    // A. Ensure Data Loads
    if (!activeInventory || activeInventory.length === 0) await loadInventory();
    await loadFinalisedTransactions(); 

    // B. Render LIVE Section
    renderLiveStats();

    // C. Auto-Set "Last 30 Days" if empty
    if (!dashboardStartDateEl.value || !dashboardEndDateEl.value) {
        const end = new Date();
        const start = new Date();
        start.setDate(end.getDate() - 30);
        dashboardStartDateEl.value = formatDateToDDMMYYYY(start);
        dashboardEndDateEl.value = formatDateToDDMMYYYY(end);
    }

    // D. Render HISTORICAL Section
    renderHistoricalStats();

    if (loader) loader.style.display = 'none';
};

// --- CHART FILTER FUNCTION ---
const updateGrowthChart = (days, btnElement) => {
    // 1. Update State
    currentGrowthTimeframe = days;

    // 2. Update UI (Buttons)
    if (btnElement) {
        document.querySelectorAll('.chart-filters .btn-mini').forEach(b => b.classList.remove('active'));
        btnElement.classList.add('active');
    }

    // 3. Re-render ONLY the Growth Chart
    renderLiveStats(true);
};

// 2. LIVE STATS (Fixed: Buttons, Lacs Axis, Heatmap, Churn)
const renderLiveStats = (onlyUpdateGrowthChart = false) => {
    const today = new Date();
    const rate = parseFloat(interestRateEl.value) || 1.75; 
    
    let totalPrincipal = 0, totalInterest = 0, totalMonthlyIncome = 0; // NEW: Added totalMonthlyIncome
    let mixStats = { goldVal: 0, silverVal: 0, goldCount: 0, silverCount: 0 };
    // --- FIX: Added Count Variables for Aging ---
    let agingStats = { normalVal: 0, midVal: 0, oldVal: 0, normalCount: 0, midCount: 0, oldCount: 0 };
    let ageStats = { totalDays: 0, count: 0, gDays: 0, gCount: 0, sDays: 0, sCount: 0 };

    let activeLoansList = [];
    let redeemedLoansList = [];
    let monthCounts = Array(12).fill(0); 

    // --- PROCESS ACTIVE INVENTORY ---
    activeInventory.forEach(loan => {
        const p = parseFloat(loan.principal) || 0;
        const loanDate = parseDate(loan.date);
        
        if (loanDate && p > 0) {
            let days = days360(loanDate, today);
            if (days < 0) days = 0; 
            
            // Heatmap: Count the month (0=Jan, 11=Dec)
            monthCounts[loanDate.getMonth()]++;

            // NEW: Get exact rate for this specific active loan
            const actualRate = getInterestRateForLoan(loan.no, rate);
            
            // NEW: Add this loan's exact monthly interest to the total
            totalMonthlyIncome += p * (actualRate / 100);

            // Active Graph Data
            activeLoansList.push({ start: loanDate, end: null, principal: p, rate: actualRate }); // Use actualRate

            // Stats
            ageStats.totalDays += days; ageStats.count++;
            if (loan.type === 'G') { ageStats.gDays += days; ageStats.gCount++; mixStats.goldVal += p; mixStats.goldCount++; }
            else { ageStats.sDays += days; ageStats.sCount++; mixStats.silverVal += p; mixStats.silverCount++; }

            const calcDays = Math.max(30, days);
            const interest = (p * actualRate * calcDays) / 3000; // Use actualRate
            totalPrincipal += p; 
            totalInterest += interest;

            // --- FIX: Increment Counts Alongside Values ---
            if (days < 730) { 
                agingStats.normalVal += p; 
                agingStats.normalCount++; 
            } else if (days < 1095) { 
                agingStats.midVal += p; 
                agingStats.midCount++; 
            } else { 
                agingStats.oldVal += p; 
                agingStats.oldCount++; 
            }
        }
    });

    // --- PROCESS FINALISED REPORTS ---
    if (cachedFinalisedReports && cachedFinalisedReports.length > 0) {
        cachedFinalisedReports.forEach(report => {
            const loansData = report.loans || report.items || [];
            if (Array.isArray(loansData)) {
                loansData.forEach(item => {
                    const start = parseDate(item.date);
                    const end = parseDate(report.reportDate);
                    const p = parseFloat(item.principal) || 0;
                    const baseRate = parseFloat(report.interestRate) || rate; 
                    const actualRate = getInterestRateForLoan(item.no, baseRate); // NEW

                    if (start && end && p > 0) {
                        monthCounts[start.getMonth()]++; // Heatmap
                        redeemedLoansList.push({
                            start: start, end: end, principal: p, rate: actualRate, // <-- FIXED: Changed 'r' to 'actualRate'
                            duration: Math.max(0, days360(start, end))
                        });
                    }
                });
            }
        });
    }

    // --- UPDATE KPIs ---
    const count = activeInventory.length;
    const avgSize = count > 0 ? totalPrincipal / count : 0;
    // monthlyIncome is now calculated perfectly inside the loop above

    const avgAgeTotal = ageStats.count > 0 ? Math.round(ageStats.totalDays / ageStats.count) : 0;
    const avgAgeG = ageStats.gCount > 0 ? Math.round(ageStats.gDays / ageStats.gCount) : 0;
    const avgAgeS = ageStats.sCount > 0 ? Math.round(ageStats.sDays / ageStats.sCount) : 0;

    // Fix Churn Rate: Show "-" if no finalised loans in last 90 days
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setDate(threeMonthsAgo.getDate() - 90);
    const recentRedeemed = redeemedLoansList.filter(l => l.end >= threeMonthsAgo);
    let churnText = "-";
    if (recentRedeemed.length > 0) {
        let totalChurnDays = 0;
        recentRedeemed.forEach(l => totalChurnDays += l.duration);
        churnText = Math.round(totalChurnDays / recentRedeemed.length) + " Days";
    }

    // Fix Heatmap: Show "-" if no data at all
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const maxVal = Math.max(...monthCounts);
    const maxMonthIndex = monthCounts.indexOf(maxVal);
    const busiestMonth = maxVal > 0 ? monthNames[maxMonthIndex] : "-";

    // --- PREVENT FLICKER: Skip if only updating growth chart ---
    if (!onlyUpdateGrowthChart) {

    // --- RENDER TEXT ---
    document.getElementById('kpiCount').textContent = count; 
    document.getElementById('kpiAvgSize').textContent = `₹${Math.round(avgSize).toLocaleString('en-IN')}`;
    document.getElementById('kpiAvgAge').textContent = `${avgAgeTotal} Days`;
    const splitEl = document.getElementById('kpiAvgAgeSplit');
    if(splitEl) splitEl.textContent = `G: ${avgAgeG}d | S: ${avgAgeS}d`;
    if(document.getElementById('kpiChurn')) document.getElementById('kpiChurn').textContent = churnText;
    if(document.getElementById('kpiHeatmap')) document.getElementById('kpiHeatmap').textContent = busiestMonth;
    if (document.getElementById('kpiMonthly')) document.getElementById('kpiMonthly').textContent = `₹${Math.round(totalMonthlyIncome).toLocaleString('en-IN')}`;
    document.getElementById('dashNetWorth').textContent = `₹${Math.round(totalPrincipal + totalInterest).toLocaleString('en-IN')}`;
    document.getElementById('dashPrincipal').textContent = `₹${Math.round(totalPrincipal).toLocaleString('en-IN')}`;
    document.getElementById('dashInterest').textContent = `+ ₹${Math.round(totalInterest).toLocaleString('en-IN')}`;

    // --- CHARTS ---
    if (pieChartInstance) pieChartInstance.destroy();
    if (barChartInstance) barChartInstance.destroy();

    const currencyTooltip = {
        callbacks: {
            label: function(context) {
                let value = context.raw || 0;
                let c = context.dataset.counts ? context.dataset.counts[context.dataIndex] : 0;
                return ` ₹${value.toLocaleString('en-IN')} (${c} Nos)`;
            }
        }
    };

    const mixCtx = document.getElementById('mixChart').getContext('2d');
    pieChartInstance = new Chart(mixCtx, {
        type: 'doughnut',
        data: { 
            labels: ['Gold', 'Silver'], 
            datasets: [{ 
                data: [mixStats.goldVal, mixStats.silverVal], counts: [mixStats.goldCount, mixStats.silverCount],
                backgroundColor: ['#fca311', '#adb5bd'], borderWidth: 0 
            }] 
        },
        options: { maintainAspectRatio: false, plugins: { legend: { position: 'bottom' }, tooltip: currencyTooltip } }
    });

    const agingCtx = document.getElementById('agingChart').getContext('2d');
    barChartInstance = new Chart(agingCtx, {
        type: 'bar',
        data: { 
            labels: ['< 2 Yrs', '2-3 Yrs', '> 3 Yrs'], 
            datasets: [{ 
                data: [agingStats.normalVal, agingStats.midVal, agingStats.oldVal], 
                counts: [agingStats.normalCount, agingStats.midCount, agingStats.oldCount],
                backgroundColor: ['#2a9d8f', '#e9c46a', '#e76f51'], borderRadius: 4 
            }] 
        },
        options: { maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: currencyTooltip }, scales: { y: { beginAtZero: true, display: false } } }
    });
    
    } // <--- CLOSES THE PREVENT FLICKER BLOCK

    // --- UPDATE GROWTH CHART (Fixed) ---
    if (window.growthChartInstance) window.growthChartInstance.destroy();

    const allHistory = [...activeLoansList, ...redeemedLoansList];
    allHistory.sort((a, b) => a.start - b.start);

    if (allHistory.length > 0) {
        // 1. Calculate Start Date based on Filter
        let startDateFilter = new Date(allHistory[0].start); 
        
        if (currentGrowthTimeframe !== 'ALL') {
            const days = parseInt(currentGrowthTimeframe);
            const cutoff = new Date();
            cutoff.setDate(cutoff.getDate() - days);
            // If the cutoff is AFTER the first loan, use cutoff. 
            if (cutoff > startDateFilter) startDateFilter = cutoff;
        }

        const chartLabels = [];
        const chartData = [];
        
        // --- FIX: Event-Based Time Steps ---
        // 1. Collect every exact date a transaction happened
        const uniqueDateStrings = new Set();
        const dateObjects = [];

        const addDate = (d) => {
            if (!d) return;
            // Normalize time to midnight to prevent duplicate dates
            const normalized = new Date(d.getFullYear(), d.getMonth(), d.getDate());
            const str = formatDateToDDMMYYYY(normalized);
            if (!uniqueDateStrings.has(str)) {
                uniqueDateStrings.add(str);
                dateObjects.push(normalized);
            }
        };

        // Add all batch entry dates (start) and finalised dates (end)
        allHistory.forEach(loan => {
            addDate(loan.start);
            if (loan.end) addDate(loan.end);
        });
        addDate(today); // Always include today's current value

        // 2. Sort dates chronologically
        dateObjects.sort((a, b) => a - b);

        // 3. Filter out dates that are older than our selected timeframe
        const filterStart = new Date(startDateFilter.getFullYear(), startDateFilter.getMonth(), startDateFilter.getDate());
        const timelineDates = dateObjects.filter(d => d >= filterStart);

        // 4. Calculate portfolio value at each exact transaction date
        for (let targetDate of timelineDates) {
            let dailyValue = 0;
            
            for (let loan of allHistory) {
                const isStarted = loan.start <= targetDate;
                const isNotEnded = (loan.end === null) || (loan.end > targetDate);

                if (isStarted && isNotEnded) {
                    const daysActive = days360(loan.start, targetDate);
                    dailyValue += loan.principal;
                    if (daysActive > 0) {
                        dailyValue += (loan.principal * loan.rate * daysActive) / 3000;
                    }
                }
            }
            chartLabels.push(formatDateToDDMMYYYY(targetDate));
            chartData.push(dailyValue);
        }
        
        const growthCtx = document.getElementById('growthChart').getContext('2d');
        window.growthChartInstance = new Chart(growthCtx, {
            type: 'line',
            data: {
                labels: chartLabels,
                datasets: [{
                    label: 'Net Portfolio Value',
                    data: chartData,
                    borderColor: '#2a9d8f',
                    backgroundColor: 'rgba(42, 157, 143, 0.1)',
                    fill: true,
                    pointRadius: 0, borderWidth: 2, tension: 0.4
                }]
            },
            options: {
                maintainAspectRatio: false,
                interaction: { intersect: false, mode: 'index' },
                plugins: { legend: { display: false }, tooltip: {
                    callbacks: { label: (c) => ` ₹${Math.round(c.raw).toLocaleString('en-IN')}` }
                }},
                scales: { 
                    x: { ticks: { maxTicksLimit: 6 } }, 
                    y: { 
                        // FIXED: Display in Lacs (e.g., 200 L)
                        ticks: { 
                            callback: (v) => (v / 100000).toFixed(1) + ' L' 
                        } 
                    }
                }
            }
        });
    }

    // --- PREVENT FLICKER: Skip lists if only updating growth chart ---
    if (!onlyUpdateGrowthChart) {

    // --- TOP LISTS ---
    const activeSorted = activeInventory.map(loan => {
         const p = parseFloat(loan.principal) || 0;
         const loanDate = parseDate(loan.date);
         let days = loanDate ? days360(loanDate, today) : 0;
         if (days < 0) days = 0;
         
         // Apply minimum 30 days logic for interest calculation
         const actualRate = getInterestRateForLoan(loan.no, rate); // NEW
         const calcDays = (days > 0 && days < 30) ? 30 : days;
         const interest = (p * actualRate * calcDays) / 3000; // Use actualRate
         
         // Fix: explicitly return the 'interest' variable so we can sort by it later
         return { ...loan, principal: p, days, interest: interest, totalValue: p + interest };
    });

    const oldestLoans = [...activeSorted].sort((a, b) => b.days - a.days).slice(0, 5);
    document.getElementById('oldestLoansList').innerHTML = oldestLoans.map(l => {
        const years = (l.days / 365).toFixed(1);
        const tagClass = l.type === 'G' ? 'tag-g' : 'tag-s';
        return `<li><div class="list-main"><span class="list-no">${l.no} <span class="list-tag ${tagClass}">${l.type}</span></span><span class="list-sub">${l.date} (${years} Years)</span></div><div class="list-val">₹${Math.round(l.principal).toLocaleString('en-IN')}<div style="font-size:0.75rem; color:#888; margin-top:3px;">(₹${Math.round(l.totalValue).toLocaleString('en-IN')})</div></div></li>`;
    }).join('');
    
    const highValueLoans = [...activeSorted].sort((a, b) => b.totalValue - a.totalValue).slice(0, 5);
    document.getElementById('highValueList').innerHTML = highValueLoans.map(l => {
        const years = (l.days / 365).toFixed(1);
        const tagClass = l.type === 'G' ? 'tag-g' : 'tag-s';
        return `<li><div class="list-main"><span class="list-no">${l.no} <span class="list-tag ${tagClass}">${l.type}</span></span><span class="list-sub">${l.date} (${years} Years)</span></div><div class="list-val">₹${Math.round(l.totalValue).toLocaleString('en-IN')}<div style="font-size:0.75rem; color:#888; margin-top:3px;">(Prin: ₹${Math.round(l.principal).toLocaleString('en-IN')})</div></div></li>`;
    }).join('');

    // --- NEW: Top Highest Interest Loans ---
    const highestInterestListEl = document.getElementById('highestInterestList');
    if (highestInterestListEl) {
        const highestInterestLoans = [...activeSorted].sort((a, b) => b.interest - a.interest).slice(0, 5);
        highestInterestListEl.innerHTML = highestInterestLoans.map(l => {
            const tagClass = l.type === 'G' ? 'tag-g' : 'tag-s';
            // Layout: 
            // Left Side: Loan No & Tag | Date & Principal
            // Right Side: Total Value | Interest Generated
            return `<li>
                <div class="list-main">
                    <span class="list-no">${l.no} <span class="list-tag ${tagClass}">${l.type}</span></span>
                    <span class="list-sub">${l.date} &bull; Prin: ₹${Math.round(l.principal).toLocaleString('en-IN')}</span>
                </div>
                <div class="list-val">
                    ₹${Math.round(l.totalValue).toLocaleString('en-IN')}
                    <div style="font-size:0.75rem; color:#d90429; font-weight:bold; margin-top:3px;">(Int: ₹${Math.round(l.interest).toLocaleString('en-IN')})</div>
                </div>
            </li>`;
        }).join('');
    }

    // --- NEW: Series Wise Breakdown Chart ---
    const seriesCanvas = document.getElementById('seriesBreakdownChart');
    if (seriesCanvas) {
        const seriesStats = {};
        let totalActivePrincipal = 0;

        activeInventory.forEach(loan => {
            const p = parseFloat(loan.principal) || 0;
            if (p <= 0) return;

            // --- NEW: Calculate Interest for this specific loan ---
            const loanDate = parseDate(loan.date);
            let days = loanDate ? days360(loanDate, today) : 0;
            if (days < 0) days = 0;
            const actualRate = getInterestRateForLoan(loan.no, rate); // NEW
            const calcDays = (days > 0 && days < 30) ? 30 : days;
            const interest = (p * actualRate * calcDays) / 3000; // Use actualRate
            const currentValue = p + interest;

            // Extract the series letter
            let series = "OTHER";
            const cleanNo = loan.no ? loan.no.trim().toUpperCase() : "";
            const match = cleanNo.match(/^([A-Z]+)/);
            if (match) {
                series = match[1];
            }

            if (!seriesStats[series]) {
                seriesStats[series] = { count: 0, principal: 0, gCount: 0, sCount: 0, gPrincipal: 0, sPrincipal: 0, currentValue: 0, interest: 0 };
            }

            seriesStats[series].count++;
            seriesStats[series].principal += p;
            seriesStats[series].currentValue += currentValue;
            seriesStats[series].interest += interest;
            totalActivePrincipal += p;

            if (loan.type === 'G') {
                seriesStats[series].gCount++;
                seriesStats[series].gPrincipal += p;
            } else {
                seriesStats[series].sCount++;
                seriesStats[series].sPrincipal += p;
            }
        });

        // Sort by highest principal value first
        const sortedSeries = Object.keys(seriesStats).sort((a, b) => seriesStats[b].principal - seriesStats[a].principal);

        const labels = [];
        const gData = [];
        const sData = [];
        const customTooltipData = [];

        sortedSeries.forEach(s => {
            const stat = seriesStats[s];
            const weight = totalActivePrincipal > 0 ? ((stat.principal / totalActivePrincipal) * 100).toFixed(1) : 0;
            
            labels.push(`Series ${s}`);
            gData.push(stat.gPrincipal);
            sData.push(stat.sPrincipal);
            
            // Store extra data for the smart tooltip
            customTooltipData.push({
                weight: weight,
                totalCount: stat.count,
                gCount: stat.gCount,
                sCount: stat.sCount,
                currentValue: stat.currentValue,
                interest: stat.interest
            });
        });

        if (window.seriesChartInstance) window.seriesChartInstance.destroy();

        window.seriesChartInstance = new Chart(seriesCanvas.getContext('2d'), {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Gold (G)',
                        data: gData,
                        backgroundColor: '#fca311', // Gold Color
                        borderRadius: 4
                    },
                    {
                        label: 'Silver (S)',
                        data: sData,
                        backgroundColor: '#adb5bd', // Silver Color
                        borderRadius: 4
                    }
                ]
            },
            options: {
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                scales: {
                    x: { stacked: true },
                    y: { 
                        stacked: true,
                        beginAtZero: true,
                        ticks: {
                            callback: function(value) {
                                return '₹' + (value >= 100000 ? (value / 100000).toFixed(1) + 'L' : (value >= 1000 ? (value / 1000).toFixed(1) + 'k' : value));
                            }
                        }
                    }
                },
                plugins: {
                    legend: { position: 'bottom' },
                    tooltip: {
                        filter: function(tooltipItem) {
                            return tooltipItem.datasetIndex === 0; 
                        },
                        callbacks: {
                            label: function(context) {
                                const idx = context.dataIndex;
                                const totalAmt = gData[idx] + sData[idx];
                                return [
                                    ` 💰 Total Prin: ₹${Math.round(totalAmt).toLocaleString('en-IN')}`,
                                    `      G: ₹${Math.round(gData[idx]).toLocaleString('en-IN')}`,
                                    `      S: ₹${Math.round(sData[idx]).toLocaleString('en-IN')}`
                                ];
                            },
                            afterBody: function(context) {
                                if (context.length === 0) return '';
                                const idx = context[0].dataIndex;
                                const meta = customTooltipData[idx];
                                return [
                                    ``, // Empty line for spacing
                                    `📈 Current Value: ₹${Math.round(meta.currentValue).toLocaleString('en-IN')}`,
                                    `      (Incl. Int: ₹${Math.round(meta.interest).toLocaleString('en-IN')})`,
                                    `📊 Total Loans: ${meta.totalCount} Nos`,
                                    `🏆 G: ${meta.gCount} | S: ${meta.sCount}`,
                                    `⚖️ Weightage: ${meta.weight}%`
                                ];
                            }
                        }
                    }
                }
            }
        });
    }

    } // <--- CLOSES THE TOP LISTS BLOCK
};
// 3. HISTORICAL STATS (DEFINED HERE TO FIX ERROR)
const renderHistoricalStats = () => {
    const startDate = parseDate(dashboardStartDateEl.value);
    const endDate = parseDate(dashboardEndDateEl.value);
    const msgEl = document.getElementById('dashboardMessage');

    if (!startDate || !endDate) {
        if(msgEl) { msgEl.textContent = "Select valid dates for history."; msgEl.style.display = 'block'; }
        return;
    }
    if(msgEl) msgEl.style.display = 'none';

    // A. Data Aggregation (Group by Month)
    const monthData = {}; 
    
    const getMonthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const getMonthLabel = (d) => {
        const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        return `${months[d.getMonth()]} ${String(d.getFullYear()).slice(-2)}`;
    };

    const addToMonth = (d, type, amount) => {
        if (!d || d < startDate || d > endDate) return;
        const key = getMonthKey(d);
        if (!monthData[key]) {
            monthData[key] = { label: getMonthLabel(d), given: 0, prin: 0, int: 0 };
        }
        monthData[key][type] += amount;
    };

    // B. Process Loan Given (From Active and Finalised Loans)
    activeInventory.forEach(loan => {
        addToMonth(parseDate(loan.date), 'given', parseFloat(loan.principal) || 0);
    });
    
    if (cachedFinalisedReports && cachedFinalisedReports.length > 0) {
        cachedFinalisedReports.forEach(report => {
            const loansData = report.loans || report.items || [];
            if (Array.isArray(loansData)) {
                loansData.forEach(loan => {
                    addToMonth(parseDate(loan.date), 'given', parseFloat(loan.principal) || 0);
                });
            }
            
            // C. Process Collections (From Finalised Reports)
            const reportDate = parseDate(report.reportDate);
            if (reportDate && reportDate >= startDate && reportDate <= endDate) {
                addToMonth(reportDate, 'prin', parseFloat(report.totals?.principal) || 0);
                addToMonth(reportDate, 'int', parseFloat(report.totals?.interest) || 0);
            }
        });
    }

    // D. Sort and Prepare Chart Data
    const sortedKeys = Object.keys(monthData).sort();
    const labels = [];
    const givenData = [];
    const prinData = [];
    const intData = [];

    let totalGiven = 0, totalPrinCollected = 0, totalIntCollected = 0;

    sortedKeys.forEach(key => {
        labels.push(monthData[key].label);
        givenData.push(monthData[key].given);
        prinData.push(monthData[key].prin);
        intData.push(monthData[key].int);
        
        totalGiven += monthData[key].given;
        totalPrinCollected += monthData[key].prin;
        totalIntCollected += monthData[key].int;
    });

    // E. Update Text UI
    const givenEl = document.getElementById('histGiven');
    const prinEl = document.getElementById('histPrin');
    const intEl = document.getElementById('histInt');
    
    if(givenEl) givenEl.textContent = `₹${Math.round(totalGiven).toLocaleString('en-IN')}`;
    if(prinEl) prinEl.textContent = `₹${Math.round(totalPrinCollected).toLocaleString('en-IN')}`;
    if(intEl) intEl.textContent = `₹${Math.round(totalIntCollected).toLocaleString('en-IN')}`;

    // F. Draw Unified Monthly Cash Flow Chart
    if (window.histPieInstance) window.histPieInstance.destroy();
    if (window.histBarInstance) window.histBarInstance.destroy();
    if (window.histCashflowInstance) window.histCashflowInstance.destroy();

    const canvas = document.getElementById('historicalCashflowChart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    window.histCashflowInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels.length > 0 ? labels : ['No Data'],
            datasets: [
                {
                    label: 'Loan Given',
                    data: labels.length > 0 ? givenData : [0],
                    backgroundColor: '#D90429', // Red for money out
                    borderRadius: 4,
                    barPercentage: 0.7
                },
                {
                    label: 'Principal Collected',
                    data: labels.length > 0 ? prinData : [0],
                    backgroundColor: '#2a9d8f', // Green for principal back
                    borderRadius: 4,
                    barPercentage: 0.7
                },
                {
                    label: 'Interest Collected',
                    data: labels.length > 0 ? intData : [0],
                    backgroundColor: '#fca311', // Yellow for profit
                    borderRadius: 4,
                    barPercentage: 0.7
                }
            ]
        },
        options: {
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { position: 'bottom' },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return ` ${context.dataset.label}: ₹${context.raw.toLocaleString('en-IN')}`;
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: function(value) {
                            return '₹' + (value >= 100000 ? (value / 100000).toFixed(1) + 'L' : (value >= 1000 ? (value / 1000).toFixed(1) + 'k' : value));
                        }
                    }
                }
            }
        }
    });
};
// --- Authentication ---
// --- Authentication ---
// --- Authentication ---
// --- Authentication ---
const signInWithGoogle = () => {
    const provider = new firebase.auth.GoogleAuthProvider();
    
    // Detect if running in Standalone (PWA) mode on iOS
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || (navigator.standalone === true);
    const isIosPwa = isIOS && isStandalone;

    // Set Persistence to LOCAL
    auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL)
        .then(() => {
            if (isIosPwa) {
                // PWA: Set flag to handle the redirect on reload
                localStorage.setItem('isPwaLoggingIn', 'true');
                return auth.signInWithRedirect(provider);
            } else {
                // Browser: Use Popup (Faster for laptops/Android)
                return auth.signInWithPopup(provider);
            }
        })
        .catch(error => {
            console.error("Login Flow Error:", error);
            localStorage.removeItem('isPwaLoggingIn'); 
            showConfirm("Login Error", error.message, false);
        });
};
const signOut = () => auth.signOut();

// --- Real-time Functions ---
const updateLiveState = () => {
    if (!user || !reportsCollection) return;

    const loans = Array.from(document.querySelectorAll('#loanTable tbody tr'))
        .map(row => ({
            no: row.querySelector('.no').value,
            principal: row.querySelector('.principal').value,
            date: row.querySelector('.date').value
        }));
    
    const liveState = {
        todayDate: todayDateEl.value,
        interestRate: interestRateEl.value,
        loans: loans,
        previousDues: currentPreviousDues, // <--- ADD THIS LINE (Safety Net)
        previousDuesDate: currentPreviousDuesDate, // <--- ADD THIS
        lastUpdatedBy: sessionClientId
    };

    const liveStateRef = db.collection('liveCalculatorState').doc(user.uid);
    // Merge true ensures we don't overwrite unrelated fields, 
    // but adding previousDues here ensures the local variable is always synced.
    liveStateRef.set(liveState, { merge: true }).catch(error => {
        console.error("Could not update live state:", error);
    });
};

const debouncedUpdateLiveState = debounce(() => updateLiveState(), 500);

const listenForLiveStateChanges = () => {
    if (liveStateUnsubscribe) {
        liveStateUnsubscribe();
    }
    if (!user) return;

    const liveStateRef = db.collection('liveCalculatorState').doc(user.uid);
    liveStateUnsubscribe = liveStateRef.onSnapshot(doc => {
        if (doc.exists) {
            const state = doc.data();
            if (state.lastUpdatedBy === sessionClientId) return;

            isUpdatingFromListener = true;

            // --- REMOVED VOLATILE DUES LOADING ---
            // Dues are now safely handled by the permanent global collection.
            // We DO NOT overwrite currentPreviousDues here anymore to prevent data loss.
            // ---------------------------------------------------

            // --- FIX 2: FORCE CURRENT DATE ---
            // If the saved date is NOT today, we assume it's old/stale and force Today.
            const realToday = formatDateToDDMMYYYY(new Date());
            const savedDate = state.todayDate;

            // Only use saved date if it matches Today (keeps session sync valid)
            // Otherwise, auto-update to today
            if (savedDate && savedDate === realToday) {
                todayDateEl.value = savedDate;
            } else {
                todayDateEl.value = realToday; // Auto-update to today
            }
            // ---------------------------------
            
            // ... (rest of the code remains the same)
            interestRateEl.value = state.interestRate || '1.75';
            
            loanTableBody.innerHTML = '';
            if (state.loans && state.loans.length > 0) {
                state.loans.forEach(loan => addRow(loan));
            }
            while (loanTableBody.rows.length < 3) {
                addRow({ no: '', principal: '', date: '' });
            }
             if (loanTableBody.rows.length > 0 && loanTableBody.lastChild.querySelector('.principal').value) { 
                 addRow({ no: '', principal: '', date: '' }); 
             }
        } else {
            todayDateEl.value = formatDateToDDMMYYYY(new Date());
            interestRateEl.value = '1.75';
            loanTableBody.innerHTML = '';
            for (let i = 0; i < 3; i++) {
                addRow({ no: '', principal: '', date: '' });
            }
            updateLiveState();
        }

        updateAllCalculations();

        setTimeout(() => { isUpdatingFromListener = false; }, 100);
    }, error => {
        console.error("Error with live listener:", error);
    });
};


// --- DUES FINALISE LOGIC (Updated: Auto-Removes from Inventory) ---
const finaliseReport = (docId) => {
    // 1. Store the ID
    pendingReportIdToFinalise = docId;
    
    // 2. Clear & Open Dues Modal IMMEDIATELY
    document.getElementById('duesInput').value = ''; 
    document.getElementById('duesModal').style.display = 'flex';
    
    // 3. Auto-focus input
    setTimeout(() => document.getElementById('duesInput').focus(), 100);
};

const confirmFinaliseWithDues = async () => {
    const duesVal = document.getElementById('duesInput').value;
    const newDues = parseFloat(duesVal) || 0;
    const reportId = pendingReportIdToFinalise;

    // 1. Close Modal
    document.getElementById('duesModal').style.display = 'none';

    if (!reportId) return;

    // 2. Confirmation
    const confirmed = await showConfirm(
        "Finalise & Archive", 
        "This will move loans to 'Redeemed Inventory' and lock the report. Continue?"
    );
    
    if (!confirmed) return; 

    // 3. Execute Cloud Move
    if (navigator.onLine && reportsCollection) {
        try {
            showConfirm("Archiving...", "Moving loans to Redeemed Inventory...", false);
            
            const reportRef = reportsCollection.doc(reportId);
            const reportDoc = await reportRef.get();
            
            if (!reportDoc.exists) throw new Error("Report not found.");
            
            const reportData = reportDoc.data();
            const newName = `Final Hisab of ${reportData.reportDate}`;
            
            // --- BATCH OPERATION (All or Nothing) ---
            const batch = db.batch();

            // A. Finalise the Report
            batch.update(reportRef, { 
                status: 'finalised', 
                reportName: newName,
                finalisedDues: newDues,
                finalisedAt: firebase.firestore.FieldValue.serverTimestamp()
            });

            // B. Update Shared Dues Globally
            const sharedDuesRef = db.collection('globalSettings').doc('sharedDues');
            batch.set(sharedDuesRef, {
                previousDues: newDues,
                previousDuesDate: reportData.reportDate 
            }, { merge: true });

            // --- NEW: Save to Permanent History Ledger ---
            const duesHistoryRef = db.collection('duesHistory').doc();
            batch.set(duesHistoryRef, {
                amount: newDues,
                date: reportData.reportDate,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                source: 'Finalise Report: ' + reportId,
                updatedBy: user.email || user.uid
            });
            // ---------------------------------------------

            // Mirror to live state just to keep legacy code happy
            const liveStateRef = db.collection('liveCalculatorState').doc(user.uid);
            batch.set(liveStateRef, {
                previousDues: newDues,
                previousDuesDate: reportData.reportDate 
            }, { merge: true });
            
            // C. MOVE LOANS: Active -> Redeemed
            let moveCount = 0;
            if (reportData.loans && Array.isArray(reportData.loans)) {
                reportData.loans.forEach(loan => {
                    if (loan.no) {
                        let cleanNo = loan.no.trim().toUpperCase();
                        // Create unique ID (e.g. USER123_A-52)
                        const docId = `${user.uid}_${cleanNo.replace(/\//g, '-')}`;
                        
                        // 1. DELETE from Active Inventory
                        const activeRef = db.collection('activeInventory').doc(docId);
                        batch.delete(activeRef);

                        // 2. ADD to Redeemed Inventory (New Collection)
                        const redeemedRef = db.collection('redeemedInventory').doc(docId);
                        batch.set(redeemedRef, {
                            ...loan, // Copy Number, Principal, Date, Type
                            userId: user.uid,
                            originalReportId: reportId,
                            redeemedDate: reportData.reportDate,
                            redeemedAt: firebase.firestore.FieldValue.serverTimestamp(),
                            status: 'redeemed'
                        });
                        moveCount++;
                    }
                });
            }

            // D. Commit Changes
            await batch.commit();

            // 4. Success UI
            currentPreviousDues = newDues;
            currentPreviousDuesDate = reportData.reportDate; 
            
            await showConfirm("Success", `Archived ${moveCount} loans to Redeemed Inventory.`, false);
            
            // Refresh All Data
            loadRecentTransactions();
            loadFinalisedTransactions();
            loadInventory(); 

        } catch (error) {
            console.error("Error finalising:", error);
            await showConfirm("Error", "Could not complete the archive process.", false);
        }
    } else {
        await showConfirm("Offline", "You must be online to archive loans.", false);
    }
};

// --- Initial Load & Event Listeners ---
document.addEventListener('DOMContentLoaded', async () => {
    // --- FIX 1: INSTANT LOAD (Draw Table Immediately) ---
    // This makes the app look "ready" instantly, before Firebase connects
    todayDateEl.value = formatDateToDDMMYYYY(new Date()); 
    interestRateEl.value = '1.75';
    
    // Draw 3 Empty Rows instantly
    loanTableBody.innerHTML = '';
    for(let i=0; i<3; i++) {
        // Manually adding row HTML to be faster than function call
        const row = loanTableBody.insertRow();
        row.innerHTML = `
            <td>${i + 1}</td>
            <td><input type="text" class="no" value=""></td>
            <td><input type="number" class="principal" placeholder="0"></td>
            <td><input type="text" class="date" placeholder="DD/MM/YYYY"></td>
            <td class="read-only duration"></td>
            <td class="read-only interest"></td>
            <td><button class="btn btn-danger" onclick="removeRow(this)">X</button></td>`;
    }
    await initLocalDb();
    updateSyncStatus();
   // --- FINAL PRODUCTION AUTH LISTENER ---
    
    // 1. Show a loading message if we know we are coming back from a PWA login
    if (localStorage.getItem('isPwaLoggingIn') === 'true') {
        loginMessage.textContent = "Verifying secure login...";
        // Optional: You could show a spinner here if you wanted
    }

    // 2. Check for Redirect Result (PWA Mode)
    if (localStorage.getItem('isPwaLoggingIn') === 'true') {
        auth.getRedirectResult()
            .then((result) => {
                localStorage.removeItem('isPwaLoggingIn'); // Clear flag
                if (result.user) {
                    handleUserLogin(result.user);
                } else {
                    handleUserLogout();
                }
            })
            .catch((error) => {
                localStorage.removeItem('isPwaLoggingIn');
                console.error("Redirect Error:", error);
                handleUserLogout();
            });
    }
    // --- DUES MODAL LISTENERS ---
    const duesConfirmBtn = document.getElementById('duesConfirmBtn');
    if (duesConfirmBtn) duesConfirmBtn.addEventListener('click', confirmFinaliseWithDues);

    const duesCancelBtn = document.getElementById('duesCancelBtn');
    if (duesCancelBtn) duesCancelBtn.addEventListener('click', () => {
        document.getElementById('duesModal').style.display = 'none';
        pendingReportIdToFinalise = null;
    });

    // 3. Standard Listener (Browser Mode / Already Logged In)
    auth.onAuthStateChanged((firebaseUser) => {
        // Only run this if we aren't currently processing a redirect to avoid conflicts
        if (!localStorage.getItem('isPwaLoggingIn')) {
            if (firebaseUser) {
                handleUserLogin(firebaseUser);
            } else {
                handleUserLogout();
            }
        }
    });

    // --- Helpers ---
    function handleUserLogin(firebaseUser) {
        user = firebaseUser;
        reportsCollection = db.collection('sharedReports');
        authStatusEl.textContent = user.displayName || user.email;
        loginOverlay.style.display = 'none';
        appContainer.style.display = 'block';
        
        // --- NEW: Fetch Global Shared Dues ---
        db.collection('globalSettings').doc('sharedDues').get().then(doc => {
            if (doc.exists) {
                currentPreviousDues = parseFloat(doc.data().previousDues) || 0;
                currentPreviousDuesDate = doc.data().previousDuesDate || '';
            }
        }).catch(err => console.error("Error loading shared dues:", err));

        listenForLiveStateChanges(); 
        syncData();
        
        // --- NEW: EAGER LOADING ---
        // Fetch everything in the background instantly on login.
        // It will load from the local cache instantly, then sync.
        loadInventory();
        loadRecentTransactions();
        loadFinalisedTransactions();
    }

    function handleUserLogout() {
        user = null;
        currentlyEditingReportId = null;
        reportsCollection = null;
        cachedReports = [];
        loginMessage.textContent = "Sign in to access your synced reports.";
        loginOverlay.style.display = 'flex';
        appContainer.style.display = 'none';
        if (liveStateUnsubscribe) {
            liveStateUnsubscribe();
            liveStateUnsubscribe = null;
        }
    }
    // --- SAFE AUTH & LOAN LISTENERS ---
    if (googleSignInBtn) googleSignInBtn.addEventListener('click', signInWithGoogle);
    if (signOutBtn) signOutBtn.addEventListener('click', signOut);
    if (addRowBtn) addRowBtn.addEventListener('click', () => addRow({ no: '', principal: '', date: '' }));
    // Wrap it in a check to prevent the crash
    // 1. Calculator Tab Save Button
    const calculatorSaveBtn = document.getElementById('saveBtn');
    if (calculatorSaveBtn) {
        calculatorSaveBtn.addEventListener('click', () => saveReport(false));
    }
    
    // 2. Inventory Tab Save Button
    const inventorySaveBtn = document.getElementById('saveBatchBtn');
    if (inventorySaveBtn) {
        inventorySaveBtn.addEventListener('click', saveBatchEntries);
    }
    clearSheetBtn.addEventListener('click', clearSheet);
    exitViewModeBtn.addEventListener('click', exitViewMode);
    exportPdfBtn.addEventListener('click', exportToPDF);
    exportViewPdfBtn.addEventListener('click', exportToPDF);
    scanImageBtn.addEventListener('click', () => imageUploadInput.click());
    imageUploadInput.addEventListener('change', handleImageScan);
    confirmOkBtn.addEventListener('click', () => closeConfirm(true));
    confirmCancelBtn.addEventListener('click', () => closeConfirm(false));
    confirmModal.addEventListener('click', (e) => { if (e.target === confirmModal) closeConfirm(false); });
    document.querySelectorAll('.tab-button').forEach(button => {
        button.addEventListener('click', (e) => showTab(e.target.dataset.tab));
    });
    todayDateEl.addEventListener('input', updateAllCalculations);
    interestRateEl.addEventListener('input', updateAllCalculations);
    todayDateEl.addEventListener('blur', (e) => {
        const parsed = parseDate(e.target.value);
        if (parsed) e.target.value = formatDateToDDMMYYYY(parsed);
        updateAllCalculations();
    });
    reportSearchInput.addEventListener('input', e => { renderRecentTransactions(e.target.value); });
    document.getElementById('finalisedReportSearchInput').addEventListener('input', e => { 
        renderFinalisedTransactions(e.target.value); 
    });
    window.addEventListener('online', updateSyncStatus);
    window.addEventListener('offline', updateSyncStatus);
    // ---------------------------------------------------------
    // FIXED: Auto-Fill & Auto-Add Logic
    // ---------------------------------------------------------
    loanTableBody.addEventListener('input', e => {
        const target = e.target;
        const currentRow = target.closest('tr');
        
        // 1. AUTO-ADD ROW LOGIC
        // If user types in the LAST row, add a new blank row
        const lastRow = loanTableBody.lastElementChild;
        if (currentRow === lastRow && target.value.trim() !== '') {
            addRow(); 
        }

        // 2. AUTO-FILL LOGIC (Inventory Lookup)
        if (target.classList.contains('no')) {
            const val = target.value.trim().toUpperCase(); 
            const principalInput = currentRow.querySelector('.principal');
            const dateInput = currentRow.querySelector('.date');

            // A. Reset Styles first (so we don't keep old colors)
            target.classList.remove('found-gold', 'found-silver');

            // B. Find Match (Check exact match OR normalized match like A-50 vs A/50)
            const match = activeInventory.find(item => 
                item.no === val || normalizeLoanNo(item.no) === normalizeLoanNo(val)
            ); 

            if (match) {
                principalInput.value = match.principal;
                dateInput.value = match.date;
                if (match.type === 'G') target.classList.add('found-gold');
                else if (match.type === 'S') target.classList.add('found-silver');
            } else {
                // NEW: Clear fields if the exact loan number is not found in DB
                principalInput.value = '';
                dateInput.value = '';
                target.classList.remove('found-gold', 'found-silver');
            }
        }
        
        // 3. UPDATE CALCULATIONS
        // Recalculate interest whenever any input changes
        if (target.matches('input')) {
            updateAllCalculations();
        }
    });
    
    loanTableBody.addEventListener('blur', e => {
        if (e.target.matches('input.date')) {
            const parsed = parseDate(e.target.value);
            if (parsed) e.target.value = formatDateToDDMMYYYY(parsed);
            updateAllCalculations();
        }
    }, true);

    // --- Dashboard Filter Event Listeners ---
    last30DaysBtn.addEventListener('click', () => {
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(endDate.getDate() - 30);
        dashboardStartDateEl.value = formatDateToDDMMYYYY(startDate);
        dashboardEndDateEl.value = formatDateToDDMMYYYY(endDate);
        renderDashboard();
    });
    currentFyBtn.addEventListener('click', () => {
        const { startDate, endDate } = getFinancialYear();
        dashboardStartDateEl.value = formatDateToDDMMYYYY(startDate);
        dashboardEndDateEl.value = formatDateToDDMMYYYY(endDate);
        renderDashboard();
    });
    prevFyBtn.addEventListener('click', () => {
        const today = new Date();
        const prevYearDate = new Date(new Date().setFullYear(today.getFullYear() - 1));
        const { startDate, endDate } = getFinancialYear(prevYearDate);
        dashboardStartDateEl.value = formatDateToDDMMYYYY(startDate);
        dashboardEndDateEl.value = formatDateToDDMMYYYY(endDate);
        renderDashboard();
    });
    applyDateFilterBtn.addEventListener('click', renderDashboard);
    dashboardStartDateEl.addEventListener('blur', (e) => {
        const parsed = parseDate(e.target.value);
        if (parsed) e.target.value = formatDateToDDMMYYYY(parsed);
    });
    dashboardEndDateEl.addEventListener('blur', (e) => {
        const parsed = parseDate(e.target.value);
        if (parsed) e.target.value = formatDateToDDMMYYYY(parsed);
    });

    // --- Event Listeners for Loan Search Tab ---
    const addSearchRowBtn = document.getElementById('addSearchRowBtn');
    if (addSearchRowBtn) {
        addSearchRowBtn.addEventListener('click', () => addSearchRow());
    }
    scanNumbersBtn.addEventListener('click', () => numberImageUploadInput.click());
    numberImageUploadInput.addEventListener('change', handleNumberScan);
    clearSearchSheetBtn.addEventListener('click', clearSearchTable);
    
    loanSearchTableBody.addEventListener('input', (e) => {
        if (e.target.matches('.search-no')) {
            performLoanSearch(e.target);
            updateSearchTotals(); // <--- ADD THIS
        }
    });
    searchFiltersContainer.addEventListener('click', (e) => {
        if (e.target.matches('.btn')) {
            searchFiltersContainer.querySelector('.active-filter').classList.remove('active-filter');
            e.target.classList.add('active-filter');
            filterSearchResults(e.target.dataset.filter);
        }
    });

    // --- NEW: Dynamic Toggle Listener ---
    const autoFillToggle = document.getElementById('autoFillToggle');
    if (autoFillToggle) {
        autoFillToggle.addEventListener('change', (e) => {
            if (e.target.checked) {
                injectOldLoans();
            } else {
                removeOldLoans();
            }
        });
    }

    // Listen for messages from the Service Worker (for shared images)
    navigator.serviceWorker.addEventListener('message', event => {
        if (event.data && event.data.action === 'scan-image') {
            showTab('calculatorTab');
            handleImageScan(event.data.file);
        }
    });
});

// --- NEW: Logic for Clear Batch Button ---
const clearBatchBtn = document.getElementById('clearBatchBtn');

const clearBatchTable = async () => {
    const confirmed = await showConfirm(
        "Clear Batch Entry", 
        "Are you sure you want to clear all entries?"
    );
    if (confirmed) {
        // Clear all rows
        document.querySelector('#batchTable tbody').innerHTML = '';
        
        // Add 3 default rows back
        for (let i = 0; i < 3; i++) {
             // Ensure function exists before calling
             if (typeof addBatchRow === 'function') {
                 addBatchRow();
             }
        }
        
        // Reset Total Display
        const totalDisplay = document.getElementById('batchTotalDisplay');
        if(totalDisplay) totalDisplay.textContent = '₹0';
    }
};

// Add Listener
if (clearBatchBtn) {
    clearBatchBtn.addEventListener('click', clearBatchTable);
}

const generateSortedImage = () => {
    // 1. Get current list from the table
    const loanList = getAvailableLoansFromTable();

    if (!loanList || loanList.length === 0) {
        showConfirm("Error", "No available loans found.", false);
        return;
    }

    // A. Process List: FORCE Data from Active Inventory
    // This ensures we use the Database Principal/Date, NOT the Scanned Image data.
    const processedList = loanList.map(item => {
        // Find the "Truth" in your Database
        const match = activeInventory.find(inv => normalizeLoanNo(inv.no) === normalizeLoanNo(item.no));
        
        // NEW: Tag the number if it's auto-added
        let finalNo = item.no;
        if (item.isOld) finalNo += " [OLD]";

        if (match) {
            // FOUND: Use Database Values (Ignore Scan Errors)
            return { 
                no: finalNo, // Uses tagged number
                principal: String(match.principal), 
                date: match.date, 
                detail: match.type || "?" 
            };
        } else {
            // NOT FOUND: Fallback to what's in the table (Scanned Data)
            return { 
                no: finalNo, // Uses tagged number
                principal: item.principal ? String(item.principal) : '-', 
                date: item.date || '-', 
                detail: "?" 
            };
        }
    });

    // Sort: By Type (G/S), then by Number
    processedList.sort((a, b) => {
        if (a.detail < b.detail) return -1;
        if (a.detail > b.detail) return 1;
        return a.no.localeCompare(b.no, undefined, { numeric: true, sensitivity: 'base' });
    });

    // B. Create Canvas (High Definition Setup)
    const reportCanvas = document.createElement('canvas');
    const ctx = reportCanvas.getContext('2d', { willReadFrequently: true });
    
    // Scale factor for High DPI
    const scale = 2; 
    
    // Layout Config
    const rowHeight = 50;
    const dateHeaderHeight = 40; 
    const columnHeaderHeight = 50; 
    const totalHeaderHeight = dateHeaderHeight + columnHeaderHeight;
    const padding = 200; 
    
    const logicalWidth = 900;
    const logicalHeight = totalHeaderHeight + (processedList.length * 60) + padding;

    reportCanvas.width = logicalWidth * scale;
    reportCanvas.height = logicalHeight * scale;

    ctx.scale(scale, scale);

    // C. Draw White Background
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, logicalWidth, logicalHeight);

    // D. Draw Today's Date
    const today = new Date().toLocaleDateString('en-GB');
    ctx.fillStyle = "#333";
    ctx.font = "bold 16px sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(today, logicalWidth - 20, 25); 

    // E. Draw Column Headers
    const headerY = dateHeaderHeight;
    ctx.fillStyle = "#f1f3f5";
    ctx.fillRect(0, headerY, logicalWidth, columnHeaderHeight);

    const textY = headerY + 32;
    const colX = { sl: 30, no: 130, amt: 450, date: 550, det: 800 };

    ctx.fillStyle = "#000";
    ctx.font = "bold 18px sans-serif";
    
    ctx.textAlign = "left";
    ctx.fillText("SL NO", colX.sl, textY);
    ctx.fillText("NO", colX.no, textY);
    ctx.textAlign = "right"; 
    ctx.fillText("AMOUNT", colX.amt, textY);
    ctx.textAlign = "left";  
    ctx.fillText("DATE", colX.date, textY);
    ctx.fillText("DETAIL", colX.det, textY);
    
    ctx.beginPath();
    ctx.moveTo(0, headerY + columnHeaderHeight);
    ctx.lineTo(logicalWidth, headerY + columnHeaderHeight);
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#333";
    ctx.stroke();

    // F. Draw Rows
    let y = totalHeaderHeight + 35;
    let currentCategory = null;
    let slCounter = 1;

    processedList.forEach(item => {
        // Draw Category Header if changed
        if (item.detail !== currentCategory) {
            currentCategory = item.detail;
            y += 45; 
            ctx.fillStyle = "#e9ecef";
            ctx.fillRect(0, y - 60, logicalWidth, 30);
            ctx.fillStyle = "#000";
            ctx.textAlign = "left";
            ctx.font = "bold 16px sans-serif";
            ctx.fillText(`CATEGORY: ${currentCategory}`, 20, y - 40);
        }

        ctx.font = "24px sans-serif";
        ctx.fillStyle = "#000000";
        
        ctx.textAlign = "left";
        ctx.fillText(slCounter++, colX.sl, y);
        ctx.fillText(item.no, colX.no, y);

        ctx.textAlign = "right";
        ctx.fillText(item.principal, colX.amt, y);
        ctx.textAlign = "left"; 

        ctx.fillText(item.date, colX.date, y);

        // DETAIL COLOR LOGIC
        let badgeColor = "#333";
        if (item.detail === "G") badgeColor = "#f1c40f"; 
        else if (item.detail === "S") badgeColor = "#000000"; 
        else if (item.detail === "?") badgeColor = "#e74c3c"; 

        ctx.fillStyle = badgeColor;
        ctx.font = "bold 26px sans-serif";
        ctx.fillText(item.detail, colX.det, y);

        ctx.strokeStyle = "#eee";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(20, y + 15);
        ctx.lineTo(880, y + 15);
        ctx.stroke();

        y += rowHeight;
    });

    // G. Download/Share
    reportCanvas.toBlob((blob) => {
        const fileName = `Sorted_List_${Date.now()}.png`;
        const file = new File([blob], fileName, { type: 'image/png' });
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

        if (isMobile && navigator.canShare && navigator.canShare({ files: [file] })) {
            navigator.share({ files: [file], title: 'Sorted Loan List' }).catch(console.error);
        } else {
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = fileName;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
    });
};
// 3. MAIN SCANNER (UPDATED: Captures Full Data)
// Updated: Passes hidden amount/date to addSearchRow
// NEW HELPER: Reads the current state of the table (handles manual edits)
const getAvailableLoansFromTable = () => {
    const availableLoans = [];
    const rows = document.querySelectorAll('#loanSearchTable tbody tr');
    
    rows.forEach(row => {
        const statusCell = row.querySelector('.status-cell');
        const input = row.querySelector('.search-no');
        
        // Only grab rows marked as "Available"
        if (statusCell && statusCell.classList.contains('status-available') && input.value.trim()) {
            const normalizedKey = normalizeLoanNo(input.value.trim().toUpperCase());
            const storedData = row.scanData || { principal: '-', date: '-' };
            
            // NEW: Check if this row is an auto-added old loan
            const isOld = row.classList.contains('auto-added-row');
            
            availableLoans.push({ 
                no: normalizedKey,
                principal: storedData.principal,
                date: storedData.date,
                isOld: isOld // Passing the flag to the canvas generator
            });
        }
    });
    return availableLoans;
};

const fillSearchTableFromScan = async (loanData) => {
    // 1. Build Cache (Only for Finalised reports now)
    buildLoanSearchCache(); 

    if (!loanData || loanData.length === 0) {
        showConfirm('Scan Results', 'No numbers found.', false);
        return;
    }

    document.querySelectorAll('#loanSearchTable .search-no').forEach(input => {
        if (!input.value.trim()) input.closest('tr').remove();
    });

    const cleanDate = (d) => d ? d.replace(/-/g, '/') : '-';

    loanData.forEach(item => {
        const extraData = {
            principal: item.principal ? String(item.principal) : '-',
            date: cleanDate(item.date)
        };
        addSearchRow(item.no, item.box, extraData);
    });

    // Process & Erase
    const inputs = document.querySelectorAll('#loanSearchTable .search-no');
    let erasedCount = 0;
    let foundAvailable = false;

    inputs.forEach((input) => {
        performLoanSearch(input); 
        const row = input.closest('tr');
        const statusCell = row.querySelector('.status-cell');
        
        if (statusCell.classList.contains('status-not-available')) {
            if (row.eraseBox) {
                eraseRegion(row.eraseBox);
                erasedCount++;
            }
        } else if (statusCell.classList.contains('status-available')) {
            foundAvailable = true;
        }
    });

    renumberSearchRows();
    
    // Setup Download Button (Reverted to just generate)
    const dlBtn = document.getElementById('downloadErasedBtn');
    if(dlBtn) {
        if (foundAvailable) {
            dlBtn.style.display = 'inline-flex';
            dlBtn.onclick = generateSortedImage; 
        } else {
            dlBtn.style.display = 'none';
        }
    }
    
    // --- NEW: Real-time Toggle Check after Scan ---
    const autoFillToggle = document.getElementById('autoFillToggle');
    if (autoFillToggle && autoFillToggle.checked) {
        injectOldLoans();
    } else {
        updateSearchTotals(); // Ensure totals update even if toggle is off
    }

    showConfirm('Scan Complete', `Found ${loanData.length}. Erased ${erasedCount}.`, false);
};
    
    
// --- FIX 3: AUTO-REFRESH DATE ON WAKE UP ---
// If app was in background overnight, update date when opened
document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === 'visible') {
        const currentVal = todayDateEl.value;
        const realToday = formatDateToDDMMYYYY(new Date());

        // If the date box shows a date that is NOT today, update it.
        if (currentVal && currentVal !== realToday) {
            console.log("🌞 New Day Detected: Updating Date...");
            todayDateEl.value = realToday;
            updateAllCalculations(); // Recalculate interest for the new day
        }
    }
});

// ==========================================
// HISTORY FILTER LOGIC
// ==========================================
const filterHistory = (mode) => {
    // 1. UI Update
    document.querySelectorAll('.chart-filters .btn-mini').forEach(btn => btn.classList.remove('active'));
    // Find the button that was clicked (approximate match)
    const buttons = document.querySelectorAll('.chart-filters .btn-mini');
    if (mode === '7') buttons[0].classList.add('active');
    if (mode === '30') buttons[1].classList.add('active');
    if (mode === 'FY') buttons[2].classList.add('active');
    if (mode === 'ALL') buttons[3].classList.add('active');

    // 2. Filter Data
    if (!cachedFinalisedReports || cachedFinalisedReports.length === 0) return;

    let filteredData = [...cachedFinalisedReports];
    const today = new Date();

    if (mode === '7') {
        // Just take the last 7 entries
        filteredData = filteredData.slice(0, 7);
    } else if (mode === '30') {
        const cutoff = new Date();
        cutoff.setDate(today.getDate() - 30);
        filteredData = filteredData.filter(r => parseDate(r.reportDate) >= cutoff);
    } else if (mode === 'FY') {
        const { startDate, endDate } = getFinancialYear();
        filteredData = filteredData.filter(r => {
            const d = parseDate(r.reportDate);
            return d >= startDate && d <= endDate;
        });
    }
    // 'ALL' does nothing (uses all data)

    // 3. Sort Ascending for Chart (Oldest -> Newest)
    // Note: cachedFinalisedReports is usually Newest -> Oldest, so we reverse for the chart
    const chartData = filteredData.sort((a, b) => parseDate(a.reportDate) - parseDate(b.reportDate));

    // 4. Render Chart
    if (window.historyChartInstance) window.historyChartInstance.destroy();

    const histCtx = document.getElementById('historyChart').getContext('2d');
    window.historyChartInstance = new Chart(histCtx, {
        type: 'line',
        data: {
            labels: chartData.map(r => r.reportDate),
            datasets: [{
                label: 'Total Collected',
                data: chartData.map(r => parseFloat(r.totals?.final || 0)),
                borderColor: '#3D52D5',
                backgroundColor: 'rgba(61, 82, 213, 0.1)',
                fill: true,
                tension: 0.4,
                pointRadius: 4,
                pointBackgroundColor: '#fff',
                pointBorderColor: '#3D52D5',
                pointBorderWidth: 2
            }]
        },
        options: {
            maintainAspectRatio: false,
            plugins: { 
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return ` ₹${context.raw.toLocaleString('en-IN')}`;
                        }
                    }
                }
            },
            scales: { 
                y: { 
                    beginAtZero: true, 
                    grid: { borderDash: [5, 5] },
                    ticks: { callback: (v) => '₹' + v/1000 + 'k' } 
                } 
            }
        }
    });
};
// ==========================================
// FIX: ACTIVATE 'LOAN ENTRY' SCAN BUTTON
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    // 1. Create a hidden file input for the Batch Scanner (if it doesn't exist)
    if (!document.getElementById('batchImageInput')) {
        const input = document.createElement('input');
        input.type = 'file';
        input.id = 'batchImageInput';
        input.accept = 'image/*';
        input.style.display = 'none';
        document.body.appendChild(input);
        
        // Add Listener for File Selection
        input.addEventListener('change', handleBatchScan);
    }

    // 2. Connect the "Scan Image" Button to the Input
    const scanBtn = document.getElementById('scanBatchBtn');
    if (scanBtn) {
        // Remove old listeners to prevent duplicates
        const newBtn = scanBtn.cloneNode(true);
        scanBtn.parentNode.replaceChild(newBtn, scanBtn);
        
        newBtn.addEventListener('click', () => {
            document.getElementById('batchImageInput').click();
        });
    }
});

const handleBatchScan = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    showConfirm('Scanning...', 'Analyzing handwritten list for Entry...', false);

    try {
        const reader = new FileReader();
        reader.onload = async () => {
            try {
                const base64Image = reader.result.split(',')[1];
                
                // --- FIX 1: Send 'loan_entry' scanType ---
                const response = await fetch('/.netlify/functions/scanImage', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        image: base64Image, 
                        mimeType: file.type,
                        scanType: 'loan_entry' // <--- CRITICAL FIX
                    })
                });

                if (!response.ok) throw new Error("Scan failed. Server error.");
                
                const result = await response.json();
                const loans = result.loans; 

                if (!loans || loans.length === 0) {
                    closeConfirm();
                    showConfirm("No Data", "No legible loans found in the image.", false);
                    return;
                }

                const batchBody = document.querySelector('#batchTable tbody');
                // Remove empty rows first
                Array.from(batchBody.rows).forEach(row => {
                   const noVal = row.querySelector('.batch-no').value;
                   if(!noVal) row.remove();
                });

                // --- FIX 2: Get Selected Series ---
                const selectedSeries = document.getElementById('batchSeries')?.value || 'R';

                loans.forEach(l => {
                    const row = batchBody.insertRow();
                    const count = batchBody.rows.length;
                    
                    // --- FIX 3: Apply Series Prefix Immediately ---
                    let cleanNo = String(l.no).toUpperCase().trim();
                    if (/^\d+$/.test(cleanNo)) {
                        cleanNo = `${selectedSeries}/${cleanNo}`; // R/11
                    } else {
                         // Standard cleanup just in case
                        cleanNo = cleanNo.replace(/([A-Z])[\.\-\s]*(\d+)/g, '$1/$2');
                    }

                    // --- FIX 4: Map Type & Details ---
                    // Default to 'S' if undefined, but use scan result if present
                    const typeVal = (l.type === 'G' || l.type === 'S') ? l.type : 'S';
                    const detailVal = l.details || '';

                    row.innerHTML = `
                        <td>${count}</td>
                        <td>
                            <input type="text" class="batch-no" value="${cleanNo}" placeholder="LOAN NO" style="text-transform: uppercase; width: 100%;">
                        </td>
                        <td><input type="number" class="batch-principal" value="${l.principal}" placeholder="0" oninput="updateBatchTotal()"></td>
                        <td>
                            <select class="batch-type" style="border:none; background:transparent; font-weight:900; font-size: 0.9rem;">
                                <option value="S" ${typeVal === 'S' ? 'selected' : ''}>S</option>
                                <option value="G" ${typeVal === 'G' ? 'selected' : ''}>G</option>
                            </select>
                        </td>
                        <td><input type="text" class="batch-note" placeholder="Details" value="${detailVal}"></td>
                        <td style="text-align: center;">
                            <button class="btn btn-danger btn-sm" onclick="this.closest('tr').remove(); renumberBatchRows(); updateBatchTotal();" style="padding: 5px 12px; font-size: 1.5rem; line-height: 1;">&times;</button>
                        </td>
                    `;
                });
                
                renumberBatchRows();
                updateBatchTotal(); // Calculate total immediately
                closeConfirm();
                showConfirm("Success", `Added ${loans.length} loans.`, false);
            
            } catch (err) {
                closeConfirm();
                showConfirm("Error", err.message, false);
            }
        };
        reader.readAsDataURL(file);
    } catch (e) {
        closeConfirm();
        showConfirm("Error", e.message, false);
    }
    event.target.value = '';
};

// --- Add this Helper Function for the Total ---
const updateBatchTotal = () => {
    const inputs = document.querySelectorAll('.batch-principal');
    let total = 0;
    inputs.forEach(inp => total += (parseFloat(inp.value) || 0));
    const display = document.getElementById('batchTotalDisplay');
    if(display) display.textContent = `₹${total.toLocaleString('en-IN')}`;
};
