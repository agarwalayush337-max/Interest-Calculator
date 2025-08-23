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

// --- DOM Elements ---
const loginOverlay = document.getElementById('loginOverlay');
const appContainer = document.getElementById('appContainer');
const authStatusEl = document.getElementById('authStatus');
const printSaveBtn = document.getElementById('printSaveBtn');
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

const calculateDurationInDays = (loanDate, todayDate) => {
    if (!loanDate || !todayDate) return 0;
    const start = loanDate;
    const end = todayDate;
    if (start > end) return 0;
    const diffTime = Math.abs(end - start);
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
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

        const duration = calculateDurationInDays(loanDate, todayDate);
        const interest = calculateInterest(principal, interestRate, duration);
        const roundedInterest = roundToNearest(interest, 5);
        
        durationEl.textContent = duration > 0 ? duration : '';
        interestEl.textContent = roundedInterest > 0 ? roundedInterest.toFixed(2) : '';

        totalPrincipal += principal;
        totalInterestRaw += interest;
    });
    
    const roundedTotalInterest = roundToNearest(totalInterestRaw, 10);

    totalPrincipalEl.textContent = totalPrincipal.toFixed(2);
    totalInterestEl.textContent = roundedTotalInterest.toFixed(2);
    finalTotalEl.textContent = (totalPrincipal + roundedTotalInterest).toFixed(2);
    
    saveCurrentState();
};

// --- Table Management ---
const addRow = (loan = { no: '', principal: '', date: '' }) => {
    const rowCount = loanTableBody.rows.length;
    const row = loanTableBody.insertRow();
    
    row.innerHTML = `
        <td>${rowCount + 1}</td>
        <td><input type="text" class="no" value="${loan.no}"></td>
        <td><input type="number" class="principal" placeholder="0.00" value="${loan.principal}"></td>
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

const sortRows = () => {
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
    saveCurrentState();
};

// --- State Management (Local Storage for active state) ---
const saveCurrentState = () => {
    if (!user) return; // Don't save if not logged in
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
    document.querySelector(`[onclick="showTab('${tabId}')"]`).classList.add('active');
    
    if (tabId === 'recentTransactionsTab' && user) {
        loadRecentTransactions();
    }
};

// --- Print & Save (Now with Firestore) ---
const printAndSave = async () => {
    if (!reportsCollection) {
        alert("Database not connected. Please wait.");
        return;
    }

    const loans = Array.from(document.querySelectorAll('#loanTable tbody tr'))
        .map(row => ({
            no: row.querySelector('.no').value,
            principal: row.querySelector('.principal').value,
            date: row.querySelector('.date').value,
            duration: row.querySelector('.duration').textContent,
            interest: row.querySelector('.interest').textContent
        }))
        .filter(loan => loan.principal);

    if (loans.length === 0) {
        alert("Please add at least one loan with a principal amount to save a report.");
        return;
    }

    const report = {
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
        await reportsCollection.add(report);
        document.getElementById('printTitle').textContent = `Interest Report`;
        document.getElementById('printDate').textContent = `As of ${todayDateEl.value}`;
        window.print();
    } catch (error) {
        console.error("Error saving report: ", error);
        alert("Could not save report to the database. Please check your connection.");
    }
};

// --- Recent Transactions (Now with Firestore) ---
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
                <span>Report from ${report.reportDate}</span>
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
    auth.signInWithRedirect(provider);
};

const signOut = () => {
    auth.signOut();
};

// --- Initial Load & Auth ---
document.addEventListener('DOMContentLoaded', () => {
    const isSupportedAuthEnv = ['http:', 'https:', 'chrome-extension:'].includes(window.location.protocol);

    if (!isSupportedAuthEnv) {
        loginMessage.textContent = 'Sign-in is disabled in this environment. Please use the hosted website link.';
        googleSignInBtn.disabled = true;
        return;
    }

    auth.getRedirectResult()
        .then((result) => {
            // This is just to handle the redirect flow. 
            // The onAuthStateChanged observer will handle the user state.
        }).catch((error) => {
            console.error("Google Sign-in redirect failed: ", error);
            alert("Could not complete sign in. Please try again.");
        });

    auth.onAuthStateChanged(firebaseUser => {
        if (firebaseUser) {
            user = firebaseUser;
            reportsCollection = db.collection('reports').doc(user.uid).collection('userReports');
            
            authStatusEl.textContent = user.displayName || user.email;
            loginOverlay.style.display = 'none';
            appContainer.style.display = 'block';

            loadCurrentState();
            
            if(document.getElementById('recentTransactionsTab').classList.contains('active')) {
                loadRecentTransactions();
            }
        } else {
            user = null;
            reportsCollection = null;
            
            loginOverlay.style.display = 'flex';
            appContainer.style.display = 'none';
        }
    });

    todayDateEl.addEventListener('input', updateAllCalculations);
    interestRateEl.addEventListener('input', updateAllCalculations);
    todayDateEl.addEventListener('blur', (e) => {
        const parsed = parseDate(e.target.value);
        if (parsed) e.target.value = formatDateToDDMMYYYY(parsed);
        updateAllCalculations();
    });
});
