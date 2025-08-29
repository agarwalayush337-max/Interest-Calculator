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
let cachedFinalisedReports = [];
let pieChartInstance, barChartInstance;
let initialDashboardLoad = true;
const FINALISED_DELETE_KEY = 'DELETE-FINAL-2025';

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
const dashboardContent = document.getElementById('dashboardContent');
const scanImageBtn = document.getElementById('scanImageBtn');
const imageUploadInput = document.getElementById('imageUploadInput');

// --- Core App Functions ---
async function initLocalDb() {
    localDb = await idb.openDB('interest-calculator-db', 1, {
        upgrade(db) {
            if (!db.objectStoreNames.contains('unsyncedReports')) db.createObjectStore('unsyncedReports', { keyPath: 'localId' });
            if (!db.objectStoreNames.contains('deletionsQueue')) db.createObjectStore('deletionsQueue', { keyPath: 'docId' });
        },
    });
}

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
        } catch (error) { console.error('Failed to sync report:', error); }
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

const parseDate = (dateString) => {
    if (!dateString) return null;
    const parts = String(dateString).match(/(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
    if (!parts) return null;
    let day = parseInt(parts[1], 10), month = parseInt(parts[2], 10), year = parseInt(parts[3], 10);
    if (year < 100) year += 2000;
    return (day > 0 && day <= 31 && month > 0 && month <= 12) ? new Date(year, month - 1, day) : null;
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
        const totalEl = row.querySelector('.total');
        const duration = days360(loanDate, todayDate);
        const interest = calculateInterest(principal, interestRate, duration);
        const roundedInterest = roundToNearest(interest, 5);
        const displayDuration = (duration > 0 && duration < 30) ? 30 : duration;
        durationEl.textContent = displayDuration > 0 ? displayDuration : '';
        interestEl.textContent = roundedInterest > 0 ? Math.round(roundedInterest) : '';
        const rowTotal = principal + roundedInterest;
        totalEl.textContent = rowTotal > 0 ? Math.round(rowTotal) : '';
        totalPrincipal += principal;
        totalInterestRaw += interest;
    });
    const roundedTotalInterest = roundToNearest(totalInterestRaw, 10);
    totalPrincipalEl.textContent = Math.round(totalPrincipal);
    totalInterestEl.textContent = Math.round(roundedTotalInterest);
    finalTotalEl.textContent = Math.round(totalPrincipal + roundedTotalInterest);
    saveCurrentState();
};

const addRow = (loan = { no: '', principal: '', date: '' }) => {
    const rowCount = loanTableBody.rows.length;
    const row = loanTableBody.insertRow();
    row.innerHTML = `<td>${rowCount + 1}</td><td><input type="text" class="no" value="${loan.no}"></td><td><input type="number" class="principal" placeholder="0" value="${loan.principal}"></td><td><input type="text" class="date" placeholder="DD/MM/YYYY" value="${loan.date}"></td><td class="read-only duration"></td><td class="read-only interest"></td><td class="read-only total"></td><td><button class="btn btn-danger" aria-label="Remove Row" onclick="removeRow(this)">X</button></td>`;
    renumberRows();
    updateAllCalculations();
};

const removeRow = (button) => {
    if (loanTableBody.rows.length > 1) {
        button.closest('tr').remove();
        renumberRows();
        updateAllCalculations();
    }
};

const renumberRows = () => document.querySelectorAll('#loanTable tbody tr').forEach((r, i) => r.cells[0].textContent = i + 1);

const cleanAndSortTable = () => {
    Array.from(loanTableBody.querySelectorAll('tr')).forEach(row => {
        if (!row.querySelector('.principal').value.trim() && loanTableBody.rows.length > 1) row.remove();
    });
    const sortedRows = Array.from(loanTableBody.querySelectorAll('tr')).sort((a, b) => a.querySelector('.no').value.trim().localeCompare(b.querySelector('.no').value.trim(), undefined, { numeric: true }));
    sortedRows.forEach(row => loanTableBody.appendChild(row));
    renumberRows();
};

const saveCurrentState = () => {
    if (!user) return;
    const loans = Array.from(document.querySelectorAll('#loanTable tbody tr')).map(row => ({
        no: row.querySelector('.no').value,
        principal: row.querySelector('.principal').value,
        date: row.querySelector('.date').value
    })).filter(loan => loan.no || loan.principal);
    localStorage.setItem(`interestLedgerState_${user.uid}`, JSON.stringify({ todayDate: todayDateEl.value, interestRate: interestRateEl.value, loans }));
};

