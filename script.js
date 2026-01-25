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
const SHEET_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRqmKLvcVqOhmK-chMuP7HCgKW0ijSUXhMnZOwIY7XlRSgfXv_PjHK8ObCjPjIr6H853vr9ptn0prjk/pub?gid=0&single=true&output=csv";
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
let currentlyEditingReportId = null; 

// --- GLOBALS FOR SCANNING & SHEETS ---
let currentScanCoordinates = []; 
let scanCanvas = null;           
let scanCtx = null;              
let sheetDetailsCache = new Map(); // Stores Sheet Data
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
        const loanDate = parseDate(row.querySelector('.date').value);
        const durationEl = row.querySelector('.duration');
        const interestEl = row.querySelector('.interest');
        
        const duration = days360(loanDate, todayDate);
        const interest = calculateInterest(principal, interestRate, duration);
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
        // Formatting: B.673 -> B/673
        let cleanNo = String(loan.no).toUpperCase();
        cleanNo = cleanNo.replace(/([A-Z])[\.\-\s]+(\d)/g, '$1/$2');
        if (/^[A-Z]\d+$/.test(cleanNo)) {
             cleanNo = cleanNo.replace(/([A-Z])(\d)/, '$1/$2');
        }

        const formattedLoan = {
            no: cleanNo,
            principal: String(loan.principal).replace(/,/g, ''),
            date: formatDateToDDMMYYYY(parseDate(loan.date))
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
    // 1. Standard UI Toggle (No changes here)
    document.querySelectorAll('.tab-content, .tab-button').forEach(el => el.classList.remove('active'));
    document.getElementById(tabId).classList.add('active');
    document.querySelector(`[data-tab="${tabId}"]`).classList.add('active');

    if (user) {
        // 2. NEW: Merged Transactions Tab
        if (tabId === 'transactionsTab') {
            // Always start on the "Pending" view
            toggleTxView('pending');
            
            // Load both lists so the toggle works instantly
        
            loadRecentTransactions(); 
            
            // We load finalised in background if empty
            if (cachedFinalisedReports.length === 0) {
                 loadFinalisedTransactions();
            }
        }

       if (tabId === 'dashboardTab') {
            renderDashboard();
        }

        // 4. NEW: Inventory Tab (Renamed from loanSearchTab)
        if (tabId === 'inventoryTab') {
            loadInventory();
            
            // Default to Search View
            toggleInventoryView('search'); 

            // Initialize Search Table (Manual Search)
            if (loanSearchTableBody.rows.length === 0) {
                for (let i = 0; i < 3; i++) addSearchRow();
            }

            // Initialize Batch Table (Stock Entry)
            const batchBody = document.querySelector('#batchTable tbody');
            if (batchBody && batchBody.rows.length === 0) {
                for(let i=0; i<3; i++) addBatchRow();
            }

            // ... cache logic ...
             if (cachedFinalisedReports.length === 0) {
                loadFinalisedTransactions().then(buildLoanSearchCache);
            } else {
                buildLoanSearchCache();
            }
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
        <td><input type="number" class="batch-principal" placeholder="0"></td>
        <td>
            <select class="batch-type" style="border:none; background:transparent; font-weight:900; font-size: 0.9rem; padding: 5px;">
                <option value="G">G</option>
                <option value="S">S</option>
            </select>
        </td>
        <td><input type="text" class="batch-note" placeholder="Details"></td>
        <td style="text-align: center;">
            <button class="btn btn-danger btn-sm" onclick="removeBatchRow(this)" style="padding: 5px 12px; font-size: 1.5rem; line-height: 1;">&times;</button>
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

// NEW: Load Inventory from DB
const loadInventory = async () => {
    if (!user) return;
    try {
        const snapshot = await db.collection('activeInventory').where('userId', '==', user.uid).get();
        activeInventory = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        // Optional: Update dashboard stats here
    } catch (e) { console.error("Inventory Load Error:", e); }
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
            const cleanNo = normalizeLoanNo(rawNo); // Normalize: R/01 -> R/1

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
        return showConfirm("Empty Batch", "Please enter at least one loan number and principal.", false);
    }

    // --- NEW: DUPLICATE SAFETY CHECK ---
    // We check against the locally cached 'activeInventory' array
    const duplicates = entries.filter(newEntry => 
        activeInventory.some(existing => normalizeLoanNo(existing.no) === newEntry.no)
    );

    if (duplicates.length > 0) {
        // If we find duplicates, we STOP and ask the user.
        const dupList = duplicates.map(d => d.no).join(', ');
        const proceed = await showConfirm(
            "Duplicate Warning", 
            `The following loans already exist: ${dupList}. \n\nDo you want to OVERWRITE them with new values?`
        );
        
        if (!proceed) {
            return; // If you click "Cancel", nothing gets saved. Data is safe.
        }
    }
    // -----------------------------------

    // 2. Send to Firestore
    showConfirm("Saving...", "Uploading inventory to cloud...", false);
    const batch = db.batch();
    
    entries.forEach(entry => {
        const docId = `${user.uid}_${entry.no.replace(/\//g, '-')}`;
        const docRef = db.collection('activeInventory').doc(docId);
        batch.set(docRef, entry);
    });

    try {
        await batch.commit();
        await showConfirm("Success", `Saved ${entries.length} items to Inventory.`, false);
        batchBody.innerHTML = ''; 
        for(let i=0; i<3; i++) addBatchRow(); 
        loadInventory(); 
    } catch (error) {
        console.error("Batch Save Error:", error);
        await showConfirm("Error", "Failed to save batch. Check internet connection.", false);
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

    // 4. Draw Table
    doc.autoTable({
        startY: 30,
        head: [['SL', 'No', 'Principal', 'Date', 'Duration (Days)', 'Interest', 'Total']],
        body: tableBodyData,
        theme: 'striped',
        headStyles: { halign: 'center', fontStyle: 'bold' },
        styles: { halign: 'center' }
    });

    const finalY = doc.autoTable.previous.finalY;

    // ==========================================
    // 5. NEW TOTALS SECTION (6-Line Layout)
    // ==========================================
    doc.setFontSize(12);
    doc.setFont("helvetica", "normal");
    const numberColumnX = 160;
    const labelColumnX = 165;
    
    // Base Y Position
    let currentY = finalY + 10;

    // Get Values
    const tPrincipal = parseFloat(totalPrincipalEl.textContent) || 0;
    const tInterest = parseFloat(totalInterestEl.textContent) || 0;
    const pDues = parseFloat(currentPreviousDues) || 0;
    
    // Calculated Totals
    const subTotal = Math.round(tPrincipal + tInterest); // Total (Principal + Interest)
    const pdfFinalTotal = Math.round(subTotal + pDues);  // Final Amount

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
    doc.text(String(subTotal), numberColumnX, currentY, { align: 'right' });
    doc.text('Total', labelColumnX, currentY, { align: 'left' });
    doc.setFont("helvetica", "normal"); // Reset font

    // Lines 4 & 5: Previous Dues & Date
    if (pDues > 0) {
        // Line 4: Previous Dues Amount
        currentY += 7;
        doc.text(String(pDues), numberColumnX, currentY, { align: 'right' });
        doc.text('Previous Dues', labelColumnX, currentY, { align: 'left' });

        // Line 5: "of [Date]"
        if (currentPreviousDuesDate) {
            currentY += 5; // Smaller gap for description
            doc.setFontSize(10); // Smaller font for date
            doc.setTextColor(100); // Gray color
            doc.text(`of ${currentPreviousDuesDate}`, labelColumnX, currentY, { align: 'left' });
            
            // Reset Styles
            doc.setFontSize(12);
            doc.setTextColor(0);
        } else {
            // Just a spacer if no date is found
            currentY += 2; 
        }

        // Line 6: Final Total Amount
        currentY += 7; // Extra gap before final total
        doc.setFont("helvetica", "bold");
        doc.text(String(pdfFinalTotal), numberColumnX, currentY, { align: 'right' });
        doc.text('Total Amount', labelColumnX, currentY, { align: 'left' });
    } else {
        // If no dues, just show the Final Total (same as subtotal)
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
        const wasSaved = await saveReport(true); 
        if (wasSaved) {
            generatePDF('save');
        }
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
};
const restoreDefaultBackButton = () => {
    exitViewModeBtn.textContent = 'Back to Calculator';
    exitViewModeBtn.onclick = exitViewMode;
};

const viewReport = (reportId, isEditable, isFinalised = false, originTab = 'calculatorTab') => {
    const report = (isFinalised ? cachedFinalisedReports : cachedReports).find(r => r.id === reportId);
    if (!report) return showConfirm("Error", "Report not found!", false);
    
    if (liveStateUnsubscribe) {
        liveStateUnsubscribe();
        liveStateUnsubscribe = null;
    }

    // --- FIX: Smart "Back" Button Logic ---
    if (originTab === 'loanSearchTab') {
        exitViewModeBtn.textContent = 'Back to Loan Search';
        exitViewModeBtn.onclick = () => {
            // Fix: Go to 'inventoryTab' (the real ID) instead of 'loanSearchTab'
            showTab('inventoryTab'); 
            toggleInventoryView('search'); // Ensure we land on Search, not Entry
            restoreDefaultBackButton();
        };
    } else if (originTab === 'recentTransactionsTab') {
        exitViewModeBtn.textContent = 'Back to Recent';
        exitViewModeBtn.onclick = () => {
            // Fix: Go to 'transactionsTab' (the real ID)
            showTab('transactionsTab'); 
            toggleTxView('pending'); // Force switch to "Pending" list
            restoreDefaultBackButton();
        };
    } else if (originTab === 'finalisedTransactionsTab') {
        exitViewModeBtn.textContent = 'Back to Finalised';
        exitViewModeBtn.onclick = () => {
            // Fix: Go to 'transactionsTab' (the real ID)
            showTab('transactionsTab'); 
            toggleTxView('finalised'); // Force switch to "Finalised" list
            restoreDefaultBackButton();
        };
    } else {
        restoreDefaultBackButton();
    }

    showTab('calculatorTab');
    todayDateEl.value = report.reportDate;
    interestRateEl.value = report.interestRate;
    loanTableBody.innerHTML = '';
    
    isUpdatingFromListener = true;
    if (report.loans) report.loans.forEach(loan => addRow(loan));
    isUpdatingFromListener = false;
    
    if (isEditable) {
        currentlyEditingReportId = reportId;
        addRow({ no: '', principal: '', date: '' });
        setViewMode(false);
    } else {
        currentlyEditingReportId = null;
        setViewMode(true);
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

    // --- CHECK 1: FINALIZED REPORTS (Sold/Closed) ---
    // Here we DO show the date because it is the "Finalised Date"
    if (loanSearchCache.has(normalizedKey)) {
        const data = loanSearchCache.get(normalizedKey);
        principalCell.textContent = data.principal;
        dateCell.textContent = data.reportDate; // <--- KEEP THIS (It's the finalised date)
        statusCell.classList.add('status-not-available');
        statusCell.innerHTML = `
            <span>Not Available</span>
            <button class="btn btn-secondary btn-sm btn-flat-sm" onclick="viewReport('${data.reportId}', false, true, 'loanSearchTab')">
                View
            </button>`;
        return; 
    }

    // --- CHECK 2: ACTIVE INVENTORY (Your New Entries) ---
    const inventoryMatch = activeInventory.find(item => 
        item.no === userInput || normalizeLoanNo(item.no) === normalizedKey
    );

    if (inventoryMatch) {
        statusCell.classList.add('status-available');
        
        // Show Principal ONLY. 
        // We leave the date BLANK or put a dash '-' because it is not finalised yet.
        principalCell.textContent = inventoryMatch.principal || '-';
        dateCell.textContent = '';  // <--- CHANGED: Forces date to be empty/dash

        // Color Logic for G/S
        let colorStyle = '#333';
        if(inventoryMatch.type === 'G') colorStyle = '#f1c40f'; // Yellow
        if(inventoryMatch.type === 'S') colorStyle = '#000000'; // Black

        statusCell.innerHTML = `<span>Available</span><span style="margin-left:8px; font-weight:900; font-size:1.1em; color:${colorStyle};">[${inventoryMatch.type}]</span>`;
        return; 
    }

    // --- CHECK 3: OLD SHEET DATA (CSV) ---
    statusCell.classList.add('status-available');
    let annotationHtml = '';
    
    if (sheetDetailsCache.has(normalizedKey)) {
        const detail = sheetDetailsCache.get(normalizedKey);
        let colorStyle = '#333';
        if(detail === 'G') colorStyle = '#f1c40f'; 
        if(detail === 'S') colorStyle = '#000000'; 
        annotationHtml = `<span style="margin-left:8px; font-weight:900; font-size:1.1em; color:${colorStyle};">[${detail}]</span>`;
    } else {
        annotationHtml = `<span style="margin-left:8px; font-weight:bold; color:#e74c3c;">[?]</span>`;
    }

    statusCell.innerHTML = `<span>Available</span>${annotationHtml}`;
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
// ADVANCED DASHBOARD (Value-Based + History)
// ==========================================
const renderDashboard = async () => {
    const loader = document.getElementById('dashboardLoader');
    if (loader) loader.style.display = 'block';

    // 1. Load Data
    if (!activeInventory || activeInventory.length === 0) await loadInventory();
    await loadFinalisedTransactions(); 

    const today = new Date();
    const rate = parseFloat(interestRateEl.value) || 1.75; 
    
    // 2. Aggregation Variables
    let totalPrincipal = 0;
    let totalInterest = 0;
    
    let mixStats = { goldVal: 0, goldCount: 0, silverVal: 0, silverCount: 0 };
    let agingStats = { normalVal: 0, normalCount: 0, midVal: 0, midCount: 0, oldVal: 0, oldCount: 0 };

    // 3. Process Active Loans
    const processedLoans = activeInventory.map(loan => {
        const p = parseFloat(loan.principal) || 0;
        const loanDate = parseDate(loan.date);
        let interest = 0;
        let days = 0;

        if (loanDate && p > 0) {
            days = days360(loanDate, today);
            interest = (p * rate * days) / 3000;
        }

        totalPrincipal += p;
        totalInterest += interest;

        // Mix Logic
        if (loan.type === 'G') { mixStats.goldVal += p; mixStats.goldCount++; }
        else if (loan.type === 'S') { mixStats.silverVal += p; mixStats.silverCount++; }

        // Aging Logic
        if (days < 730) { agingStats.normalVal += p; agingStats.normalCount++; } 
        else if (days < 1095) { agingStats.midVal += p; agingStats.midCount++; } 
        else { agingStats.oldVal += p; agingStats.oldCount++; }

        return { no: loan.no, type: loan.type, principal: p, totalValue: p + interest, days, date: loan.date };
    });

    // 4. Update Net Worth Card
    const netWorth = totalPrincipal + totalInterest;
    document.getElementById('dashNetWorth').textContent = `₹${Math.round(netWorth).toLocaleString('en-IN')}`;
    document.getElementById('dashPrincipal').textContent = `₹${Math.round(totalPrincipal).toLocaleString('en-IN')}`;
    document.getElementById('dashInterest').textContent = `+ ₹${Math.round(totalInterest).toLocaleString('en-IN')}`;

    // 5. CHART CONFIGURATION
    const currencyTooltip = {
        callbacks: {
            label: function(context) {
                let value = context.raw || 0;
                let count = context.dataset.counts ? context.dataset.counts[context.dataIndex] : 0;
                return ` ₹${value.toLocaleString('en-IN')} (${count} Nos)`;
            }
        }
    };

    if (pieChartInstance) pieChartInstance.destroy();
    if (barChartInstance) barChartInstance.destroy();
    // Note: History chart is handled by filterHistory, so we don't destroy it here directly

    // A. PORTFOLIO MIX CHART
    const pieCtx = document.getElementById('mixChart').getContext('2d');
    pieChartInstance = new Chart(pieCtx, {
        type: 'doughnut',
        data: { 
            labels: ['Gold', 'Silver'], 
            datasets: [{ 
                data: [mixStats.goldVal, mixStats.silverVal], 
                counts: [mixStats.goldCount, mixStats.silverCount],
                backgroundColor: ['#fca311', '#adb5bd'],
                borderWidth: 0
            }] 
        },
        options: { maintainAspectRatio: false, plugins: { tooltip: currencyTooltip, legend: { position: 'bottom' } } }
    });

    // B. AGING CHART
    const barCtx = document.getElementById('agingChart').getContext('2d');
    barChartInstance = new Chart(barCtx, {
        type: 'bar',
        data: { 
            labels: ['< 2 Years', '2-3 Years', '> 3 Years'], 
            datasets: [{ 
                label: 'Loan Value', 
                data: [agingStats.normalVal, agingStats.midVal, agingStats.oldVal],
                counts: [agingStats.normalCount, agingStats.midCount, agingStats.oldCount],
                backgroundColor: ['#2a9d8f', '#e9c46a', '#e76f51'],
                borderRadius: 5
            }] 
        },
        options: { 
            maintainAspectRatio: false, 
            plugins: { tooltip: currencyTooltip, legend: { display: false } },
            scales: { y: { beginAtZero: true, grid: { display: false }, ticks: { callback: (v) => '₹' + v/1000 + 'k' } } }
        }
    });

    // C. HISTORY CHART (Delegate to Filter Function)
    // This fixes the error because it waits for the element to exist
    setTimeout(() => {
        if(typeof filterHistory === 'function') {
            filterHistory('ALL'); 
        }
    }, 100);

    // 6. TOP LISTS
    const oldestLoans = [...processedLoans].sort((a, b) => b.days - a.days).slice(0, 5);
    document.getElementById('oldestLoansList').innerHTML = oldestLoans.map(l => `
        <li>
            <div class="list-main"><span class="list-no">${l.no} <span class="list-tag ${l.type === 'G' ? 'tag-g' : 'tag-s'}">${l.type}</span></span><span class="list-sub">${l.date} (${l.days} days)</span></div>
            <div class="list-val">₹${Math.round(l.principal).toLocaleString('en-IN')}</div>
        </li>`).join('');

    const highValueLoans = [...processedLoans].sort((a, b) => b.totalValue - a.totalValue).slice(0, 5);
    document.getElementById('highValueList').innerHTML = highValueLoans.map(l => `
        <li>
            <div class="list-main"><span class="list-no">${l.no}</span><span class="list-sub">Prin: ₹${Math.round(l.principal/1000)}k</span></div>
            <div class="list-val">₹${Math.round(l.totalValue).toLocaleString('en-IN')}<div style="font-size:0.7rem; color:#888;">(Incl. Int)</div></div>
        </li>`).join('');

    if (loader) loader.style.display = 'none';
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

            // --- CHANGED: Load Silently ---
            currentPreviousDues = parseFloat(state.previousDues) || 0;
            currentPreviousDuesDate = state.previousDuesDate || ''; // <--- Load Date
            // We DO NOT update the UI here.
            // -----------------------------

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


// --- DUES FINALISE LOGIC ---
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
    const docId = pendingReportIdToFinalise;

    // 1. Close the Input Box
    document.getElementById('duesModal').style.display = 'none';

    if (!docId) return;

    // 2. NOW Ask for Confirmation (The "Are you sure?" Popup)
    const confirmed = await showConfirm(
        "Finalise Report", 
        "Are you sure you want to finalise this report? This action cannot be undone."
    );
    
    if (!confirmed) return; // If they click Cancel, stop everything.

    // 3. Proceed with Saving
    if (navigator.onLine && reportsCollection) {
        try {
            showConfirm("Processing...", "Finalising report...", false);
            
            const reportDoc = await reportsCollection.doc(docId).get();
            if (!reportDoc.exists) throw new Error("Report not found.");
            
            const reportData = reportDoc.data();
            const newName = `Final Hisab of ${reportData.reportDate}`;
            
            // A. Finalise the Report
            await reportsCollection.doc(docId).update({ 
                status: 'finalised', 
                reportName: newName,
                finalisedDues: newDues 
            });

            // B. Save Dues Silently for Next Session
            await db.collection('liveCalculatorState').doc(user.uid).set({
                previousDues: newDues,
                previousDuesDate: reportData.reportDate // <--- SAVE THE DATE
            }, { merge: true });

            // C. Update Local Variable
            currentPreviousDues = newDues;
            currentPreviousDuesDate = reportData.reportDate; // <--- Update Local
            await showConfirm("Success", `Report Finalised.`, false);
            
            loadRecentTransactions();
            loadFinalisedTransactions();

        } catch (error) {
            console.error("Error finalising report:", error);
            await showConfirm("Error", "Could not finalise the report.", false);
        }
    } else {
        await showConfirm("Offline", "You must be online to finalise a report.", false);
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
        
        listenForLiveStateChanges(); 
        syncData();
        loadInventory();
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
                // C. FORCE UPDATE (The Fix)
                // We now overwrite the values even if the box wasn't empty
                principalInput.value = match.principal;
                dateInput.value = match.date;
                
                // D. Apply Color
                // Grey (#e0e0e0) = Silver ('S')
                // Yellow (#fcf4cf) = Gold ('G')
                if (match.type === 'G') target.classList.add('found-gold');
                else if (match.type === 'S') target.classList.add('found-silver');
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

    /*// --- Dashboard Filter Event Listeners ---
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
    });*/

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
        }
    });

    searchFiltersContainer.addEventListener('click', (e) => {
        if (e.target.matches('.btn')) {
            searchFiltersContainer.querySelector('.active-filter').classList.remove('active-filter');
            e.target.classList.add('active-filter');
            filterSearchResults(e.target.dataset.filter);
        }
    });

    // Listen for messages from the Service Worker (for shared images)
    navigator.serviceWorker.addEventListener('message', event => {
        if (event.data && event.data.action === 'scan-image') {
            showTab('calculatorTab');
            handleImageScan(event.data.file);
        }
    });

    // --- Auto-Load Saved Sheet on Startup ---
   // --- Auto-Load Sheet on Startup ---
    // Trigger the fetch immediately using the hardcoded URL
    fetchSheetData();
});

// ======================================================
// EXTERNAL INTEGRATION LOGIC (Sheet & Report Gen)
// ======================================================

// 1. DATA FETCHER
// 1. DATA FETCHER (Updated: Uses Hardcoded SHEET_URL)
// 1. DATA FETCHER (Updated: Hardcoded Link + UI Fix)
// 1. DATA FETCHER (Robust CSV Parser - Fixes Partial Loading)
// 1. DATA FETCHER (Robust CSV Parser)
// 1. DATA FETCHER (Updated with HTML Detection Guard)
const fetchSheetData = async () => {
    const url = SHEET_URL; 

    if (!url || url.includes("PASTE_YOUR_NEW")) {
        console.warn("No Sheet URL configured.");
        return false;
    }

    // Timestamp to prevent caching
    const uniqueUrl = url + `&t=${Date.now()}`;
    
    // Status UI
    const statusEl = document.querySelector('.initializing-text') || document.getElementById('sheetStatus');

    if(statusEl) {
        statusEl.textContent = "⏳ Connecting to Sheet...";
        statusEl.style.color = "#d35400";
    }

    try {
        const response = await fetch(uniqueUrl);
        if (!response.ok) throw new Error("Connection Failed");
        const text = await response.text();

        // 🛑 CRITICAL CHECK: Did we get a Website instead of Data?
        if (text.trim().startsWith("<!DOCTYPE html") || text.includes("<html")) {
            throw new Error("Wrong Link Type! You are using an '/edit' link. Please use 'File > Share > Publish to web > CSV'.");
        }
        
        // Use the Robust Parser
        const rows = parseCSV(text); 
        
        sheetDetailsCache.clear();
        
        rows.forEach(cols => {
            if (cols.length >= 2) {
                const rawNo = cols[0].trim(); 
                const cleanNo = normalizeLoanNo(rawNo); 
                const details = cols[1].trim(); 
                
                if (cleanNo && details) {
                    sheetDetailsCache.set(cleanNo, details);
                }
            }
        });

        console.log(`Loaded ${sheetDetailsCache.size} details.`);
        
        if(statusEl) {
            statusEl.textContent = `✅ Active: ${sheetDetailsCache.size} records.`;
            statusEl.style.color = "green";
            statusEl.style.fontWeight = "bold";
        }
        return true;
    } catch (error) {
        console.error("Sheet Error:", error);
        if(statusEl) {
            // Show the specific error message to the user
            statusEl.textContent = `❌ ${error.message}`;
            statusEl.style.color = "red";
            statusEl.style.fontSize = "12px"; // Make it readable
        }
        showConfirm("Sheet Error", error.message, false); // Alert the user via modal
        return false;
    }
};

// --- HELPER: ROBUST CSV PARSER ---
// Add this function directly below fetchSheetData
function parseCSV(text) {
    const rows = [];
    let currentRow = [];
    let currentCell = '';
    let insideQuotes = false;
    
    // Iterate character by character
    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        const nextChar = text[i + 1];
        
        if (char === '"') {
            if (insideQuotes && nextChar === '"') {
                currentCell += '"'; // Handle escaped quote ("")
                i++; // Skip the next quote
            } else {
                insideQuotes = !insideQuotes; // Toggle quote state
            }
        } else if (char === ',' && !insideQuotes) {
            // End of cell
            currentRow.push(currentCell);
            currentCell = '';
        } else if ((char === '\r' || char === '\n') && !insideQuotes) {
            // End of row (Handle CRLF or LF)
            if (char === '\r' && nextChar === '\n') i++;
            currentRow.push(currentCell);
            if (currentRow.length > 0) rows.push(currentRow); // Add row
            currentRow = [];
            currentCell = '';
        } else {
            currentCell += char;
        }
    }
    // Push the very last row if exists
    if (currentCell || currentRow.length > 0) {
        currentRow.push(currentCell);
        rows.push(currentRow);
    }
    return rows;
}

// 2. GENERATE SORTED IMAGE (UPDATED: 4 Columns + Strict Mobile/PC Logic)
// UPDATED: GENERATE SORTED IMAGE (Fixes: No Blue Header, Right-Align Amount, No Cut-off)
// UPDATED: GENERATE SORTED IMAGE
// Fixes: Share on Mobile Only, No Cut-off, New Header Format, Yellow/Black Colors
// UPDATED: GENERATE SORTED IMAGE (High Quality + Date + Correct Header)
// UPDATED: GENERATE SORTED IMAGE (High-Res, No Overlap, Fixed Date)
const generateSortedImage = () => {
    // 1. Get fresh data
    const loanList = getAvailableLoansFromTable();

    if (!loanList || loanList.length === 0) {
        showConfirm("Error", "No available loans found.", false);
        return;
    }

    // A. Categorize and Sort
    const processedList = loanList.map(item => {
        const detail = sheetDetailsCache.get(item.no) || "?";
        const principalStr = item.principal ? String(item.principal) : '-';
        return { 
            no: item.no, 
            principal: principalStr, 
            date: item.date || '-', 
            detail: detail 
        };
    });

    processedList.sort((a, b) => {
        if (a.detail < b.detail) return -1;
        if (a.detail > b.detail) return 1;
        return a.no.localeCompare(b.no, undefined, { numeric: true, sensitivity: 'base' });
    });

    // B. Create Canvas (High Definition Setup)
    const reportCanvas = document.createElement('canvas');
    const ctx = reportCanvas.getContext('2d');
    
    // Scale factor for High DPI (Retina) screens
    const scale = 2; 
    
    // Layout Config (Logical Pixels)
    const rowHeight = 50;
    const dateHeaderHeight = 40; // Space for the date at top
    const columnHeaderHeight = 50; // Space for SL/NO/AMOUNT headers
    const totalHeaderHeight = dateHeaderHeight + columnHeaderHeight;
    const padding = 200; // Increased to prevent bottom cut-off
    
    const logicalWidth = 900;
    // Calculate total height dynamically
    // We assume roughly 1 header per 5 rows to estimate, 
    // but canvas will resize if we need more. 
    // For now, let's use a safe dynamic height + padding
    const logicalHeight = totalHeaderHeight + (processedList.length * 60) + padding;

    // Set Actual Size (Multiplied by Scale)
    reportCanvas.width = logicalWidth * scale;
    reportCanvas.height = logicalHeight * scale;

    // Normalize coordinate system so we can write code using logical pixels
    ctx.scale(scale, scale);

    // C. Draw White Background
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, logicalWidth, logicalHeight);

    // D. Draw Today's Date (Top Right)
    const today = new Date().toLocaleDateString('en-GB'); // DD/MM/YYYY
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
    
    // Header Bottom Line
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
            
            // 1. Push y down to create a gap between previous row and header
            y += 45; 
            
            // 2. Draw Header Box in that gap
            ctx.fillStyle = "#e9ecef";
            ctx.fillRect(0, y - 60, logicalWidth, 30);
            
            ctx.fillStyle = "#000";
            ctx.textAlign = "left";
            ctx.font = "bold 16px sans-serif";
            ctx.fillText(`CATEGORY: ${currentCategory}`, 20, y - 40);
        }

        // Row Content
        ctx.font = "24px sans-serif";
        ctx.fillStyle = "#000000";
        
        // SL NO
        ctx.textAlign = "left";
        ctx.fillText(slCounter++, colX.sl, y);
        
        // LOAN NO
        ctx.fillText(item.no, colX.no, y);

        // AMOUNT (Right Aligned)
        ctx.textAlign = "right";
        ctx.fillText(item.principal, colX.amt, y);
        ctx.textAlign = "left"; 

        // DATE
        ctx.fillText(item.date, colX.date, y);

        // DETAIL COLOR LOGIC (Yellow & Black)
        let badgeColor = "#333";
        if (item.detail === "G") badgeColor = "#f1c40f"; // Golden Yellow
        else if (item.detail === "S") badgeColor = "#000000"; // Black
        else if (item.detail === "?") badgeColor = "#e74c3c"; // Red

        ctx.fillStyle = badgeColor;
        ctx.font = "bold 26px sans-serif";
        ctx.fillText(item.detail, colX.det, y);

        // Divider Line
        ctx.strokeStyle = "#eee";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(20, y + 15);
        ctx.lineTo(880, y + 15);
        ctx.stroke();

        y += rowHeight;
    });

    // G. Mobile Share vs PC Download
    reportCanvas.toBlob((blob) => {
        const fileName = `Sorted_List_${Date.now()}.png`;
        const file = new File([blob], fileName, { type: 'image/png' });
        
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

        if (isMobile && navigator.canShare && navigator.canShare({ files: [file] })) {
            navigator.share({
                files: [file],
                title: 'Sorted Loan List'
            }).catch(console.error);
        } else {
            // PC: Force Download
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
            // Use stored scan data if it exists, otherwise default
            const storedData = row.scanData || { principal: '-', date: '-' };
            
            availableLoans.push({ 
                no: normalizedKey,
                principal: storedData.principal,
                date: storedData.date
            });
        }
    });
    return availableLoans;
};

// UPDATED: MAIN SCANNER (Uses new download logic)
const fillSearchTableFromScan = async (loanData) => {
    
    if (sheetDetailsCache.size === 0) await fetchSheetData();
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
    
    // Setup Download Button (Points to new generation function)
    const dlBtn = document.getElementById('downloadErasedBtn');
    if(dlBtn) {
        if (foundAvailable) {
            dlBtn.style.display = 'inline-flex';
            // IMPORTANT: Call the function directly, don't pass old list
            dlBtn.onclick = generateSortedImage; 
        } else {
            dlBtn.style.display = 'none';
        }
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
