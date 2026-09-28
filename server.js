'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const CsvAdapter = require('./src/storage/CsvAdapter');
const SqlEngine = require('./src/engine/SqlEngine');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');

// 存储层实例 —— 换存储只需替换这一行（如 new JsonAdapter(...)）
const storage = new CsvAdapter({ dataDir: DATA_DIR });
const engine = new SqlEngine(storage);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
};

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function serveStatic(res, urlPath) {
  const rel = urlPath === '/' ? 'index.html' : urlPath;
  let filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not Found'); return; }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;

  // 列出所有表
  if (p === '/api/tables' && req.method === 'GET') {
    try {
      const tables = await storage.listTables();
      sendJson(res, 200, { tables });
    } catch (e) {
      sendJson(res, 500, { error: e.message });
    }
    return;
  }

  // 执行 SQL
  if (p === '/api/query' && req.method === 'POST') {
    let body = '';
    req.on('data', c => {
      body += c;
      if (body.length > 2 * 1024 * 1024) req.destroy(); // 限制 2MB
    });
    req.on('end', async () => {
      try {
        const { sql } = JSON.parse(body || '{}');
        const result = await engine.query(sql);
        sendJson(res, 200, result);
      } catch (e) {
        sendJson(res, 400, { error: e.message });
      }
    });
    return;
  }

  if (p.startsWith('/api/')) {
    res.writeHead(404); res.end('Not Found');
    return;
  }

  serveStatic(res, p);
});

server.listen(PORT, () => {
  console.log(`CSV-SQL demo 运行中 -> http://localhost:${PORT}`);
  console.log(`数据目录: ${DATA_DIR}`);
});