const loadCurrentState = () => {
    if (!user) return;
    const savedState = JSON.parse(localStorage.getItem(`interestLedgerState_${user.uid}`));
    loanTableBody.innerHTML = '';
    if (savedState) {
        todayDateEl.value = savedState.todayDate || formatDateToDDMMYYYY(new Date());
        interestRateEl.value = savedState.interestRate || '1.75';
        if (savedState.loans?.length > 0) savedState.loans.forEach(addRow);
    } else {
        todayDateEl.value = formatDateToDDMMYYYY(new Date());
    }
    while (loanTableBody.rows.length < 5) addRow();
    if (loanTableBody.lastChild.querySelector('.principal').value) addRow();
    updateAllCalculations();
};

const showTab = async (tabId) => {
    document.querySelectorAll('.tab-content, .tab-button').forEach(el => el.classList.remove('active'));
    document.getElementById(tabId).classList.add('active');
    document.querySelector(`[data-tab="${tabId}"]`).classList.add('active');
    if (user) {
        if (tabId === 'recentTransactionsTab') loadRecentTransactions();
        if (tabId === 'finalisedTransactionsTab') loadFinalisedTransactions();
        if (tabId === 'dashboardTab') {
            dashboardLoader.style.display = 'flex';
            dashboardContent.style.display = 'none';
            await loadFinalisedTransactions();
            if (initialDashboardLoad) {
                document.getElementById('filterCurrentFY').click();
                initialDashboardLoad = false;
            } else {
                filterAndRenderDashboard();
            }
        }
    }
};

const getCurrentLoans = () => Array.from(document.querySelectorAll('#loanTable tbody tr'))
    .map(row => ({
        no: row.querySelector('.no').value,
        principal: row.querySelector('.principal').value,
        date: row.querySelector('.date').value,
        duration: row.querySelector('.duration').textContent,
        interest: row.querySelector('.interest').textContent,
        total: row.querySelector('.total').textContent
    })).filter(loan => loan.principal && parseFloat(loan.principal) > 0);

const printAndSave = async () => {
    cleanAndSortTable();
    updateAllCalculations();
    document.getElementById('printDateHeader').textContent = `Date- ${todayDateEl.value}`;
    document.getElementById('printTableFooter').innerHTML = `<div class="print-footer-item"><div class="print-label">Total Principal</div><div class="print-value">${totalPrincipalEl.textContent}</div></div><div class="print-footer-item"><div class="print-label">Total Interest</div><div class="print-value">${totalInterestEl.textContent}</div></div>`;
    document.getElementById('printFinalTotals').innerHTML = `<div><span>${totalPrincipalEl.textContent}</span> Total Principal</div><div><span>${totalInterestEl.textContent}</span> Total Interest</div><div class="bold"><span>${finalTotalEl.textContent}</span> Total Amount</div>`;
    const loansToSave = getCurrentLoans().map(({ no, principal, date }) => ({ no, principal, date }));
    if (loansToSave.length === 0) return showConfirm("Cannot Save", "Please add at least one loan with a principal amount.", false);
    const reportDate = todayDateEl.value;
    const report = { reportDate, interestRate: interestRateEl.value, loans: loansToSave, createdAt: new Date(), status: 'pending', totals: { principal: totalPrincipalEl.textContent, interest: totalInterestEl.textContent, final: finalTotalEl.textContent } };
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
        await showConfirm("Offline", "Report saved locally.", false);
    }
    window.print();
    loadRecentTransactions();
};

