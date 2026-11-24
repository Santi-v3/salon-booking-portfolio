let currentPage = 'dashboard';
let currentMonthOffset = 0;
let editingAppointmentId = null;
let editingCustomerId = null;
let editingServiceId = null;

async function api(path, options = {}) {
  const config = {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    ...options,
  };
  if (config.body) config.body = JSON.stringify(config.body);
  const res = await fetch('/api' + path, config);
  if (res.status === 401) { window.location.href = '/login.html'; return null; }
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || data.error || 'Fehler');
  return data;
}

function toast(msg, type = 'success') {
  const c = document.getElementById('toast-container');
  const t = document.createElement('div');
  t.className = 'toast toast-' + type;
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

function formatDate(d) {
  return new Date(d + 'T12:00:00').toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
}

function formatDateFull(d) {
  return new Date(d + 'T12:00:00').toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
}

function navigate(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + page).classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelector('.nav-item[data-page="' + page + '"]')?.classList.add('active');
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelector('.tab[data-page="' + page + '"]')?.classList.add('active');
  currentPage = page;
  loadPage(page);
}

async function loadPage(page) {
  const fns = { dashboard: loadDashboard, calendar: loadCalendar, appointments: loadAllAppointments, customers: loadCustomers, services: loadServices, statistics: loadStatistics, settings: loadSettings };
  if (fns[page]) fns[page]();
}

// ====== RENDER HELPERS ======
const statusMeta = {
  open: { label: 'Offen', cls: 'status-open' },
  confirmed: { label: 'Bestätigt', cls: 'status-confirmed' },
  completed: { label: 'Erledigt', cls: 'status-completed' },
  cancelled: { label: 'Abgesagt', cls: 'status-cancelled' },
};

function renderAppt(a) {
  const m = statusMeta[a.status] || { label: a.status, cls: '' };
  const isOpen = a.status === 'open';
  return `<div class="appt-item ${isOpen ? 'appt-open' : ''}" onclick="openAppointmentDetail(${a.id})">
    <div class="appt-time" style="color:${a.service_color}">${a.time}</div>
    <div class="appt-info">
      <div class="appt-name">${a.customer_name}</div>
      <div class="appt-detail">${a.service_name} · ${a.duration} Min</div>
    </div>
    <span class="status ${m.cls}">${m.label}</span>
    <div class="appt-actions">
      ${isOpen ? `<button class="btn btn-sm btn-success" onclick="event.stopPropagation();openConfirmAppointment(${a.id})">✓ Bestätigen</button>` : ''}
      ${isOpen ? `<button class="btn btn-sm btn-danger" onclick="event.stopPropagation();rejectAppointment(${a.id})">✕</button>` : ''}
      ${a.status === 'confirmed' ? `<button class="btn btn-sm btn-primary" onclick="event.stopPropagation();completeAppointment(${a.id})">✓</button>` : ''}
      <button class="btn btn-sm" onclick="event.stopPropagation();openEditAppointment(${a.id})">✎</button>
      ${a.status === 'confirmed' ? `<button class="btn btn-sm btn-danger" onclick="event.stopPropagation();cancelAppointment(${a.id})">✕</button>` : ''}
      ${a.status === 'cancelled' ? `<button class="btn btn-sm btn-danger" onclick="event.stopPropagation();deleteAppointmentItem(${a.id})">🗑</button>` : ''}
    </div>
  </div>`;
}

async function openAppointmentDetail(id) {
  const a = await api('/appointments/' + id);
  window._curCustomer = { id: a.customer_id, name: a.customer_name, email: a.customer_email, phone: a.customer_phone };
  const m = statusMeta[a.status] || { label: a.status, cls: '' };
  document.getElementById('modal-title').textContent = a.customer_name;
  let html = `
    <div class="appt-detail-modal">
      <div class="adm-row">
        <span class="status ${m.cls}" style="font-size:13px;padding:4px 12px">${m.label}</span>
        <span class="adm-muted">${a.service_name} · ${a.duration} Min</span>
      </div>
      <div class="adm-dt">${formatDateFull(a.date)}</div>
      <div class="adm-time" style="color:${a.service_color}">${a.time} Uhr</div>
      ${a.notes ? '<div class="adm-notes">' + a.notes + '</div>' : ''}
      <div class="adm-contact" style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border)">
        <div style="margin-bottom:4px"><strong>Email:</strong> ${a.customer_email ? `<a href="#" onclick="event.preventDefault();showEmailCompose()" style="color:var(--primary);text-decoration:underline">${a.customer_email}</a>` : '-'}</div>
        <div><strong>Telefon:</strong> ${a.customer_phone ? `<a href="tel:${a.customer_phone.replace(/[^\d+]/g,'')}" style="color:var(--primary);text-decoration:underline">${a.customer_phone}</a>` : '-'}</div>
      </div>
    </div>
    <div class="adm-actions">`;
  if (a.status === 'open') html += `<button class="btn btn-primary" onclick="openConfirmAppointment(${a.id})">✓ Bestätigen</button>`;
  if (a.status === 'confirmed') html += `<button class="btn btn-primary" onclick="closeModal();completeAppointment(${a.id})">✓ Erledigen</button>`;
  if (a.status === 'open') html += `<button class="btn btn-danger" onclick="if(!confirm('Termin ablehnen?'))return;closeModal();api('/appointments/'+${a.id},{method:'PUT',body:{status:'cancelled'}}).then(()=>{toast('Abgesagt');loadPage('${currentPage}')})">✕ Ablehnen</button>`;
  if (a.status === 'confirmed') html += `<button class="btn btn-danger" onclick="if(!confirm('Termin absagen?'))return;closeModal();api('/appointments/'+${a.id},{method:'PUT',body:{status:'cancelled'}}).then(()=>{toast('Abgesagt');loadPage('${currentPage}')})">✕ Absagen</button>`;
  html += `<button class="btn" onclick="openEditAppointment(${a.id})">✎ Bearbeiten</button>`;
  html += `<button class="btn btn-danger" onclick="if(!confirm('Termin endgültig löschen?'))return;closeModal();api('/appointments/'+${a.id},{method:'DELETE'}).then(()=>{toast('Gelöscht');loadPage('${currentPage}')})">✕ Löschen</button>`;
  html += `<button class="btn" onclick="closeModal()">Schließen</button>`;
  html += `</div>`;
  document.getElementById('modal-body').innerHTML = html;
  document.getElementById('modal-overlay').classList.remove('hidden');
}

// ====== DASHBOARD ======
let dashWeekOffset = 0;

function changeDashWeek(delta) {
  dashWeekOffset += delta;
  loadDashboard();
}

function getWeekRange(offset) {
  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? 6 : day - 1;
  const mon = new Date(now);
  mon.setDate(now.getDate() - diff + offset * 7);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);

  const months = ['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez'];
  const monStr = mon.getDate() + '. ' + months[mon.getMonth()];
  const sunStr = sun.getDate() + '. ' + months[sun.getMonth()];
  const same = mon.getMonth() === sun.getMonth();
  return {
    start: mon.toISOString().split('T')[0],
    end: sun.toISOString().split('T')[0],
    label: same ? mon.getDate() + '. – ' + sunStr : monStr + ' – ' + sunStr
  };
}

