// --- At the top of the file, BEFORE any other code ---
// Register the Service Worker
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js')
        .then(registration => {
            console.log('Service Worker registered with scope:', registration.scope);
        })
        .catch(error => {
            console.error('Service Worker registration failed:', error);
        });
}

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
let loanSearchCache = new Map();
let pieChartInstance, barChartInstance;
let currentlyEditingReportId = null; 
const FINALISED_DELETE_KEY = 'DELETE-FINAL-2025';
let currentScanCoordinates = []; // Stores the box data from AI
let scanCanvas = null;           // Reference to the canvas
let scanCtx = null;              // Canvas context
let sheetDetailsCache = new Map(); // <--- ADD THIS LINE
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

// --- Image Scanning ---
// Updated: fix formatting (B.673 -> B/673) for Calculator Tab
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
        // --- FORMATTING FIX ---
        // 1. Force Uppercase
        let cleanNo = String(loan.no).toUpperCase();

        // 2. Replace Dot/Space/Dash between Letter and Number with '/'
        // Matches "B.673", "A. 617", "B-673", "B 673"
        cleanNo = cleanNo.replace(/([A-Z])[\.\-\s]+(\d)/g, '$1/$2');

        // 3. (Safety) If it is just "A617" (no separator), add the slash
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
const showTab = (tabId) => {
    document.querySelectorAll('.tab-content, .tab-button').forEach(el => el.classList.remove('active'));
    document.getElementById(tabId).classList.add('active');
    document.querySelector(`[data-tab="${tabId}"]`).classList.add('active');

    if (user) {
        if (tabId === 'recentTransactionsTab') {
            recentTransactionsListEl.innerHTML = '';
            loadRecentTransactions();
        }
        if (tabId === 'finalisedTransactionsTab') {
            document.getElementById('finalisedTransactionsList').innerHTML = '';
            loadFinalisedTransactions();
        }
        if (tabId === 'dashboardTab') {
            if (!dashboardStartDateEl.value || !dashboardEndDateEl.value) {
                const { startDate, endDate } = getFinancialYear();
                dashboardStartDateEl.value = formatDateToDDMMYYYY(startDate);
                dashboardEndDateEl.value = formatDateToDDMMYYYY(endDate);
            }
            renderDashboard();
        }
        if (tabId === 'loanSearchTab') {
            if (loanSearchTableBody.rows.length === 0) {
                for (let i = 0; i < 5; i++) addSearchRow();
            }
            if (cachedFinalisedReports.length === 0) {
                loadFinalisedTransactions().then(buildLoanSearchCache);
            } else {
                buildLoanSearchCache();
            }
        }
    }
};

