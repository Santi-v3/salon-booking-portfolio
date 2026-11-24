require('dotenv').config();

const { startServer } = require('./server');
const { initDatabase } = require('./database');

async function main() {
  initDatabase();
  const server = await startServer();
  const port = server.address().port;
  console.log(`Friseur Terminverwaltung läuft auf http://${process.env.HOST || '127.0.0.1'}:${port}`);
  console.log(`Buchungsseite: http://localhost:${port}/public/booking.html`);
  console.log(`Admin Login: http://localhost:${port}/login.html`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
