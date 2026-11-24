let API_BASE = 'http://localhost:3456';
let currentPage = 'dashboard';
let currentWeekOffset = 0;
let editingAppointmentId = null;
let editingCustomerId = null;
let editingServiceId = null;

function api(path, options = {}) {
  const url = API_BASE + '/api' + path;
  const config = {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  };
  if (config.body) config.body = JSON.stringify(config.body);
  return fetch(url, config).then(r => r.json());
}

function toast(msg, type = 'success') {
  const container = document.getElementById('toast-container');
  const t = document.createElement('div');
  t.className = 'toast toast-' + type;
  t.textContent = msg;
  container.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatTime(timeStr) {
  return timeStr || '';
}

function navigate(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + page).classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelector('.nav-item[data-page="' + page + '"]')?.classList.add('active');
  currentPage = page;
  loadPage(page);
}

async function loadPage(page) {
  switch (page) {
    case 'dashboard': loadDashboard(); break;
    case 'calendar': loadCalendar(); break;
    case 'customers': loadCustomers(); break;
    case 'services': loadServices(); break;
    case 'statistics': loadStatistics(); break;
    case 'settings': loadSettings(); break;
  }
}

// ====== DASHBOARD ======
async function loadDashboard() {
  const date = document.getElementById('dash-date').value || new Date().toISOString().split('T')[0];
  document.getElementById('dash-date').value = date;

  const [stats, appointments, settings] = await Promise.all([
    api('/statistics?start=' + date + '&end=' + date),
    api('/appointments?date=' + date),
    window.electronAPI?.getSettings() || api('/settings'),
  ]);

  const statsHtml = `
    <div class="stat-card stat-primary"><div class="stat-value">${appointments.length}</div><div class="stat-label">Termine heute</div></div>
    <div class="stat-card stat-success"><div class="stat-value">${appointments.filter(a => a.status === 'confirmed').length}</div><div class="stat-label">Bestätigt</div></div>
    <div class="stat-card stat-danger"><div class="stat-value">${appointments.filter(a => a.status === 'cancelled').length}</div><div class="stat-label">Abgesagt</div></div>
    <div class="stat-card stat-warning"><div class="stat-value">${stats.unique_customers || 0}</div><div class="stat-label">Kunden heute</div></div>
  `;
  document.getElementById('dash-stats').innerHTML = statsHtml;

  const list = document.getElementById('dash-appointments');
  if (appointments.length === 0) {
    list.innerHTML = '<div class="empty-state"><div class="icon">&#128197;</div><p>Keine Termine heute</p></div>';
    return;
  }
  list.innerHTML = appointments.map(a => renderAppointmentRow(a)).join('');
}

