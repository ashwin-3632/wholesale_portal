// app.js

import { db } from './firebase-config.js';

import {
  collection,
  doc,
  setDoc,
  getDoc,
  updateDoc,
  increment,
  query,
  orderBy,
  where,
  runTransaction, // For atomic counter increment
  serverTimestamp,
  writeBatch,
  getDocs,
  FieldPath // Keep FieldPath imported, as it might be used elsewhere or for clarity
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// Global variables
let currentBillIdForViewer = null;
let currentPartyPhoneForStatement = null;

// UI Elements for main views
const mainPortalView = document.getElementById('main-portal-view');
const billViewerPage = document.getElementById('bill-viewer-page');
const billViewerContent = document.getElementById('bill-viewer-content');

// Record Payment Modal elements
const recordPaymentModal = new bootstrap.Modal(document.getElementById('recordPaymentModal'));
const paymentPartySelect = document.getElementById('payment-party-select');
const recordPaymentForm = document.getElementById('record-payment-form');

// Party Statement Modal elements
const partyStatementModal = new bootstrap.Modal(document.getElementById('partyStatementModal'));
const statementPartyName = document.getElementById('statement-party-name');
const statementPartyPhone = document.getElementById('statement-party-phone');
const partyStatementContent = document.getElementById('party-statement-content');

// Edit Party Modal elements
const editPartyModal = new bootstrap.Modal(document.getElementById('editPartyModal'));
const editPartyForm = document.getElementById('edit-party-form');
const editPartyPhoneHidden = document.getElementById('edit-party-phone-hidden');
const editPartyNameInput = document.getElementById('edit-party-name');
const editPartyAddressInput = document.getElementById('edit-party-address');

// Submit Bill button reference (Assuming it has an ID 'submit-bill-btn' in index.html)
const submitBillBtn = document.getElementById('submit-bill-btn');


// --------------------- UI Visibility Functions ---------------------
function showBillViewerPage(billId) {
	window.currentlyViewingBillId = billId;
	
    currentBillIdForViewer = billId;
    mainPortalView.style.display = 'none';
    billViewerPage.style.display = 'block';
    populateBillViewerContent(billId);
}

function showMainPortalView() {
  document.getElementById('main-portal-view').style.display = 'block';
  document.getElementById('bill-viewer-page').style.display = 'none';
  currentBillIdForViewer = null;
  const firstTabLink = document.querySelector('#tabs .nav-link.active');
  if (firstTabLink) {
    new bootstrap.Tab(firstTabLink).show();
  }
}

// --------------------- ADD PARTY ---------------------
document.getElementById('add-party-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('party-name').value.trim();
  const phone = document.getElementById('phone-number').value.trim();
  const address = document.getElementById('address').value.trim();
  if (!name || !phone) return alert("Name and phone are required");

  try {
    const partyDocRef = doc(db, 'parties', phone);
    await setDoc(partyDocRef, {
      name,
      address,
      totalBilled: 0,
      totalPaid: 0,
      totalDue: 0
    });
    alert("Party added successfully.");
    e.target.reset();
    loadDashboard();
    loadPartyNamesForDatalist();
    loadPartyAccounts();
  } catch (error) {
    console.error("Error adding party:", error);
    alert("Error adding party: " + error.message);
  }
});

// --------------------- CREATE BILL ---------------------
const itemsTable = document.querySelector('#bill-items-table tbody');
let itemIndex = 1;

function updateItemSNo() {
    itemsTable.querySelectorAll('tr').forEach((row, index) => {
        row.querySelector('td:first-child').innerText = index + 1;
    });
    itemIndex = itemsTable.children.length + 1;
}

function recalculateTotal() {
  let total = 0;
  itemsTable.querySelectorAll('tr').forEach(row => {
    const rate = parseFloat(row.querySelector('.rate')?.value) || 0;
    const qty = parseFloat(row.querySelector('.quantity')?.value) || 0;
    const lineTotal = rate * qty;
    row.querySelector('.total').value = lineTotal.toFixed(2);
    total += lineTotal;
  });
  document.getElementById('bill-total').value = total.toFixed(2);
  const paid = parseFloat(document.getElementById('paid-amount').value) || 0;
  document.getElementById('due-amount').value = (total - paid).toFixed(2);
}

// app.js - Add this new function
function updateRemoveButtonStates() {
    const allRows = itemsTable.querySelectorAll('tr');
    const totalRows = allRows.length;

    allRows.forEach((row, index) => {
        const removeButton = row.querySelector('.remove-item');
        if (removeButton) { // Ensure the button exists
            // Enable only for the last two rows (index is 0-based)
            // If totalRows is 1, index 0 is (1-0 <= 2) -> true
            // If totalRows is 2, index 0 is (2-0 <= 2) -> true, index 1 is (2-1 <= 2) -> true
            // If totalRows is 3, index 0 is (3-0 <= 2) -> false, index 1 is (3-1 <= 2) -> true, index 2 is (3-2 <= 2) -> true
            if (totalRows - (index + 1) < 2) { // (index + 1) gives S.No.
                removeButton.disabled = false; // Enabled
            } else {
                removeButton.disabled = true; // Disabled
            }
        }
    });
}

function addItemRow() {
  const row = itemsTable.insertRow();
  row.innerHTML = `
    <td>${itemIndex}</td>
    <td><input type="number" class="form-control rate"></td>
    <td><input type="number" class="form-control quantity"></td>
    <td><input type="number" class="form-control total" readonly></td>
    <td><button type="button" class="btn btn-danger remove-item p-1">&#x1F5D1;</button></td>
  `;
  itemIndex++;
  row.querySelector('.rate').addEventListener('input', recalculateTotal);

  // Requirement 1: Auto-add new row when quantity is entered in the last row
  // Listener attached to the quantity input of the newly created row
  row.querySelector('.quantity').addEventListener('input', (e) => {
    recalculateTotal(); // First, recalculate totals based on current input
    const qtyValue = parseFloat(e.target.value);
    // Check if this is the last row in the table and a valid quantity (>0) is entered
    if (e.target.closest('tr') === itemsTable.lastElementChild && qtyValue > 0) {
      addItemRow(); // Add a new empty row
    }
  });

  row.querySelector('.remove-item').addEventListener('click', () => {
    row.remove();
    recalculateTotal();
    updateItemSNo();
    updateRemoveButtonStates(); // ADD THIS LINE
  });
  recalculateTotal();
  updateItemSNo();
  updateRemoveButtonStates(); // ADD THIS LINE
}

// REMOVE event listener for 'add-item'
document.getElementById('add-item')?.remove(); // Optional cleanup

