const { Resend } = require('resend');

let resendClient = null;
let _lastApiKey = null;

function getClient(apiKey) {
  if (!apiKey) return null;
  if (resendClient && _lastApiKey === apiKey) return resendClient;
  _lastApiKey = apiKey;
  resendClient = new Resend(apiKey);
  return resendClient;
}

function formatDateTime(date, time) {
  const d = new Date(date + 'T' + time);
  return d.toLocaleDateString('de-DE', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }) + ' um ' + time + ' Uhr';
}

async function sendEmail(settings, to, subject, html) {
  if (!settings.email_notifications || settings.email_notifications === 'false') return;

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log('Email not sent (Resend API key not configured):', subject, to);
    return;
  }

  const client = getClient(apiKey);
  const fromEmail = process.env.RESEND_FROM_EMAIL || settings.resend_from_email || 'onboarding@resend.dev';

  try {
    const { data, error } = await client.emails.send({
      from: `"${settings.shop_name || 'Friseur'}" <${fromEmail}>`,
      to,
      subject,
      html,
    });
    if (error) {
      console.error('Failed to send email:', error);
    } else {
      console.log('Email sent:', subject, 'to', to, 'id:', data?.id);
    }
  } catch (err) {
    console.error('Failed to send email:', err.message);
  }
}

function sendBookingReceived(settings, customer, appointment, service) {
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;border:1px solid #ddd;border-radius:8px">
      <div style="text-align:center;margin-bottom:20px;padding:20px;background:linear-gradient(135deg,#667eea,#764ba2);border-radius:8px;color:white">
        <h1 style="margin:0">${settings.shop_name || 'Friseursalon'}</h1>
        <p style="margin:5px 0">Buchung eingegangen</p>
      </div>
      <p>Hallo <strong>${customer.name}</strong>,</p>
      <p>Ihre Buchung ist bei uns eingegangen und wird geprüft. Sie erhalten in Kürze eine Bestätigung.</p>
      <div style="background:#f9f9f9;padding:15px;border-radius:8px;margin:15px 0">
        <p><strong>Dienstleistung:</strong> ${service.name}</p>
        <p><strong>Wunschtermin:</strong> ${formatDateTime(appointment.date, appointment.time)}</p>
        <p><strong>Dauer:</strong> ${appointment.duration} Minuten</p>
      </div>
      <p style="color:#666;font-size:14px">Status: <strong>Ausstehend</strong> – wir melden uns, sobald der Termin bestätigt ist.</p>
      <hr style="border:none;border-top:1px solid #eee">
      <p style="color:#999;font-size:12px;text-align:center">${settings.shop_address || ''}</p>
    </div>`;
  return sendEmail(settings, customer.email, '⏳ Buchung eingegangen - ' + service.name, html);
}

function sendAppointmentConfirmation(settings, customer, appointment, service, changes) {
  const changesHtml = changes && changes.length ? '<p><strong>Anpassungen:</strong></p><ul>' + changes.map(c => '<li>' + c + '</li>').join('') + '</ul>' : '';
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;border:1px solid #ddd;border-radius:8px">
      <div style="text-align:center;margin-bottom:20px;padding:20px;background:linear-gradient(135deg,#22b573,#1a8f5c);border-radius:8px;color:white">
        <h1 style="margin:0">${settings.shop_name || 'Friseursalon'}</h1>
        <p style="margin:5px 0">Termin bestätigt &#10003;</p>
      </div>
      <p>Hallo <strong>${customer.name}</strong>,</p>
      <p>Ihr Termin wurde bestätigt!</p>
      <div style="background:#e8faf1;padding:15px;border-radius:8px;margin:15px 0;border:1px solid #b8e6cc">
        <p><strong>Dienstleistung:</strong> ${service.name}</p>
        <p><strong>Termin:</strong> ${formatDateTime(appointment.date, appointment.time)}</p>
        <p><strong>Dauer:</strong> ${appointment.duration} Minuten</p>
        ${service.price ? '<p><strong>Preis:</strong> ' + service.price.toFixed(2).replace('.', ',') + ' €</p>' : ''}
      </div>
      ${changesHtml}
      <p style="color:#666;font-size:14px">Bitte erscheinen Sie pünktlich zum Termin. Bei Verhinderung sagen Sie bitte rechtzeitig ab.</p>
      <hr style="border:none;border-top:1px solid #eee">
      <p style="color:#999;font-size:12px;text-align:center">${settings.shop_address || ''}</p>
    </div>`;
  return sendEmail(settings, customer.email, '✓ Termin bestätigt - ' + service.name, html);
}