function renderAppointmentRow(a) {
  const statusClass = 'status-' + a.status;
  const statusLabel = { confirmed: 'Bestätigt', completed: 'Erledigt', cancelled: 'Abgesagt' }[a.status] || a.status;
  return `
    <div class="appointment-row">
      <div class="appointment-time" style="color:${a.service_color}">${a.time}</div>
      <div class="appointment-info">
        <div class="name">${a.customer_name}</div>
        <div class="detail">${a.service_name} &middot; ${a.duration} Min ${a.service_price ? '&middot; ' + a.service_price.toFixed(2).replace('.', ',') + ' €' : ''}</div>
      </div>
      <span class="status-badge ${statusClass}">${statusLabel}</span>
      <div class="appointment-actions">
        ${a.status === 'confirmed' ? `<button class="btn btn-sm btn-success" onclick="completeAppointment(${a.id})">&#10003;</button>` : ''}
        ${a.status === 'confirmed' ? `<button class="btn btn-sm" onclick="openShiftModal(${a.id})">&#9201;</button>` : ''}
        <button class="btn btn-sm" onclick="openEditAppointment(${a.id})">&#9998;</button>
        <button class="btn btn-sm btn-danger" onclick="cancelAppointment(${a.id})">&#10005;</button>
      </div>
    </div>
  `;
}

// ====== CALENDAR ======
async function loadCalendar() {
  const today = new Date();
  const startOfWeek = new Date(today);
  startOfWeek.setDate(today.getDate() + (currentWeekOffset * 7) - today.getDay() + 1);

  const dates = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(startOfWeek);
    d.setDate(startOfWeek.getDate() + i);
    dates.push(d);
  }

  const startDate = dates[0].toISOString().split('T')[0];
  const endDate = dates[6].toISOString().split('T')[0];

  document.getElementById('week-label').textContent =
    formatDate(startDate) + ' - ' + formatDate(endDate);

  const [appointments, workingHours] = await Promise.all([
    api('/appointments?start=' + startDate + '&end=' + endDate),
    api('/working-hours'),
  ]);

  const dayNames = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  const todayStr = new Date().toISOString().split('T')[0];

  // Build time slots from working hours
  let minTime = 9 * 60, maxTime = 18 * 60;
  workingHours.forEach(wh => {
    if (wh.is_active) {
      const [sh, sm] = wh.start_time.split(':').map(Number);
      const [eh, em] = wh.end_time.split(':').map(Number);
      minTime = Math.min(minTime, sh * 60 + sm);
      maxTime = Math.max(maxTime, eh * 60 + em);
    }
  });

  const slots = [];
  for (let m = minTime; m <= maxTime; m += 30) {
    slots.push(m);
  }

  const apptsByDate = {};
  appointments.forEach(a => {
    if (!apptsByDate[a.date]) apptsByDate[a.date] = [];
    apptsByDate[a.date].push(a);
  });

  // Header
  let html = '<div class="calendar-grid">';
  html += '<div class="calendar-header-row">';
  html += '<div class="calendar-header-cell"></div>';
  dates.forEach((d, i) => {
    const ds = d.toISOString().split('T')[0];
    const isToday = ds === todayStr;
    html += `<div class="calendar-header-cell ${isToday ? 'today' : ''}">${dayNames[i]} ${d.getDate()}.${d.getMonth()+1}.</div>`;
  });
  html += '</div><div class="calendar-body">';

  slots.forEach(slot => {
    const h = Math.floor(slot / 60);
    const m = slot % 60;
    const timeStr = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

    html += '<div class="calendar-row">';
    html += `<div class="calendar-time">${timeStr}</div>`;

    dates.forEach(d => {
      const ds = d.toISOString().split('T')[0];
      const dayAppts = (apptsByDate[ds] || []).filter(a => {
        const [ah, am] = a.time.split(':').map(Number);
        return ah * 60 + am === slot;
      });

      html += '<div class="calendar-cell">';
      dayAppts.forEach(a => {
        const statusClass = 'status-' + a.status;
        html += `<div class="calendar-appt ${statusClass}" style="background:${a.service_color}" onclick="openEditAppointment(${a.id})" title="${a.customer_name} - ${a.service_name}">${a.time} ${a.customer_name}</div>`;
      });
      html += '</div>';
    });
    html += '</div>';
  });

  html += '</div></div>';
  document.getElementById('calendar-view').innerHTML = html;
}

function changeWeek(delta) {
  currentWeekOffset += delta;
  loadCalendar();
}

// ====== CUSTOMERS ======
async function loadCustomers() {
  const search = document.getElementById('customer-search').value;
  const customers = await api('/customers?search=' + encodeURIComponent(search));

  const list = document.getElementById('customer-list');
  if (customers.length === 0) {
    list.innerHTML = '<div class="empty-state"><div class="icon">&#128101;</div><p>Keine Kunden gefunden</p></div>';
    return;
  }

  let html = '<table><thead><tr><th>Name</th><th>Email</th><th>Telefon</th><th>Notizen</th><th>Aktionen</th></tr></thead><tbody>';
  customers.forEach(c => {
    html += `<tr>
      <td><strong>${c.name}</strong></td>
      <td>${c.email || '-'}</td>
      <td>${c.phone || '-'}</td>
      <td style="max-width:150px;overflow:hidden;text-overflow:ellipsis">${c.notes || ''}</td>
      <td>
        <button class="btn btn-sm" onclick="openEditCustomer(${c.id})">Bearbeiten</button>
        <button class="btn btn-sm btn-danger" onclick="deleteCustomer(${c.id})">Löschen</button>
      </td>
    </tr>`;
  });
  html += '</tbody></table>';
  list.innerHTML = html;
}

// ====== SERVICES ======
async function loadServices() {
  const services = await api('/services?active=false');
  const list = document.getElementById('service-list');
  if (services.length === 0) {
    list.innerHTML = '<div class="empty-state"><div class="icon">&#128296;</div><p>Keine Dienstleistungen</p></div>';
    return;
  }

  let html = '<table><thead><tr><th>Name</th><th>Dauer</th><th>Preis</th><th>Status</th><th>Aktionen</th></tr></thead><tbody>';
  services.forEach(s => {
    html += `<tr>
      <td><span style="display:inline-block;width:12px;height:12px;background:${s.color};border-radius:50%;margin-right:8px;vertical-align:middle"></span>${s.name}</td>
      <td>${s.duration} Min</td>
      <td>${s.price ? s.price.toFixed(2).replace('.',',') + ' €' : '-'}</td>
      <td>${s.is_active ? '<span class="status-badge status-confirmed">Aktiv</span>' : '<span class="status-badge status-cancelled">Inaktiv</span>'}</td>
      <td><button class="btn btn-sm" onclick="openEditService(${s.id})">Bearbeiten</button></td>
    </tr>`;
  });
  html += '</tbody></table>';
  list.innerHTML = html;
}

// ====== STATISTICS ======
async function loadStatistics() {
  const end = document.getElementById('stats-end').value || new Date().toISOString().split('T')[0];
  const start = document.getElementById('stats-start').value || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  document.getElementById('stats-start').value = start;
  document.getElementById('stats-end').value = end;

  const stats = await api('/statistics?start=' + start + '&end=' + end);

  document.getElementById('stats-cards').innerHTML = `
    <div class="stat-card stat-primary"><div class="stat-value">${stats.total_appointments || 0}</div><div class="stat-label">Termine gesamt</div></div>
    <div class="stat-card stat-success"><div class="stat-value">${stats.completed || 0}</div><div class="stat-label">Erledigt</div></div>
    <div class="stat-card stat-danger"><div class="stat-value">${stats.cancelled || 0}</div><div class="stat-label">Abgesagt</div></div>
    <div class="stat-card stat-primary"><div class="stat-value">${stats.total_revenue ? stats.total_revenue.toFixed(2).replace('.', ',') + ' €' : '0,00 €'}</div><div class="stat-label">Umsatz</div></div>
  `;

  const serviceHtml = stats.byService && stats.byService.length > 0
    ? '<table><thead><tr><th>Dienstleistung</th><th>Anzahl</th><th>Umsatz</th></tr></thead><tbody>'
      + stats.byService.map(s => `<tr><td>${s.name}</td><td>${s.count}</td><td>${s.revenue.toFixed(2).replace('.', ',')} €</td></tr>`).join('')
      + '</tbody></table>'
    : '<div class="empty-state"><p>Keine Daten im gewählten Zeitraum</p></div>';
  document.getElementById('stats-by-service').innerHTML = serviceHtml;
}

// ====== SETTINGS ======
async function loadSettings() {
  const settings = await window.electronAPI?.getSettings() || await api('/settings');
  const workingHours = await api('/working-hours');
  const blockedDates = await api('/blocked-dates');

  const settingFields = ['shop_name', 'shop_address', 'booking_lead_time', 'smpt_host', 'smpt_port', 'smpt_user', 'smpt_pass', 'smpt_from'];
  settingFields.forEach(key => {
    const el = document.getElementById('set-' + key);
    if (el) el.value = settings[key] || '';
  });

  const dayNames = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
  const whHtml = workingHours.map(wh => `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
      <label style="min-width:90px;margin:0;font-weight:500;color:var(--text)">${dayNames[wh.day_of_week]}</label>
      <input type="time" value="${wh.start_time}" onchange="updateWorkingHour(${wh.id}, 'start_time', this.value)" style="width:100px">
      <span>bis</span>
      <input type="time" value="${wh.end_time}" onchange="updateWorkingHour(${wh.id}, 'end_time', this.value)" style="width:100px">
      <label style="margin:0;display:flex;align-items:center;gap:4px">
        <input type="checkbox" ${wh.is_active ? 'checked' : ''} onchange="updateWorkingHour(${wh.id}, 'is_active', this.checked)">
        Aktiv
      </label>
    </div>
  `).join('');
  document.getElementById('working-hours-list').innerHTML = whHtml;

  renderBlockedDates(blockedDates);
  renderServerInfo();
}

function renderBlockedDates(dates) {
  const list = document.getElementById('blocked-dates-list');
  if (!dates || dates.length === 0) {
    list.innerHTML = '<p style="color:var(--text-muted);font-size:12px;">Keine blockierten Daten</p>';
    return;
  }
  list.innerHTML = dates.map(d => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid var(--border);font-size:13px">
      <span><strong>${formatDate(d.date)}</strong> ${d.reason ? '- ' + d.reason : ''}</span>
      <button class="btn btn-sm btn-danger" onclick="removeBlockedDate('${d.date}')">Löschen</button>
    </div>
  `).join('');
}