// Autofill party details (when phone number changes)
document.getElementById('bill-phone-number').addEventListener('change', async () => {
  const phone = document.getElementById('bill-phone-number').value.trim();
  if (!phone) {
    document.getElementById('bill-party-name').value = "";
    document.getElementById('bill-address').value = "";
    return;
  }
  try {
    const partyDocRef = doc(db, 'parties', phone);
    const docSnap = await getDoc(partyDocRef);
    if (docSnap.exists()) {
      const data = docSnap.data();
      document.getElementById('bill-party-name').value = data.name;
      document.getElementById('bill-address').value = data.address;
    } else {
      document.getElementById('bill-party-name').value = "";
      document.getElementById('bill-address').value = "";
      alert("Party not found. Please add the party first.");
    }
  } catch (error) {
      console.error("Error fetching party details:", error);
      alert("Error fetching party details: " + error.message);
  }
});

// ✅ New: Live party name suggestion while typing phone
const phoneInput = document.getElementById('bill-phone-number');
const suggestionBox = document.getElementById('phone-suggestion-box');

phoneInput.addEventListener('input', async () => {
  const queryStr = phoneInput.value.trim();
  if (queryStr.length < 3) {
    suggestionBox.style.display = 'none';
    return;
  }

  const q = query(
    collection(db, 'parties'),
    where('phone', '>=', queryStr),
    where('phone', '<=', queryStr + '\uf8ff')
  );

  const snap = await getDocs(q);
  suggestionBox.innerHTML = '';

  if (snap.empty) {
    suggestionBox.style.display = 'none';
    return;
  }

  snap.forEach(doc => {
    const party = doc.data();
    const item = document.createElement('button');
    item.classList.add('list-group-item', 'list-group-item-action');
    item.textContent = party.name;
    item.onclick = () => {
      document.getElementById('bill-party-name').value = party.name;
      document.getElementById('bill-address').value = party.address || '';
      phoneInput.value = party.phone;
      suggestionBox.style.display = 'none';
      phoneInput.dispatchEvent(new Event('change'));
    };
    suggestionBox.appendChild(item);
  });

  suggestionBox.style.display = 'block';
});



// Load party names for the searchable datalist dropdown
async function loadPartyNamesForDatalist() {
    const datalist = document.getElementById('party-names-list');
    datalist.innerHTML = '';

    const cached = localStorage.getItem('partyList');
    if (cached) {
        JSON.parse(cached).forEach(party => {
            const option = document.createElement('option');
            option.value = party.name;
            option.setAttribute('data-phone', party.phone);
            datalist.appendChild(option);
        });
        return;
    }

    try {
        const partiesSnap = await getDocs(collection(db, 'parties'));
        const partyList = [];

        partiesSnap.forEach(docSnap => {
            const party = docSnap.data();
            partyList.push({ name: party.name, phone: docSnap.id });

            const option = document.createElement('option');
            option.value = party.name;
            option.setAttribute('data-phone', docSnap.id);
            datalist.appendChild(option);
        });

        localStorage.setItem('partyList', JSON.stringify(partyList));
    } catch (error) {
        console.error("Error loading parties:", error);
    }
}



async function submitBillToFirestore(bill) {
  const { phone, name, address, lr, items, billTotal, paid } = bill;
  let due = billTotal - paid;

  const billCounterRef = doc(db, 'metadata', 'billCounter');
  let newBillNumber;

  await runTransaction(db, async (transaction) => {
    const counterDoc = await transaction.get(billCounterRef);
    if (!counterDoc.exists()) {
      transaction.set(billCounterRef, { currentCount: 0 });
      newBillNumber = 1;
    } else {
      newBillNumber = counterDoc.data().currentCount + 1;
    }
    transaction.update(counterDoc.ref, { currentCount: newBillNumber });
  });

  const formattedBillId = String(newBillNumber).padStart(9, '0');
  const billDocRef = doc(collection(db, 'bills'), formattedBillId);

  let status = 'Pending';
  let clearanceTimestamp = null;
  if (due <= 0) {
    status = 'Cleared';
    clearanceTimestamp = new Date();
    due = 0;
  }

  await setDoc(billDocRef, {
    billId: formattedBillId,
    partyPhone: phone,
    partyName: name,
    address,
    date: new Date(),
    transportLR: lr,
    items,
    billTotal,
    paid,
    due,
    status,
    clearanceTimestamp
  });

  const partyDocRef = doc(db, 'parties', phone);
  await updateDoc(partyDocRef, {
    totalBilled: increment(billTotal),
    totalPaid: increment(paid),
    totalDue: increment(due)
  });

  // Final UI updates after syncing
  showBillViewerPage(formattedBillId);
  loadDashboard();
  loadPartyAccounts();
}



// Listen for input on the party name field to autofill phone/address from datalist selection
document.getElementById('bill-party-name').addEventListener('input', async () => {
    const partyNameInput = document.getElementById('bill-party-name').value.trim();
    const datalistOptions = document.getElementById('party-names-list').options;
    let selectedPartyPhone = '';

    for (let i = 0; i < datalistOptions.length; i++) {
        if (datalistOptions[i].value === partyNameInput) {
            selectedPartyPhone = datalistOptions[i].getAttribute('data-phone');
            break;
        }
    }

    if (selectedPartyPhone) {
        document.getElementById('bill-phone-number').value = selectedPartyPhone;
        document.getElementById('bill-phone-number').dispatchEvent(new Event('change'));
    } else {
        document.getElementById('bill-phone-number').value = '';
        document.getElementById('bill-address').value = '';
    }
});

document.getElementById('paid-amount').addEventListener('input', recalculateTotal);

