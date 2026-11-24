const Database = require('better-sqlite3');
const path = require('path');
let app;
try { app = process.versions.electron ? require('electron').app : null; } catch (e) { app = null; }

let db;

function getDbPath() {
  if (process.env.DATABASE_PATH) {
    return process.env.DATABASE_PATH;
  }
  let userDataPath;
  try {
    userDataPath = app ? app.getPath('userData') : path.join(__dirname, 'data');
  } catch (e) {
    userDataPath = path.join(__dirname, 'data');
  }
  return path.join(userDataPath, 'hairdresser.db');
}

function initDatabase(dbPath) {
  db = new Database(dbPath || getDbPath());
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      duration INTEGER NOT NULL,
      price REAL DEFAULT 0,
      color TEXT DEFAULT '#4A90D9',
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS appointments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL,
      service_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      time TEXT NOT NULL,
      duration INTEGER NOT NULL,
      status TEXT DEFAULT 'confirmed',
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
      FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS working_hours (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      day_of_week INTEGER NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      is_active INTEGER DEFAULT 1,
      UNIQUE(day_of_week)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS blocked_dates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      reason TEXT,
      UNIQUE(date)
    );
  `);

  insertDefaultData();
  return db;
}

function closeDatabase() {
  if (db) {
    db.close();
    db = undefined;
  }
}

function insertDefaultData() {
  const serviceCount = db.prepare('SELECT COUNT(*) as count FROM services').get();
  if (serviceCount.count === 0) {
    const insert = db.prepare('INSERT INTO services (name, duration, price, color) VALUES (?, ?, ?, ?)');
    insert.run('Haarschnitt', 30, 25, '#4A90D9');
    insert.run('Haarschnitt + Waschen', 45, 35, '#50C878');
    insert.run('Föhnen', 20, 15, '#FFD700');
    insert.run('Färben komplett', 90, 60, '#FF6347');
    insert.run('Strähnen', 120, 80, '#9370DB');
    insert.run('Bart schneiden', 15, 10, '#8B4513');
    insert.run('Kinderhaarschnitt', 20, 15, '#FF69B4');
  }

  const hoursCount = db.prepare('SELECT COUNT(*) as count FROM working_hours').get();
  if (hoursCount.count === 0) {
    const insert = db.prepare('INSERT INTO working_hours (day_of_week, start_time, end_time, is_active) VALUES (?, ?, ?, ?)');
    insert.run(1, '09:00', '18:00', 1);
    insert.run(2, '09:00', '18:00', 1);
    insert.run(3, '09:00', '18:00', 1);
    insert.run(4, '09:00', '20:00', 1);
    insert.run(5, '09:00', '18:00', 1);
    insert.run(6, '08:00', '16:00', 1);
    insert.run(0, '00:00', '00:00', 0);
  }

  const settingsCount = db.prepare('SELECT COUNT(*) as count FROM settings').get();
  if (settingsCount.count === 0) {
    const insert = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
    insert.run('resend_from_email', 'onboarding@resend.dev');
    insert.run('shop_name', 'Mein Friseursalon');
    insert.run('shop_address', '');
    insert.run('booking_lead_time', '60');
    insert.run('auto_shift_enabled', 'true');
    insert.run('email_notifications', 'true');
  }
}

function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  rows.forEach(r => settings[r.key] = r.value);
  return settings;
}

function updateSetting(key, value) {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, String(value));
}

function getServices(activeOnly = true) {
  if (activeOnly) {
    return db.prepare('SELECT * FROM services WHERE is_active = 1 ORDER BY name').all();
  }
  return db.prepare('SELECT * FROM services ORDER BY name').all();
}

function getService(id) {
  return db.prepare('SELECT * FROM services WHERE id = ?').get(id);
}

function createService({ name, duration, price, color }) {
  const result = db.prepare('INSERT INTO services (name, duration, price, color) VALUES (?, ?, ?, ?)').run(name, duration, price, color || '#4A90D9');
  return getService(result.lastInsertRowid);
}

function updateService(id, { name, duration, price, color, is_active }) {
  db.prepare('UPDATE services SET name = ?, duration = ?, price = ?, color = ?, is_active = ? WHERE id = ?')
    .run(name, duration, price, color || '#4A90D9', is_active !== undefined ? (is_active ? 1 : 0) : 1, id);
  return getService(id);
}

function deleteService(id) {
  db.prepare('DELETE FROM services WHERE id = ?').run(id);
}

function getCustomers(search = '') {
  const query = `
    SELECT c.*,
      (SELECT COUNT(*) FROM appointments a WHERE a.customer_id = c.id AND a.status = 'completed') as visit_count
    FROM customers c
  `;
  if (search) {
    return db.prepare(query + ' WHERE c.name LIKE ? OR c.email LIKE ? OR c.phone LIKE ? ORDER BY c.name')
      .all(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  return db.prepare(query + ' ORDER BY c.name').all();
}

function getCustomer(id) {
  return db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
}

function findCustomerByEmail(email) {
  return db.prepare('SELECT * FROM customers WHERE email = ?').get(email);
}

function createCustomer({ name, email, phone, notes }) {
  const existing = email ? findCustomerByEmail(email) : null;
  if (existing) return existing;
  const result = db.prepare('INSERT INTO customers (name, email, phone, notes) VALUES (?, ?, ?, ?)').run(name, email || '', phone || '', notes || '');
  return getCustomer(result.lastInsertRowid);
}

function updateCustomer(id, { name, email, phone, notes }) {
  db.prepare('UPDATE customers SET name = ?, email = ?, phone = ?, notes = ? WHERE id = ?')
    .run(name, email || '', phone || '', notes || '', id);
  return getCustomer(id);
}

function deleteCustomer(id) {
  db.prepare('DELETE FROM customers WHERE id = ?').run(id);
}

function getAppointments(date) {
  if (date) {
    return db.prepare(`
      SELECT a.*, c.name as customer_name, c.email as customer_email, c.phone as customer_phone,
             s.name as service_name, s.color as service_color, s.price as service_price
      FROM appointments a
      JOIN customers c ON a.customer_id = c.id
      JOIN services s ON a.service_id = s.id
      WHERE a.date = ?
      ORDER BY a.time
    `).all(date);
  }
  return db.prepare(`
    SELECT a.*, c.name as customer_name, c.email as customer_email, c.phone as customer_phone,
           s.name as service_name, s.color as service_color, s.price as service_price
    FROM appointments a
    JOIN customers c ON a.customer_id = c.id
    JOIN services s ON a.service_id = s.id
    ORDER BY a.date DESC, a.time
  `).all();
}

function getAppointmentsRange(startDate, endDate) {
  return db.prepare(`
    SELECT a.*, c.name as customer_name, c.email as customer_email, c.phone as customer_phone,
           s.name as service_name, s.color as service_color, s.price as service_price
    FROM appointments a
    JOIN customers c ON a.customer_id = c.id
    JOIN services s ON a.service_id = s.id
    WHERE a.date >= ? AND a.date <= ?
    ORDER BY a.date, a.time
  `).all(startDate, endDate);
}

function getAppointment(id) {
  return db.prepare(`
    SELECT a.*, c.name as customer_name, c.email as customer_email, c.phone as customer_phone,
           s.name as service_name, s.color as service_color, s.price as service_price
    FROM appointments a
    JOIN customers c ON a.customer_id = c.id
    JOIN services s ON a.service_id = s.id
    WHERE a.id = ?
  `).get(id);
}

function getConflictingAppointments(date, time, duration, excludeId) {
  const [newH, newM] = time.split(':').map(Number);
  const newStart = newH * 60 + newM;
  const newEnd = newStart + duration;
  let rows = db.prepare(`SELECT * FROM appointments WHERE date = ? AND status != 'cancelled'`).all(date);
  if (excludeId) rows = rows.filter(r => r.id !== excludeId);
  return rows.filter(r => {
    const [h, m] = r.time.split(':').map(Number);
    const rStart = h * 60 + m;
    const rEnd = rStart + r.duration;
    return newStart < rEnd && newEnd > rStart;
  }).map(r => ({ ...getAppointment(r.id) }));
}

function createAppointment({ customer_id, service_id, date, time, duration, notes, status }) {
  const result = db.prepare('INSERT INTO appointments (customer_id, service_id, date, time, duration, notes, status) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(customer_id, service_id, date, time, duration, notes || '', status || 'open');
  return getAppointment(result.lastInsertRowid);
}

function updateAppointment(id, { customer_id, service_id, date, time, duration, status, notes }) {
  const fields = [];
  const values = [];
  if (customer_id !== undefined) { fields.push('customer_id = ?'); values.push(customer_id); }
  if (service_id !== undefined) { fields.push('service_id = ?'); values.push(service_id); }
  if (date !== undefined) { fields.push('date = ?'); values.push(date); }
  if (time !== undefined) { fields.push('time = ?'); values.push(time); }
  if (duration !== undefined) { fields.push('duration = ?'); values.push(duration); }
  if (status !== undefined) { fields.push('status = ?'); values.push(status); }
  if (notes !== undefined) { fields.push('notes = ?'); values.push(notes); }
  fields.push('updated_at = CURRENT_TIMESTAMP');
  values.push(id);
  db.prepare(`UPDATE appointments SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return getAppointment(id);
}