async function renderServerInfo() {
  const info = await window.electronAPI?.getServerInfo() || { ip: 'localhost', port: 3456 };
  document.getElementById('server-status').textContent = 'http://' + info.ip + ':' + info.port;
}

function copyBookingUrl() {
  const el = document.getElementById('server-status');
  const url = el.textContent + '/public/booking.html';
  navigator.clipboard.writeText(url).then(() => toast('Buchungs-URL kopiert!')).catch(() => toast('Fehler beim Kopieren', 'error'));
}

async function saveSetting(key, value) {
  await window.electronAPI?.updateSetting(key, value) || api('/settings/' + key, { method: 'PUT', body: { value } });
  toast('Gespeichert');
}

async function updateWorkingHour(id, field, value) {
  const body = {};
  if (field === 'is_active') {
    const wh = await api('/working-hours');
    const current = wh.find(w => w.id === id);
    body.start_time = current.start_time;
    body.end_time = current.end_time;
    body.is_active = value;
  } else if (field === 'start_time') {
    const wh = await api('/working-hours');
    const current = wh.find(w => w.id === id);
    body.start_time = value;
    body.end_time = current.end_time;
    body.is_active = current.is_active;
  } else if (field === 'end_time') {
    const wh = await api('/working-hours');
    const current = wh.find(w => w.id === id);
    body.start_time = current.start_time;
    body.end_time = value;
    body.is_active = current.is_active;
  }
  await api('/working-hours/' + id, { method: 'PUT', body });
  toast('Öffnungszeiten gespeichert');
}