const generateAndExportPDF = () => {
    cleanAndSortTable();
    updateAllCalculations();
    const loans = getCurrentLoans();
    if (loans.length === 0) return showConfirm("Cannot Export", "Please add loan data to export.", false);
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    doc.setFontSize(12).setFont("helvetica", "normal").text(`Date- ${todayDateEl.value}`, 190, 20, { align: 'right' });
    const tableBodyData = loans.map((loan, i) => {
        const principal = parseFloat(loan.principal) || 0;
        const interest = parseFloat(loan.interest) || 0;
        return [i + 1, loan.no, loan.principal, loan.date, loan.duration, loan.interest, String(Math.round(principal + interest))];
    });
    tableBodyData.push([
        { content: 'TOTAL', colSpan: 2, styles: { halign: 'right', fontStyle: 'bold' } },
        { content: totalPrincipalEl.textContent, styles: { halign: 'center', fontStyle: 'bold', fontSize: 11 } },
        '', '',
        { content: totalInterestEl.textContent, styles: { halign: 'center', fontStyle: 'bold', fontSize: 11 } },
        ''
    ]);
    doc.autoTable({ startY: 30, head: [['SL', 'No', 'Principal', 'Date', 'Duration (Days)', 'Interest', 'Total']], body: tableBodyData, theme: 'striped', headStyles: { halign: 'center', fontStyle: 'bold' }, styles: { halign: 'center' } });
    const finalY = doc.autoTable.previous.finalY;
    const numberColumnX = 160, labelColumnX = 165;
    doc.setFontSize(12).setFont("helvetica", "normal");
    doc.text(String(totalPrincipalEl.textContent), numberColumnX, finalY + 17, { align: 'right' }).text('Total Principal', labelColumnX, finalY + 17, { align: 'left' });
    doc.text(String(totalInterestEl.textContent), numberColumnX, finalY + 24, { align: 'right' }).text('Total Interest', labelColumnX, finalY + 24, { align: 'left' });
    doc.setFont("helvetica", "bold").text(String(finalTotalEl.textContent), numberColumnX, finalY + 31, { align: 'right' }).text('Total Amount', labelColumnX, finalY + 31, { align: 'left' });
    doc.save(`Interest_Report_${todayDateEl.value.replace(/\//g, '-')}.pdf`);
};

const clearSheet = async () => {
    if (await showConfirm("Clear Sheet", "Are you sure? This action cannot be undone.")) {
        loanTableBody.innerHTML = '';
        while (loanTableBody.rows.length < 5) addRow();
        updateAllCalculations();
    }
};

const renderRecentTransactions = (filter = '') => {
    recentTransactionsListEl.innerHTML = '';
    const searchTerm = filter.toLowerCase();
    const filteredReports = cachedReports.filter(report => report.reportName?.toLowerCase().includes(searchTerm) || report.loans?.some(loan => loan.no?.toLowerCase().includes(searchTerm) || loan.principal?.toLowerCase().includes(searchTerm)));
    if (filteredReports.length === 0) {
        recentTransactionsListEl.innerHTML = '<li>No matching transactions found.</li>';
        return;
    }
    filteredReports.forEach(report => {
        const li = document.createElement('li');
        if (report.isLocal) li.classList.add('unsynced');
        li.innerHTML = `<span>${report.reportName || `Report from ${report.reportDate}`}</span><div class="button-group"><button class="btn btn-secondary" onclick="viewReport('${report.id}', false)">View</button><button class="btn btn-primary" onclick="viewReport('${report.id}', true)">Edit</button><button class="btn btn-success" onclick="finaliseReport('${report.id}')">Finalise</button><button class="btn btn-danger" onclick="deleteReport('${report.id}')">Delete</button></div>`;
        recentTransactionsListEl.appendChild(li);
    });
};

const loadRecentTransactions = async () => {
    if (!user || !reportsCollection) { recentTransactionsLoader.style.display = 'none'; return; }
    recentTransactionsLoader.style.display = 'flex';
    let onlineReports = [];
    if (navigator.onLine) {
        try {
            const snapshot = await reportsCollection.where("status", "!=", "finalised").orderBy("status").orderBy("createdAt", "desc").get();
            onlineReports = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
        } catch (error) { console.error("Error loading online reports:", error); }
    }
    const localReports = (localDb) ? (await localDb.getAll('unsyncedReports')).map(r => ({ ...r, id: r.localId, isLocal: true })) : [];
    cachedReports = [...localReports, ...onlineReports].sort((a, b) => (b.createdAt?.toDate?.() || 0) - (a.createdAt?.toDate?.() || 0));
    recentTransactionsLoader.style.display = 'none';
    renderRecentTransactions(reportSearchInput.value);
};

const renderFinalisedTransactions = (filter = '') => {
    const listEl = document.getElementById('finalisedTransactionsList');
    listEl.innerHTML = '';
    const searchTerm = filter.toLowerCase();
    const filteredReports = cachedFinalisedReports.filter(report => report.reportName?.toLowerCase().includes(searchTerm) || report.loans?.some(loan => loan.no?.toLowerCase().includes(searchTerm) || loan.principal?.toLowerCase().includes(searchTerm)));
    if (filteredReports.length === 0) {
        listEl.innerHTML = '<li>No finalised transactions found.</li>';
        return;
    }
    filteredReports.forEach(report => {
        const li = document.createElement('li');
        let creationDate = report.createdAt?.toDate()?.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).toLowerCase() || '';
        li.innerHTML = `<div style="flex-grow: 1;"><span style="font-weight: 600;">${report.reportName || `Report from ${report.reportDate}`}</span><div style="font-size: 0.8rem; color: var(--subtle-text-color);">${creationDate}</div></div><div class="button-group"><button class="btn btn-secondary" onclick="viewReport('${report.id}', false, true)">View</button><button class="btn btn-danger" onclick="deleteReport('${report.id}', true)">Delete</button></div>`;
        listEl.appendChild(li);
    });
};

