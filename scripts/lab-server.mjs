import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
const root = resolve(import.meta.dirname, '..'), port = 4173;
const silent = Buffer.alloc(44 + 8000 * 60 * 2);
silent.write('RIFF'); silent.writeUInt32LE(silent.length - 8, 4); silent.write('WAVEfmt ', 8);
silent.writeUInt32LE(16, 16); silent.writeUInt16LE(1, 20); silent.writeUInt16LE(1, 22); silent.writeUInt32LE(8000, 24);
silent.writeUInt32LE(16000, 28); silent.writeUInt16LE(2, 32); silent.writeUInt16LE(16, 34); silent.write('data', 36); silent.writeUInt32LE(silent.length - 44, 40);
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  if (url.pathname === '/silence.wav') {
    const match = req.headers.range?.match(/bytes=(\d+)-(\d*)/);
    const start = match ? Number(match[1]) : 0, end = match?.[2] ? Math.min(Number(match[2]), silent.length - 1) : silent.length - 1;
    if (start > end || start >= silent.length) { res.writeHead(416); res.end(); return; }
    res.writeHead(match ? 206 : 200, { 'Content-Type': 'audio/wav', 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1,
      ...(match ? { 'Content-Range': `bytes ${start}-${end}/${silent.length}` } : {}) }); res.end(silent.subarray(start, end + 1)); return;
  }
  const requestPath = ['/watch', '/'].includes(url.pathname) ? 'lab/index.html' : url.pathname.slice(1);
  const file = resolve(root, requestPath);
  if (!file.startsWith(root + sep) || !/^(lab|extension)\//.test(requestPath)) { res.writeHead(403); res.end(); return; }
  try { const body = await readFile(file); res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(body); }
  catch { res.writeHead(404); res.end('Not found'); }
}).listen(port, '127.0.0.1', () => console.log(`Local fixture lab: http://127.0.0.1:${port}/watch?v=abcdefghijk`));