async function loadDashboard() {
  const range = getWeekRange(dashWeekOffset);
  document.getElementById('dash-week-label').textContent = range.label;

  const appointments = await api('/appointments?start=' + range.start + '&end=' + range.end);
  document.getElementById('dash-stats').innerHTML = `
    <div class="stat-card primary"><div class="stat-value">${appointments.length}</div><div class="stat-label">Termine (Woche)</div></div>
    <div class="stat-card warning"><div class="stat-value">${appointments.filter(a => a.status === 'open').length}</div><div class="stat-label">Offen (Woche)</div></div>
    <div class="stat-card success"><div class="stat-value">${appointments.filter(a => a.status === 'confirmed').length}</div><div class="stat-label">Bestätigt (Woche)</div></div>
    <div class="stat-card danger"><div class="stat-value">${appointments.filter(a => a.status === 'cancelled').length}</div><div class="stat-label">Abgesagt (Woche)</div></div>`;

  const list = document.getElementById('dash-appointments');
  if (!appointments.length) {
    list.innerHTML = '<div class="empty-state"><div class="icon">&#128197;</div><p>Keine Termine diese Woche</p></div>';
  } else {
    const grouped = {};
    appointments.forEach(a => { if (!grouped[a.date]) grouped[a.date] = []; grouped[a.date].push(a); });
    let html = '';
    Object.keys(grouped).sort().forEach(d => {
      const dayAppts = grouped[d];
      const hasActive = dayAppts.some(a => a.status !== 'cancelled');
      if (!hasActive) return;
      html += `<div style="font-size:12px;font-weight:600;color:var(--text-muted);margin:8px 0 4px 4px">${formatDateFull(d)}</div>`;
      html += '<div class="appt-list">' + dayAppts.map(a => renderAppt(a)).join('') + '</div>';
    });
    if (!html) html = '<div class="empty-state"><p>Keine Termine diese Woche</p></div>';
    list.innerHTML = html;
  }
}

// ====== CALENDAR (MONTH VIEW) ======
async function loadCalendar() {
  if (!calendarDayDate && currentMonthOffset === 0) {
    calendarDayDate = toStr(new Date());
  }
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth() + currentMonthOffset;
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const daysInMonth = lastDay.getDate();
  const startPad = firstDay.getDay();
  const startDate = new Date(year, month, 1);
  startDate.setDate(startDate.getDate() - startPad);
  const endDate = new Date(year, month + 1, 0);
  endDate.setDate(endDate.getDate() + (6 - endDate.getDay()));

  const label = firstDay.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
  document.getElementById('week-label').textContent = label;

  const [appointments] = await Promise.all([api('/appointments?start=' + toStr(startDate) + '&end=' + toStr(endDate))]);
  const byDate = {};
  appointments.forEach(a => {
    if (a.status === 'cancelled') return;
    if (!byDate[a.date]) byDate[a.date] = [];
    byDate[a.date].push(a);
  });

  const dayNames = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  const todayStr = toStr(today);
  let html = '<div class="day-headers">' + dayNames.map(d => `<div class="day-header">${d}</div>`).join('') + '</div>';
  html += '<div class="day-grid">';

  const d = new Date(startDate);
  for (let row = 0; row < 6; row++) {
    for (let col = 0; col < 7; col++) {
      const ds = toStr(d);
      const isCurrentMonth = d.getMonth() === month;
      const isToday = ds === todayStr;
      const dayAppts = byDate[ds] || [];
      const isPast = d < new Date(todayStr + 'T00:00:00');
      const dots = [];
      dayAppts.forEach(a => {
        const dotColor = a.status === 'open' ? '#b5b5c3' : a.status === 'confirmed' ? '#22b573' : '#4f6ef7';
        dots.push(`<span class="cal-dot" style="background:${dotColor}" title="${a.time} ${a.customer_name}"></span>`);
      });
      html += `<div class="cal-day ${isToday ? 'today' : ''} ${!isCurrentMonth ? 'cal-dim' : ''}" onclick="showCalendarDay('${ds}')" ondblclick="openNewAppointment('${ds}')">
        <div class="day-num ${isPast && isCurrentMonth ? 'cal-past' : ''}">${d.getDate()}</div>
        ${dots.length ? '<div class="cal-dots">' + dots.join('') + '</div>' : ''}
      </div>`;
      d.setDate(d.getDate() + 1);
    }
  }
  html += '</div>';

  if (calendarDayDate) {
    const dayAppts = byDate[calendarDayDate] || [];
    html += `<div class="card" style="margin-top:12px">
      <div class="card-header">${formatDateFull(calendarDayDate)}</div>
      <div class="card-body">${dayAppts.length ? '<div class="appt-list">' + dayAppts.map(a => renderAppt(a)).join('') + '</div>' : '<div class="empty-state"><p>Keine Termine</p></div>'}</div>
    </div>`;
  }

  document.getElementById('calendar-view').innerHTML = html;
}

let calendarDayDate = null;

function toStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

function changeMonth(delta) {
  currentMonthOffset += delta;
  calendarDayDate = null;
  loadCalendar();
}

function showCalendarDay(dateStr) {
  calendarDayDate = calendarDayDate === dateStr ? null : dateStr;
  loadCalendar();
}

// ====== CONFIRM MODAL ======
function openConfirmAppointment(id) {
  editingAppointmentId = id;
  api('/appointments/' + id).then(a => {
    document.getElementById('modal-title').textContent = 'Termin bestätigen';
    document.getElementById('modal-body').innerHTML = `
      <p style="margin-bottom:12px;color:var(--text-muted)">Kunde: <strong>${a.customer_name}</strong> · ${a.service_name}</p>
      <div class="form-row"><div class="form-group"><label>Datum</label><input type="date" id="conf-date" value="${a.date}"></div><div class="form-group"><label>Zeit</label><input type="time" id="conf-time" value="${a.time}"></div></div>
      <div class="form-group"><label>Dauer (Min.)</label><input type="number" id="conf-duration" value="${a.duration}"></div>
      <div style="display:flex;gap:10px;margin-top:16px">
        <button class="btn" style="flex:1" onclick="closeModal()">Ablehnen</button>
        <button class="btn btn-primary" style="flex:2" onclick="doConfirmAppointment(${a.id})">✓ Bestätigen & Mail senden</button>
      </div>`;
    document.getElementById('modal-overlay').classList.remove('hidden');
  });
}

async function doConfirmAppointment(id) {
  const date = document.getElementById('conf-date').value;
  const time = document.getElementById('conf-time').value;
  const duration = parseInt(document.getElementById('conf-duration').value);
  if (!date || !time) return toast('Datum und Zeit erforderlich', 'error');
  try {
    await api('/appointments/' + id, { method: 'PUT', body: { status: 'confirmed', date, time, duration } });
    toast('Termin bestätigt – Kunde benachrichtigt');
    closeModal();
    loadPage(currentPage);
  } catch (e) { toast(e.message || 'Fehler', 'error'); }
}