async function addBlockedDate() {
  const date = document.getElementById('blocked-date-input').value;
  const reason = document.getElementById('blocked-reason-input').value;
  if (!date) return toast('Bitte Datum wählen', 'error');
  await api('/blocked-dates', { method: 'POST', body: { date, reason } });
  document.getElementById('blocked-date-input').value = '';
  document.getElementById('blocked-reason-input').value = '';
  const dates = await api('/blocked-dates');
  renderBlockedDates(dates);
  toast('Geschlossen am ' + formatDate(date));
}

async function removeBlockedDate(date) {
  await api('/blocked-dates/' + date, { method: 'DELETE' });
  const dates = await api('/blocked-dates');
  renderBlockedDates(dates);
  toast('Blockiertes Datum entfernt');
}

// ====== APPOINTMENT MODALS ======
function openNewAppointment(date, time) {
  editingAppointmentId = null;
  const modal = document.getElementById('modal-overlay');
  document.getElementById('modal-title').textContent = 'Neuer Termin';
  document.getElementById('modal-body').innerHTML = `
    <div class="form-group">
      <label>Kunde</label>
      <select id="appt-customer"><option value="">Kunde auswählen...</option></select>
      <button class="btn btn-sm" style="margin-top:5px" onclick="openNewCustomer()">+ Neuen Kunden anlegen</button>
    </div>
    <div class="form-group">
      <label>Dienstleistung</label>
      <select id="appt-service" onchange="updateApptDuration()"><option value="">Wählen...</option></select>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Datum</label>
        <input type="date" id="appt-date" value="${date || new Date().toISOString().split('T')[0]}">
      </div>
      <div class="form-group">
        <label>Zeit</label>
        <input type="time" id="appt-time" value="${time || '10:00'}">
      </div>
    </div>
    <div class="form-group">
      <label>Dauer (Minuten)</label>
      <input type="number" id="appt-duration" value="30">
    </div>
    <div class="form-group">
      <label>Notizen</label>
      <textarea id="appt-notes" rows="2"></textarea>
    </div>
    <div class="form-actions">
      <button class="btn" onclick="closeModal()">Abbrechen</button>
      <button class="btn btn-primary" onclick="saveAppointment()">Termin erstellen</button>
    </div>
  `;
  modal.classList.remove('hidden');

  loadCustomerSelect();
  loadServiceSelect();
}