// Create bill submit
document.getElementById('create-bill-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  // Disable submit button while processing
  if (submitBillBtn) {
    submitBillBtn.disabled = true;
    submitBillBtn.innerText = "Submitting...";
  }

  // Auto-delete last empty row
  const lastRow = itemsTable.lastElementChild;
  if (lastRow) {
    const lastRateInput = lastRow.querySelector('.rate');
    const lastQtyInput = lastRow.querySelector('.quantity');
    const lastRate = parseFloat(lastRateInput?.value);
    const lastQty = parseFloat(lastQtyInput?.value);
    if ((!lastRateInput || isNaN(lastRate) || lastRate === 0) && (!lastQtyInput || isNaN(lastQty) || lastQty === 0)) {
      lastRow.remove();
      updateItemSNo();
    }
  }

  // Read form inputs
  const phone = document.getElementById('bill-phone-number').value.trim();
  const name = document.getElementById('bill-party-name').value.trim();
  const address = document.getElementById('bill-address').value.trim();
  const lr = document.getElementById('transport-lr').value.trim();
  const paid = parseFloat(document.getElementById('paid-amount').value) || 0;

  if (!phone || !name) {
    alert("Party phone and name required");
    if (submitBillBtn) {
      submitBillBtn.disabled = false;
      submitBillBtn.innerText = "Submit Bill";
    }
    return;
  }

  // Build item array with halved rates
  const items = Array.from(itemsTable.querySelectorAll('tr')).map(row => {
    let rate = parseFloat(row.querySelector('.rate')?.value) || 0;
    const qty = parseFloat(row.querySelector('.quantity')?.value) || 0;
    rate = rate / 2;
    return { rate, qty, total: rate * qty };
  }).filter(item => item.qty > 0 || item.rate > 0);

  if (items.length === 0) {
    alert("Please add at least one bill item with valid rate and quantity.");
    if (submitBillBtn) {
      submitBillBtn.disabled = false;
      submitBillBtn.innerText = "Submit Bill";
    }
    return;
  }

  const billTotal = items.reduce((sum, item) => sum + item.total, 0);
  const due = billTotal - paid;

  // Prepare complete bill object
  const bill = {
    phone,
    name,
    address,
    lr,
    items,
    billTotal,
    paid,
    due
  };

  try {
    if (navigator.onLine) {
      await submitBillToFirestore(bill);
    } else {
      const unsyncedBills = JSON.parse(localStorage.getItem('unsyncedBills') || '[]');
      unsyncedBills.push(bill);
      localStorage.setItem('unsyncedBills', JSON.stringify(unsyncedBills));
      alert("🔌 Offline: Bill saved locally. Will sync when online.");
      showBillViewerPage('DRAFT-OFFLINE');
    }

    // Cleanup UI
    e.target.reset();
    itemsTable.innerHTML = '';
    itemIndex = 1;
    addItemRow();
    updateRemoveButtonStates();

  } catch (error) {
    console.error("Error creating bill:", error);
    alert("Error: " + error.message);
  } finally {
    if (submitBillBtn) {
      submitBillBtn.disabled = false;
      submitBillBtn.innerText = "Submit Bill";
    }
  }
});


// --------------------- SEARCH BILLS ---------------------
document.getElementById('search-bills-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const billIdFilter = document.getElementById('search-bill-id').value.trim();
  const phone = document.getElementById('search-phone-number').value.trim();
  const partyName = document.getElementById('search-party-name').value.trim().toLowerCase();
  const fromDateStr = document.getElementById('search-date-from').value;
  const toDateStr = document.getElementById('search-date-to').value;
  const status = document.getElementById('search-status').value;

  const tbody = document.querySelector('#search-results-table tbody');
  tbody.innerHTML = '';
  document.getElementById('select-all-bills').checked = false;

  // ✅ If Bill ID is present, search only by it
  if (billIdFilter) {
    try {
      const normalizedBillId = billIdFilter.padStart(9, '0');
	  const q = query(collection(db, 'bills'), where('billId', '==', normalizedBillId));
      const snap = await getDocs(q);

      if (snap.empty) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted">No bill found with ID ${billIdFilter}</td></tr>`;
        return;
      }

      snap.forEach(docSnap => {
        const data = docSnap.data();
        const billDate = data.date.toDate();
        const row = tbody.insertRow();
        row.innerHTML = `
          <td><input type="checkbox" class="bill-select" value="${docSnap.id}" /></td>
          <td>${docSnap.id}</td>
          <td>${data.partyName}</td>
          <td>${billDate.toLocaleString()}</td>
          <td>${data.status}</td>
          <td><button class="btn btn-sm btn-info view-bill-btn" data-bill-id="${docSnap.id}">View</button></td>
        `;
      });

      return; // ⛔ Skip rest of filtering logic if bill ID was used
    } catch (error) {
      console.error("Error searching by Bill ID:", error);
      alert("Failed to search by Bill ID: " + error.message);
      return;
    }
  }

  // 🔁 Normal filtering logic (phone, status, dates, party name)
  let billsQuery = collection(db, 'bills');

  if (phone) {
    billsQuery = query(billsQuery, where('partyPhone', '==', phone));
  }

  if (status && status !== 'all') {
    billsQuery = query(billsQuery, where('status', '==', status.charAt(0).toUpperCase() + status.slice(1)));
  }

  billsQuery = query(billsQuery, orderBy('date', 'desc'));

  let snapshot;
  try {
    snapshot = await getDocs(billsQuery);
  } catch (error) {
    console.error("Error fetching bills:", error);
    alert("Error searching bills. Check console for details.");
    return;
  }

  snapshot.forEach(docSnap => {
    const data = docSnap.data();
    const billDate = data.date.toDate();

    const matchName = !partyName || data.partyName.toLowerCase().includes(partyName);
    const matchFrom = !fromDateStr || billDate >= new Date(fromDateStr);
    const matchTo = !toDateStr || billDate <= new Date(toDateStr + 'T23:59:59');

    if (matchName && matchFrom && matchTo) {
      const row = tbody.insertRow();
      row.innerHTML = `
        <td><input type="checkbox" class="bill-select" value="${docSnap.id}" /></td>
        <td>${docSnap.id}</td>
        <td>${data.partyName}</td>
        <td>${billDate.toLocaleString()}</td>
        <td>${data.status}</td>
        <td><button class="btn btn-sm btn-info view-bill-btn" data-bill-id="${docSnap.id}">View</button></td>
      `;
    }
  });
});


// Event listener for "Select All" checkbox
document.getElementById('select-all-bills').addEventListener('change', (e) => {
    const isChecked = e.target.checked;
    document.querySelectorAll('.bill-select').forEach(checkbox => {
        checkbox.checked = isChecked;
    });
});

// Event listener for individual checkboxes to update "Select All" status
document.querySelector('#search-results-table tbody').addEventListener('change', (e) => {
    if (e.target.classList.contains('bill-select')) {
        const allCheckboxes = document.querySelectorAll('.bill-select');
        const checkedCheckboxes = document.querySelectorAll('.bill-select:checked');
        document.getElementById('select-all-bills').checked = allCheckboxes.length === checkedCheckboxes.length;
    }
});