// --- New helper function to reset the calculator state ---
const resetCalculatorState = () => {
    if (!user) return;
    const defaultLoans = Array(5).fill({ no: '', principal: '', date: '' });
    const liveStateRef = db.collection('liveCalculatorState').doc(user.uid);

    liveStateRef.set({
        todayDate: formatDateToDDMMYYYY(new Date()),
        interestRate: '1.75',
        loans: defaultLoans,
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
    cleanAndSortTable();
    updateAllCalculations(); 
    const loans = getCurrentLoans();
    if (loans.length === 0) {
        showConfirm("Cannot Generate PDF", "Please add loan data to generate a report.", false);
        return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    doc.setFontSize(12);
    doc.setFont("helvetica", "normal");
    doc.text(`Date- ${todayDateEl.value}`, 190, 20, { align: 'right' });

    const tableBodyData = loans.map((loan, i) => {
        const principal = parseFloat(loan.principal) || 0;
        const interest = parseFloat(loan.interest) || 0;
        const total = Math.round(principal + interest);
        return [i + 1, loan.no, loan.principal, loan.date, loan.duration, loan.interest, String(total)];
    });

    tableBodyData.push([
        { content: 'TOTAL', colSpan: 2, styles: { halign: 'right', fontStyle: 'bold' } },
        { content: totalPrincipalEl.textContent, styles: { halign: 'center', fontStyle: 'bold', fontSize: 11 } },
        '', '',
        { content: totalInterestEl.textContent, styles: { halign: 'center', fontStyle: 'bold', fontSize: 11 } },
        ''
    ]);

    doc.autoTable({
        startY: 30,
        head: [['SL', 'No', 'Principal', 'Date', 'Duration (Days)', 'Interest', 'Total']],
        body: tableBodyData,
        theme: 'striped',
        headStyles: { halign: 'center', fontStyle: 'bold' },
        styles: { halign: 'center' }
    });

    const finalY = doc.autoTable.previous.finalY;

    doc.setFontSize(12);
    doc.setFont("helvetica", "normal");
    const numberColumnX = 160;
    const labelColumnX = 165;

    doc.text(String(totalPrincipalEl.textContent), numberColumnX, finalY + 17, { align: 'right' });
    doc.text('Total Principal', labelColumnX, finalY + 17, { align: 'left' });
    doc.text(String(totalInterestEl.textContent), numberColumnX, finalY + 24, { align: 'right' });
    doc.text('Total Interest', labelColumnX, finalY + 24, { align: 'left' });
    doc.setFont("helvetica", "bold");
    doc.text(String(finalTotalEl.textContent), numberColumnX, finalY + 31, { align: 'right' });
    doc.text('Total Amount', labelColumnX, finalY + 31, { align: 'left' });

    const fileName = `Interest_Report_${todayDateEl.value.replace(/\//g, '-')}.pdf`;
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

    // First, check if the browser supports the Web Share API for files
    if (isMobile && navigator.share && navigator.canShare) {
        // Convert the jsPDF document into a blob, then a File object
        const pdfBlob = doc.output('blob');
        const pdfFile = new File([pdfBlob], fileName, { type: 'application/pdf' });

        // Check if the browser can share this specific file
        if (navigator.canShare({ files: [pdfFile] })) {
            try {
                // Open the native share dialog with only the file
                await navigator.share({
                    files: [pdfFile]
                });
                // The return statement exits the function so the fallback code doesn't run
                return; 
            } catch (error) {
                console.error('Share API failed:', error);
                // If sharing fails (e.g., user cancels), we'll proceed to the fallback.
            }
        }
    }

    // --- FALLBACK LOGIC ---
    // This code runs if the Share API isn't supported or fails.
    if (action === 'print' && !isMobile) {
        doc.autoPrint();
        doc.output('dataurlnewwindow');
    } else {
        // Standard download for desktops or older mobile browsers
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
                if (!silent) {
                    // Success message is part of the confirmation to clear
                }
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
                if (!silent) {
                    // Success message is part of the confirmation to clear
                }
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
    // Check if the view-mode action bar is currently visible.
    const isViewMode = viewModeActionBar.style.display !== 'none';

    if (isViewMode) {
        // If in view-only mode, just generate the PDF from the visible data.
        generatePDF('save');
    } else {
        // If in edit mode, save silently first, then generate the PDF.
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

// NEW function to add to script.js
const clearSearchTable = async () => {
    const confirmed = await showConfirm(
        "Clear Search Sheet", 
        "Are you sure you want to clear all search rows?"
    );
    if (confirmed) {
        // Clear the existing rows
        loanSearchTableBody.innerHTML = '';
        // Add 5 new empty rows to start with
        for (let i = 0; i < 5; i++) {
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
    if (!user || !reportsCollection) {
        recentTransactionsLoader.style.display = 'none';
        return;
    }
    recentTransactionsLoader.style.display = 'flex';
    let onlineReports = [], localReports = [];
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
    cachedReports = [...local, ...onlineReports].sort((a, b) => {
        const dateA = a.createdAt?.toDate?.() || 0;
        const dateB = b.createdAt?.toDate?.() || 0;
        return dateB - dateA;
    });
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
    document.getElementById('finalisedTransactionsLoader').style.display = 'flex';
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

    // Smart "Back" button logic
    if (originTab === 'loanSearchTab') {
        exitViewModeBtn.textContent = 'Back to Loan Search';
        exitViewModeBtn.onclick = () => {
            showTab('loanSearchTab');
            restoreDefaultBackButton();
        };
    } else if (originTab === 'recentTransactionsTab') {
        exitViewModeBtn.textContent = 'Back to Recent';
        exitViewModeBtn.onclick = () => {
            showTab('recentTransactionsTab');
            restoreDefaultBackButton();
        };
    } else if (originTab === 'finalisedTransactionsTab') {
        exitViewModeBtn.textContent = 'Back to Finalised';
        exitViewModeBtn.onclick = () => {
            showTab('finalisedTransactionsTab');
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

const finaliseReport = async (docId) => {
    const confirmed = await showConfirm("Finalise Report", "Are you sure you want to finalise this report? This action cannot be undone.");
    if (!confirmed) return;
    if (navigator.onLine && reportsCollection) {
        try {
            const reportDoc = await reportsCollection.doc(docId).get();
            if (!reportDoc.exists) throw new Error("Report not found.");
            const reportData = reportDoc.data();
            const newName = `Final Hisab of ${reportData.reportDate}`;
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
            if (key !== null) { 
                await showConfirm("Access Denied", "The security key is incorrect. Deletion cancelled.", false);
            }
            return;
        }
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
// NEW: Helper function to normalize loan numbers (e.g., A/052 -> A/52)
// Updated: Aggressive Normalizer (Fixes Matching Issues)
const normalizeLoanNo = (loanNo) => {
    if (!loanNo) return '';
    // This regex finds a non-digit prefix and a digit suffix.
    const match = loanNo.match(/^(\D*)(\d+)$/);
    if (match) {
        const prefix = match[1]; // e.g., "A/"
        const numericPart = parseInt(match[2], 10).toString(); // e.g., "052" -> 52 -> "52"
        return prefix + numericPart;
    }
    return loanNo; // Return original if it doesn't match the pattern
};

// Updated: Rebuilds cache using the new Normalizer
const buildLoanSearchCache = () => {
    loanSearchCache.clear();
    if (cachedFinalisedReports.length === 0) return;

    console.log("Building Cache..."); // Debug Log

    cachedFinalisedReports.forEach(report => {
        if (report.loans && Array.isArray(report.loans)) {
            report.loans.forEach(loan => {
                const originalLoanNo = loan.no?.trim();
                if (originalLoanNo) {
                    // Use the NEW normalizer
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

// Updated: addSearchRow saves coordinates in memory
const addSearchRow = (loanNo = '', box = null) => {
    const rowCount = loanSearchTableBody.rows.length;
    const row = loanSearchTableBody.insertRow();
    
    // SAVE COORDINATES DIRECTLY TO THE ROW OBJECT
    if (box) {
        row.eraseBox = box; // Store raw array
    }

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

const performLoanSearch = (inputElement) => {
    if (!inputElement) return;
    
    const row = inputElement.closest('tr');
    const userInput = inputElement.value.trim().toUpperCase();
    const principalCell = row.querySelector('.principal-result');
    const dateCell = row.querySelector('.date-result');
    const statusCell = row.querySelector('.status-cell');

    principalCell.textContent = '';
    dateCell.textContent = '';
    statusCell.innerHTML = '';
    statusCell.className = 'read-only status-cell';

    if (!userInput) return;

    const normalizedSearchTerm = normalizeLoanNo(userInput);

    if (loanSearchCache.has(normalizedSearchTerm)) {
        const data = loanSearchCache.get(normalizedSearchTerm);
        principalCell.textContent = data.principal;
        dateCell.textContent = data.reportDate;
        statusCell.classList.add('status-not-available');
        statusCell.innerHTML = `
            <span>Not Available</span>
            <button class="btn btn-secondary btn-sm btn-flat-sm" onclick="viewReport('${data.reportId}', false, true, 'loanSearchTab')">
                View Report
            </button>`;
    } else {
        statusCell.classList.add('status-available');
        statusCell.textContent = 'Available';
    }
};

// Updated: Handle Image Scan to draw on Canvas
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
            
            // Store coordinates for erasing later
            currentScanCoordinates = result.loanNumbers || [];
            
            fillSearchTableFromScan(result.loanNumbers);
            
            // Show the download button
            document.getElementById('downloadErasedBtn').style.display = 'inline-flex';

        } catch (error) {
            closeConfirm();
            await showConfirm('Error', error.message, false);
        }
    };
    reader.readAsDataURL(file);
    numberImageUploadInput.value = '';
};

// Updated: Uses row.eraseBox to find what to erase
// Updated: Main Logic with Debugging
// Updated: Restored original "Scan Complete" message format
// Updated: Combines Erasing (Existing) with Annotation (New)
const fillSearchTableFromScan = async (loanData) => {
    
    // 1. Force-Load Sheet if needed
    const sheetUrl = document.getElementById('publicSheetInput').value.trim();
    if (sheetUrl && sheetDetailsCache.size === 0) {
        await fetchSheetData(sheetUrl);
    }

    // 2. Build Cache & Safety Checks
    buildLoanSearchCache(); 

    if (!loanData || loanData.length === 0) {
        showConfirm('Scan Results', 'No numbers found.', false);
        return;
    }

    // 3. Clear & Repopulate Table
    document.querySelectorAll('#loanSearchTable .search-no').forEach(input => {
        if (!input.value.trim()) input.closest('tr').remove();
    });

    loanData.forEach(item => {
        addSearchRow(item.no, item.box);
    });

    // 4. Process Each Item
    const inputs = document.querySelectorAll('#loanSearchTable .search-no');
    let erasedCount = 0;
    let annotatedCount = 0;

    inputs.forEach((input) => {
        const rawValue = input.value;
        const normalizedKey = normalizeLoanNo(rawValue);
        
        performLoanSearch(input); 

        const row = input.closest('tr');
        const statusCell = row.querySelector('.status-cell');
        
        // --- LOGIC START ---
        
        // A. If "Not Available" -> ERASE (Uses your existing perfect eraser)
        if (statusCell && statusCell.classList.contains('status-not-available')) {
            if (row.eraseBox) {
                eraseRegion(row.eraseBox);
                erasedCount++;
            }
        }
        
        // B. If "Available" -> ANNOTATE (New Logic)
        else if (statusCell && statusCell.classList.contains('status-available')) {
            // Check if we have details for this number in the Sheet
            if (sheetDetailsCache.has(normalizedKey)) {
                const details = sheetDetailsCache.get(normalizedKey);
                
                // Only annotate if we have coordinates
                if (row.eraseBox) {
                    annotateLoanDetails(row.eraseBox, details);
                    annotatedCount++;
                }
            }
        }
        // --- LOGIC END ---
    });

    renumberSearchRows();
    
    // Status Message
    let msg = `Found ${loanData.length} numbers.`;
    if (erasedCount > 0) msg += ` Erased ${erasedCount}.`;
    if (annotatedCount > 0) msg += ` Annotated ${annotatedCount}.`;
    
    showConfirm('Scan Complete', msg, false);
};
// NEW: Function to draw white box over coordinates
// NEW: Intelligent Erase with Background Color Matching
// NEW: "Clone Stamp" Eraser (Copies background texture instead of painting solid color)
// NEW: "Full Width" Paper Texture Cloner
// Updated: "Full Width" Texture Cloner with Safety Checks
// FIXED: Robust "Full Width" Eraser (Uses Image Stretching)
// FIXED: "Smart Edge" Eraser (Avoids black borders)
// NEW: "Pixel-by-Pixel" Vertical Healing (The Perfectionist Method)

// FIXED: "Safe Stretch" Eraser (Reverted to best logic + Safety Adjustments)
// FIXED: "Adaptive Stretch" Eraser (Scales perfectly to line size)
const eraseRegion = (box) => {
    if (!scanCtx || !scanCanvas || !box) return;

    // 1. Get Coordinates
    const ymin = Math.max(0, box[0]);
    const ymax = Math.min(1000, box[2]);
    if (ymax <= ymin) return;

    // 2. Convert to pixels
    const y = Math.floor((ymin / 1000) * scanCanvas.height);
    const h = Math.ceil(((ymax - ymin) / 1000) * scanCanvas.height);

    // --- ADAPTIVE PADDING ---
    // Instead of a huge fixed number (like 35px), we take a percentage.
    // We add 12% padding to the top and bottom.
    // If the line is 50px tall, this adds 6px. It scales automatically.
    const padding = Math.ceil(h * 0.12); 
    
    // Apply the calculated padding
    const drawY = Math.max(0, y - padding);
    const drawH = h + (padding * 2);

    try {
        // --- SAFE ZONE STRATEGY ---
        // Sample from 92% width (Safe from black borders, but still empty paper)
        const safeMargin = Math.floor(scanCanvas.width * 0.92); 
        const sampleW = 30;

        // Capture clean paper texture
        const texture = scanCtx.getImageData(safeMargin, drawY, sampleW, drawH);
        
        const tempC = document.createElement('canvas');
        tempC.width = sampleW;
        tempC.height = drawH;
        tempC.getContext('2d').putImageData(texture, 0, 0);

        // Stretch it across the line
        scanCtx.drawImage(
            tempC, 
            0, 0, sampleW, drawH, 
            0, drawY, scanCanvas.width, drawH 
        );

    } catch (e) {
        // Fallback
        scanCtx.fillStyle = '#fff';
        scanCtx.fillRect(0, drawY, scanCanvas.width, drawH);
    }
};
// Remove any old event listeners (safety)
const downloadBtn = document.getElementById('downloadErasedBtn');
if (downloadBtn) {
    // We use .onclick = function ... this overwrites any previous clicks!
    downloadBtn.onclick = function() {
        if (!scanCanvas) {
            showConfirm("Error", "No image to download.", false);
            return;
        }

        scanCanvas.toBlob((blob) => {
            if (!blob) return;

            const fileName = `Erased_List_${Date.now()}.png`;
            const file = new File([blob], fileName, { type: 'image/png' });
            
            const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

            if (isMobile) {
                // MOBILE LOGIC: Share Sheet
                if (navigator.canShare && navigator.canShare({ files: [file] })) {
                    navigator.share({
                        files: [file],
                        title: 'Filtered Loan List'
                    }).catch(console.error);
                } else {
                    // Mobile Fallback
                    const link = document.createElement('a');
                    link.href = URL.createObjectURL(blob);
                    link.download = fileName;
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                }
            } else {
                // PC LOGIC: Direct Download ONLY
                const link = document.createElement('a');
                link.href = URL.createObjectURL(blob);
                link.download = fileName;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
            }
        }, 'image/png', 1.0);
    };
}
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

// --- Dashboard ---
const renderDashboard = async () => {
    dashboardLoader.style.display = 'block';
    dashboardMessage.style.display = 'none';
    if (pieChartInstance) pieChartInstance.destroy();
    if (barChartInstance) barChartInstance.destroy();

    if (!user || !navigator.onLine) {
        dashboardMessage.textContent = "Dashboard requires an internet connection to view finalised reports.";
        dashboardMessage.style.display = 'block';
        dashboardLoader.style.display = 'none';
        return;
    }
    
    await loadFinalisedTransactions();

    const startDate = parseDate(dashboardStartDateEl.value);
    const endDate = parseDate(dashboardEndDateEl.value);

    if (!startDate || !endDate) {
        dashboardMessage.textContent = "Please select a valid start and end date to see the dashboard.";
        dashboardMessage.style.display = 'block';
        dashboardLoader.style.display = 'none';
        return;
    }

    const filteredReports = cachedFinalisedReports.filter(report => {
        const reportDate = parseDate(report.reportDate);
        return reportDate && reportDate >= startDate && reportDate <= endDate;
    });

    dashboardLoader.style.display = 'none';
    
    if (filteredReports.length === 0) {
        dashboardMessage.textContent = "No finalised data available for the selected date range.";
        dashboardMessage.style.display = 'block';
        return;
    }

    dashboardMessage.style.display = 'none';
    let totalPrincipalAll = 0, totalInterestAll = 0;
    
    filteredReports.forEach(report => {
        totalPrincipalAll += parseFloat(report.totals.principal) || 0;
        totalInterestAll += parseFloat(report.totals.interest) || 0;
    });

    const pieCtx = document.getElementById('totalsPieChart').getContext('2d');
    pieChartInstance = new Chart(pieCtx, {
        type: 'pie',
        data: { labels: ['Total Principal', 'Total Interest'], datasets: [{ data: [totalPrincipalAll, totalInterestAll], backgroundColor: ['#3D52D5', '#fca311'] }] },
    });

    const barCtx = document.getElementById('principalBarChart').getContext('2d');
    const recentReports = filteredReports.slice(0, 7).reverse();
    barChartInstance = new Chart(barCtx, {
        type: 'bar',
        data: { 
            labels: recentReports.map(r => r.reportDate), 
            datasets: [{ 
                label: 'Total Principal', 
                data: recentReports.map(r => r.totals.principal), 
                backgroundColor: '#3D52D5' 
            }] 
        },
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
        lastUpdatedBy: sessionClientId
    };

    const liveStateRef = db.collection('liveCalculatorState').doc(user.uid);
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
            if (state.lastUpdatedBy === sessionClientId) {
                return;
            }

            isUpdatingFromListener = true;

            todayDateEl.value = state.todayDate || formatDateToDDMMYYYY(new Date());
            interestRateEl.value = state.interestRate || '1.75';
            
            loanTableBody.innerHTML = '';
            if (state.loans && state.loans.length > 0) {
                state.loans.forEach(loan => addRow(loan));
            }
            while (loanTableBody.rows.length < 5) {
                addRow({ no: '', principal: '', date: '' });
            }
             if (loanTableBody.rows.length > 0 && loanTableBody.lastChild.querySelector('.principal').value) { 
                 addRow({ no: '', principal: '', date: '' }); 
             }
        } else {
            todayDateEl.value = formatDateToDDMMYYYY(new Date());
            interestRateEl.value = '1.75';
            loanTableBody.innerHTML = '';
            for (let i = 0; i < 5; i++) {
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

// --- Initial Load & Event Listeners ---
document.addEventListener('DOMContentLoaded', async () => {
    await initLocalDb();
    updateSyncStatus();
    auth.onAuthStateChanged(async (firebaseUser) => {
        if (firebaseUser) {
            user = firebaseUser;
            reportsCollection = db.collection('sharedReports');
            authStatusEl.textContent = user.displayName || user.email;
            loginOverlay.style.display = 'none';
            appContainer.style.display = 'block';
            
            listenForLiveStateChanges(); 
            syncData();

        } else {
            user = null;
            currentlyEditingReportId = null;
            reportsCollection = null;
            cachedReports = [];
            loginOverlay.style.display = 'flex';
            appContainer.style.display = 'none';
            if (liveStateUnsubscribe) {
                liveStateUnsubscribe();
                liveStateUnsubscribe = null;
            }
        }
    });
    googleSignInBtn.addEventListener('click', signInWithGoogle);
    signOutBtn.addEventListener('click', signOut);
    addRowBtn.addEventListener('click', () => addRow({ no: '', principal: '', date: '' }));
    saveBtn.addEventListener('click', () => saveReport(false));
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
    loanTableBody.addEventListener('input', e => {
        if (e.target.matches('input')) {
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
    addSearchRowBtn.addEventListener('click', () => addSearchRow());
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
});

// ======================================================
// PASTE THIS AT THE VERY END OF SCRIPT.JS
// (Fixed: Uses "Publish to Web" for 100% Reliability)
// ======================================================

// Ensure the cache variable exists (prevents crash if declared earlier)
if (typeof sheetDetailsCache === 'undefined') {
    var sheetDetailsCache = new Map();
}

// 1. DATA FETCHER (Strict "Publish to Web" Logic)
const fetchSheetData = async (url) => {
    const statusEl = document.getElementById('sheetStatus');
    const inputEl = document.getElementById('publicSheetInput');
    
    // Add timestamp to prevent browser caching old data
    const cleanUrl = url.trim();
    const uniqueUrl = cleanUrl + (cleanUrl.includes('?') ? '&' : '?') + `t=${Date.now()}`;
    
    if(statusEl) {
        statusEl.textContent = "⏳ Downloading...";
        statusEl.style.color = "#d35400";
    }

    try {
        const response = await fetch(uniqueUrl);
        
        // 1. Check for Network Errors
        if (!response.ok) throw new Error(`Connection Error (${response.status})`);
        
        const text = await response.text();
        
        // 2. Check for Privacy/Login Errors
        // If Google sends back HTML login page instead of CSV data
        if (text.trim().startsWith("<!DOCTYPE html>") || text.includes("<html")) {
            throw new Error("Sheet is Private. Use 'File > Share > Publish to web'.");
        }

        const rows = text.split('\n');
        sheetDetailsCache.clear();
        
        rows.forEach(row => {
            // Regex handles commas inside quotes (standard CSV format)
            const cols = row.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/); 
            if (cols.length >= 2) {
                // Remove quotes from Excel
                const rawNo = cols[0].replace(/^"|"$/g, '').trim(); 
                const cleanNo = normalizeLoanNo(rawNo); 
                const details = cols.slice(1).join(',').replace(/^"|"$/g, '').trim();

                if (cleanNo && details) {
                    sheetDetailsCache.set(cleanNo, details);
                }
            }
        });

        console.log(`Loaded ${sheetDetailsCache.size} details.`);
        if(statusEl) {
            statusEl.textContent = `✅ Active: ${sheetDetailsCache.size} records.`;
            statusEl.style.color = "var(--success-color)";
        }
        if(inputEl) inputEl.style.borderColor = "var(--success-color)";
        
        return true;

    } catch (error) {
        console.error("Sheet Error:", error);
        if(statusEl) {
            statusEl.textContent = "❌ Error. See Console.";
            statusEl.style.color = "var(--danger-color)";
        }
        if(inputEl) inputEl.style.borderColor = "var(--danger-color)";
        
        // Detailed Alert
        showConfirm("Link Error", 
            `Could not read the Google Sheet.\n\nReason: ${error.message}\n\nSOLUTION:\n1. Go to File > Share > Publish to web.\n2. Select 'Comma-separated values (.csv)'.\n3. Paste THAT link here.`, 
            false
        );
        return false;
    }
};

// 2. INPUT HANDLER (Auto-Saves Link)
const saveAndLoadSheet = (url) => {
    if (!url) return;
    localStorage.setItem('publicSheetUrl', url.trim());
    fetchSheetData(url.trim());
};

// 3. ANNOTATION DRAWING (Black Text)
const annotateLoanDetails = (box, text) => {
    if (!scanCtx || !scanCanvas || !box) return;

    const ymin = Math.max(0, box[0]);
    const xmax = Math.min(1000, box[3]); 
    
    const y = Math.floor((ymin / 1000) * scanCanvas.height);
    const x = Math.floor((xmax / 1000) * scanCanvas.width);
    const h = Math.ceil(((box[2] - ymin) / 1000) * scanCanvas.height);

    // Dynamic Font Size (60% of line height)
    const fontSize = Math.max(16, Math.floor(h * 0.60)); 
    scanCtx.font = `bold ${fontSize}px sans-serif`;
    
    // COLOR: Black
    scanCtx.fillStyle = "#000000"; 
    scanCtx.textBaseline = "middle";

    // Draw text with 40px padding to the right
    scanCtx.fillText(text, x + 40, y + (h / 2));
};

// 4. MAIN SCANNER (The Brain)
const fillSearchTableFromScan = async (loanData) => {
    
    // A. Attempt to Load Sheet Data
    const inputEl = document.getElementById('publicSheetInput');
    const sheetUrl = inputEl ? inputEl.value.trim() : '';
    
    // Only fetch if we have a URL and haven't loaded data yet
    if (sheetUrl && sheetDetailsCache.size === 0) {
        const success = await fetchSheetData(sheetUrl);
        if (!success) {
            // If fetching failed, we pause to let the user know, but continue processing numbers
            console.warn("Continuing scan without annotations due to sheet error.");
        }
    }

    // B. Standard Search Prep
    buildLoanSearchCache(); 

    if (!loanData || loanData.length === 0) {
        showConfirm('Scan Results', 'No numbers found.', false);
        return;
    }

    // Clear UI
    document.querySelectorAll('#loanSearchTable .search-no').forEach(input => {
        if (!input.value.trim()) input.closest('tr').remove();
    });

    // Populate Table
    loanData.forEach(item => {
        addSearchRow(item.no, item.box);
    });

    // C. Process Items (Erase & Annotate)
    const inputs = document.querySelectorAll('#loanSearchTable .search-no');
    let erasedCount = 0;
    let annotatedCount = 0;

    inputs.forEach((input) => {
        const rawValue = input.value;
        const normalizedKey = normalizeLoanNo(rawValue);
        
        performLoanSearch(input); 

        const row = input.closest('tr');
        const statusCell = row.querySelector('.status-cell');
        
        // 1. ERASE (Orange)
        if (statusCell && statusCell.classList.contains('status-not-available')) {
            if (row.eraseBox) {
                eraseRegion(row.eraseBox);
                erasedCount++;
            }
        }
        
        // 2. ANNOTATE (Green)
        else if (statusCell && statusCell.classList.contains('status-available')) {
            // Check cache for details
            if (sheetDetailsCache.has(normalizedKey)) {
                const details = sheetDetailsCache.get(normalizedKey);
                if (row.eraseBox) {
                    annotateLoanDetails(row.eraseBox, details);
                    annotatedCount++;
                }
            }
        }
    });

    renumberSearchRows();
    
    let msg = `Found ${loanData.length} numbers.`;
    if (erasedCount > 0) msg += ` Erased ${erasedCount}.`;
    if (annotatedCount > 0) msg += ` Annotated ${annotatedCount}.`;
    
    showConfirm('Scan Complete', msg, false);
};

// 5. STARTUP LISTENER (Restores Link)
document.addEventListener('DOMContentLoaded', () => {
    const savedUrl = localStorage.getItem('publicSheetUrl');
    const inputEl = document.getElementById('publicSheetInput');
    
    if (savedUrl && inputEl) {
        inputEl.value = savedUrl;
        // Trigger fetch immediately
        fetchSheetData(savedUrl);
    }
});