async function openEditAppointment(id) {
  editingAppointmentId = id;
  const a = await api('/appointments/' + id);
  const modal = document.getElementById('modal-overlay');
  document.getElementById('modal-title').textContent = 'Termin bearbeiten';
  document.getElementById('modal-body').innerHTML = `
    <div class="form-group">
      <label>Kunde</label>
      <select id="appt-customer"><option value="">Kunde auswählen...</option></select>
    </div>
    <div class="form-group">
      <label>Dienstleistung</label>
      <select id="appt-service" onchange="updateApptDuration()"><option value="">Wählen...</option></select>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Datum</label>
        <input type="date" id="appt-date" value="${a.date}">
      </div>
      <div class="form-group">
        <label>Zeit</label>
        <input type="time" id="appt-time" value="${a.time}">
      </div>
    </div>
    <div class="form-group">
      <label>Status</label>
      <select id="appt-status">
        <option value="confirmed" ${a.status === 'confirmed' ? 'selected' : ''}>Bestätigt</option>
        <option value="completed" ${a.status === 'completed' ? 'selected' : ''}>Erledigt</option>
        <option value="cancelled" ${a.status === 'cancelled' ? 'selected' : ''}>Abgesagt</option>
      </select>
    </div>
    <div class="form-group">
      <label>Dauer (Minuten)</label>
      <input type="number" id="appt-duration" value="${a.duration}">
    </div>
    <div class="form-group">
      <label>Notizen</label>
      <textarea id="appt-notes" rows="2">${a.notes || ''}</textarea>
    </div>
    <div class="form-actions">
      <button class="btn" onclick="closeModal()">Abbrechen</button>
      <button class="btn btn-primary" onclick="saveAppointment()">Speichern</button>
    </div>
  `;
  modal.classList.remove('hidden');

  await loadCustomerSelect(a.customer_id);
  await loadServiceSelect(a.service_id);
  document.getElementById('appt-duration').value = a.duration;
}

async function loadCustomerSelect(selectedId) {
  const customers = await api('/customers');
  const sel = document.getElementById('appt-customer');
  sel.innerHTML = '<option value="">Kunde auswählen...</option>'
    + customers.map(c => `<option value="${c.id}" ${c.id === selectedId ? 'selected' : ''}>${c.name} ${c.email ? ' (' + c.email + ')' : ''}</option>`).join('');
}

async function loadServiceSelect(selectedId) {
  const services = await api('/services');
  const sel = document.getElementById('appt-service');
  sel.innerHTML = '<option value="">Wählen...</option>'
    + services.map(s => `<option value="${s.id}" data-duration="${s.duration}" ${s.id === selectedId ? 'selected' : ''}>${s.name} (${s.duration} Min)</option>`).join('');
  updateApptDuration();
}

function updateApptDuration() {
  const sel = document.getElementById('appt-service');
  const dur = document.getElementById('appt-duration');
  if (sel.selectedIndex > 0) {
    const option = sel.options[sel.selectedIndex];
    dur.value = option.dataset.duration || 30;
  }
}

async function saveAppointment() {
  const customer_id = parseInt(document.getElementById('appt-customer').value);
  const service_id = parseInt(document.getElementById('appt-service').value);
  const date = document.getElementById('appt-date').value;
  const time = document.getElementById('appt-time').value;
  const duration = parseInt(document.getElementById('appt-duration').value);
  const notes = document.getElementById('appt-notes').value;
  const status = document.getElementById('appt-status')?.value;

  if (!customer_id) return toast('Bitte Kunde auswählen', 'error');
  if (!service_id) return toast('Bitte Dienstleistung auswählen', 'error');
  if (!date || !time) return toast('Bitte Datum und Zeit wählen', 'error');

  try {
    if (editingAppointmentId) {
      const body = { customer_id, service_id, date, time, duration, notes };
      if (status) body.status = status;
      await api('/appointments/' + editingAppointmentId, { method: 'PUT', body });
      toast('Termin aktualisiert');
    } else {
      await api('/appointments', { method: 'POST', body: { customer_id, service_id, date, time, duration, notes } });
      toast('Termin erstellt');
    }
    closeModal();
    loadPage(currentPage);
  } catch (e) {
    toast('Fehler beim Speichern', 'error');
  }
}

async function cancelAppointment(id) {
  if (!confirm('Termin wirklich absagen?')) return;
  await api('/appointments/' + id, { method: 'PUT', body: { status: 'cancelled' } });
  toast('Termin abgesagt');
  loadPage(currentPage);
}