document.getElementById('mark-cleared').addEventListener('click', async () => {
  const selected = Array.from(document.querySelectorAll('.bill-select:checked')).map(cb => cb.value);
  if (!selected.length) return alert("Select at least one bill.");

  const batch = writeBatch(db);
  try {
    for (const id of selected) {
        const billDocRef = doc(db, 'bills', id);
        const billDocSnap = await getDoc(billDocRef);
        if (billDocSnap.exists()) {
            const billData = billDocSnap.data();
            const partyDocRef = doc(db, 'parties', billData.partyPhone);

            if (billData.status === 'Pending') {
                batch.update(partyDocRef, {
                    totalDue: increment(-billData.due)
                });
                batch.update(billDocRef, {
                    status: 'Cleared',
                    clearanceTimestamp: new Date(),
                    due: 0
                });
            }
        }
    }
    await batch.commit();
    alert("Selected bills marked as Cleared.");
    document.getElementById('search-bills-form').dispatchEvent(new Event('submit'));
    loadDashboard();
    loadPartyAccounts();
  } catch (error) {
    console.error("Error marking bills cleared:", error);
    alert("Error marking bills cleared: " + error.message);
  }
});

// Function to populate today's bills directly upon click on "Search Bills" tab
async function loadTodaysBills() {
  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const q = query(
      collection(db, 'bills'),
      where('date', '>=', todayStart),
      where('date', '<=', todayEnd),
      orderBy('date', 'desc'),
      orderBy('__name__', 'desc')
    );

    const snap = await getDocs(q);

    const tbody = document.querySelector('#search-results-table tbody');
    tbody.innerHTML = ''; // clear old results

    snap.forEach(doc => {
      const bill = doc.data();
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><input type="checkbox" class="bill-select-checkbox" data-bill-id="${bill.billId}"></td>
        <td>${bill.billId}</td>
        <td>${bill.partyName}</td>
        <td>${bill.date.toDate().toLocaleDateString()}</td>
        <td>${bill.status}</td>
        <td><button class="btn btn-sm btn-primary view-bill-btn" data-id="${bill.billId}">View</button></td>
      `;
      tbody.appendChild(tr);
    });

  } catch (err) {
    console.error("Error loading today's bills:", err);
  }
}



// --------------------- Bill Viewer Page Logic ---------------------

// Function to populate and show the Bill Viewer Page
async function populateBillViewerContent(billId) {
  const billDocRef = doc(db, 'bills', billId);
  const billSnap = await getDoc(billDocRef);

  if (!billSnap.exists()) {
    document.getElementById('bill-viewer-content').innerHTML = `<p class="text-danger">Bill not found.</p>`;
    return;
  }

  const bill = billSnap.data();
  const dateStr = bill.date.toDate().toLocaleString();
  const items = bill.items || [];

  const isMobile = window.innerWidth < 768;

  const allRows = items.map((item, index) => {
  const serial = index + 1;
  return `
    <tr>
      <td><strong>${serial}</strong></td>
      <td>${item.rate.toFixed(2)}</td>
      <td>${item.qty}</td>
      <td>${item.total.toFixed(2)}</td>
    </tr>`;
}).join('');

const singleTableHtml = `
  <div class="item-table-mobile">
    <table class="table table-bordered table-sm text-start w-100">
      <thead><tr><th>S.No.</th><th>Rate</th><th>Qty</th><th>Total</th></tr></thead>
      <tbody>${allRows}</tbody>
    </table>
  </div>`;

const oddItems = [], evenItems = [];
items.forEach((item, index) => {
  const serial = index + 1;
  const row = `
    <tr>
      <td><strong>${serial}</strong></td>
      <td>${item.rate.toFixed(2)}</td>
      <td>${item.qty}</td>
      <td>${item.total.toFixed(2)}</td>
    </tr>`;
  if (serial % 2 === 1) oddItems.push(row);
  else evenItems.push(row);
});

const twoColumnHtml = `
  <div class="item-table-desktop">
    <div class="row">
      <div class="col-6">
        <table class="table table-bordered table-sm text-start">
          <thead><tr><th>S.No.</th><th>Rate</th><th>Qty</th><th>Total</th></tr></thead>
          <tbody>${oddItems.join('')}</tbody>
        </table>
      </div>
      <div class="col-6">
        <table class="table table-bordered table-sm text-start">
          <thead><tr><th>S.No.</th><th>Rate</th><th>Qty</th><th>Total</th></tr></thead>
          <tbody>${evenItems.join('')}</tbody>
        </table>
      </div>
    </div>
  </div>`;

const itemTableHtml = singleTableHtml + twoColumnHtml;


  // Charges + totals
  let rightSummaryHtml = '';
  if (bill.packing > 0) {
    rightSummaryHtml += `<div><strong>Packing:</strong> ₹${bill.packing.toFixed(2)}</div>`;
  }
  if (bill.additionalCharge > 0) {
    rightSummaryHtml += `<div><strong>Additional Charge:</strong> ₹${bill.additionalCharge.toFixed(2)}</div>`;
  }
  rightSummaryHtml += `
    <div><strong>Bill Total:</strong> ₹${bill.billTotal.toFixed(2)}</div>
    <div><strong>Paid:</strong> ₹${bill.paid.toFixed(2)}</div>
    <div><strong>Due:</strong> ₹${bill.due.toFixed(2)}</div>
    <div><strong>Status:</strong> ${bill.status}</div>`;

  const html = `
    <div class="text-center fw-bold fs-5">Bill ID: ${bill.billId}</div>
    <hr class="my-2" />

    <div class="row mb-3">
      <div class="col-6">
        <div><strong>Name:</strong> ${bill.partyName}</div>
        <div><strong>Phone:</strong> ${bill.partyPhone}</div>
      </div>
      <div class="col-6">
        <div><strong>Date:</strong> ${dateStr}</div>
        <div><strong>Address:</strong> ${bill.address || '-'}</div>
        <div><strong>Transport:</strong> ${bill.transportLR || '-'}</div>
      </div>
    </div>

    <hr class="my-3" />
    <div class="text-center fw-bold mb-2">ITEMS</div>
    ${itemTableHtml}

    <div class="row pt-3 border-top mt-3">
      <div class="col-6">
        <div><strong>Signature</strong></div>
      </div>
      <div class="col-6 text-end">
        ${rightSummaryHtml}
      </div>
    </div>
  `;

  document.querySelector('#bill-viewer-content .bill-content-wrapper').innerHTML = html;

  const editChargesBtn = document.getElementById('edit-charges-btn');
    if (editChargesBtn) {
        editChargesBtn.style.display = 'inline-block'; // Always show the button

		if (bill.chargesLocked) {
			editChargesBtn.disabled = true;
			editChargesBtn.title = "Charges are locked";
			editChargesBtn.classList.add('btn-secondary');
			editChargesBtn.classList.remove('btn-warning');
			editChargesBtn.onclick = null; // Remove click handler
		} else {
			editChargesBtn.disabled = false;
			editChargesBtn.title = "Edit Packing & Additional Charges";
			editChargesBtn.classList.add('btn-warning');
			editChargesBtn.classList.remove('btn-secondary');
			editChargesBtn.onclick = () => openEditChargesSection(billId);
		}

    }
}



// Function to generate PDF (download only, no print option directly)
function generateBillOutput(format) {
  if (!currentBillIdForViewer) {
    alert("No bill selected for output.");
    return;
  }

  const wrapper = document.querySelector('.bill-content-wrapper');
  const element = wrapper; // Use the actual .bill-content-wrapper content

  // Cleanup any previous classes
  wrapper.classList.remove('a4-output', 'thermal-output');

  let options = {
    margin: [10, 10, 10, 10],
    filename: `bill_${currentBillIdForViewer}_${format}.pdf`,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, logging: false },
    jsPDF: { unit: 'mm', orientation: 'portrait' }
  };

  if (format === 'a4') {
    wrapper.classList.add('a4-output');
    options.jsPDF.format = 'a4';
  } else if (format === 'thermal') {
    wrapper.classList.add('thermal-output');
    options.jsPDF.format = [80, 297];
    options.margin = [5, 5, 5, 5];
    options.html2canvas.scale = 1;
  }

  html2pdf().from(element).set(options).save().then(() => {
    wrapper.classList.remove('a4-output', 'thermal-output');
  });
}




// --------------------- Party Accounts Tab Logic ---------------------
async function loadPartyAccounts() {
    const partyAccountsTableBody = document.querySelector('#party-accounts-table tbody');
    partyAccountsTableBody.innerHTML = '';

    try {
        const partiesSnap = await getDocs(collection(db, 'parties'));
        partiesSnap.forEach(docSnap => {
            const party = docSnap.data();
            const row = partyAccountsTableBody.insertRow();
            const pendingBalance = (party.totalDue || 0).toFixed(2);

            row.innerHTML = `
                <td>${party.name}</td>
                <td>${docSnap.id}</td>
                <td>₹${pendingBalance}</td>
                <td>${party.address || 'N/A'}</td>
                <td>
                    <button type="button" class="btn btn-sm btn-info record-payment-btn" data-phone="${docSnap.id}">Record Payment</button>
                    <button type="button" class="btn btn-sm btn-secondary edit-party-btn" data-phone="${docSnap.id}">Edit</button>
                    <button type="button" class="btn btn-sm btn-primary view-statement-btn" data-phone="${docSnap.id}" data-party-name="${party.name}">View Statement</button>
                </td>
            `;
        });
    } catch (error) {
        console.error("Error loading party accounts:", error);
        alert("Error loading party accounts: " + error.message);
    }
}

// Event listeners for Party Accounts tab buttons at the top
document.getElementById('add-party-btn-accounts').addEventListener('click', () => {
    const addPartyTabLink = document.querySelector('a[href="#add-party"]');
    if (addPartyTabLink) {
        new bootstrap.Tab(addPartyTabLink).show();
    }
});

document.getElementById('record-payment-btn').addEventListener('click', async () => {
    paymentPartySelect.innerHTML = '<option value="">Select Party</option>';
    try {
        const partiesSnap = await getDocs(collection(db, 'parties'));
        if (partiesSnap.empty) {
            alert("No parties found. Please add parties first.");
            return;
        }
        partiesSnap.forEach(docSnap => {
            const party = docSnap.data();
            const option = document.createElement('option');
            option.value = docSnap.id;
            option.innerText = `${party.name} (${docSnap.id})`;
            paymentPartySelect.appendChild(option);
        });
        recordPaymentModal.show();
    } catch (error) {
        console.error("Error populating party select for payment:", error);
        alert("Error loading parties for payment: " + error.message);
    }
});

// Handle Record Payment Form Submission
recordPaymentForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const partyPhone = paymentPartySelect.value;
    console.log("DEBUG (Submit): Raw partyPhone from dropdown:", partyPhone);
    console.log("DEBUG (Submit): Type of partyPhone:", typeof partyPhone);
    console.log("DEBUG (Submit): Is partyPhone empty string?", partyPhone === "");

    const paymentAmount = parseFloat(document.getElementById('payment-amount').value);
    const paymentMode = document.getElementById('payment-mode').value;

    if (!partyPhone) {
        return alert("Please select a party.");
    }
    if (isNaN(paymentAmount) || paymentAmount <= 0 || !paymentMode) {
        return alert("Please fill all payment details correctly.");
    }

    try {
        const partyRef = doc(db, 'parties', partyPhone);

        await runTransaction(db, async (transaction) => {
            console.log("DEBUG (Transaction): Transaction started.");
            console.log("DEBUG (Transaction): Current db instance:", db);

            // --- ALL READS FIRST ---
            const partyDoc = await transaction.get(partyRef);
            if (!partyDoc.exists()) {
                throw new Error("Party does not exist in the database!");
            }
            const partyData = partyDoc.data();
            console.log("DEBUG (Transaction): Party doc fetched:", partyData);

            const billsCollectionRef = collection(db, 'bills');
            const pendingBillsQuery = query(
                billsCollectionRef,
                where('partyPhone', '==', partyPhone),
                where('status', '==', 'Pending'),
                orderBy('date', 'asc')
            );
            const pendingBillsSnap = await getDocs(pendingBillsQuery);
            console.log("DEBUG (Transaction): Pending bills snap fetched. Count:", pendingBillsSnap.size);

            let sortedPendingBills = pendingBillsSnap.docs.sort((a, b) => {
                const dateA = a.data().date.toDate();
                const dateB = b.data().date.toDate();
                return dateA - dateB || a.id.localeCompare(b.id);
            });

            // --- ALL WRITES ---
            let remainingPayment = paymentAmount;
            let updatedTotalPaid = partyData.totalPaid + paymentAmount;
            let updatedTotalDue = partyData.totalDue - paymentAmount;
            if (updatedTotalDue < 0) updatedTotalDue = 0;

            transaction.update(partyRef, {
                totalPaid: updatedTotalPaid,
                totalDue: updatedTotalDue
            });

            const paymentsCollectionRef = collection(db, 'payments');
            const recordedBills = [];

            for (const billDoc of sortedPendingBills) {
                if (remainingPayment <= 0) break;

                const billData = billDoc.data();
                let billDue = billData.due;

                if (billDue > 0) {
                    const amountToApply = Math.min(remainingPayment, billDue);
                    const newBillDue = billDue - amountToApply;
                    const newBillStatus = newBillDue <= 0 ? 'Cleared' : 'Pending';
                    const clearanceTimestamp = newBillDue <= 0 ? new Date() : null;

                    transaction.update(billDoc.ref, {
                        due: newBillDue,
                        paid: increment(amountToApply), // ✅ add this line
                        status: newBillStatus,
                        clearanceTimestamp: clearanceTimestamp
                    });

                    recordedBills.push(billDoc.id);
                    remainingPayment -= amountToApply;
                }
            }

            transaction.set(doc(paymentsCollectionRef), {
                partyPhone: partyPhone,
                amount: paymentAmount,
                mode: paymentMode,
                date: new Date(),
                recordedAgainstBills: recordedBills
            });

            console.log("DEBUG (Transaction): Transaction writes prepared.");
        });

        alert("Payment recorded successfully!");
        recordPaymentModal.hide();
        recordPaymentForm.reset();
        loadDashboard();
        loadPartyAccounts();
    } catch (error) {
        console.error("Error recording payment:", error);
        alert("Error recording payment: " + error.message);
    }
});


// --------------------- Edit Party Logic ---------------------

// Function to show the Edit Party Modal with pre-filled data
async function showEditPartyModal(partyPhone) {
    try {
        const partyDocRef = doc(db, 'parties', partyPhone);
        const docSnap = await getDoc(partyDocRef);

        if (docSnap.exists()) {
            const data = docSnap.data();
            editPartyPhoneHidden.value = partyPhone;
            editPartyNameInput.value = data.name;
            editPartyAddressInput.value = data.address || '';
            editPartyModal.show();
        } else {
            alert("Party not found for editing.");
        }
    } catch (error) {
        console.error("Error fetching party data for edit:", error);
        alert("Error loading party for edit: " + error.message);
    }
}

// Handle Edit Party Form Submission
editPartyForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const partyPhone = editPartyPhoneHidden.value;
    const newName = editPartyNameInput.value.trim();
    const newAddress = editPartyAddressInput.value.trim();

    if (!newName) {
        return alert("Party Name is required.");
    }

    try {
        const partyDocRef = doc(db, 'parties', partyPhone);
        await updateDoc(partyDocRef, {
            name: newName,
            address: newAddress
        });
        alert("Party details updated successfully!");
        editPartyModal.hide();
        loadPartyAccounts();
        loadPartyNamesForDatalist();
    } catch (error) {
        console.error("Error updating party details:", error);
        alert("Error updating party details: " + error.message);
    }
});


// ✅ Edit Charges Modal Logic
let currentBillIdForEditingCharges = null;

// Open Edit Charges Section
async function openEditChargesSection(billId) {
  currentBillIdForEditingCharges = billId;
  const billRef = doc(db, 'bills', billId);
  const billSnap = await getDoc(billRef);

  if (!billSnap.exists()) {
    return alert("Bill not found.");
  }

  const bill = billSnap.data();

  if (bill.chargesLocked) {
    alert("Charges for this bill are locked and cannot be edited.");
    return;
  }

  document.getElementById('packing-charge-input').value = bill.packing || 0;
  document.getElementById('additional-charge-input').value = bill.additionalCharge || 0;
  document.getElementById('edit-charges-section').classList.add('show');
}

// ✅ Reusable function to update packing/additionalCharge and recalculate bill
async function updateChargesInFirestore(billId) {
  const packing = parseFloat(document.getElementById('packing-charge-input').value) || 0;
  const additional = parseFloat(document.getElementById('additional-charge-input').value) || 0;

  const billRef = doc(db, 'bills', billId);
  const billSnap = await getDoc(billRef);
  if (!billSnap.exists()) throw new Error("Bill not found.");

  const billData = billSnap.data();
  const itemTotal = billData.items.reduce((sum, item) => sum + item.total, 0);
  const newBillTotal = itemTotal + packing + additional;
  let newDue = newBillTotal - billData.paid;
  if (newDue < 0) newDue = 0;
  const newStatus = newDue <= 0 ? "Cleared" : "Pending";

  await updateDoc(billRef, {
    packing,
    additionalCharge: additional,
    billTotal: newBillTotal,
    due: newDue,
    status: newStatus,
    clearanceTimestamp: newStatus === "Cleared" ? new Date() : null,
    chargesLocked: true // ✅ lock flag added
  });
}


// Submit updated charges
const editChargesForm = document.getElementById('edit-charges-form');

editChargesForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await updateChargesInFirestore(currentBillIdForEditingCharges);
    document.getElementById('edit-charges-section').classList.remove('show');
    showBillViewerPage(currentBillIdForEditingCharges);
  } catch (error) {
    console.error("Error updating charges:", error);
    alert("Failed to update charges: " + error.message);
  }
});

document.getElementById('cancel-edit-charges-btn').addEventListener('click', () => {
  document.getElementById('edit-charges-section').classList.remove('show');
});



// 🔗 Bind Edit Button to Section Logic
document.getElementById('edit-charges-btn').addEventListener('click', () => {
  if (window.currentlyViewingBillId) {
    openEditChargesSection(window.currentlyViewingBillId);
  } else {
    alert("No bill selected.");
  }
});


// Event delegation for Party Accounts table action buttons
document.querySelector('#party-accounts-table tbody').addEventListener('click', async (e) => {
    const target = e.target;
    if (!target.hasAttribute('data-phone')) return;

    const partyPhone = target.getAttribute('data-phone');
    const partyName = target.closest('tr').querySelector('td:first-child').innerText;

    if (target.classList.contains('record-payment-btn')) {
        await loadPartyNamesForDatalistForPaymentModal(partyPhone);
        recordPaymentModal.show();
    } else if (target.classList.contains('edit-party-btn')) {
        showEditPartyModal(partyPhone);
    } else if (target.classList.contains('view-statement-btn')) {
        currentPartyPhoneForStatement = partyPhone;
        statementPartyName.innerText = partyName;
        statementPartyPhone.innerText = partyPhone;
        await populatePartyStatement(partyPhone);
        partyStatementModal.show();
    }
});

// Helper to load parties for the payment modal's select dropdown, with optional pre-selection
async function loadPartyNamesForDatalistForPaymentModal(preSelectPhone = null) {
    paymentPartySelect.innerHTML = '<option value="">Select Party</option>';
    try {
        const partiesSnap = await getDocs(collection(db, 'parties'));
        if (partiesSnap.empty) {
            alert("No parties found to record payment against. Please add parties first.");
            return;
        }
        partiesSnap.forEach(docSnap => {
            const party = docSnap.data();
            const option = document.createElement('option');
            option.value = docSnap.id;
            option.innerText = `${party.name} (${docSnap.id})`;
            paymentPartySelect.appendChild(option);
        });
        if (preSelectPhone) {
            paymentPartySelect.value = preSelectPhone;
        }
    } catch (error) {
        console.error("Error populating party select for payment modal:", error);
        alert("Error loading parties for payment: " + error.message);
    }
}

// ✅ 1. Updated populatePartyStatement() function with correct balance logic
async function populatePartyStatement(partyPhone) {
    partyStatementContent.innerHTML = '<p>Loading statement...</p>';
    try {
        const billsQuery = query(
            collection(db, 'bills'),
            where('partyPhone', '==', partyPhone),
            orderBy('date', 'asc'),
            orderBy('__name__', 'asc')
        );
        const billsSnap = await getDocs(billsQuery);

        const paymentsQuery = query(
            collection(db, 'payments'),
            where('partyPhone', '==', partyPhone),
            orderBy('date', 'asc'),
            orderBy('__name__', 'asc')
        );
        const paymentsSnap = await getDocs(paymentsQuery);

        let transactions = [];

        billsSnap.forEach(docSnap => {
            const bill = docSnap.data();
            transactions.push({
                date: bill.date.toDate(),
                type: 'Bill',
                refId: docSnap.id,
                debit: bill.billTotal,
                credit: 0,
                status: bill.status,
                isBill: true
            });
        });

        paymentsSnap.forEach(docSnap => {
            const payment = docSnap.data();
            transactions.push({
                date: payment.date.toDate(),
                type: 'Payment',
                refId: docSnap.id,
                debit: 0,
                credit: payment.amount,
                status: payment.mode,
                isBill: false,
                recordedBills: payment.recordedAgainstBills || []
            });
        });

        transactions.sort((a, b) => a.date.getTime() - b.date.getTime());

        let statementHtml = `
            <table class="table table-bordered table-striped">
                <thead>
                    <tr>
                        <th>Date</th>
                        <th>Type</th>
                        <th>Ref ID</th>
                        <th>Amount</th>
                        <th>Status/Mode</th>
                        <th>Balance</th>
                    </tr>
                </thead>
                <tbody>
        `;

        let runningBalance = 0;
        transactions.forEach(tx => {
            if (tx.isBill) {
                runningBalance += tx.debit;
                statementHtml += `
                    <tr>
                        <td>${tx.date.toLocaleString()}</td>
                        <td>${tx.type}</td>
                        <td>${tx.refId}</td>
                        <td class="text-danger">- ₹${tx.debit.toFixed(2)}</td>
                        <td>${tx.status}</td>
                        <td>₹${runningBalance.toFixed(2)}</td>
                    </tr>
                `;
            } else {
                runningBalance -= tx.credit;
                const billList = tx.recordedBills.length > 0 ? `<div style="font-size: 0.85em; color: #555;">Against: ${tx.recordedBills.join(', ')}</div>` : '';
                statementHtml += `
                    <tr>
                        <td>${tx.date.toLocaleString()}</td>
                        <td>${tx.type}</td>
                        <td>${tx.refId}</td>
                        <td class="text-success">+ ₹${tx.credit.toFixed(2)}</td>
                        <td>${tx.status}${billList}</td>
                        <td>₹${runningBalance.toFixed(2)}</td>
                    </tr>
                `;
            }
        });

        statementHtml += `</tbody></table>`;
        partyStatementContent.innerHTML = statementHtml;
    } catch (error) {
        console.error("Error populating party statement:", error);
        partyStatementContent.innerHTML = `<p class='text-danger'>Error loading statement: ${error.message}</p>`;
    }
}


document.getElementById('download-statement-csv-btn').addEventListener('click', async () => {
    if (!currentPartyPhoneForStatement) {
        alert("No party selected for statement download.");
        return;
    }

    try {
        const partyDoc = await getDoc(doc(db, 'parties', currentPartyPhoneForStatement));
        const partyData = partyDoc.data();
        const partyName = partyData.name;
        const partyPhone = currentPartyPhoneForStatement;

        const billsQuery = query(
            collection(db, 'bills'),
            where('partyPhone', '==', partyPhone),
            orderBy('date', 'asc'),
            orderBy('__name__', 'asc')
        );
        const billsSnap = await getDocs(billsQuery);

        const paymentsQuery = query(
            collection(db, 'payments'),
            where('partyPhone', '==', partyPhone),
            orderBy('date', 'asc'),
            orderBy('__name__', 'asc')
        );
        const paymentsSnap = await getDocs(paymentsQuery);

        let csvContent = `Party Name:,${partyName}\n`;
        csvContent += `Party Phone:,${partyPhone}\n\n`;
        csvContent += `Date,Type,Reference ID,Debit (Bill Total),Credit (Payment),Status/Mode,Running Balance\n`;

        let transactions = [];

        billsSnap.forEach(docSnap => {
            const bill = docSnap.data();
            transactions.push({
                date: bill.date.toDate(),
                type: 'Bill',
                refId: docSnap.id,
                debit: bill.billTotal,
                credit: 0,
                statusMode: bill.status,
                isBill: true
            });
        });

        paymentsSnap.forEach(docSnap => {
            const payment = docSnap.data();
            transactions.push({
                date: payment.date.toDate(),
                type: 'Payment',
                refId: docSnap.id,
                debit: 0,
                credit: payment.amount,
                statusMode: payment.mode,
                isBill: false,
                recordedBills: payment.recordedAgainstBills || []
            });
        });

        transactions.sort((a, b) => a.date.getTime() - b.date.getTime());

        let runningBalance = 0;
        transactions.forEach(tx => {
            if (tx.isBill) {
                runningBalance += tx.debit;
                csvContent += `"${tx.date.toLocaleString()}","${tx.type}","${tx.refId}","${tx.debit.toFixed(2)}","0.00","${tx.statusMode}","${runningBalance.toFixed(2)}"\n`;
            } else {
                runningBalance -= tx.credit;
                const billRefList = tx.recordedBills.length > 0
                    ? ` | Against: ${tx.recordedBills.join(', ')}`
                    : '';
                csvContent += `"${tx.date.toLocaleString()}","${tx.type}","${tx.refId}","0.00","${tx.credit.toFixed(2)}","${tx.statusMode}${billRefList}","${runningBalance.toFixed(2)}"\n`;
            }
        });

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.setAttribute('download', `statement_${partyName.replace(/\s/g, '_')}_${partyPhone}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

    } catch (error) {
        console.error("Error generating party statement CSV:", error);
        alert("Error generating statement CSV: " + error.message);
    }
});



