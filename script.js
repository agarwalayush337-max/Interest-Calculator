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
let lastSavedReportState = null; // Variable to track the last saved state

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
const mainActionBar = document.getElementById('mainActionBar');
const viewModeActionBar = document.getElementById('viewModeActionBar');
const googleSignInBtn = document.getElementById('googleSignInBtn');
const loginMessage = document.getElementById('loginMessage');
const signOutBtn = document.getElementById('signOutBtn');
const addRowBtn = document.getElementById('addRowBtn');
const saveReportBtn = document.getElementById('saveReportBtn');
const printReportBtn = document.getElementById('printReportBtn');
const clearSheetBtn = document.getElementById('clearSheetBtn');
const exitViewModeBtn = document.getElementById('exitViewModeBtn');


// --- Smart Date Parsing ---
const parseDate = (dateString) => {
    if (!dateString) return null;
    const parts = dateString.match(/(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
    if (!parts) return null;
    
    let day = parseInt(parts[1], 10);
    let month = parseInt(parts[2], 10);
    let year = parseInt(parts[3], 10);

    if (year < 100) {
         year += (new Date().getFullYear() - (new Date().getFullYear() % 100)) - (year > (new Date().getFullYear() % 100) ? 100 : 0);
    }
    
    if (day > 0 && day <= 31 && month > 0 && month <= 12) {
        return new Date(year, month - 1, day);
    }
    return null;
};

const formatDateToDDMMYYYY = (date) => {
    if (!date || isNaN(date.getTime())) return '';
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
};

// --- Calculation Logic ---
const roundToNearest = (num, nearest) => Math.round(num / nearest) * nearest;

const days360 = (startDate, endDate) => {
    if (!startDate || !endDate || startDate > endDate) return 0;

    let d1 = startDate.getDate();
    let m1 = startDate.getMonth() + 1;
    let y1 = startDate.getFullYear();

    let d2 = endDate.getDate();
    let m2 = endDate.getMonth() + 1;
    let y2 = endDate.getFullYear();

    if (d1 === 31) d1 = 30;
    if (d2 === 31 && d1 === 30) d2 = 30;

    return (y2 - y1) * 360 + (m2 - m1) * 30 + (d2 - d1);
};


const calculateInterest = (principal, rate, durationInDays) => {
    const effectiveDuration = (durationInDays > 0 && durationInDays < 30) ? 30 : durationInDays;
    const monthlyRate = rate / 100;
    const dailyRate = monthlyRate / 30;
    return principal * dailyRate * effectiveDuration;
};

const updateAllCalculations = () => {
    const todayDate = parseDate(todayDateEl.value);
    const interestRate = parseFloat(interestRateEl.value) || 0;
    
    let totalPrincipal = 0;
    let totalInterestRaw = 0;

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
        <td><button class="btn btn-danger" onclick="removeRow(this)">X</button></td>
    `;
    
    const dateInput = row.querySelector('.date');
    dateInput.addEventListener('blur', (e) => {
        const parsed = parseDate(e.target.value);
        if (parsed) e.target.value = formatDateToDDMMYYYY(parsed);
        updateAllCalculations();
    });

    const inputs = row.querySelectorAll('input.no, input.principal');
    inputs.forEach(input => {
        input.addEventListener('input', (e) => {
            const currentRow = e.target.closest('tr');
            if (currentRow.isSameNode(loanTableBody.lastChild)) {
                addRow();
            }
            updateAllCalculations();
        });
    });
    dateInput.addEventListener('input', updateAllCalculations);
};

const removeRow = (button) => {
    const row = button.closest('tr');
    if (loanTableBody.rows.length > 1) {
        row.remove();
        renumberRows();
        updateAllCalculations();
    }
};

const renumberRows = () => {
    document.querySelectorAll('#loanTable tbody tr').forEach((r, index) => {
        r.cells[0].textContent = index + 1;
    });
};

const cleanAndSortTable = () => {
    const rows = Array.from(loanTableBody.querySelectorAll('tr'));
    rows.forEach(row => {
        const noVal = row.querySelector('.no').value.trim();
        const principalVal = row.querySelector('.principal').value.trim();
        if (!noVal && !principalVal && loanTableBody.rows.length > 1) {
           row.remove();
        }
    });
    
    const sortedRows = Array.from(loanTableBody.querySelectorAll('tr'));
    sortedRows.sort((a, b) => {
        const valA = a.querySelector('.no').value.trim().toLowerCase();
        const valB = b.querySelector('.no').value.trim().toLowerCase();
        return valA.localeCompare(valB, undefined, {numeric: true, sensitivity: 'base'});
    });

    sortedRows.forEach(row => loanTableBody.appendChild(row));
    renumberRows();
    updateAllCalculations();
    saveCurrentState();
};

// --- State Management (Local Storage for active state) ---
const saveCurrentState = () => {
    if (!user) return;
    const loans = Array.from(document.querySelectorAll('#loanTable tbody tr'))
        .map(row => ({
            no: row.querySelector('.no').value,
            principal: row.querySelector('.principal').value,
            date: row.querySelector('.date').value
        }))
        .filter(loan => loan.no || loan.principal);

    const currentState = {
        todayDate: todayDateEl.value,
        interestRate: interestRateEl.value,
        loans: loans
    };
    localStorage.setItem(`interestLedgerState_${user.uid}`, JSON.stringify(currentState));
};

const loadCurrentState = () => {
    if (!user) return;
    const savedState = JSON.parse(localStorage.getItem(`interestLedgerState_${user.uid}`));
    loanTableBody.innerHTML = '';
    if (savedState) {
        todayDateEl.value = savedState.todayDate || formatDateToDDMMYYYY(new Date());
        interestRateEl.value = savedState.interestRate || '1.75';
        if (savedState.loans && savedState.loans.length > 0) {
            savedState.loans.forEach(loan => addRow(loan));
        }
    } else {
        todayDateEl.value = formatDateToDDMMYYYY(new Date());
    }
    
    while(loanTableBody.rows.length < 5) {
        addRow();
    }

    if (loanTableBody.rows.length > 0 && !loanTableBody.lastChild.querySelector('.principal').value) {
        // all good, there's an empty row
    } else {
         addRow();
    }

    updateAllCalculations();
};

// --- Tabs ---
const showTab = (tabId) => {
    document.querySelectorAll('.tab-content, .tab-button').forEach(el => el.classList.remove('active'));
    document.getElementById(tabId).classList.add('active');
    document.querySelector(`[data-tab="${tabId}"]`).classList.add('active');
    
    if (tabId === 'recentTransactionsTab' && user) {
        loadRecentTransactions();
    }
};

// --- Save, Print, and Clear ---
const getCurrentLoans = () => {
    return Array.from(document.querySelectorAll('#loanTable tbody tr'))
        .map(row => ({
            no: row.querySelector('.no').value,
            principal: row.querySelector('.principal').value,
            date: row.querySelector('.date').value,
            duration: row.querySelector('.duration').textContent,
            interest: row.querySelector('.interest').textContent
        }))
        .filter(loan => loan.principal);
};

const saveReport = async (isSilent = false) => {
    if (!reportsCollection) {
        if (!isSilent) alert("Database not connected. Please wait.");
        return { success: false };
    }
    
    cleanAndSortTable();
    const loans = getCurrentLoans();

    if (loans.length === 0) {
        if (!isSilent) alert("Please add at least one loan with a principal amount to save a report.");
        return { success: false };
    }

    const baseName = `Summary of ${todayDateEl.value}`;
    const querySnapshot = await reportsCollection.where("reportDate", "==", todayDateEl.value).get();
    const count = querySnapshot.size;
    const reportName = count > 0 ? `${baseName} (${count + 1})` : baseName;

    const report = {
        reportName: reportName,
        reportDate: todayDateEl.value,
        interestRate: interestRateEl.value,
        loans: loans,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        totals: {
            principal: totalPrincipalEl.textContent,
            interest: totalInterestEl.textContent,
            final: finalTotalEl.textContent
        }
    };
    
    try {
        const docRef = await reportsCollection.add(report);
        lastSavedReportState = JSON.stringify(loans); // Track the state of what was just saved
        if (!isSilent) alert(`Report "${reportName}" saved successfully!`);
        return { success: true };
    } catch (error) {
        console.error("Error saving report: ", error);
        if (!isSilent) alert("Could not save report to the database.");
        return { success: false };
    }
};

const printReport = () => {
    cleanAndSortTable();
    document.getElementById('printTitle').textContent = `Interest Report`;
    document.getElementById('printDate').textContent = `As of ${todayDateEl.value}`;
    window.print();
};

const clearSheet = async () => {
    const currentLoans = getCurrentLoans();
    const isSheetDirty = JSON.stringify(currentLoans) !== lastSavedReportState;

    if (currentLoans.length > 0 && isSheetDirty) {
        if (confirm("You have unsaved changes. Do you want to save them before clearing the sheet?")) {
            const saveResult = await saveReport(true); // Save silently
            if (!saveResult.success) {
                alert("Could not save the report. Sheet will not be cleared.");
                return;
            }
        }
    }
    
    loanTableBody.innerHTML = '';
    while(loanTableBody.rows.length < 5) {
        addRow();
    }
    updateAllCalculations();
};


// --- Recent Transactions ---
const loadRecentTransactions = () => {
    if (!reportsCollection) {
        recentTransactionsListEl.innerHTML = '<li>Connecting to database...</li>';
        return;
    }

    recentTransactionsListEl.innerHTML = '<li>Loading reports...</li>';
    reportsCollection.orderBy("createdAt", "desc").get().then(querySnapshot => {
        recentTransactionsListEl.innerHTML = '';
        if (querySnapshot.empty) {
            recentTransactionsListEl.innerHTML = '<li>No saved transactions yet.</li>';
            return;
        }
        querySnapshot.forEach(doc => {
            const report = doc.data();
            const li = document.createElement('li');
            li.innerHTML = `
                <span>${report.reportName || `Report from ${report.reportDate}`}</span>
                <div class="button-group">
                    <button class="btn btn-secondary" onclick="viewReport('${doc.id}', false)">View</button>
                    <button class="btn btn-primary" onclick="viewReport('${doc.id}', true)">Edit</button>
                    <button class="btn btn-danger" onclick="deleteReport('${doc.id}')">Delete</button>
                </div>
            `;
            recentTransactionsListEl.appendChild(li);
        });
    }).catch(error => {
        console.error("Error loading reports: ", error);
        recentTransactionsListEl.innerHTML = '<li>Could not load reports.</li>';
    });
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
        if(deleteBtn) deleteBtn.style.display = isEditable ? 'inline-flex' : 'none';
    });
};

const exitViewMode = () => {
    setViewMode(false);
    loadCurrentState();
};

const viewReport = (docId, isEditable) => {
    reportsCollection.doc(docId).get().then(doc => {
        if (!doc.exists) {
            alert("Report not found!");
            return;
        }
        const report = doc.data();
        
        showTab('calculatorTab');
        todayDateEl.value = report.reportDate;
        interestRateEl.value = report.interestRate;
        loanTableBody.innerHTML = '';
        
        if(report.loans) {
            report.loans.forEach(loan => addRow(loan));
            lastSavedReportState = JSON.stringify(report.loans); // Set the state to match the viewed report
        }
        
        if (isEditable) {
            addRow();
            setViewMode(false);
        } else {
             setViewMode(true);
        }
        updateAllCalculations();
    });
};

const deleteReport = (docId) => {
    if (!confirm("Are you sure you want to delete this report?")) return;
    reportsCollection.doc(docId).delete().then(() => {
        loadRecentTransactions();
    }).catch(error => {
        console.error("Error deleting report: ", error);
        alert("Could not delete report.");
    });
};

// --- Authentication ---
const signInWithGoogle = () => {
    const provider = new firebase.auth.GoogleAuthProvider();
    auth.signInWithPopup(provider).catch(error => {
        console.error("Google Sign-in failed: ", error);
        alert("Could not sign in with Google. Please ensure pop-ups are not blocked and try again.");
    });
};

const signOut = () => {
    auth.signOut();
};

// --- Initial Load & Event Listeners ---
document.addEventListener('DOMContentLoaded', () => {
    const isSupportedAuthEnv = ['http:', 'https:', 'chrome-extension:'].includes(window.location.protocol);

    if (!isSupportedAuthEnv) {
        loginMessage.textContent = 'Sign-in is disabled in this environment. Please use the hosted website link.';
        googleSignInBtn.disabled = true;
        return;
    }

    auth.onAuthStateChanged(firebaseUser => {
        if (firebaseUser) {
            user = firebaseUser;
            reportsCollection = db.collection('reports').doc(user.uid).collection('userReports');
            
            authStatusEl.textContent = user.displayName || user.email;
            loginOverlay.style.display = 'none';
            appContainer.style.display = 'block';

            loadCurrentState();
            
            if(document.querySelector('.tab-button.active').dataset.tab === 'recentTransactionsTab') {
                loadRecentTransactions();
            }
        } else {
            user = null;
            reportsCollection = null;
            
            loginOverlay.style.display = 'flex';
            appContainer.style.display = 'none';
        }
    });

    // Event Listeners
    googleSignInBtn.addEventListener('click', signInWithGoogle);
    signOutBtn.addEventListener('click', signOut);
    addRowBtn.addEventListener('click', () => addRow());
    saveReportBtn.addEventListener('click', () => saveReport(false));
    printReportBtn.addEventListener('click', printReport);
    clearSheetBtn.addEventListener('click', clearSheet);
    exitViewModeBtn.addEventListener('click', exitViewMode);

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
});
