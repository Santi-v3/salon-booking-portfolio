const express = require('express');
const path = require('path');
const session = require('express-session');
const db = require('./database');
const notifications = require('./notifications');
const auth = require('./auth');

let server = null;
let localIp = 'localhost';

function getLocalIp() {
  const os = require('os');
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

function startServer(port) {
  auth.assertAuthConfig();
  const requestedPort = port ?? process.env.PORT ?? 3456;
  const PORT = Number.parseInt(requestedPort, 10);
  const HOST = process.env.HOST || '127.0.0.1';
  if (!Number.isInteger(PORT) || PORT < 0 || PORT > 65535) {
    throw new Error('PORT must be an integer between 0 and 65535.');
  }
  if (!['127.0.0.1', '0.0.0.0', 'localhost'].includes(HOST)) {
    throw new Error('HOST must be 127.0.0.1, localhost or 0.0.0.0.');
  }
  return new Promise((resolve, reject) => {
    const app = express();
    app.disable('x-powered-by');
    app.set('trust proxy', 1);
    app.use((req, res, next) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('Referrer-Policy', 'same-origin');
      res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
      next();
    });
    app.use(express.json());

    const isSecure = process.env.NODE_ENV === 'production';
    app.use(session({
      name: 'salon.sid',
      secret: process.env.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      cookie: { secure: isSecure, httpOnly: true, sameSite: 'lax', maxAge: 24 * 60 * 60 * 1000 }
    }));

    app.use('/api/auth', auth.router);

    app.use('/public', express.static(path.join(__dirname, 'public')));

    // ====== PUBLIC API ======

    app.get('/api/status', (req, res) => {
      res.json({ status: 'ok', shopName: db.getSettings().shop_name || 'Friseur' });
    });

    app.get('/api/public-settings', (req, res) => {
      const s = db.getSettings();
      res.json({ shop_name: s.shop_name, shop_address: s.shop_address });
    });

    app.get('/api/services', (req, res) => res.json(db.getServices(req.query.active !== 'false')));

    app.get('/api/available-slots', (req, res) => {
      res.json(db.getAvailableSlots(req.query.date));
    });

    app.post('/api/customers', (req, res) => res.json(db.createCustomer(req.body)));

    app.post('/api/appointments', async (req, res) => {
      const { date, time, duration } = req.body;
      const conflicts = db.getConflictingAppointments(date, time, parseInt(duration) || 30);
      if (conflicts.length > 0) {
        return res.status(409).json({
          error: 'Terminkonflikt',
          message: 'Zu dieser Zeit gibt es bereits einen Termin: ' + conflicts[0].customer_name + ' (' + conflicts[0].time + ' Uhr)'
        });
      }
      const body = { ...req.body, status: 'open' };
      const appt = db.createAppointment(body);
      const settings = db.getSettings();
      const customer = db.getCustomer(appt.customer_id);
      const service = db.getService(appt.service_id);
      if (customer && customer.email) {
        try {
          await notifications.sendBookingReceived(settings, customer, appt, service);
          await notifications.sendBookingConfirmationToOwner(settings, customer, appt, service);
        } catch (e) { console.error('Notification error:', e); }
      }
      res.json(appt);
    });

    // ====== PROTECTED API (Admin only) ======

    const adminApi = express.Router();
    adminApi.use(auth.authMiddleware);

    const editableSettings = new Set([
      'shop_name', 'shop_address', 'booking_lead_time', 'resend_from_email',
      'booking_url', 'auto_shift_enabled', 'email_notifications',
    ]);
    adminApi.get('/settings', (req, res) => {
      const settings = db.getSettings();
      const safeSettings = Object.fromEntries(
        Object.entries(settings).filter(([key]) => key !== 'resend_api_key')
      );
      safeSettings.email_provider_configured = Boolean(process.env.RESEND_API_KEY);
      res.json(safeSettings);
    });
    adminApi.put('/settings/:key', (req, res) => {
      if (!editableSettings.has(req.params.key)) {
        return res.status(400).json({ error: 'Setting is not editable through the API' });
      }
      db.updateSetting(req.params.key, req.body.value);
      res.json({ ok: true });
    });

    adminApi.get('/services/:id', (req, res) => res.json(db.getService(parseInt(req.params.id))));
    adminApi.post('/services', (req, res) => res.json(db.createService(req.body)));
    adminApi.put('/services/:id', (req, res) => res.json(db.updateService(parseInt(req.params.id), req.body)));
    adminApi.delete('/services/:id', (req, res) => { db.deleteService(parseInt(req.params.id)); res.json({ ok: true }); });

    adminApi.get('/customers', (req, res) => res.json(db.getCustomers(req.query.search || '')));
    adminApi.get('/customers/:id', (req, res) => res.json(db.getCustomer(parseInt(req.params.id))));
    adminApi.put('/customers/:id', (req, res) => res.json(db.updateCustomer(parseInt(req.params.id), req.body)));
    adminApi.delete('/customers/:id', (req, res) => { db.deleteCustomer(parseInt(req.params.id)); res.json({ ok: true }); });

    adminApi.post('/test-email', async (req, res) => {
      const settings = db.getSettings();
      if (!process.env.RESEND_API_KEY) return res.status(400).json({ error: 'Resend API-Key nicht konfiguriert' });
      const to = process.env.RESEND_FROM_EMAIL || settings.resend_from_email;
      if (!to) return res.status(400).json({ error: 'Keine Absender-E-Mail hinterlegt' });
      try {
        await notifications.sendEmail(settings, to,
          '🔧 Test-E-Mail von ' + (settings.shop_name || 'Friseur'),
          '<p>Wenn Sie diese E-Mail sehen, funktioniert die Resend-Konfiguration!</p>'
        );
        res.json({ ok: true, to });
      } catch (e) {
        console.error('Test email error:', e);
        res.status(500).json({ error: e.message });
      }
    });

    adminApi.post('/send-customer-email', async (req, res) => {
      const { to, subject, message } = req.body;
      if (!to || !subject || !message) return res.status(400).json({ error: 'Missing fields' });
      const settings = db.getSettings();
      if (!process.env.RESEND_API_KEY) return res.status(400).json({ error: 'Resend nicht konfiguriert' });
      try {
        await notifications.sendEmail(settings, to, subject, message.replace(/\n/g, '<br>'));
        res.json({ ok: true });
      } catch (e) {
        console.error('Send email error:', e);
        res.status(500).json({ error: e.message });
      }
    });

    adminApi.get('/appointments', (req, res) => {
      if (req.query.start && req.query.end) {
        return res.json(db.getAppointmentsRange(req.query.start, req.query.end));
      }
      res.json(db.getAppointments(req.query.date || null));
    });
    adminApi.get('/appointments/upcoming', (req, res) => res.json(db.getUpcomingAppointments(parseInt(req.query.limit) || 10)));
    adminApi.get('/appointments/:id', (req, res) => res.json(db.getAppointment(parseInt(req.params.id))));

    adminApi.put('/appointments/:id', async (req, res) => {
      const oldAppt = db.getAppointment(parseInt(req.params.id));
      const { date, time, duration } = req.body;
      if (date && time) {
        const conflicts = db.getConflictingAppointments(date, time, parseInt(duration) || oldAppt.duration, parseInt(req.params.id));
        if (conflicts.length > 0) {
          return res.status(409).json({
            error: 'Terminkonflikt',
            message: 'Zu dieser Zeit gibt es bereits einen Termin: ' + conflicts[0].customer_name + ' (' + conflicts[0].time + ' Uhr)'
          });
        }
      }
      const appt = db.updateAppointment(parseInt(req.params.id), req.body);
      const settings = db.getSettings();
      const customer = db.getCustomer(appt.customer_id);
      const service = db.getService(appt.service_id);

      if (customer && customer.email) {
        const changes = [];
        if (oldAppt.date !== appt.date) changes.push('Datum: ' + appt.date);
        if (oldAppt.time !== appt.time) changes.push('Uhrzeit: ' + appt.time + ' Uhr');
        if (oldAppt.status !== appt.status && appt.status === 'confirmed' && oldAppt.status === 'open') {
          await notifications.sendAppointmentConfirmation(settings, customer, appt, service, changes);
        } else if (oldAppt.status !== appt.status && appt.status === 'cancelled' && oldAppt.status === 'open') {
          await notifications.sendAppointmentRejection(settings, customer, appt, service);
        } else if (oldAppt.status !== appt.status && appt.status === 'cancelled') {
          await notifications.sendAppointmentCancellation(settings, customer, appt, service);
        } else if (changes.length > 0) {
          await notifications.sendAppointmentChange(settings, customer, appt, service, changes);
        }
      }
      res.json(appt);
    });

    adminApi.delete('/appointments/:id', async (req, res) => {
      const appt = db.deleteAppointment(parseInt(req.params.id));
      const settings = db.getSettings();
      const customer = db.getCustomer(appt.customer_id);
      const service = db.getService(appt.service_id);
      if (customer && customer.email) {
        await notifications.sendAppointmentCancellation(settings, customer, appt, service);
      }
      res.json({ ok: true });
    });

    adminApi.post('/appointments/:id/shift', async (req, res) => {
      const { minutes } = req.body;
      const appt = db.getAppointment(parseInt(req.params.id));
      if (!appt) return res.status(404).json({ error: 'Not found' });

      const shifted = db.shiftAppointments(appt.date, appt.time, minutes);
      const settings = db.getSettings();

      for (const s of shifted) {
        const customer = db.getCustomer(s.customer_id);
        const service = db.getService(s.service_id);
        if (customer && customer.email) {
          await notifications.sendShiftNotification(settings, customer, s, service, s.oldTime, s.time);
        }
      }
      res.json({ shifted: shifted.length });
    });

    adminApi.post('/shift-cancel-appointment', async (req, res) => {
      const { appointmentId } = req.body;
      if (!appointmentId) return res.status(400).json({ error: 'appointmentId required' });
      const appt = db.getAppointment(parseInt(appointmentId));
      if (!appt) return res.status(404).json({ error: 'Not found' });
      db.updateAppointment(appt.id, { status: 'cancelled' });
      const settings = db.getSettings();
      const customer = db.getCustomer(appt.customer_id);
      const service = db.getService(appt.service_id);
      if (customer && customer.email) {
        const html = `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;border:1px solid #ddd;border-radius:8px">
            <div style="text-align:center;margin-bottom:20px;padding:20px;background:linear-gradient(135deg,#a8a8a8,#666);border-radius:8px;color:white">
              <h1 style="margin:0">${settings.shop_name || 'Friseursalon'}</h1>
              <p style="margin:5px 0">Termin abgesagt</p>
            </div>
            <p>Hallo <strong>${customer.name}</strong>,</p>
            <p>Tut mir leid für die Absage, heute hat es leider etwas länger gedauert, deswegen kann ich dich heute nicht schneiden.</p>
            <p>Wenn du möchtest, kannst du gerne einen neuen Termin machen:</p>
            <div style="text-align:center;margin:20px 0">
              <a href="${settings.booking_url || (req.protocol + '://' + req.get('host') + '/public/booking.html')}" style="display:inline-block;padding:12px 24px;background:#4f6ef7;color:white;text-decoration:none;border-radius:8px;font-weight:600">Termin buchen</a>
            </div>
            <p style="color:#666;font-size:14px">Liebe Grüße,<br>${settings.shop_name || 'Dein Friseur'}</p>
          </div>`;
        try {
          await notifications.sendEmail(settings, customer.email, '✕ Termin abgesagt - ' + service.name, html);
        } catch (e) { console.error('Shift cancel email error:', e); }
      }
      res.json({ ok: true });
    });

    adminApi.post('/cascade-shift', async (req, res) => {
      const { date, appointmentId, minutes } = req.body;
      if (!date || !appointmentId || minutes === undefined) {
        return res.status(400).json({ error: 'date, appointmentId and minutes required' });
      }
      const result = db.cascadeShiftAppointments(date, parseInt(appointmentId), parseInt(minutes));
      const settings = db.getSettings();
      for (const s of result.shifted) {
        const customer = db.getCustomer(s.customer_id);
        const service = db.getService(s.service_id);
        if (customer && customer.email) {
          await notifications.sendShiftNotification(settings, customer, s, service, s.oldTime, s.time);
        }
      }
      res.json(result);
    });

    adminApi.get('/working-hours', (req, res) => res.json(db.getWorkingHours()));
    adminApi.put('/working-hours/:id', (req, res) => {
      db.updateWorkingHours(parseInt(req.params.id), req.body);
      res.json({ ok: true });
    });

    adminApi.get('/blocked-dates', (req, res) => res.json(db.getBlockedDates()));
    adminApi.post('/blocked-dates', (req, res) => {
      db.addBlockedDate(req.body.date, req.body.reason);
      res.json({ ok: true });
    });
    adminApi.delete('/blocked-dates/:date', (req, res) => {
      db.removeBlockedDate(req.params.date);
      res.json({ ok: true });
    });

    adminApi.get('/statistics', (req, res) => {
      const end = req.query.end || new Date().toISOString().split('T')[0];
      const start = req.query.start || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      res.json(db.getStatistics(start, end));
    });

    adminApi.get('/info', (req, res) => {
      const advertisedHost = HOST === '0.0.0.0' ? localIp : HOST;
      const activePort = server?.address()?.port ?? PORT;
      res.json({ ip: advertisedHost, port: activePort, bookingUrl: `http://${advertisedHost}:${activePort}/public/booking.html` });
    });

    app.use('/api', adminApi);

    // ====== ADMIN UI ======
    app.use('/admin', auth.authMiddleware, express.static(path.join(__dirname, 'public', 'admin')));

    app.get('/login.html', (req, res) => {
      res.sendFile(path.join(__dirname, 'public', 'admin', 'login.html'));
    });

    app.get('/admin', (req, res) => {
      res.redirect('/admin/index.html');
    });

    app.get('/', (req, res) => {
      res.redirect('/public/booking.html');
    });

    server = app.listen(PORT, HOST, () => {
      localIp = getLocalIp();
      const activePort = server.address().port;
      const advertisedHost = HOST === '0.0.0.0' ? localIp : HOST;
      console.log(`Server running on http://localhost:${activePort}`);
      console.log(`Customer booking: http://${advertisedHost}:${activePort}/public/booking.html`);
      console.log(`Admin panel: http://${advertisedHost}:${activePort}/login.html`);
      resolve(server);
    });
    server.once('error', reject);
  });
}

function stopServer() {
  if (server) {
    server.close();
    server = null;
  }
}

module.exports = { startServer, stopServer, getLocalIp };