function deleteAppointment(id) {
  const appt = getAppointment(id);
  db.prepare('DELETE FROM appointments WHERE id = ?').run(id);
  return appt;
}

function shiftAppointments(date, fromTime, shiftMinutes) {
  const appointments = db.prepare(`
    SELECT * FROM appointments WHERE date = ? AND time >= ? AND status != 'cancelled' ORDER BY time DESC
  `).all(date, fromTime);

  const shifted = [];
  for (const appt of appointments) {
    const [h, m] = appt.time.split(':').map(Number);
    const totalMinutes = h * 60 + m + shiftMinutes;
    const newHour = Math.floor(totalMinutes / 60);
    const newMin = totalMinutes % 60;
    const newTime = `${String(newHour).padStart(2, '0')}:${String(newMin).padStart(2, '0')}`;
    db.prepare('UPDATE appointments SET time = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(newTime, appt.id);
    shifted.push({ ...getAppointment(appt.id), oldTime: appt.time });
  }
  return shifted;
}

function shiftDateAppointments(date, shiftMinutes) {
  const dayOfWeek = new Date(date).getDay();
  const wh = db.prepare('SELECT * FROM working_hours WHERE day_of_week = ? AND is_active = 1').get(dayOfWeek);

  const appts = db.prepare(`
    SELECT * FROM appointments WHERE date = ? AND status != 'cancelled' ORDER BY time DESC
  `).all(date);

  const shifted = [];
  const outside = [];
  for (const appt of appts) {
    const [h, m] = appt.time.split(':').map(Number);
    const totalMinutes = h * 60 + m + shiftMinutes;
    const newHour = Math.floor(totalMinutes / 60);
    const newMin = totalMinutes % 60;
    const newTime = `${String(newHour).padStart(2, '0')}:${String(newMin).padStart(2, '0')}`;
    db.prepare('UPDATE appointments SET time = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(newTime, appt.id);
    const updated = { ...getAppointment(appt.id), oldTime: appt.time };
    shifted.push(updated);
    if (wh) {
      const [whStartH, whStartM] = wh.start_time.split(':').map(Number);
      const [whEndH, whEndM] = wh.end_time.split(':').map(Number);
      const whStart = whStartH * 60 + whStartM;
      const whEnd = whEndH * 60 + whEndM;
      const apptStart = newHour * 60 + newMin;
      if (apptStart < whStart || apptStart >= whEnd) {
        outside.push(updated);
      }
    }
  }
  return { shifted, outside };
}

function cascadeShiftAppointments(date, fromAppointmentId, shiftMinutes) {
  const dayOfWeek = new Date(date).getDay();
  const wh = db.prepare('SELECT * FROM working_hours WHERE day_of_week = ? AND is_active = 1').get(dayOfWeek);

  const appts = db.prepare(`
    SELECT * FROM appointments WHERE date = ? AND status != 'cancelled' ORDER BY time ASC
  `).all(date);

  const startIdx = appts.findIndex(a => a.id === fromAppointmentId);
  if (startIdx === -1) return { shifted: [] };

  const shifted = [];
  const outside = [];
  for (let i = startIdx; i < appts.length; i++) {
    const appt = appts[i];
    const [h, m] = appt.time.split(':').map(Number);
    const apptStart = h * 60 + m;

    if (i === startIdx) {
      shifted.push(shiftAppt(appt, shiftMinutes));
    } else {
      const prev = appts[i - 1];
      const [ph, pm] = prev.time.split(':').map(Number);
      const prevShiftedEnd = (ph * 60 + pm + shiftMinutes) + prev.duration;
      if (prevShiftedEnd > apptStart) {
        shifted.push(shiftAppt(appt, shiftMinutes));
      } else {
        break;
      }
    }
  }

  for (const s of shifted) {
    if (wh) {
      const [h, m] = s.time.split(':').map(Number);
      const apptStart = h * 60 + m;
      const [whStartH, whStartM] = wh.start_time.split(':').map(Number);
      const [whEndH, whEndM] = wh.end_time.split(':').map(Number);
      const whStart = whStartH * 60 + whStartM;
      const whEnd = whEndH * 60 + whEndM;
      if (apptStart < whStart || apptStart >= whEnd) {
        outside.push(s);
      }
    }
  }

  function shiftAppt(appt, minutes) {
    const [h, m] = appt.time.split(':').map(Number);
    const totalMinutes = h * 60 + m + minutes;
    const newHour = Math.floor(totalMinutes / 60);
    const newMin = totalMinutes % 60;
    const newTime = `${String(newHour).padStart(2, '0')}:${String(newMin).padStart(2, '0')}`;
    db.prepare('UPDATE appointments SET time = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(newTime, appt.id);
    return { ...getAppointment(appt.id), oldTime: appt.time };
  }

  return { shifted, outside };
}

function getWorkingHours() {
  return db.prepare('SELECT * FROM working_hours ORDER BY day_of_week').all();
}

function updateWorkingHours(id, { start_time, end_time, is_active }) {
  db.prepare('UPDATE working_hours SET start_time = ?, end_time = ?, is_active = ? WHERE id = ?')
    .run(start_time, end_time, is_active ? 1 : 0, id);
}

function getBlockedDates() {
  return db.prepare('SELECT * FROM blocked_dates ORDER BY date').all();
}

function addBlockedDate(date, reason) {
  db.prepare('INSERT OR IGNORE INTO blocked_dates (date, reason) VALUES (?, ?)').run(date, reason || '');
}

function removeBlockedDate(date) {
  db.prepare('DELETE FROM blocked_dates WHERE date = ?').run(date);
}

function getAvailableSlots(date) {
  const dayOfWeek = new Date(date).getDay();
  const wh = db.prepare('SELECT * FROM working_hours WHERE day_of_week = ? AND is_active = 1').get(dayOfWeek);
  if (!wh) return [];

  const blocked = db.prepare('SELECT * FROM blocked_dates WHERE date = ?').get(date);
  if (blocked) return [];

  const existingAppts = db.prepare('SELECT * FROM appointments WHERE date = ? AND status != ? ORDER BY time')
    .all(date, 'cancelled');
  const services = getServices(true);
  const settings = getSettings();
  const leadTime = parseInt(settings.booking_lead_time) || 60;

  const [whStartH, whStartM] = wh.start_time.split(':').map(Number);
  const [whEndH, whEndM] = wh.end_time.split(':').map(Number);
  const whStart = whStartH * 60 + whStartM;
  const whEnd = whEndH * 60 + whEndM;

  const now = new Date();
  const isToday = date === now.toISOString().split('T')[0];
  const currentMinutes = isToday ? (now.getHours() * 60 + now.getMinutes() + leadTime) : whStart;

  const slots = [];
  const minSlotDuration = Math.min(...services.map(s => s.duration));
  const slotStep = 15;

  let cursor = Math.max(whStart, currentMinutes);
  cursor = Math.ceil(cursor / slotStep) * slotStep;

  for (let appt of existingAppts) {
    const [ah, am] = appt.time.split(':').map(Number);
    const apptStart = ah * 60 + am;
    const apptEnd = apptStart + appt.duration;

    while (cursor + minSlotDuration <= apptStart && cursor + minSlotDuration <= whEnd) {
      slots.push(cursor);
      cursor += slotStep;
    }
    cursor = Math.max(cursor, apptEnd);
  }

  while (cursor + minSlotDuration <= whEnd) {
    slots.push(cursor);
    cursor += slotStep;
  }

  return slots.map(m => ({
    time: `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`,
    minutes: m
  }));
}

function getStatistics(startDate, endDate) {
  const stats = db.prepare(`
    SELECT 
      COUNT(*) as total_appointments,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
      SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled,
      AVG(CASE WHEN status = 'completed' THEN duration ELSE NULL END) as avg_duration,
      COUNT(DISTINCT customer_id) as unique_customers
    FROM appointments
    WHERE date >= ? AND date <= ?
  `).get(startDate, endDate);

  const revenue = db.prepare(`
    SELECT COALESCE(SUM(s.price), 0) as total_revenue
    FROM appointments a
    JOIN services s ON a.service_id = s.id
    WHERE a.date >= ? AND a.date <= ? AND a.status = 'completed'
  `).get(startDate, endDate);

  const byService = db.prepare(`
    SELECT s.name, COUNT(*) as count, SUM(s.price) as revenue
    FROM appointments a
    JOIN services s ON a.service_id = s.id
    WHERE a.date >= ? AND a.date <= ? AND a.status = 'completed'
    GROUP BY s.id
    ORDER BY count DESC
  `).all(startDate, endDate);

  const dailyStats = db.prepare(`
    SELECT date, COUNT(*) as count,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed
    FROM appointments
    WHERE date >= ? AND date <= ?
    GROUP BY date
    ORDER BY date
  `).all(startDate, endDate);

  let customerStats, monthlyRevenue;
  try { customerStats = getCustomerRevenueStats(startDate, endDate); } catch (e) { customerStats = []; }
  try { monthlyRevenue = getMonthlyRevenue(startDate, endDate); } catch (e) { monthlyRevenue = []; }

  // Fill in missing months with 0
  const startMonth = startDate.slice(0, 7);
  const endMonth = endDate.slice(0, 7);
  const months = [];
  let cursor = new Date(startMonth + '-01');
  const end = new Date(endMonth + '-01');
  while (cursor <= end) {
    const key = cursor.toISOString().slice(0, 7);
    const existing = monthlyRevenue.find(m => m.month === key);
    months.push(existing || { month: key, revenue: 0, count: 0 });
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return { ...stats, ...revenue, byService, dailyStats, customerStats, monthlyRevenue: months };
}

function getCustomerRevenueStats(startDate, endDate) {
  return db.prepare(`
    SELECT c.id, c.name,
      COUNT(*) as visit_count,
      SUM(s.price) as total_revenue
    FROM appointments a
    JOIN customers c ON a.customer_id = c.id
    JOIN services s ON a.service_id = s.id
    WHERE a.date >= ? AND a.date <= ? AND a.status = 'completed'
    GROUP BY c.id
    ORDER BY visit_count DESC
  `).all(startDate, endDate);
}

function getMonthlyRevenue(startDate, endDate) {
  return db.prepare(`
    SELECT strftime('%Y-%m', a.date) as month,
      SUM(s.price) as revenue,
      COUNT(*) as count
    FROM appointments a
    JOIN services s ON a.service_id = s.id
    WHERE a.date >= ? AND a.date <= ? AND a.status = 'completed'
    GROUP BY strftime('%Y-%m', a.date)
    ORDER BY month
  `).all(startDate, endDate);
}

function getUpcomingAppointments(limit = 10) {
  const today = new Date().toISOString().split('T')[0];
  const now = new Date().toTimeString().slice(0, 5);
  return db.prepare(`
    SELECT a.*, c.name as customer_name, c.email as customer_email, s.name as service_name, s.color as service_color
    FROM appointments a
    JOIN customers c ON a.customer_id = c.id
    JOIN services s ON a.service_id = s.id
    WHERE (a.date > ? OR (a.date = ? AND a.time >= ?)) AND a.status = 'confirmed'
    ORDER BY a.date, a.time
    LIMIT ?
  `).all(today, today, now, limit);
}

module.exports = {
  initDatabase, closeDatabase, getSettings, updateSetting,
  getServices, getService, createService, updateService, deleteService,
  getCustomers, getCustomer, createCustomer, updateCustomer, deleteCustomer, findCustomerByEmail,
  getAppointments, getAppointmentsRange, getAppointment, createAppointment, updateAppointment, deleteAppointment, shiftAppointments, shiftDateAppointments, cascadeShiftAppointments, getConflictingAppointments,
  getWorkingHours, updateWorkingHours,
  getBlockedDates, addBlockedDate, removeBlockedDate,
  getAvailableSlots,
  getStatistics, getUpcomingAppointments, getCustomerRevenueStats, getMonthlyRevenue
};
