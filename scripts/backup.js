'use strict';
// Faz uma cópia consistente do banco, mesmo com o site no ar.
// Uso: npm run backup            (cria data/backups/hlg-AAAAMMDD-HHMMSS.db)
//      npm run backup -- /caminho/de/outro/lugar.db
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
const src = path.join(dataDir, 'hlg.db');
if (!fs.existsSync(src)) { console.error('Banco não encontrado em', src); process.exit(1); }

const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
const dest = path.resolve(process.argv[2] || path.join(dataDir, 'backups', `hlg-${stamp}.db`));
fs.mkdirSync(path.dirname(dest), { recursive: true });
if (fs.existsSync(dest)) { console.error('Já existe um arquivo em', dest); process.exit(1); }

const db = new DatabaseSync(src, { readOnly: true });
db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
db.close();
console.log('Backup criado:', dest);
