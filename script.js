// --- Firebase Configuration ---
const firebaseConfig = {
    apiKey: "AIzaSyA7_nnw_BRziSVyjbZ-2UMxTKIKVW_K_JQ",
    authDomain: "interest-calculator-8d997.firebaseapp.com",
    projectId: "interest-calculator-8d997",
    storageBucket: "interest-calculator-8d997.appspot.com",
    messagingSenderId: "187925519090",
    appId: "1:187925519090:web:c875d2fb788d02b5bf4e6b"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();
let user = null;
let reportsCollection = null;
let localDb = null;
let cachedReports = [];
let pieChartInstance, barChartInstance;

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
const printAndSaveBtn = document.getElementById('printAndSaveBtn');
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
    updateSyncStatus();
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
    const parts = dateString.match(/(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
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
    saveCurrentState();
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
    updateAllCalculations();
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

// --- START: NEW Cloud Vision Integration ---

// Helpers to normalize OCR text (Hindi digits -> ASCII, etc.)
const _devToAscii = (s) => {
    const map = { '०':'0','१':'1','२':'2','३':'3','४':'4','५':'5','६':'6','७':'7','८':'8','९':'9' };
    return s.replace(/[०-९]/g, ch => map[ch] || ch);
};
const normalizeOcrText = (t) => {
    return _devToAscii(t)
        .replace(/[„”“]/g, '"')
        .replace(/[’‘´`]/g, "'")
        .replace(/[–—]/g, "-")
        .replace(/[|]/g, "1");
};

// Rank a numeric candidate as "amount" using nearby context
const scoreAmountCandidate = (value, context) => {
    let score = Math.log10(Math.max(1, value)); // bigger numbers get a natural lift

    // Positive signals
    if (/(₹|rs\.?|रु|रूपये|रुपये|amount|amt|total|कुल)/i.test(context)) score += 6;
    if (/\/-|\-\/|:|-:$/.test(context)) score += 2; // common bill suffix
    if (/(cash|receive|paid|देय|राशि)/i.test(context)) score += 3;

    // Negative signals (quantities, units, counts)
    if (/\b(pcs?|pieces?|nos?|qty|kg|gm|g|ml|ltr|cm|mm|मीटर|ग्राम|किलो|पीस|संख्या|वज़न|वजन)\b/i.test(context)) score -= 6;

    // Very small numbers are unlikely to be amounts
    if (value < 1000) score -= 4;

    return score;
};

const parseAndFillData = (data) => {
    // The data is now an object { words: [...] } from our Netlify function
    const words = data.words || [];
    console.log("Received structured word data:", words);

    if (words.length === 0) {
        showConfirm('Scan Failed', 'No text could be found in the image.', false);
        return;
    }

    // --- Helper function to find the Y-center of a word's bounding box ---
    const getWordCenterY = (word) => {
        const yCoords = word.bounds.map(v => v.y || 0);
        return (Math.min(...yCoords) + Math.max(...yCoords)) / 2;
    };
    
    // --- Helper function to find the X-start of a word's bounding box ---
    const getWordStartX = (word) => {
        return Math.min(...word.bounds.map(v => v.x || 0));
    };

    let loanNo = null;
    let principal = null;
    let date = null;

    // --- 1) Find Loan No (by looking for the unique pattern like D.123) ---
    const loanNoCandidates = words.filter(w => /^[A-Z]\.\d{3}$/i.test(w.text));
    if (loanNoCandidates.length > 0) {
        loanNo = loanNoCandidates[0].text.toUpperCase();
    }
    
    // --- 2) Find Date and Amount using their labels and positions ---
    const findValueNearLabel = (labels) => {
        let labelWord = null;
        for (const word of words) {
            if (labels.includes(word.text.replace(':', '').trim())) {
                labelWord = word;
                break;
            }
        }

        if (!labelWord) return null;

        const labelCenterY = getWordCenterY(labelWord);
        const labelStartX = getWordStartX(labelWord);

        // Find all words on the same horizontal line, to the right of the label
        const wordsOnSameLine = words.filter(word => {
            const wordCenterY = getWordCenterY(word);
            const wordStartX = getWordStartX(word);
            // Check if Y centers are close and if word is to the right
            return Math.abs(wordCenterY - labelCenterY) < 20 && wordStartX > labelStartX;
        });

        // Sort them by their horizontal position and join them
        if (wordsOnSameLine.length > 0) {
            wordsOnSameLine.sort((a, b) => getWordStartX(a) - getWordStartX(b));
            return wordsOnSameLine.map(w => w.text).join('');
        }
        return null;
    };

    // --- Execute finders ---
    const rawDate = findValueNearLabel(['ता', 'तारीख', 'Date', 'Dt']);
    if(rawDate) {
        const parsed = parseDate(rawDate);
        date = parsed ? formatDateToDDMMYYYY(parsed) : rawDate;
    }
    
    const rawAmount = findValueNearLabel(['रु', 'रू', 'Rs']);
    if(rawAmount) {
        // Remove any non-digit characters and parse
        principal = rawAmount.replace(/[^\d]/g, '');
    }

    // --- Fill into Table ---
    if (loanNo && principal && date) {
        let targetRow = Array.from(loanTableBody.querySelectorAll('tr')).find(r =>
            !r.querySelector('.principal').value && !r.querySelector('.no').value
        );

        if (!targetRow) {
            addRow({ no: loanNo, principal, date });
        } else {
            targetRow.querySelector('.no').value = loanNo;
            targetRow.querySelector('.principal').value = principal;
            targetRow.querySelector('.date').value = date;
        }

        updateAllCalculations();
        showConfirm('Scan Complete', 'Data has been successfully added to the table.', false);
    } else {
        showConfirm('Scan Results', 'Could not find all required data. Check the console for details.', false);
        // Provide the original raw text for debugging if needed
        const rawTextForDebug = words.map(w => w.text).join(' ');
        console.log("Full text to copy:", rawTextForDebug);
        console.log("Data found:", { loanNo, principal, date });
    }
};

const handleImageScan = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    showConfirm('Scanning Image...', 'Please wait while the document is being analyzed.', false);

    try {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = async () => {
            const base64Image = reader.result.split(',')[1];
            const response = await fetch('/.netlify/functions/scanImage', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ image: base64Image })
            });
            closeConfirm();

            if (!response.ok) {
                const errorInfo = await response.json();
                throw new Error(errorInfo.error || 'The scan failed. The server responded with an error.');
            }

            const result = await response.json();
            
            // --- CORRECTION IS HERE ---
            // We now check for 'result.words' instead of the old 'result.text'
            if (result && result.words) {
                // We pass the entire 'result' object to our new parser
                parseAndFillData(result);
            } else {
                await showConfirm('Scan Failed', 'No text could be found in the image.', false);
            }
        };
        reader.onerror = (error) => {
            closeConfirm();
            console.error("FileReader Error:", error);
            throw new Error('There was an error reading the image file.');
        };
    } catch (error) {
        console.error('Scan process failed:', error);
        closeConfirm();
        await showConfirm('Error', error.message, false);
    }

    imageUploadInput.value = '';
};
// --- END: NEW Cloud Vision Integration ---


// --- State Management ---
const saveCurrentState = () => {
    if (!user) return;
    const loans = Array.from(document.querySelectorAll('#loanTable tbody tr'))
        .map(row => ({
            no: row.querySelector('.no').value,
            principal: row.querySelector('.principal').value,
            date: row.querySelector('.date').value
        }))
        .filter(loan => loan.no || loan.principal);
    const currentState = { todayDate: todayDateEl.value, interestRate: interestRateEl.value, loans: loans };
    localStorage.setItem(`interestLedgerState_${user.uid}`, JSON.stringify(currentState));
};
const loadCurrentState = () => {
    if (!user) return;
    const savedState = JSON.parse(localStorage.getItem(`interestLedgerState_${user.uid}`));
    loanTableBody.innerHTML = '';
    if (savedState) {
        todayDateEl.value = savedState.todayDate || formatDateToDDMMYYYY(new Date());
        interestRateEl.value = savedState.interestRate || '1.75';
        if (savedState.loans && savedState.loans.length > 0) savedState.loans.forEach(loan => addRow(loan));
    } else {
        todayDateEl.value = formatDateToDDMMYYYY(new Date());
    }
    while (loanTableBody.rows.length < 5) addRow({ no: '', principal: '', date: '' });
    if (!loanTableBody.lastChild.querySelector('.principal').value) { } else { addRow({ no: '', principal: '', date: '' }); }
    updateAllCalculations();
};

// --- Tabs ---
const showTab = (tabId) => {
    document.querySelectorAll('.tab-content, .tab-button').forEach(el => el.classList.remove('active'));
    document.getElementById(tabId).classList.add('active');
    document.querySelector(`[data-tab="${tabId}"]`).classList.add('active');
    if (user) {
        if (tabId === 'recentTransactionsTab') {
            recentTransactionsListEl.innerHTML = '';
            recentTransactionsLoader.style.display = 'flex';
            loadRecentTransactions();
        }
        if (tabId === 'dashboardTab') {
            renderDashboard();
        }
    }
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

const printAndSave = async () => {
    cleanAndSortTable();
    updateAllCalculations();
    const loans = getCurrentLoans().map(({ no, principal, date }) => ({ no, principal, date }));
    if (loans.length === 0) return showConfirm("Cannot Save", "Please add at least one loan with a principal amount.", false);

    const reportDate = todayDateEl.value;
    const report = {
        reportDate,
        interestRate: interestRateEl.value,
        loans,
        createdAt: new Date(),
        totals: { principal: totalPrincipalEl.textContent, interest: totalInterestEl.textContent, final: finalTotalEl.textContent }
    };

    if (navigator.onLine && reportsCollection) {
        const baseName = `Summary of ${reportDate}`;
        const querySnapshot = await reportsCollection.where("reportDate", "==", reportDate).get();
        report.reportName = querySnapshot.size > 0 ? `${baseName} (${querySnapshot.size + 1})` : baseName;
        report.createdAt = firebase.firestore.FieldValue.serverTimestamp();
        try {
            await reportsCollection.add(report);
            await showConfirm("Success", "Report saved to the cloud.", false);
        } catch (error) { console.error("Error saving online:", error); }
    } else {
        report.localId = `local_${Date.now()}`;
        report.reportName = `(Unsynced) Summary of ${reportDate}`;
        await localDb.put('unsyncedReports', report);
        await showConfirm("Offline", "Report saved locally. It will sync when you're back online.", false);
    }
    document.getElementById('printTitle').textContent = `Interest Report`;
    document.getElementById('printDate').textContent = `As of ${reportDate}`;
    window.print();
    loadRecentTransactions();
};

const exportToPDF = async () => {
    cleanAndSortTable();
    updateAllCalculations();
    const loans = getCurrentLoans();
    if (loans.length === 0) return showConfirm("Cannot Export", "Please add loan data to export.", false);

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    doc.setFontSize(18);
    doc.text("Interest Report", 14, 22);
    doc.setFontSize(11);
    doc.text(`As of Date: ${todayDateEl.value}`, 14, 29);
    doc.text(`Interest Rate: ${interestRateEl.value}% (Monthly)`, 120, 29);

    doc.autoTable({
        startY: 35,
        head: [['SL', 'No', 'Principal', 'Date', 'Duration (Days)', 'Interest']],
        body: loans.map((loan, i) => [i + 1, loan.no, loan.principal, loan.date, loan.duration, loan.interest]),
    });

    const finalY = doc.autoTable.previous.finalY;
    doc.setFontSize(12);
    doc.text(`Total Principal: ${totalPrincipalEl.textContent}`, 14, finalY + 10);
    doc.text(`Total Interest: ${totalInterestEl.textContent}`, 14, finalY + 17);
    doc.setFont("helvetica", "bold");
    doc.text(`Final Total Amount: ${finalTotalEl.textContent}`, 14, finalY + 24);

    doc.save(`Interest_Report_${todayDateEl.value.replace(/\//g, '-')}.pdf`);
};

const clearSheet = async () => {
    const confirmed = await showConfirm("Clear Sheet", "Are you sure? This action cannot be undone.");
    if (confirmed) {
        loanTableBody.innerHTML = '';
        while (loanTableBody.rows.length < 5) addRow({ no: '', principal: '', date: '' });
        updateAllCalculations();
    }
};

// --- Recent Transactions ---
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
                <button class="btn btn-secondary" onclick="viewReport('${report.id}', false)">View</button>
                <button class="btn btn-primary" onclick="viewReport('${report.id}', true)">Edit</button>
                <button class="btn btn-danger" onclick="deleteReport('${report.id}')">Delete</button>
            </div>`;
        recentTransactionsListEl.appendChild(li);
    });
};

const loadRecentTransactions = async () => {
    if (!user) return;
    let onlineReports = [], localReports = [];
    if (navigator.onLine && reportsCollection) {
        try {
            const snapshot = await reportsCollection.orderBy("createdAt", "desc").get();
            onlineReports = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id, isLocal: false }));
        } catch (error) { console.error("Error loading online reports:", error); }
    }
    if (localDb) {
        localReports = (await localDb.getAll('unsyncedReports')).map(r => ({ ...r, id: r.localId, isLocal: true }));
    }
    cachedReports = [...localReports, ...onlineReports].sort((a, b) =>
        (b.createdAt?.toDate?.() || b.createdAt) - (a.createdAt?.toDate?.() || a.createdAt)
    );
    recentTransactionsLoader.style.display = 'none';
    renderRecentTransactions(reportSearchInput.value);
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

const exitViewMode = () => { setViewMode(false); loadCurrentState(); };

const viewReport = (reportId, isEditable) => {
    const report = cachedReports.find(r => r.id === reportId);
    if (!report) return showConfirm("Error", "Report not found!", false);
    showTab('calculatorTab');
    todayDateEl.value = report.reportDate;
    interestRateEl.value = report.interestRate;
    loanTableBody.innerHTML = '';
    if (report.loans) report.loans.forEach(loan => addRow(loan));
    if (isEditable) { addRow({ no: '', principal: '', date: '' }); setViewMode(false); } else { setViewMode(true); }
    updateAllCalculations();
};

const deleteReport = async (docId) => {
    const confirmed = await showConfirm("Delete Report", "Are you sure you want to permanently delete this report?");
    if (!confirmed) return;
    const reportToDelete = cachedReports.find(r => r.id === docId);
    if (!reportToDelete) return;
    if (reportToDelete.isLocal) {
        await localDb.delete('unsyncedReports', docId);
    } else {
        if (navigator.onLine && reportsCollection) {
            try { await reportsCollection.doc(docId).delete(); } catch (e) { console.error(e); }
        } else {
            await localDb.put('deletionsQueue', { docId });
        }
    }
    loadRecentTransactions();
};

// --- Dashboard ---
const renderDashboard = async () => {
    if (cachedReports.length === 0) await loadRecentTransactions();
    dashboardLoader.style.display = 'none';
    if (cachedReports.length === 0) {
        dashboardMessage.textContent = "No data available. Save some reports to see the dashboard.";
        dashboardMessage.style.display = 'block';
        return;
    }
    dashboardMessage.style.display = 'none';

    let totalPrincipalAll = 0, totalInterestAll = 0;
    cachedReports.forEach(report => {
        totalPrincipalAll += parseFloat(report.totals.principal);
        totalInterestAll += parseFloat(report.totals.interest);
    });

    const pieCtx = document.getElementById('totalsPieChart').getContext('2d');
    if (pieChartInstance) pieChartInstance.destroy();
    pieChartInstance = new Chart(pieCtx, {
        type: 'pie',
        data: { labels: ['Total Principal', 'Total Interest'], datasets: [{ data: [totalPrincipalAll, totalInterestAll], backgroundColor: ['#3D52D5', '#fca311'] }] },
    });

    const barCtx = document.getElementById('principalBarChart').getContext('2d');
    const recentReports = cachedReports.slice(0, 7).reverse();
    if (barChartInstance) barChartInstance.destroy();
    barChartInstance = new Chart(barCtx, {
        type: 'bar',
        data: { labels: recentReports.map(r => r.reportDate), datasets: [{ label: 'Total Principal', data: recentReports.map(r => r.totals.principal), backgroundColor: '#3D52D5' }] },
        options: { scales: { y: { beginAtZero: true } } }
    });
};

// --- Authentication ---
const signInWithGoogle = () => {
    const provider = new firebase.auth.GoogleAuthProvider();
    auth.signInWithPopup(provider).catch(error => {
        console.error("Google Sign-in failed: ", error);
        showConfirm("Sign-In Failed", "Could not sign in with Google. Please ensure pop-ups are not blocked.", false);
    });
};
const signOut = () => auth.signOut();

// --- Initial Load & Event Listeners ---
document.addEventListener('DOMContentLoaded', async () => {
    await initLocalDb();
    updateSyncStatus();

    auth.onAuthStateChanged(firebaseUser => {
        if (firebaseUser) {
            user = firebaseUser;
            reportsCollection = db.collection('reports').doc(user.uid).collection('userReports');
            authStatusEl.textContent = user.displayName || user.email;
            loginOverlay.style.display = 'none';
            appContainer.style.display = 'block';
            loadCurrentState();
            syncData();
            if (document.querySelector('.tab-button.active').dataset.tab === 'recentTransactionsTab') {
                loadRecentTransactions();
            }
        } else {
            user = null; reportsCollection = null; cachedReports = [];
            loginOverlay.style.display = 'flex';
            appContainer.style.display = 'none';
        }
    });

    // Action Listeners
    googleSignInBtn.addEventListener('click', signInWithGoogle);
    signOutBtn.addEventListener('click', signOut);
    addRowBtn.addEventListener('click', () => addRow({ no: '', principal: '', date: '' }));
    printAndSaveBtn.addEventListener('click', printAndSave);
    clearSheetBtn.addEventListener('click', clearSheet);
    exitViewModeBtn.addEventListener('click', exitViewMode);
    exportPdfBtn.addEventListener('click', exportToPDF);
    exportViewPdfBtn.addEventListener('click', exportToPDF);
    scanImageBtn.addEventListener('click', () => imageUploadInput.click());
    imageUploadInput.addEventListener('change', handleImageScan);

    // Modal Listeners
    confirmOkBtn.addEventListener('click', () => closeConfirm(true));
    confirmCancelBtn.addEventListener('click', () => closeConfirm(false));
    confirmModal.addEventListener('click', (e) => { if (e.target === confirmModal) closeConfirm(false); });

    // Tab Listeners
    document.querySelectorAll('.tab-button').forEach(button => {
        button.addEventListener('click', (e) => showTab(e.target.dataset.tab));
    });

    // Input & Search Listeners
    todayDateEl.addEventListener('input', updateAllCalculations);
    interestRateEl.addEventListener('input', updateAllCalculations);
    todayDateEl.addEventListener('blur', (e) => {
        const parsed = parseDate(e.target.value);
        if (parsed) e.target.value = formatDateToDDMMYYYY(parsed);
        updateAllCalculations();
    });
    reportSearchInput.addEventListener('input', e => { renderRecentTransactions(e.target.value); });

    // Offline/Online Listeners
    window.addEventListener('online', updateSyncStatus);
    window.addEventListener('offline', updateSyncStatus);

    // Event Delegation for Loan Table
    loanTableBody.addEventListener('input', e => {
        if (e.target.matches('input')) {
            const currentRow = e.target.closest('tr');
            if (currentRow && currentRow.isSameNode(loanTableBody.lastChild) && (e.target.classList.contains('principal') || e.target.classList.contains('no'))) {
                addRow({ no: '', principal: '', date: '' });
            }
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
});