document.getElementById('download-all-party-ledger-btn').addEventListener('click', async () => {
    try {
        const partiesSnap = await getDocs(collection(db, 'parties'));
        let csvContent = `Name,Phone Number,Address,Date,Type,Reference ID,Debit (Bill Total),Credit (Payment),Status/Mode,Balance\n`;

        for (const partyDoc of partiesSnap.docs) {
            const party = partyDoc.data();
            const phone = partyDoc.id;
            const name = party.name;
            const address = party.address || 'N/A';

            const billsQuery = query(
                collection(db, 'bills'),
                where('partyPhone', '==', phone),
                orderBy('date', 'asc'),
                orderBy('__name__', 'asc')
            );
            const billsSnap = await getDocs(billsQuery);

            const paymentsQuery = query(
                collection(db, 'payments'),
                where('partyPhone', '==', phone),
                orderBy('date', 'asc'),
                orderBy('__name__', 'asc')
            );
            const paymentsSnap = await getDocs(paymentsQuery);

            let transactions = [];

            billsSnap.forEach(docSnap => {
                const bill = docSnap.data();
                transactions.push({
                    date: bill.date.toDate(),
                    type: 'Bill',
                    refId: docSnap.id,
                    debit: bill.billTotal,
                    credit: 0,
                    statusMode: bill.status,
                    isBill: true
                });
            });

            paymentsSnap.forEach(docSnap => {
                const payment = docSnap.data();
                transactions.push({
                    date: payment.date.toDate(),
                    type: 'Payment',
                    refId: docSnap.id,
                    debit: 0,
                    credit: payment.amount,
                    statusMode: payment.mode,
                    isBill: false,
                    recordedBills: payment.recordedAgainstBills || []
                });
            });

            transactions.sort((a, b) => a.date.getTime() - b.date.getTime());

            let runningBalance = 0;
            transactions.forEach(tx => {
                if (tx.isBill) {
                    runningBalance += tx.debit;
                    csvContent += `"${name}","${phone}","${address}","${tx.date.toLocaleString()}","${tx.type}","${tx.refId}","${tx.debit.toFixed(2)}","0.00","${tx.statusMode}","${runningBalance.toFixed(2)}"\n`;
                } else {
                    runningBalance -= tx.credit;
                    const billRefList = tx.recordedBills.length > 0
                        ? ` | Against: ${tx.recordedBills.join(', ')}`
                        : '';
                    csvContent += `"${name}","${phone}","${address}","${tx.date.toLocaleString()}","${tx.type}","${tx.refId}","0.00","${tx.credit.toFixed(2)}","${tx.statusMode}${billRefList}","${runningBalance.toFixed(2)}"\n`;
                }
            });
        }

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.setAttribute('download', 'all_party_ledger.csv');
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    } catch (error) {
        console.error("Error generating all party ledger CSV:", error);
        alert("Error generating all party ledger CSV: " + error.message);
    }
});



