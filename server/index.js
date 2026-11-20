import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';
import sea from 'node:sea';
import express from 'express';
import cors from 'cors';
import { Server } from 'socket.io';
import { createDatabase } from './db.js';
import { importTestsFromFolder } from './importer.js';
import { syncFromGithub } from './sync.js';
import { getLocalAddresses } from './network.js';
import { createTestsRouter } from './routes/tests.js';
import { createSessionsRouter } from './routes/sessions.js';
import { registerSocketHandlers } from './socket.js';

const __dirname = typeof import.meta?.url === 'string'
  ? path.dirname(fileURLToPath(import.meta.url))
  : process.cwd();

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

export function createApp({ dbPath, seedDemo = true, autoImportFolder = false, port = process.env.PORT || 3000, embeddedAssets = null } = {}) {
  const db = createDatabase(dbPath, { seedDemo });
  if (autoImportFolder) {
    const res = importTestsFromFolder(db);
    if (res.imported.length > 0) {
      console.log(`Импортировано новых тестов из папки «тесты»: ${res.imported.length}`);
    }
  }
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST', 'PUT', 'DELETE'],
    },
  });

  app.use(cors());
  app.use(express.json({ limit: '5mb' }));

  app.get('/api/server-info', (req, res) => {
    const addresses = getLocalAddresses();
    const actualPort = server.address()?.port || Number(port) || 3000;
    res.json({
      port: actualPort,
      addresses,
      defaultAddress: addresses[0]?.address || 'localhost',
    });
  });

  app.use('/api/tests', createTestsRouter(db));
  app.use('/api/sessions', createSessionsRouter(db));

  registerSocketHandlers(io, db);

  if (embeddedAssets) {
    app.use((req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) {
        return next();
      }
      const reqPath = req.path === '/' ? '/index.html' : req.path;
      const asset = embeddedAssets.get(reqPath) || embeddedAssets.get('/index.html');
      if (!asset) return next();

      const ext = path.extname(embeddedAssets.has(reqPath) ? reqPath : '/index.html');
      res.setHeader('Content-Type', MIME_TYPES[ext] || 'application/octet-stream');
      res.send(asset);
    });
  } else {
    // Serve built React frontend in production if client/dist exists
    const clientDist = path.join(__dirname, '..', 'client', 'dist');
    if (fs.existsSync(clientDist)) {
      app.use(express.static(clientDist));
      app.get('/{*splat}', (req, res, next) => {
        if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) {
          return next();
        }
        res.sendFile(path.join(clientDist, 'index.html'));
      });
    }
  }

  return { app, server, io, db };
}

export function startServer({ embeddedAssets = null, openBrowser = false } = {}) {
  const port = Number(process.env.PORT) || 3000;
  const { server, db } = createApp({ port, embeddedAssets, autoImportFolder: true });

  // Background auto-sync from saved GitHub repo (non-blocking, safe if offline)
  const syncRow = db.prepare("SELECT value FROM settings WHERE key = 'sync_github_repo'").get();
  if (syncRow?.value) {
    syncFromGithub(db, syncRow.value)
      .then((res) => {
        if (res.imported?.length > 0) {
          console.log(`Синхронизация GitHub: загружено новых тестов — ${res.imported.length}`);
        }
      })
      .catch(() => {});
  }

  server.listen(port, '0.0.0.0', () => {
    const addrs = getLocalAddresses();
    console.log(`\nСервер «Тесты Алтын Каппасовны» запущен:`);
    console.log(`  Локально (для учителя): http://localhost:${port}/teacher`);
    for (const a of addrs) {
      console.log(`  В сети (${a.label}): http://${a.address}:${port}`);
    }
    console.log('\nНе закрывайте это окно, пока идёт тестирование.\n');

    if (openBrowser && process.platform === 'win32') {
      exec(`start "" "http://localhost:${port}/teacher"`);
    }
  });

  return server;
}

// Start server only when executed directly
let isSeaEnv = false;
try {
  isSeaEnv = sea.isSea();
} catch {
  isSeaEnv = false;
}

const isMain = !isSeaEnv && typeof import.meta?.url === 'string' && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  startServer();
}