async function completeAppointment(id) {
  await api('/appointments/' + id, { method: 'PUT', body: { status: 'completed' } });
  toast('Termin als erledigt markiert');
  loadPage(currentPage);
}

// ====== SHIFT MODAL ======
async function openShiftModal(appointmentId) {
  const a = await api('/appointments/' + appointmentId);
  const modal = document.getElementById('modal-overlay');
  document.getElementById('modal-title').textContent = 'Termine verschieben';
  document.getElementById('modal-body').innerHTML = `
    <p style="margin-bottom:15px">Der Termin von <strong>${a.customer_name}</strong> um <strong>${a.time}</strong> hat länger gedauert.</p>
    <div class="form-group">
      <label>Verzögerung in Minuten</label>
      <input type="number" id="shift-minutes" value="15" min="5" max="120">
    </div>
    <p style="font-size:13px;color:var(--text-muted);margin-bottom:15px">Alle nachfolgenden Termine an diesem Tag werden um diese Zeit nach hinten verschoben. Betroffene Kunden erhalten eine Benachrichtigung.</p>
    <div class="form-actions">
      <button class="btn" onclick="closeModal()">Abbrechen</button>
      <button class="btn btn-primary" onclick="doShift(${appointmentId})">Verschieben</button>
    </div>
  `;
  modal.classList.remove('hidden');
}

async function doShift(appointmentId) {
  const minutes = parseInt(document.getElementById('shift-minutes').value);
  if (!minutes || minutes < 1) return toast('Bitte gültige Minutenanzahl', 'error');

  try {
    const result = await api('/appointments/' + appointmentId + '/shift', { method: 'POST', body: { minutes } });
    toast(result.shifted + ' Termine wurden verschoben und Kunden benachrichtigt');
    closeModal();
    loadPage(currentPage);
  } catch (e) {
    toast('Fehler beim Verschieben', 'error');
  }
}

// ====== CUSTOMER MODALS ======
function openNewCustomer() {
  editingCustomerId = null;
  const modal = document.getElementById('modal-overlay');
  document.getElementById('modal-title').textContent = 'Neuer Kunde';
  document.getElementById('modal-body').innerHTML = `
    <div class="form-group"><label>Name *</label><input type="text" id="cust-name"></div>
    <div class="form-group"><label>Email</label><input type="email" id="cust-email"></div>
    <div class="form-group"><label>Telefon</label><input type="tel" id="cust-phone"></div>
    <div class="form-group"><label>Notizen</label><textarea id="cust-notes" rows="3"></textarea></div>
    <div class="form-actions">
      <button class="btn" onclick="closeModal()">Abbrechen</button>
      <button class="btn btn-primary" onclick="saveCustomer()">Kunde anlegen</button>
    </div>
  `;
  modal.classList.remove('hidden');
}

async function openEditCustomer(id) {
  editingCustomerId = id;
  const c = await api('/customers/' + id);
  const modal = document.getElementById('modal-overlay');
  document.getElementById('modal-title').textContent = 'Kunde bearbeiten';
  document.getElementById('modal-body').innerHTML = `
    <div class="form-group"><label>Name *</label><input type="text" id="cust-name" value="${c.name}"></div>
    <div class="form-group"><label>Email</label><input type="email" id="cust-email" value="${c.email || ''}"></div>
    <div class="form-group"><label>Telefon</label><input type="tel" id="cust-phone" value="${c.phone || ''}"></div>
    <div class="form-group"><label>Notizen</label><textarea id="cust-notes" rows="3">${c.notes || ''}</textarea></div>
    <div class="form-actions">
      <button class="btn" onclick="closeModal()">Abbrechen</button>
      <button class="btn btn-primary" onclick="saveCustomer()">Speichern</button>
    </div>
  `;
  modal.classList.remove('hidden');
}

async function saveCustomer() {
  const name = document.getElementById('cust-name').value.trim();
  const email = document.getElementById('cust-email').value.trim();
  const phone = document.getElementById('cust-phone').value.trim();
  const notes = document.getElementById('cust-notes').value.trim();

  if (!name) return toast('Bitte Namen eingeben', 'error');

  try {
    if (editingCustomerId) {
      await api('/customers/' + editingCustomerId, { method: 'PUT', body: { name, email, phone, notes } });
      toast('Kunde aktualisiert');
    } else {
      await api('/customers', { method: 'POST', body: { name, email, phone, notes } });
      toast('Kunde angelegt');

      if (document.getElementById('appt-customer')) {
        await loadCustomerSelect(parseInt(localStorage.getItem('lastCustomerId')));
      }
    }
    closeModal();
    loadPage(currentPage);
  } catch (e) {
    toast('Fehler beim Speichern', 'error');
  }
}