const loadFinalisedTransactions = async () => {
    if (!user || !navigator.onLine) return;
    document.getElementById('finalisedTransactionsLoader').style.display = 'flex';
    try {
        const snapshot = await reportsCollection.where("status", "==", "finalised").get();
        let reports = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
        reports.sort((a, b) => (parseDate(b.reportDate) || 0) - (parseDate(a.reportDate) || 0));
        cachedFinalisedReports = reports;
    } catch (error) { console.error("Error loading finalised reports:", error); }
    document.getElementById('finalisedTransactionsLoader').style.display = 'none';
    renderFinalisedTransactions(document.getElementById('finalisedReportSearchInput').value);
};

const setViewMode = (isViewOnly) => {
    const isEditable = !isViewOnly;
    mainActionBar.style.display = isEditable ? 'flex' : 'none';
    viewModeActionBar.style.display = isViewOnly ? 'flex' : 'none';
    todayDateEl.readOnly = isViewOnly;
    interestRateEl.readOnly = isViewOnly;
    document.querySelectorAll('#loanTable input').forEach(input => input.readOnly = isViewOnly);
    document.querySelectorAll('#loanTable .btn-danger').forEach(btn => btn.style.display = isEditable ? 'inline-flex' : 'none');
};

const exitViewMode = () => { setViewMode(false); loadCurrentState(); };
const viewReport = (reportId, isEditable, isFinalised = false) => {
    const report = (isFinalised ? cachedFinalisedReports : cachedReports).find(r => r.id === reportId);
    if (!report) return showConfirm("Error", "Report not found!", false);
    showTab('calculatorTab');
    todayDateEl.value = report.reportDate;
    interestRateEl.value = report.interestRate;
    loanTableBody.innerHTML = '';
    if (report.loans) report.loans.forEach(addRow);
    setViewMode(!isEditable);
    updateAllCalculations();
};