// --------------------- DASHBOARD ---------------------
async function loadDashboard() {
  try {
    const partiesSnap = await getDocs(collection(db, 'parties'));
    const billsSnap = await getDocs(collection(db, 'bills'));

    document.getElementById('total-parties').innerText = partiesSnap.size;
    document.getElementById('total-bills').innerText = billsSnap.size;

    let revenue = 0;
    let due = 0;
    billsSnap.forEach(docSnap => {
      const b = docSnap.data();
      revenue += b.billTotal || 0;
      if (b.status === 'Pending') {
          due += b.due || 0;
      }
    });

    document.getElementById('total-revenue').innerText = revenue.toFixed(2);
    document.getElementById('due-amount-dashboard').innerText = due.toFixed(2);
  } catch (error) {
    console.error("Error loading dashboard:", error);
    alert("Error loading dashboard data: " + error.message);
  }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    loadDashboard();
    addItemRow();
    updateRemoveButtonStates(); // ADD THIS LINE

    const initialActiveTabHref = document.querySelector('.nav-link.active')?.getAttribute('href');

    if (initialActiveTabHref === '#create-bill') {
        loadPartyNamesForDatalist();
    } else if (initialActiveTabHref === '#party-accounts') {
        loadPartyAccounts();
    }
    showMainPortalView();

    // Sync unsynced bills saved offline
    if (navigator.onLine) {
    const unsynced = JSON.parse(localStorage.getItem('unsyncedBills') || '[]');
        if (unsynced.length > 0) {
            alert(`📡 Syncing ${unsynced.length} offline bill(s)...`);
                unsynced.forEach(async (bill) => {
                    try {
                        await submitBillToFirestore(bill);
                    } catch (err) {
                        console.warn("❌ Failed to sync offline bill:", err.message);
                    }
                });
            localStorage.removeItem('unsyncedBills');
        }
    }
});