async function deleteCustomer(id) {
  if (!confirm('Kunden wirklich löschen?')) return;
  await api('/customers/' + id, { method: 'DELETE' });
  toast('Kunde gelöscht');
  loadCustomers();
}

// ====== SERVICE MODALS ======
function openNewService() {
  editingServiceId = null;
  const modal = document.getElementById('modal-overlay');
  document.getElementById('modal-title').textContent = 'Neue Dienstleistung';
  document.getElementById('modal-body').innerHTML = `
    <div class="form-group"><label>Name *</label><input type="text" id="serv-name"></div>
    <div class="form-row">
      <div class="form-group"><label>Dauer (Minuten)</label><input type="number" id="serv-duration" value="30"></div>
      <div class="form-group"><label>Preis (€)</label><input type="number" id="serv-price" step="0.5" value="0"></div>
    </div>
    <div class="form-group"><label>Farbe</label><input type="color" id="serv-color" value="#4A90D9"></div>
    <div class="form-actions">
      <button class="btn" onclick="closeModal()">Abbrechen</button>
      <button class="btn btn-primary" onclick="saveService()">Anlegen</button>
    </div>
  `;
  modal.classList.remove('hidden');
}

async function openEditService(id) {
  editingServiceId = id;
  const s = await api('/services/' + id);
  const modal = document.getElementById('modal-overlay');
  document.getElementById('modal-title').textContent = 'Dienstleistung bearbeiten';
  document.getElementById('modal-body').innerHTML = `
    <div class="form-group"><label>Name *</label><input type="text" id="serv-name" value="${s.name}"></div>
    <div class="form-row">
      <div class="form-group"><label>Dauer (Minuten)</label><input type="number" id="serv-duration" value="${s.duration}"></div>
      <div class="form-group"><label>Preis (€)</label><input type="number" id="serv-price" step="0.5" value="${s.price || 0}"></div>
    </div>
    <div class="form-group"><label>Farbe</label><input type="color" id="serv-color" value="${s.color}"></div>
    <div class="form-group">
      <label>Aktiv <input type="checkbox" id="serv-active" ${s.is_active ? 'checked' : ''} style="width:auto;margin-left:8px"></label>
    </div>
    <div class="form-actions">
      <button class="btn" onclick="closeModal()">Abbrechen</button>
      <button class="btn btn-primary" onclick="saveService()">Speichern</button>
    </div>
  `;
  modal.classList.remove('hidden');
}

async function saveService() {
  const name = document.getElementById('serv-name').value.trim();
  const duration = parseInt(document.getElementById('serv-duration').value);
  const price = parseFloat(document.getElementById('serv-price').value) || 0;
  const color = document.getElementById('serv-color').value;
  const is_active = document.getElementById('serv-active')?.checked !== undefined ? document.getElementById('serv-active').checked : true;

  if (!name || !duration) return toast('Bitte Name und Dauer eingeben', 'error');

  try {
    if (editingServiceId) {
      await api('/services/' + editingServiceId, { method: 'PUT', body: { name, duration, price, color, is_active } });
      toast('Dienstleistung aktualisiert');
    } else {
      await api('/services', { method: 'POST', body: { name, duration, price, color } });
      toast('Dienstleistung angelegt');
    }
    closeModal();
    loadServices();
  } catch (e) {
    toast('Fehler beim Speichern', 'error');
  }
}

// ====== HELPERS ======
function closeModal(e) {
  if (e && e.target !== document.getElementById('modal-overlay')) return;
  document.getElementById('modal-overlay').classList.add('hidden');
  editingAppointmentId = null;
  editingCustomerId = null;
  editingServiceId = null;
}

// Init
document.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('dash-date').value = new Date().toISOString().split('T')[0];
  loadDashboard();

  if (window.electronAPI) {
    window.electronAPI.onNavigate((page) => navigate(page));
  }
});

// Call navigate on load to activate the dashboard
navigate('dashboard');