async function rejectAppointment(id) {
  if (!confirm('Termin ablehnen? Der Kunde erhält eine Benachrichtigung.')) return;
  await api('/appointments/' + id, { method: 'PUT', body: { status: 'cancelled' } });
  toast('Termin abgelehnt – Kunde benachrichtigt');
  loadPage(currentPage);
}

// ====== APPOINTMENT EDIT ======
function openNewAppointment(date, time) {
  editingAppointmentId = null;
  document.getElementById('modal-title').textContent = 'Neuer Termin';
  document.getElementById('modal-body').innerHTML = `
    <div class="form-group"><label>Kunde</label><select id="appt-customer"><option value="">Kunde wählen...</option></select><button class="btn btn-sm" style="margin-top:6px" onclick="openNewCustomer()">+ Neuer Kunde</button></div>
    <div class="form-group"><label>Service</label><select id="appt-service" onchange="updDur()"><option value="">Service wählen...</option></select></div>
    <div class="form-row"><div class="form-group"><label>Datum</label><input type="date" id="appt-date" value="${date || new Date().toISOString().split('T')[0]}"></div><div class="form-group"><label>Zeit</label><input type="time" id="appt-time" value="${time || '10:00'}"></div></div>
    <div class="form-group"><label>Dauer</label><input type="number" id="appt-duration" value="30"></div>
    <div class="form-actions"><button class="btn" onclick="closeModal()">Abbrechen</button><button class="btn btn-primary" onclick="saveAppointment()">Anlegen</button></div>`;
  document.getElementById('modal-overlay').classList.remove('hidden');
  loadCustSelect();
  loadServSelect();
}

async function openEditAppointment(id) {
  editingAppointmentId = id;
  const a = await api('/appointments/' + id);
  document.getElementById('modal-title').textContent = 'Termin bearbeiten';
  document.getElementById('modal-body').innerHTML = `
    <div class="form-group"><label>Kunde</label><select id="appt-customer"></select></div>
    <div class="form-group"><label>Service</label><select id="appt-service" onchange="updDur()"></select></div>
    <div class="form-row"><div class="form-group"><label>Datum</label><input type="date" id="appt-date" value="${a.date}"></div><div class="form-group"><label>Zeit</label><input type="time" id="appt-time" value="${a.time}"></div></div>
    <div class="form-group"><label>Status</label><select id="appt-status"><option value="open" ${a.status === 'open' ? 'selected' : ''}>Offen</option><option value="confirmed" ${a.status === 'confirmed' ? 'selected' : ''}>Bestätigt</option><option value="completed" ${a.status === 'completed' ? 'selected' : ''}>Erledigt</option><option value="cancelled" ${a.status === 'cancelled' ? 'selected' : ''}>Abgesagt</option></select></div>
    <div class="form-group"><label>Dauer</label><input type="number" id="appt-duration" value="${a.duration}"></div>
    <div class="form-group"><label>Notizen</label><textarea id="appt-notes" rows="2">${a.notes || ''}</textarea></div>
    <div class="form-actions"><button class="btn" onclick="closeModal()">Abbrechen</button><button class="btn btn-primary" onclick="saveAppointment()">Speichern</button></div>`;
  document.getElementById('modal-overlay').classList.remove('hidden');
  await loadCustSelect(a.customer_id);
  await loadServSelect(a.service_id);
  document.getElementById('appt-duration').value = a.duration;
}