const finaliseReport = async (docId) => {
    if (!(await showConfirm("Finalise Report", "Are you sure you want to finalise this report? This action cannot be undone."))) return;
    if (navigator.onLine && reportsCollection) {
        try {
            const reportDoc = await reportsCollection.doc(docId).get();
            if (!reportDoc.exists) throw new Error("Report not found.");
            const newName = `Final Hisab Of ${reportDoc.data().reportDate}`;
            await reportsCollection.doc(docId).update({ status: 'finalised', reportName: newName });
            await showConfirm("Success", "The report has been finalised.", false);
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

const deleteReport = async (docId, isFinalised = false) => {
    if (isFinalised) {
        const key = prompt("This is a finalised transaction. Please enter the security key to delete.");
        if (key !== FINALISED_DELETE_KEY) {
            if (key !== null) await showConfirm("Access Denied", "Incorrect security key.", false);
            return;
        }
    }
    if (!(await showConfirm("Delete Report", "Are you sure you want to permanently delete this report?"))) return;
    if (navigator.onLine && reportsCollection) {
        try {
            await reportsCollection.doc(docId).delete();
            await showConfirm("Success", "The report has been deleted.", false);
        } catch (error) {
            console.error("Error deleting report:", error);
            await showConfirm("Error", "Failed to delete report.", false);
        }
    } else {
        await showConfirm("Offline", "You must be online to delete reports.", false);
        return;
    }
    if (isFinalised) loadFinalisedTransactions(); else loadRecentTransactions();
};

const renderDashboard = (reportsToRender) => {
    // ... (This function remains unchanged)
};

const getFinancialYearDates = (yearOffset = 0) => {
    // ... (This function remains unchanged)
};

const formatDateForInput = (date) => {
    // ... (This function remains unchanged)
};

const filterAndRenderDashboard = () => {
    // ... (This function remains unchanged)
};

const signInWithGoogle = () => {
    const provider = new firebase.auth.GoogleAuthProvider();
    auth.signInWithPopup(provider).catch(error => console.error("Google Sign-in failed: ", error));
};
const signOut = () => auth.signOut();

document.addEventListener('DOMContentLoaded', async () => {
    await initLocalDb();
    updateSyncStatus();
    auth.onAuthStateChanged(async (firebaseUser) => {
        if (firebaseUser) {
            const userEmail = firebaseUser.email;
            const userRef = db.collection('allowedUsers').doc(userEmail);
            try {
                const doc = await userRef.get();
                if (doc.exists) {
                    user = firebaseUser;
                    reportsCollection = db.collection('sharedReports');
                    authStatusEl.textContent = user.displayName || user.email;
                    loginOverlay.style.display = 'none';
                    appContainer.style.display = 'block';
                    loadCurrentState();
                    syncData();
                } else {
                    await showConfirm("Access Denied", "You are not authorized to use this application.", false);
                    auth.signOut();
                }
            } catch (error) {
                console.error("Authorization check failed:", error);
                await showConfirm("Error", "An error occurred during authorization.", false);
                auth.signOut();
            }
        } else {
            user = null; reportsCollection = null; cachedReports = [];
            loginOverlay.style.display = 'flex';
            appContainer.style.display = 'none';
        }
    });
    // Setup all event listeners
    googleSignInBtn.addEventListener('click', signInWithGoogle);
    signOutBtn.addEventListener('click', signOut);
    addRowBtn.addEventListener('click', () => addRow());
    printAndSaveBtn.addEventListener('click', printAndSave);
    clearSheetBtn.addEventListener('click', clearSheet);
    exitViewModeBtn.addEventListener('click', exitViewMode);
    exportPdfBtn.addEventListener('click', generateAndExportPDF);
    exportViewPdfBtn.addEventListener('click', generateAndExportPDF);
    scanImageBtn.addEventListener('click', () => imageUploadInput.click());
    imageUploadInput.addEventListener('change', handleImageScan);
    confirmOkBtn.addEventListener('click', () => closeConfirm(true));
    confirmCancelBtn.addEventListener('click', () => closeConfirm(false));
    confirmModal.addEventListener('click', e => { if (e.target === confirmModal) closeConfirm(false); });
    document.querySelectorAll('.tab-button').forEach(button => button.addEventListener('click', e => showTab(e.target.dataset.tab)));
    todayDateEl.addEventListener('input', updateAllCalculations);
    interestRateEl.addEventListener('input', updateAllCalculations);
    todayDateEl.addEventListener('blur', e => { const p = parseDate(e.target.value); if (p) e.target.value = formatDateToDDMMYYYY(p); updateAllCalculations(); });
    reportSearchInput.addEventListener('input', e => renderRecentTransactions(e.target.value));
    document.getElementById('finalisedReportSearchInput').addEventListener('input', e => renderFinalisedTransactions(e.target.value));
    window.addEventListener('online', updateSyncStatus);
    window.addEventListener('offline', updateSyncStatus);
    loanTableBody.addEventListener('input', e => {
        if (e.target.matches('input')) {
            const row = e.target.closest('tr');
            if (row && row.isSameNode(loanTableBody.lastChild) && (e.target.classList.contains('principal') || e.target.classList.contains('no'))) {
                addRow();
            }
            updateAllCalculations();
        }
    });
    loanTableBody.addEventListener('blur', e => { if (e.target.matches('input.date')) { const p = parseDate(e.target.value); if (p) e.target.value = formatDateToDDMMYYYY(p); updateAllCalculations(); } }, true);
    // Dashboard filter listeners
    const startDateFilterEl = document.getElementById('startDateFilter');
    const endDateFilterEl = document.getElementById('endDateFilter');
    startDateFilterEl.addEventListener('change', filterAndRenderDashboard);
    endDateFilterEl.addEventListener('change', filterAndRenderDashboard);
    document.getElementById('filter30Days').addEventListener('click', () => {
        const end = new Date(), start = new Date();
        start.setDate(end.getDate() - 30);
        startDateFilterEl.value = formatDateForInput(start);
        endDateFilterEl.value = formatDateForInput(end);
        filterAndRenderDashboard();
    });
    document.getElementById('filterCurrentFY').addEventListener('click', () => {
        const { startDate, endDate } = getFinancialYearDates(0);
        startDateFilterEl.value = formatDateForInput(startDate);
endDateFilterEl.value = formatDateForInput(endDate);
        filterAndRenderDashboard();
    });
    document.getElementById('filterPrevFY').addEventListener('click', () => {
        const { startDate, endDate } = getFinancialYearDates(-1);
        startDateFilterEl.value = formatDateForInput(startDate);
        endDateFilterEl.value = formatDateForInput(endDate);
        filterAndRenderDashboard();
    });
});
