'use strict';
// Testa se um backup abre e tem os dados principais. Faça isso de vez em quando.
// Uso: npm run verify-backup -- data/backups/hlg-20261121-030000.db
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const file = process.argv[2];
if (!file || !fs.existsSync(file)) { console.error('Informe o arquivo de backup. Ex.: npm run verify-backup -- data/backups/hlg-20261121-030000.db'); process.exit(1); }

const db = new DatabaseSync(path.resolve(file), { readOnly: true });
const integrity = db.prepare('PRAGMA integrity_check').get().integrity_check;
const count = (t) => db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
console.log('Integridade:', integrity);
for (const t of ['services', 'clients', 'bookings', 'messages', 'admins']) console.log(`${t}: ${count(t)}`);
db.close();
if (integrity !== 'ok') process.exit(1);
console.log('Backup válido.');