// Tab navigation event listener to ensure data is loaded when its tab is clicked
document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('shown.bs.tab', function (event) {
        const targetTabHref = event.target.getAttribute('href');
        if (targetTabHref === '#dashboard') {
            loadDashboard();
        } else if (targetTabHref === '#create-bill') {
            loadPartyNamesForDatalist();
        } else if (targetTabHref === '#party-accounts') {
            loadPartyAccounts();
        } else if (targetTabHref === '#search-bills') {
		    // ✅ Auto-load today's bills
		    loadTodaysBills(); // ✅ We'll create this function next
		}
    });
});

// Event delegation for "View" buttons in search results (as they are dynamically added)
document.querySelector('#search-results-table tbody').addEventListener('click', (e) => {
    if (e.target.classList.contains('view-bill-btn')) {
        const billId = e.target.getAttribute('data-bill-id');
        if (billId) {
            showBillViewerPage(billId);
        } else {
            console.error("ERROR: 'View' button clicked but no data-bill-id found!");
        }
    }
});

// Attach event listeners for Bill Viewer Page buttons
document.getElementById('download-a4-pdf-btn').addEventListener('click', () => {
  generateBillOutput('a4');
});

document.getElementById('download-thermal-pdf-btn').addEventListener('click', () => {
  generateBillOutput('thermal');
});

document.getElementById('print-bill-btn').addEventListener('click', () => {
  window.print(); // Native print dialog
});

document.getElementById('back-to-portal-btn').addEventListener('click', showMainPortalView);

// Optional: Hide suggestions on outside click
document.addEventListener('click', (e) => {
  const phoneInput = document.getElementById('bill-phone-number');
  const suggestionBox = document.getElementById('phone-suggestion-box');
  if (!suggestionBox.contains(e.target) && e.target !== phoneInput) {
    suggestionBox.style.display = 'none';
  }
});

