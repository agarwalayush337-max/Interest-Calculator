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
// --- NEW ---
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
    } catch (error) {
      console.error('Failed to sync new report:', error);
    }
  }
  const deletions = await localDb.getAll('deletionsQueue');
  for (const item of deletions) {
    try {
      await reportsCollection.doc(item.docId).delete();
      await localDb.delete('deletionsQueue', item.docId);
    } catch (error) {
      console.error('Failed to sync deletion:', error);
    }
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
  return new Promise(resolve => {
    resolveConfirm = resolve;
  });
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
  let day = parseInt(parts[1], 10),
    month = parseInt(parts[2], 10),
    year = parseInt(parts[3], 10);
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

const roundToNearest = (num, nearest) => Math.round(num / nearest) * nearest;

const days360 = (startDate, endDate) => {
  if (!startDate || !endDate || startDate > endDate) return 0;
  let d1 = startDate.getDate(),
    m1 = startDate.getMonth() + 1,
    y1 = startDate.getFullYear();
  let d2 = endDate.getDate(),
    m2 = endDate.getMonth() + 1,
    y2 = endDate.getFullYear();
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
  let totalPrincipal = 0,
    totalInterestRaw = 0;
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
    <td><input type="text" class="no" value="${loan.no}" placeholder="Loan No."></td>
    <td><input type="number" class="principal" value="${loan.principal}" placeholder="Amount"></td>
    <td><input type="text" class="date" value="${loan.date}" placeholder="DD/MM/YYYY"></td>
    <td class="duration read-only"></td>
    <td class="interest read-only"></td>
    <td><button class="btn btn-danger btn-small remove-row-btn">&times;</button></td>
  `;
};

// --- START: NEW Cloud Vision Integration ---

// This function tries to find data in the OCR text and add it to your table.
// You will need to customize the logic here based on the format of your documents.
const parseAndFillData = (text) => {
    console.log("Extracted Text:", text); // Log for debugging

    // Example parsing logic:
    // This is a very basic example. You'll need to create more robust logic.
    // It looks for lines that might contain a date and a number (principal).
    const lines = text.split('\n');
    let dataFound = false;
    lines.forEach(line => {
        // Try to find a date (e.g., 25/12/2024) and a number (e.g., 5000)
        const dateMatch = line.match(/\d{1,2}[./-]\d{1,2}[./-]\d{2,4}/);
        const amountMatch = line.match(/\b\d{3,}\b/); // Look for numbers with at least 3 digits

        if (dateMatch && amountMatch) {
            const date = dateMatch[0];
            const principal = amountMatch[0];
            
            // Add a new row with the found data
            addRow({ no: 'Scanned', principal: principal, date: date });
            dataFound = true;
        }
    });

    if (dataFound) {
        updateAllCalculations(); // Recalculate totals
        showConfirm('Scan Complete', 'Data has been added to the table.', false);
    } else {
        showConfirm('Scan Complete', 'Could not automatically find data to add. Please check the console for the full text.', false);
    }
};

const handleImageScan = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    // Use your existing modal to show a loading state
    showConfirm('Scanning Image...', 'Please wait while the document is analyzed.', false);

    try {
        // 1. Convert image to base64
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = async () => {
            // The result includes the data URI prefix (e.g., "data:image/jpeg;base64,"), which we must remove.
            const base64Image = reader.result.split(',')[1];

            // 2. Call your secure Netlify Function
            const response = await fetch('/.netlify/functions/scanImage', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ image: base64Image })
            });

            closeConfirm(); // Close the "Scanning..." modal

            if (!response.ok) {
                const errorInfo = await response.json();
                throw new Error(errorInfo.error || 'The scan failed. Please try again.');
            }

            const result = await response.json();
            
            // 3. Process the result
            if (result.text) {
                parseAndFillData(result.text);
            } else {
                await showConfirm('Scan Failed', 'No text could be found in the image.', false);
            }
        };
        reader.onerror = () => {
            throw new Error('Failed to read the image file.');
        };
    } catch (error) {
        console.error('Scan failed:', error);
        await showConfirm('Error', error.message, false);
    }

    // Reset the input value so the 'change' event fires again if the same file is selected
    imageUploadInput.value = '';
};

// --- END: NEW Cloud Vision Integration ---


// --- Main Application Logic ---
document.addEventListener('DOMContentLoaded', async () => {
  // All your existing code goes here...
  await initLocalDb();

  // Attach event listeners...
  
  // --- NEW Event Listeners for Scanning ---
  scanImageBtn.addEventListener('click', () => imageUploadInput.click());
  imageUploadInput.addEventListener('change', handleImageScan);
  
  // ... rest of your existing event listeners
  googleSignInBtn.addEventListener('click', () => {
     // your sign-in logic
  });
  
  signOutBtn.addEventListener('click', () => {
      // your sign-out logic
  });

  addRowBtn.addEventListener('click', () => addRow());
  
  // and so on for all your buttons and inputs.
  // Make sure to copy the full content of your original DOMContentLoaded listener here.
});


// ... rest of your file (auth handling, saving state, etc.)
// Make sure to copy the full content of your original script here.