async function loadCustSelect(sel) {
  const cs = await api('/customers');
  document.getElementById('appt-customer').innerHTML = '<option value="">Kunde wählen...</option>' + cs.map(c => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${c.name}</option>`).join('');
}

async function loadServSelect(sel) {
  const ss = await api('/services?active=false');
  document.getElementById('appt-service').innerHTML = '<option value="">Service wählen...</option>' + ss.map(s => `<option value="${s.id}" data-duration="${s.duration}" ${s.id === sel ? 'selected' : ''}>${s.name} (${s.duration} Min)</option>`).join('');
  updDur();
}

function updDur() {
  const sel = document.getElementById('appt-service');
  if (sel.selectedIndex > 0) document.getElementById('appt-duration').value = sel.options[sel.selectedIndex].dataset.duration || 30;
}

async function saveAppointment() {
  const customer_id = parseInt(document.getElementById('appt-customer').value);
  const service_id = parseInt(document.getElementById('appt-service').value);
  const date = document.getElementById('appt-date').value;
  const time = document.getElementById('appt-time').value;
  const duration = parseInt(document.getElementById('appt-duration').value);
  const notes = document.getElementById('appt-notes')?.value || '';
  const status = document.getElementById('appt-status')?.value;
  if (!customer_id) return toast('Bitte Kunde wählen', 'error');
  if (!service_id) return toast('Bitte Service wählen', 'error');
  if (!date || !time) return toast('Bitte Datum und Zeit wählen', 'error');
  try {
    if (editingAppointmentId) {
      await api('/appointments/' + editingAppointmentId, { method: 'PUT', body: { customer_id, service_id, date, time, duration, notes, ...(status ? { status } : {}) } });
      toast('Termin aktualisiert');
    } else {
      await api('/appointments', { method: 'POST', body: { customer_id, service_id, date, time, duration, notes } });
      toast('Termin erstellt');
    }
    closeModal();
    loadPage(currentPage);
  } catch (e) { toast('Fehler', 'error'); }
}

async function cancelAppointment(id) {
  if (!confirm('Termin absagen? Kunde erhält Benachrichtigung.')) return;
  await api('/appointments/' + id, { method: 'PUT', body: { status: 'cancelled' } });
  toast('Abgesagt');
  loadPage(currentPage);
}

async function completeAppointment(id) {
  await api('/appointments/' + id, { method: 'PUT', body: { status: 'completed' } });
  toast('Erledigt');
  loadPage(currentPage);
}

// ====== ALL APPOINTMENTS ======
async function loadAllAppointments() {
  const search = (document.getElementById('appt-search')?.value || '').toLowerCase();
  const appts = await api('/appointments');
  const filtered = search ? appts.filter(a =>
    a.customer_name.toLowerCase().includes(search) ||
    (a.customer_email && a.customer_email.toLowerCase().includes(search)) ||
    a.service_name.toLowerCase().includes(search)
  ) : appts;

  const list = document.getElementById('all-appointments-list');
  if (!filtered.length) {
    list.innerHTML = '<div class="empty-state"><div class="icon">&#128197;</div><p>Keine Termine</p></div>';
    return;
  }

  if (window.innerWidth < 768) {
    const grouped = {};
    filtered.forEach(a => { if (!grouped[a.date]) grouped[a.date] = []; grouped[a.date].push(a); });
    let html = '';
    Object.keys(grouped).sort().forEach(d => {
      const dayAppts = grouped[d];
      html += `<div style="font-size:12px;font-weight:600;color:var(--text-muted);margin:8px 0 4px 4px">${formatDateFull(d)}</div>`;
      html += '<div class="appt-list">' + dayAppts.map(a => renderAppt(a)).join('') + '</div>';
    });
    list.innerHTML = html;
  } else {
    list.innerHTML = '<table><thead><tr><th>Datum</th><th>Zeit</th><th>Name</th><th>Dienstleistung</th><th>Status</th><th>Aktionen</th></tr></thead><tbody>'
      + filtered.map(a => `<tr style="cursor:pointer" onclick="openAppointmentDetail(${a.id})">
        <td style="white-space:nowrap">${a.date}</td>
        <td style="white-space:nowrap">${a.time}</td>
        <td><strong>${a.customer_name}</strong></td>
        <td>${a.service_name}</td>
        <td><span class="status ${statusMeta[a.status]?.cls || ''}">${statusMeta[a.status]?.label || a.status}</span></td>
        <td style="white-space:nowrap">
          ${a.status === 'open' ? `<button class="btn btn-sm btn-success" onclick="event.stopPropagation();openConfirmAppointment(${a.id})">✓</button>` : ''}
          ${a.status === 'confirmed' ? `<button class="btn btn-sm btn-primary" onclick="event.stopPropagation();completeAppointment(${a.id})">✓</button>` : ''}
          <button class="btn btn-sm" onclick="event.stopPropagation();openEditAppointment(${a.id})">✎</button>
          <button class="btn btn-sm btn-danger" onclick="event.stopPropagation();deleteAppointmentItem(${a.id})">✕</button>
        </td>
      </tr>`).join('') + '</tbody></table>';
  }
}

async function deleteAppointmentItem(id) {
  if (!confirm('Termin endgültig löschen?')) return;
  await api('/appointments/' + id, { method: 'DELETE' });
  toast('Gelöscht');
  if (currentPage === 'appointments') loadAllAppointments();
  else loadDashboard();
}

// ====== CUSTOMERS ======
async function loadCustomers() {
  const search = document.getElementById('customer-search').value;
  const customers = await api('/customers?search=' + encodeURIComponent(search));
  const list = document.getElementById('customer-list');
  if (!customers.length) { list.innerHTML = '<div class="empty-state"><div class="icon">&#128101;</div><p>Keine Kunden</p></div>'; return; }
  if (window.innerWidth < 768) {
    list.innerHTML = '<div class="customer-cards">' + customers.map(c => `
      <div class="customer-card" onclick="openCustomerDetail(${c.id})">
        <div class="cust-info"><div class="cust-name">${c.name}</div><div class="cust-detail">${c.visit_count || 0} Besuche</div></div>
        <span class="cust-email">${c.email || ''}</span>
      </div>`).join('') + '</div>';
  } else {
    list.innerHTML = '<table><thead><tr><th>Name</th><th>Email</th><th>Telefon</th><th>Besuche</th><th>Aktionen</th></tr></thead><tbody>'
      + customers.map(c => `<tr><td><strong>${c.name}</strong></td><td>${c.email ? `<a href="#" onclick="event.preventDefault();openEmailCompose(${c.id})" style="color:var(--primary);text-decoration:underline">${c.email}</a>` : '-'}</td><td>${c.phone ? `<a href="tel:${c.phone.replace(/[^\d+]/g,'')}" style="color:var(--primary);text-decoration:underline">${c.phone}</a>` : '-'}</td><td>${c.visit_count || 0}</td><td><button class="btn btn-sm" onclick="openEditCustomer(${c.id})">Bearbeiten</button> <button class="btn btn-sm btn-danger" onclick="deleteCustomer(${c.id})">Löschen</button></td></tr>`).join('') + '</tbody></table>';
  }
}

async function openCustomerDetail(id) {
  const c = await api('/customers/' + id);
  window._curCustomer = c;
  document.getElementById('modal-title').textContent = c.name;
  document.getElementById('modal-body').innerHTML = `
    <div class="appt-detail-modal">
      <div class="adm-row"><span class="adm-muted">${c.visit_count || 0} Besuche</span></div>
      <div style="margin-top:8px">
        <div style="margin-bottom:4px"><strong>Email:</strong> ${c.email ? `<a href="#" onclick="event.preventDefault();showEmailCompose()" style="color:var(--primary);text-decoration:underline">${c.email}</a>` : '-'}</div>
        <div style="margin-bottom:4px"><strong>Telefon:</strong> ${c.phone ? `<a href="tel:${c.phone.replace(/[^\d+]/g,'')}" style="color:var(--primary);text-decoration:underline">${c.phone}</a>` : '-'}</div>
      </div>
    </div>
    <div class="adm-actions">
      <button class="btn btn-primary" onclick="openEditCustomer(${c.id})">✎ Bearbeiten</button>
      <button class="btn btn-danger" onclick="if(!confirm('Kunden löschen?'))return;closeModal();api('/customers/'+${c.id},{method:'DELETE'}).then(()=>{toast('Gelöscht');loadCustomers()})">✕ Löschen</button>
      <button class="btn" onclick="closeModal()">Schließen</button>
    </div>`;
  document.getElementById('modal-overlay').classList.remove('hidden');
}

async function openEmailCompose(id) {
  const c = await api('/customers/' + id);
  window._curCustomer = c;
  showEmailCompose();
  document.getElementById('modal-overlay').classList.remove('hidden');
}

function showEmailCompose() {
  const c = window._curCustomer;
  if (!c || !c.email) return;
  document.getElementById('modal-title').textContent = 'Nachricht an ' + c.name;
  document.getElementById('modal-body').innerHTML = `
    <div class="email-compose">
      <div class="ec-field"><label>An</label><input type="text" value="${c.email}" disabled style="background:#e8eaef;border-radius:9px;padding:10px 12px;border:none;width:100%;font-size:15px"></div>
      <div class="ec-field"><label>Betreff</label><input type="text" id="ec-subject" placeholder="Betreff" style="border-radius:9px;padding:10px 12px;border:1px solid #d1d5db;width:100%;font-size:15px"></div>
      <div class="ec-field"><label>Nachricht</label><textarea id="ec-message" rows="6" placeholder="Ihre Nachricht..." style="border-radius:9px;padding:10px 12px;border:1px solid #d1d5db;width:100%;font-size:15px;resize:vertical;font-family:inherit"></textarea></div>
      <div id="ec-status" style="font-size:13px;color:#666;margin-top:4px"></div>
    </div>
    <div class="adm-actions">
      <button class="btn btn-primary" id="ec-send-btn" onclick="sendEmailCompose()">✉ Senden</button>
      <button class="btn" onclick="openCustomerDetail(${c.id})">← Zurück</button>
      <button class="btn" onclick="closeModal()">Schließen</button>
    </div>`;
}

// ====== CASCADE SHIFT ======
let _shiftOutsideAppts = [];
let _shiftDate = '';
let _shiftMinutes = 0;

async function openShiftModal() {
  _shiftDate = new Date().toISOString().split('T')[0];
  const now = new Date();
  const h = now.getHours();
  const min = now.getMinutes();
  if (h < 12) _shiftDate = _shiftDate;
  document.getElementById('modal-title').textContent = 'Termine verschieben';
  document.getElementById('modal-body').innerHTML = `
    <div style="margin-bottom:16px">
      <label style="font-size:13px;color:var(--text-muted);display:block;margin-bottom:4px">Datum</label>
      <input type="date" id="shift-modal-date" value="${_shiftDate}" style="border-radius:9px;padding:10px 12px;border:1px solid var(--border);width:100%;font-size:15px">
    </div>
    <div style="margin-bottom:16px">
      <label style="font-size:13px;color:var(--text-muted);display:block;margin-bottom:4px">Verschieben um (Minuten)</label>
      <input type="number" id="shift-modal-minutes" value="30" min="5" step="5" style="border-radius:9px;padding:10px 12px;border:1px solid var(--border);width:100%;font-size:15px">
    </div>
    <div class="adm-actions">
      <button class="btn btn-primary" onclick="confirmShift()">Bestätigen</button>
      <button class="btn" onclick="closeModal()">Abbrechen</button>
    </div>`;
  document.getElementById('modal-overlay').classList.remove('hidden');
}

async function confirmShift() {
  const date = document.getElementById('shift-modal-date').value;
  const minutes = parseInt(document.getElementById('shift-modal-minutes').value) || 0;
  if (!date) { toast('Bitte Datum wählen'); return; }
  if (!minutes || minutes < 1) { toast('Bitte gültige Minuten eingeben'); return; }

  const appointments = await api('/appointments?start=' + date + '&end=' + date);
  const active = appointments.filter(a => a.status !== 'cancelled').sort((a, b) => a.time.localeCompare(b.time));
  if (!active.length) { toast('Keine Termine an diesem Tag'); return; }

  _shiftDate = date;
  _shiftMinutes = minutes;

  let html = `
    <div style="margin-bottom:16px;font-size:14px;color:var(--text-muted)">
      <strong>${date}</strong> · alle Termine um <strong>${minutes} Minuten</strong> nach hinten verschieben
    </div>
    <div style="margin-bottom:16px">
      <label style="font-size:13px;color:var(--text-muted);display:block;margin-bottom:4px">Start-Termin auswählen:</label>
      <div style="max-height:350px;overflow-y:auto">`;
  active.forEach(a => {
    const startH = parseInt(a.time.split(':')[0]);
    const startM = parseInt(a.time.split(':')[1]);
    const endH = Math.floor((startH * 60 + startM + a.duration) / 60);
    const endM = (startH * 60 + startM + a.duration) % 60;
    const endStr = `${String(endH).padStart(2,'0')}:${String(endM).padStart(2,'0')}`;
    html += `
      <div class="shift-appt-row" onclick="selectShiftAppt(this, ${a.id})" style="display:flex;align-items:center;gap:10px;padding:12px;border-radius:9px;margin-bottom:4px;cursor:pointer;border:2px solid transparent;background:var(--bg)">
        <div class="shift-radio" style="width:18px;height:18px;border-radius:50%;border:2px solid var(--border);flex-shrink:0;display:flex;align-items:center;justify-content:center"></div>
        <div style="flex:1">
          <div style="font-weight:600">${a.customer_name}</div>
          <div style="font-size:12px;color:var(--text-muted)">${a.time} – ${endStr} · ${a.service_name || ''}</div>
        </div>
      </div>`;
  });
  html += `</div></div>
    <div style="font-size:15px;font-weight:600;margin-bottom:16px">Wirklich verschieben?</div>
    <div class="adm-actions">
      <button class="btn" onclick="openShiftModal()" style="background:#ef4455;color:#fff">Abbrechen</button>
      <button class="btn" onclick="executeCascadeShift()" style="background:#22b573;color:#fff">Ja</button>
    </div>`;

  document.getElementById('modal-title').textContent = 'Verschiebung bestätigen';
  document.getElementById('modal-body').innerHTML = html;
}

function selectShiftAppt(el, id) {
  document.querySelectorAll('.shift-appt-row').forEach(r => {
    r.style.borderColor = 'transparent';
    r.querySelector('.shift-radio').style.borderColor = 'var(--border)';
    r.querySelector('.shift-radio').innerHTML = '';
  });
  el.style.borderColor = 'var(--primary)';
  el.querySelector('.shift-radio').style.borderColor = 'var(--primary)';
  el.querySelector('.shift-radio').innerHTML = '<div style="width:10px;height:10px;border-radius:50%;background:var(--primary)"></div>';
  window._shiftAppointmentId = id;
}

async function executeCascadeShift() {
  const id = window._shiftAppointmentId;
  if (!id) { toast('Bitte einen Start-Termin auswählen'); return; }

  closeModal();
  document.getElementById('shift-result').textContent = 'Verschiebe...';
  try {
    const r = await api('/cascade-shift', {
      method: 'POST',
      body: { date: _shiftDate, appointmentId: id, minutes: _shiftMinutes }
    });
    if (r.shifted.length) {
      document.getElementById('shift-result').textContent = r.shifted.length + ' Termin' + (r.shifted.length > 1 ? 'e' : '') + ' verschoben';
      loadDashboard();
      if (r.outside && r.outside.length > 0) {
        showOutsideApptModal(r.outside);
      } else {
        toast(r.shifted.length + ' Termin' + (r.shifted.length > 1 ? 'e' : '') + ' verschoben');
      }
    } else {
      document.getElementById('shift-result').textContent = '✓ Keine Termine verschoben';
      toast('Keine Termine verschoben');
      loadDashboard();
    }
  } catch (e) {
    document.getElementById('shift-result').textContent = '✕ Fehler';
    toast('Fehler: ' + e.message);
  }
}

function showOutsideApptModal(shifted) {
  // For now check which shifted appointments are outside working hours by fetching them
  document.getElementById('modal-title').textContent = 'Termin außerhalb Öffnungszeit';
  document.getElementById('modal-body').innerHTML = `
    <div style="margin-bottom:12px;color:var(--text-muted)">Diese Termine wurden außerhalb der Öffnungszeiten verschoben:</div>
    <div id="outside-appt-list"></div>`;
  document.getElementById('modal-overlay').classList.remove('hidden');
  renderOutsideApptList(shifted);
}

async function renderOutsideApptList(appts) {
  const container = document.getElementById('outside-appt-list');
  if (!appts || appts.length === 0) {
    container.innerHTML = '<div style="color:var(--success);font-weight:600;text-align:center;padding:20px">✓ Alle Termine bearbeitet</div>';
    setTimeout(() => closeModal(), 1200);
    return;
  }
  container.innerHTML = appts.map(a => {
    const startH = parseInt(a.time.split(':')[0]);
    const startM = parseInt(a.time.split(':')[1]);
    const endH = Math.floor((startH * 60 + startM + a.duration) / 60);
    const endM = (startH * 60 + startM + a.duration) % 60;
    const endStr = `${String(endH).padStart(2,'0')}:${String(endM).padStart(2,'0')}`;
    return `
      <div class="outside-appt-item" data-id="${a.id}" style="display:flex;align-items:center;gap:10px;padding:12px;border-radius:9px;margin-bottom:6px;background:var(--bg)">
        <div style="flex:1">
          <div style="font-weight:600">${a.customer_name}</div>
          <div style="font-size:12px;color:var(--text-muted)">${a.time} – ${endStr} · ${a.service_name || ''}</div>
        </div>
        <button class="btn btn-sm" style="background:#22b573;color:#fff" onclick="keepShiftedAppt(this, ${a.id})">Bestätigen</button>
        <button class="btn btn-sm" style="background:#ef4455;color:#fff" onclick="rejectShiftedAppt(this, ${a.id})">Ablehnen</button>
      </div>`;
  }).join('');
}

async function keepShiftedAppt(btn, id) {
  btn.closest('.outside-appt-item').remove();
  const remaining = document.querySelectorAll('.outside-appt-item');
  if (remaining.length === 0) {
    document.getElementById('outside-appt-list').innerHTML = '<div style="color:var(--success);font-weight:600;text-align:center;padding:20px">✓ Alle Termine bearbeitet</div>';
    setTimeout(() => closeModal(), 1200);
    toast('Alle Termine bearbeitet');
    loadDashboard();
  }
}

async function rejectShiftedAppt(btn, id) {
  btn.disabled = true;
  btn.textContent = 'Sende...';
  try {
    await api('/shift-cancel-appointment', {
      method: 'POST',
      body: { appointmentId: id }
    });
    btn.closest('.outside-appt-item').remove();
    const remaining = document.querySelectorAll('.outside-appt-item');
    if (remaining.length === 0) {
      document.getElementById('outside-appt-list').innerHTML = '<div style="color:var(--success);font-weight:600;text-align:center;padding:20px">✓ Alle Termine bearbeitet</div>';
      setTimeout(() => closeModal(), 1200);
      toast('Alle Termine bearbeitet');
      loadDashboard();
    }
  } catch (e) {
    toast('Fehler: ' + e.message);
    btn.disabled = false;
    btn.textContent = 'Ablehnen';
  }
}

async function sendEmailCompose() {
  const subject = document.getElementById('ec-subject').value.trim();
  const message = document.getElementById('ec-message').value.trim();
  if (!subject) { toast('Bitte Betreff eingeben'); return; }
  if (!message) { toast('Bitte Nachricht eingeben'); return; }
  const btn = document.getElementById('ec-send-btn');
  btn.disabled = true;
  btn.textContent = '✉ Sende...';
  try {
    const r = await api('/send-customer-email', {
      method: 'POST',
      body: { to: window._curCustomer.email, subject, message }
    });
    if (r.ok) {
      toast('Nachricht gesendet');
      document.getElementById('ec-status').textContent = '✓ Gesendet';
      btn.textContent = '✓ Gesendet';
    } else {
      toast('Fehler: ' + (r.error || 'Unbekannt'));
      btn.disabled = false;
      btn.textContent = '✉ Senden';
    }
  } catch (e) {
    toast('Fehler: ' + e.message);
    btn.disabled = false;
    btn.textContent = '✉ Senden';
  }
}

// ====== SERVICES ======
async function loadServices() {
  const services = await api('/services?active=false');
  const list = document.getElementById('service-list');
  if (!services.length) { list.innerHTML = '<div class="empty-state"><div class="icon">&#128296;</div><p>Keine Services</p></div>'; return; }
  if (window.innerWidth < 768) {
    list.innerHTML = '<div class="service-cards">' + services.map(s => `
      <div class="service-card-item" onclick="openServiceDetail(${s.id})"><div class="serv-dot" style="background:${s.color}"></div>
      <div class="serv-info"><div class="serv-name">${s.name}</div><div class="serv-detail">${s.duration} Min · ${s.price ? s.price.toFixed(2).replace('.',',') + ' €' : '-'}</div></div>
      <div class="serv-actions"><button class="btn btn-sm" onclick="event.stopPropagation();openEditService(${s.id})">Bearbeiten</button><button class="btn btn-sm btn-danger" onclick="event.stopPropagation();deleteService(${s.id})">Löschen</button></div></div>`).join('') + '</div>';
  } else {
    list.innerHTML = '<table><thead><tr><th>Name</th><th>Dauer</th><th>Preis</th><th>Status</th><th>Aktionen</th></tr></thead><tbody>'
      + services.map(s => `<tr><td><span style="display:inline-block;width:12px;height:12px;background:${s.color};border-radius:4px;margin-right:8px;vertical-align:middle"></span>${s.name}</td><td>${s.duration} Min</td><td>${s.price ? s.price.toFixed(2).replace('.',',') + ' €' : '-'}</td><td><span class="status ${s.is_active ? 'status-confirmed' : 'status-cancelled'}">${s.is_active ? 'Aktiv' : 'Inaktiv'}</span></td><td><button class="btn btn-sm" onclick="openEditService(${s.id})">Bearbeiten</button> <button class="btn btn-sm btn-danger" onclick="deleteService(${s.id})">Löschen</button></td></tr>`).join('') + '</tbody></table>';
  }
}

async function openServiceDetail(id) {
  const s = await api('/services/' + id);
  document.getElementById('modal-title').textContent = s.name;
  document.getElementById('modal-body').innerHTML = `
    <div class="appt-detail-modal">
      <div class="adm-row">
        <span class="serv-dot" style="width:16px;height:16px;border-radius:5px;background:${s.color};display:inline-block"></span>
        <span class="adm-muted">${s.duration} Min · ${s.price ? s.price.toFixed(2).replace('.',',') + ' €' : '-'}</span>
      </div>
      <div style="margin-top:8px"><span class="status ${s.is_active ? 'status-confirmed' : 'status-cancelled'}">${s.is_active ? 'Aktiv' : 'Inaktiv'}</span></div>
    </div>
    <div class="adm-actions">
      <button class="btn btn-primary" onclick="openEditService(${s.id})">✎ Bearbeiten</button>
      <button class="btn btn-danger" onclick="if(!confirm('Service löschen?'))return;closeModal();api('/services/'+${s.id},{method:'DELETE'}).then(()=>{toast('Gelöscht');loadServices()})">✕ Löschen</button>
      <button class="btn" onclick="closeModal()">Schließen</button>
    </div>`;
  document.getElementById('modal-overlay').classList.remove('hidden');
}

// ====== STATISTICS ======
let statsMonthOffset = 0;

function changeStatsMonth(delta) {
  statsMonthOffset += delta;
  if (statsMonthOffset > 0) statsMonthOffset = 0;
  loadStatistics();
}

function getMonthRange(offset) {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + offset);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const start = year + '-' + month + '-01';
  const lastDay = new Date(year, d.getMonth() + 1, 0).toISOString().split('T')[0];
  const label = d.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
  return { start, end: lastDay, label };
}

async function loadStatistics() {
  const range = getMonthRange(statsMonthOffset);
  document.getElementById('stats-month-label').textContent = range.label;

  const chartEnd = range.end;
  const chartStart = new Date(chartEnd);
  chartStart.setMonth(chartStart.getMonth() - 11);
  chartStart.setDate(1);
  const chartStartStr = chartStart.toISOString().split('T')[0];

  const [monthStats, chartStats] = await Promise.all([
    api('/statistics?start=' + range.start + '&end=' + range.end),
    api('/statistics?start=' + chartStartStr + '&end=' + chartEnd)
  ]);

  document.getElementById('stats-cards').innerHTML = `
    <div class="stat-card primary"><div class="stat-value">${monthStats.total_appointments || 0}</div><div class="stat-label">Termine (Monat)</div></div>
    <div class="stat-card success"><div class="stat-value">${monthStats.completed || 0}</div><div class="stat-label">Erledigt (Monat)</div></div>
    <div class="stat-card danger"><div class="stat-value">${monthStats.cancelled || 0}</div><div class="stat-label">Abgesagt (Monat)</div></div>
    <div class="stat-card primary"><div class="stat-value">${monthStats.total_revenue ? monthStats.total_revenue.toFixed(2).replace('.', ',') + ' €' : '0,00 €'}</div><div class="stat-label">Umsatz (Monat)</div></div>`;

  const custEl = document.getElementById('stats-customers');
  if (monthStats.customerStats && monthStats.customerStats.length) {
    let h = '<div class="stats-customer-list">';
    monthStats.customerStats.forEach(c => {
      h += `<div class="stats-customer-item">
        <div class="stats-cust-name">${c.name}</div>
        <div class="stats-cust-meta"><span>${c.visit_count}x</span><span>${c.total_revenue ? c.total_revenue.toFixed(2).replace('.', ',') + ' €' : '0,00 €'}</span></div>
      </div>`;
    });
    h += '</div>';
    custEl.innerHTML = h;
  } else {
    custEl.innerHTML = '<div class="empty-state" style="padding:20px"><p>Keine Kunden in diesem Monat</p></div>';
  }

  const el = document.getElementById('stats-by-service');
  if (monthStats.byService && monthStats.byService.length) {
    if (window.innerWidth < 768) {
      el.innerHTML = '<div class="service-cards">' + monthStats.byService.map(s => `
        <div class="service-card-item"><div class="serv-info"><div class="serv-name">${s.name}</div><div class="serv-detail">${s.count}x · ${s.revenue.toFixed(2).replace('.', ',')} €</div></div></div>`).join('') + '</div>';
    } else {
      el.innerHTML = '<table><thead><tr><th>Dienstleistung</th><th>Anzahl</th><th>Umsatz</th></tr></thead><tbody>'
        + monthStats.byService.map(s => `<tr><td>${s.name}</td><td>${s.count}</td><td>${s.revenue.toFixed(2).replace('.', ',')} €</td></tr>`).join('') + '</tbody></table>';
    }
  } else { el.innerHTML = '<div class="empty-state"><p>Keine Daten</p></div>'; }

  const chartEl = document.getElementById('stats-chart-body');
  renderMonthlyChart(chartEl, chartStats.monthlyRevenue);
}

function renderMonthlyChart(container, data) {
  if (!data || !data.length) {
    container.innerHTML = '<div class="empty-state" style="padding:20px"><p>Keine Daten</p></div>';
    return;
  }

  const maxRev = Math.max(...data.map(d => d.revenue), 1);
  const barMaxH = 170;

  let html = '<div class="sc-chart">';
  data.forEach(d => {
    const pct = d.revenue / maxRev;
    const h = Math.max(pct * barMaxH, 2);
    const parts = d.month.split('-');
    const label = parts[1] + '.' + parts[0].slice(2);
    const val = d.revenue.toFixed(2).replace('.', ',') + ' €';
    html += `<div class="sc-col">
      <div class="sc-val">${d.revenue ? val : ''}</div>
      <div class="sc-bar" style="height:${h}px" title="${label}: ${val}"></div>
      <div class="sc-lbl">${label}</div>
    </div>`;
  });
  html += '</div>';
  container.innerHTML = html;
}

// ====== SETTINGS ======
async function loadSettings() {
  const [s, wh, bd] = await Promise.all([api('/settings'), api('/working-hours'), api('/blocked-dates')]);
  ['shop_name','shop_address','booking_lead_time','resend_from_email'].forEach(k => {
    const el = document.getElementById('set-' + k);
    if (el) el.value = s[k] || '';
  });
  const emailStatus = document.getElementById('email-provider-status');
  if (emailStatus) {
    emailStatus.textContent = s.email_provider_configured
      ? 'E-Mail-Versand ist über die Server-Umgebung konfiguriert.'
      : 'E-Mail-Versand ist deaktiviert. Setze RESEND_API_KEY in der Server-Umgebung.';
  }
  const days = ['Sonntag','Montag','Dienstag','Mittwoch','Donnerstag','Freitag','Samstag'];
  document.getElementById('working-hours-list').innerHTML = wh.map(w => `
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;font-size:13px">
      <span style="min-width:80px;font-weight:500">${days[w.day_of_week]}</span>
      <input type="time" value="${w.start_time}" onchange="updateWH(${w.id},'start_time',this.value)" style="width:90px;padding:6px 8px;font-size:13px">
      <span style="color:var(--text-muted)">bis</span>
      <input type="time" value="${w.end_time}" onchange="updateWH(${w.id},'end_time',this.value)" style="width:90px;padding:6px 8px;font-size:13px">
      <input type="checkbox" ${w.is_active ? 'checked' : ''} onchange="updateWH(${w.id},'is_active',this.checked)" style="width:auto;margin-left:4px">
    </div>`).join('');
  const list = document.getElementById('blocked-dates-list');
  if (!bd || !bd.length) list.innerHTML = '<p style="color:var(--text-muted);font-size:12px;">Keine</p>';
  else list.innerHTML = bd.map(d => `<div class="blocked-item"><span><strong>${formatDate(d.date)}</strong> ${d.reason ? '- ' + d.reason : ''}</span><button class="btn btn-sm btn-danger" onclick="removeBD('${d.date}')">Löschen</button></div>`).join('');
  const info = await api('/info');
  document.getElementById('server-status').textContent = info.ip + ':' + info.port;
}

async function updateWH(id, field, value) {
  const wh = await api('/working-hours');
  const cur = wh.find(w => w.id === id);
  await api('/working-hours/' + id, { method: 'PUT', body: { ...cur, [field]: value } });
  toast('Gespeichert');
}

async function addBlockedDate() {
  const date = document.getElementById('blocked-date-input').value;
  const reason = document.getElementById('blocked-reason-input').value;
  if (!date) return toast('Bitte Datum wählen', 'error');
  await api('/blocked-dates', { method: 'POST', body: { date, reason } });
  document.getElementById('blocked-date-input').value = '';
  document.getElementById('blocked-reason-input').value = '';
  loadSettings();
  toast('Geschlossen am ' + formatDate(date));
}

async function removeBD(date) { await api('/blocked-dates/' + date, { method: 'DELETE' }); loadSettings(); toast('Entfernt'); }

function copyBookingUrl() {
  navigator.clipboard.writeText(window.location.origin + '/public/booking.html').then(() => toast('URL kopiert!')).catch(() => toast('Fehler', 'error'));
}

async function saveSetting(key, value) { await api('/settings/' + key, { method: 'PUT', body: { value } }); toast('Gespeichert'); }

async function testEmail() {
  const el = document.getElementById('email-test-result');
  el.textContent = 'Sende Test-E-Mail...';
  el.style.color = '#666';
  try {
    const r = await api('/test-email', { method: 'POST' });
    el.textContent = '✓ Test-E-Mail gesendet! (an ' + r.to + ')';
    el.style.color = '#22b573';
  } catch (e) {
    el.textContent = '✕ Fehler: ' + e.message;
    el.style.color = '#ef4455';
  }
}

// ====== CUSTOMER MODALS ======
function openNewCustomer() {
  editingCustomerId = null;
  document.getElementById('modal-title').textContent = 'Neuer Kunde';
  document.getElementById('modal-body').innerHTML = `
    <div class="form-group"><label>Name *</label><input type="text" id="cust-name"></div>
    <div class="form-group"><label>Email</label><input type="email" id="cust-email"></div>
    <div class="form-group"><label>Telefon</label><input type="tel" id="cust-phone"></div>
    <div class="form-actions"><button class="btn" onclick="closeModal()">Abbrechen</button><button class="btn btn-primary" onclick="saveCustomer()">Anlegen</button></div>`;
  document.getElementById('modal-overlay').classList.remove('hidden');
}

async function openEditCustomer(id) {
  editingCustomerId = id;
  const c = await api('/customers/' + id);
  document.getElementById('modal-title').textContent = 'Kunde bearbeiten';
  document.getElementById('modal-body').innerHTML = `
    <div class="form-group"><label>Name *</label><input type="text" id="cust-name" value="${c.name}"></div>
    <div class="form-group"><label>Email</label><input type="email" id="cust-email" value="${c.email || ''}"></div>
    <div class="form-group"><label>Telefon</label><input type="tel" id="cust-phone" value="${c.phone || ''}"></div>
    <div class="form-actions"><button class="btn" onclick="closeModal()">Abbrechen</button><button class="btn btn-primary" onclick="saveCustomer()">Speichern</button></div>`;
  document.getElementById('modal-overlay').classList.remove('hidden');
}

async function saveCustomer() {
  const name = document.getElementById('cust-name').value.trim();
  const email = document.getElementById('cust-email').value.trim();
  const phone = document.getElementById('cust-phone').value.trim();
  if (!name) return toast('Bitte Namen eingeben', 'error');
  try {
    if (editingCustomerId) {
      await api('/customers/' + editingCustomerId, { method: 'PUT', body: { name, email, phone } });
      toast('Kunde aktualisiert');
    } else {
      const c = await api('/customers', { method: 'POST', body: { name, email, phone } });
      toast('Kunde angelegt');
      if (document.getElementById('appt-customer')) await loadCustSelect(c.id);
    }
    closeModal();
    loadPage(currentPage);
  } catch (e) { toast(e.message || 'Fehler', 'error'); }
}

async function deleteCustomer(id) {
  if (!confirm('Kunden löschen?')) return;
  await api('/customers/' + id, { method: 'DELETE' });
  toast('Gelöscht');
  loadCustomers();
}

// ====== SERVICE MODALS ======
function openNewService() {
  editingServiceId = null;
  document.getElementById('modal-title').textContent = 'Neue Dienstleistung';
  document.getElementById('modal-body').innerHTML = `
    <div class="form-group"><label>Name *</label><input type="text" id="serv-name"></div>
    <div class="form-row"><div class="form-group"><label>Dauer (Min.)</label><input type="number" id="serv-duration" value="30"></div><div class="form-group"><label>Preis (€)</label><input type="number" id="serv-price" step="0.5" value="0"></div></div>
    <div class="form-group"><label>Farbe</label><input type="color" id="serv-color" value="#4A90D9"></div>
    <div class="form-actions"><button class="btn" onclick="closeModal()">Abbrechen</button><button class="btn btn-primary" onclick="saveService()">Anlegen</button></div>`;
  document.getElementById('modal-overlay').classList.remove('hidden');
}

async function openEditService(id) {
  editingServiceId = id;
  const s = await api('/services/' + id);
  document.getElementById('modal-title').textContent = 'Service bearbeiten';
  document.getElementById('modal-body').innerHTML = `
    <div class="form-group"><label>Name *</label><input type="text" id="serv-name" value="${escapeHtml(s.name)}"></div>
    <div class="form-row"><div class="form-group"><label>Dauer (Min.)</label><input type="number" id="serv-duration" value="${s.duration}"></div><div class="form-group"><label>Preis (€)</label><input type="number" id="serv-price" step="0.5" value="${s.price || 0}"></div></div>
    <div class="form-group"><label>Farbe</label><input type="color" id="serv-color" value="${s.color}"></div>
    <div class="form-group"><label><input type="checkbox" id="serv-active" ${s.is_active ? 'checked' : ''} style="width:auto;margin-left:0"> Aktiv</label></div>
    <div class="form-actions"><button class="btn btn-danger" onclick="deleteService(editingServiceId)" style="${editingServiceId ? '' : 'display:none'}">Löschen</button><button class="btn" onclick="closeModal()">Abbrechen</button><button class="btn btn-primary" onclick="saveService()">Speichern</button></div>`;
  document.getElementById('modal-overlay').classList.remove('hidden');
}

function escapeHtml(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

async function saveService() {
  const name = document.getElementById('serv-name').value.trim();
  const duration = parseInt(document.getElementById('serv-duration').value);
  const price = parseFloat(document.getElementById('serv-price').value) || 0;
  const color = document.getElementById('serv-color').value;
  const is_active = document.getElementById('serv-active')?.checked !== undefined ? document.getElementById('serv-active').checked : true;
  if (!name || !duration) return toast('Bitte Name und Dauer eingeben', 'error');
  try {
    if (editingServiceId) { await api('/services/' + editingServiceId, { method: 'PUT', body: { name, duration, price, color, is_active } }); toast('Service aktualisiert'); }
    else { await api('/services', { method: 'POST', body: { name, duration, price, color } }); toast('Service angelegt'); }
    closeModal();
    loadServices();
  } catch (e) { toast(e.message || 'Fehler', 'error'); }
}

async function deleteService(id) {
  if (!id) return;
  if (!confirm('Service löschen?')) return;
  await api('/services/' + id, { method: 'DELETE' });
  toast('Service gelöscht');
  closeModal();
  loadServices();
}

// ====== AUTH ======
async function logout() {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
  window.location.href = '/login.html';
}

function closeModal(e) {
  if (e && e.target !== document.getElementById('modal-overlay')) return;
  document.getElementById('modal-overlay').classList.add('hidden');
  editingAppointmentId = editingCustomerId = editingServiceId = null;
}

document.addEventListener('DOMContentLoaded', async () => {
  const check = await fetch('/api/auth/check', { credentials: 'same-origin' }).then(r => r.json());
  if (!check.authenticated) { window.location.href = '/login.html'; return; }
  document.getElementById('shift-date').value = new Date().toISOString().split('T')[0];
  loadDashboard();
});

navigate('dashboard');