function sendAppointmentRejection(settings, customer, appointment, service) {
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;border:1px solid #ddd;border-radius:8px">
      <div style="text-align:center;margin-bottom:20px;padding:20px;background:linear-gradient(135deg,#ef4455,#c0392b);border-radius:8px;color:white">
        <h1 style="margin:0">${settings.shop_name || 'Friseursalon'}</h1>
        <p style="margin:5px 0">Termin abgelehnt</p>
      </div>
      <p>Hallo <strong>${customer.name}</strong>,</p>
      <p>leider konnte Ihr Terminanfrage nicht bestätigt werden:</p>
      <div style="background:#ffeef0;padding:15px;border-radius:8px;margin:15px 0;border:1px solid #ffcdd2">
        <p><strong>Dienstleistung:</strong> ${service.name}</p>
        <p><strong>Angefragter Termin:</strong> ${formatDateTime(appointment.date, appointment.time)}</p>
      </div>
      <p style="color:#666;font-size:14px">Bitte buchen Sie einen neuen Termin über unsere Webseite. Wir entschuldigen uns für die Unannehmlichkeiten.</p>
      <hr style="border:none;border-top:1px solid #eee">
      <p style="color:#999;font-size:12px;text-align:center">${settings.shop_address || ''}</p>
    </div>`;
  return sendEmail(settings, customer.email, '✕ Termin abgelehnt - ' + service.name, html);
}

function sendAppointmentChange(settings, customer, appointment, service, changes) {
  const changesHtml = changes.map(c => `<li>${c}</li>`).join('');
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px;">
      <div style="text-align: center; margin-bottom: 20px; padding: 20px; background: linear-gradient(135deg, #f093fb, #f5576c); border-radius: 8px; color: white;">
        <h1 style="margin: 0;">${settings.shop_name || 'Friseursalon'}</h1>
        <p style="margin: 5px 0;">Terminänderung</p>
      </div>
      <p>Hallo <strong>${customer.name}</strong>,</p>
      <p>Ihr Termin wurde geändert:</p>
      <div style="background: #fff3f3; padding: 15px; border-radius: 8px; margin: 15px 0; border: 1px solid #ffcdd2;">
        <p><strong>Dienstleistung:</strong> ${service.name}</p>
        <p><strong>Geänderte Details:</strong></p>
        <ul>${changesHtml}</ul>
        <p><strong>Neuer Termin:</strong> ${formatDateTime(appointment.date, appointment.time)}</p>
      </div>
      <p style="color: #666; font-size: 14px;">Wir bitten die Änderung zu entschuldigen.</p>
    </div>
  `;
  return sendEmail(settings, customer.email, '⚠️ Terminänderung - ' + service.name, html);
}

function sendAppointmentCancellation(settings, customer, appointment, service) {
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px;">
      <div style="text-align: center; margin-bottom: 20px; padding: 20px; background: linear-gradient(135deg, #a8a8a8, #666); border-radius: 8px; color: white;">
        <h1 style="margin: 0;">${settings.shop_name || 'Friseursalon'}</h1>
        <p style="margin: 5px 0;">Termin abgesagt</p>
      </div>
      <p>Hallo <strong>${customer.name}</strong>,</p>
      <p>leider muss Ihr Termin abgesagt werden:</p>
      <div style="background: #f5f5f5; padding: 15px; border-radius: 8px; margin: 15px 0;">
        <p><strong>Dienstleistung:</strong> ${service.name}</p>
        <p><strong>Ursprünglicher Termin:</strong> ${formatDateTime(appointment.date, appointment.time)}</p>
      </div>
      <p style="color: #666; font-size: 14px;">Wir bitten um Entschuldigung. Buchen Sie gerne einen neuen Termin.</p>
    </div>
  `;
  return sendEmail(settings, customer.email, '✕ Termin abgesagt - ' + service.name, html);
}

function sendShiftNotification(settings, customer, appointment, service, oldTime, newTime) {
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px;">
      <div style="text-align: center; margin-bottom: 20px; padding: 20px; background: linear-gradient(135deg, #ffecd2, #fcb69f); border-radius: 8px; color: #333;">
        <h1 style="margin: 0;">${settings.shop_name || 'Friseursalon'}</h1>
        <p style="margin: 5px 0;">Zeitliche Verschiebung</p>
      </div>
      <p>Hallo <strong>${customer.name}</strong>,</p>
      <p>aufgrund einer Verzögerung verschiebt sich Ihr Termin um einige Minuten:</p>
      <div style="background: #fff8e1; padding: 15px; border-radius: 8px; margin: 15px 0; border: 1px solid #ffe082;">
        <p><strong>Dienstleistung:</strong> ${service.name}</p>
        <p><strong>Datum:</strong> ${formatDateTime(appointment.date, appointment.time)}</p>
        <p><strong>Ursprüngliche Zeit:</strong> ${oldTime} Uhr</p>
        <p><strong>Neue Zeit:</strong> ${newTime} Uhr</p>
      </div>
      <p style="color: #666; font-size: 14px;">Wir bitten die Verzögerung zu entschuldigen.</p>
    </div>
  `;
  return sendEmail(settings, customer.email, '🕐 Termin verschoben - ' + service.name, html);
}

function sendBookingConfirmationToOwner(settings, customer, appointment, service) {
  const ownerEmail = process.env.RESEND_FROM_EMAIL || settings.resend_from_email;
  if (!ownerEmail) return;
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <h2>Neue Buchung eingegangen!</h2>
      <p><strong>Kunde:</strong> ${customer.name}</p>
      <p><strong>Email:</strong> ${customer.email || 'Keine Angabe'}</p>
      <p><strong>Telefon:</strong> ${customer.phone || 'Keine Angabe'}</p>
      <p><strong>Service:</strong> ${service.name}</p>
      <p><strong>Termin:</strong> ${formatDateTime(appointment.date, appointment.time)}</p>
    </div>
  `;
  return sendEmail(settings, ownerEmail, '📅 Neue Buchung: ' + customer.name + ' - ' + service.name, html);
}

module.exports = {
  sendBookingReceived,
  sendAppointmentConfirmation,
  sendAppointmentChange,
  sendAppointmentCancellation,
  sendAppointmentRejection,
  sendShiftNotification,
  sendBookingConfirmationToOwner,
  sendEmail,
};
