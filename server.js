import http from 'http';
import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env file locally if process.env.GEMINI_API_KEY is not set
function loadEnv() {
  if (process.env.GEMINI_API_KEY) return;
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const l of lines) {
      const line = l.trim();
      if (line && !line.startsWith('#') && line.includes('=')) {
        const parts = line.split('=');
        const key = parts[0].trim();
        const val = parts.slice(1).join('=').trim().replace(/^["']|["']$/g, '');
        process.env[key] = val;
      }
    }
  }
}

loadEnv();

const PORT = process.env.PORT || 3000;

// MIME types map
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

// Server creation
const server = http.createServer((req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  // 1. Gemini API Proxy Route
  if (req.method === 'POST' && pathname === '/api/gemini/generate') {
    handleGeminiProxy(req, res);
    return;
  }

  // 2. Static File Serving (from dist/ if built, or project root)
  if (req.method === 'GET' || req.method === 'HEAD') {
    handleStaticFile(pathname, res);
    return;
  }

  res.writeHead(405, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Method Not Allowed' }));
});

function handleGeminiProxy(req, res) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey || apiKey === 'your_gemini_api_key_here') {
    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'GEMINI_API_KEY is not configured in environment variables.' }));
    return;
  }

  let body = [];
  req.on('data', chunk => body.push(chunk));
  req.on('end', () => {
    const postData = Buffer.concat(body);

    callGeminiAPI(postData, apiKey, 'gemini-3.6-flash')
      .then(responseData => {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(responseData);
      })
      .catch(err => {
        console.warn('⚠️ [Gemini 3.6 Flash Error, trying Fallback]:', err.message);
        callGeminiAPI(postData, apiKey, 'gemini-2.5-flash')
          .then(responseData => {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(responseData);
          })
          .catch(fallbackErr => {
            console.error('❌ [Gemini Proxy Error]:', fallbackErr.message);
            res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: `Gemini API Proxy Error: ${fallbackErr.message}` }));
          });
      });
  });
}

function callGeminiAPI(postData, apiKey, modelName) {
  return new Promise((resolve, reject) => {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
    const targetUrl = new URL(url);

    const options = {
      hostname: targetUrl.hostname,
      path: targetUrl.pathname + targetUrl.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': postData.length
      }
    };

    const apiReq = https.request(options, (apiRes) => {
      let data = [];
      apiRes.on('data', chunk => data.push(chunk));
      apiRes.on('end', () => {
        const responseBuffer = Buffer.concat(data);
        if (apiRes.statusCode >= 200 && apiRes.statusCode < 300) {
          resolve(responseBuffer);
        } else {
          reject(new Error(`HTTP ${apiRes.statusCode}: ${responseBuffer.toString('utf8')}`));
        }
      });
    });

    apiReq.on('error', err => reject(err));
    apiReq.write(postData);
    apiReq.end();
  });
}

function handleStaticFile(pathname, res) {
  const distDir = path.join(__dirname, 'dist');
  const useDist = fs.existsSync(distDir);
  const baseDir = useDist ? distDir : __dirname;

  let safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
  if (safePath === '/' || safePath === '\\') {
    safePath = '/index.html';
  }

  let filePath = path.join(baseDir, safePath);

  if (!fs.existsSync(filePath) && useDist) {
    const fallbackPath = path.join(__dirname, safePath);
    if (fs.existsSync(fallbackPath)) {
      filePath = fallbackPath;
    }
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  } else {
    const indexPath = path.join(baseDir, 'index.html');
    if (fs.existsSync(indexPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      fs.createReadStream(indexPath).pipe(res);
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
    }
  }
}

server.listen(PORT, () => {
  console.log(`=========================================`);
  console.log(` Rihal Node.js Production Server Running!`);
  console.log(` URL: http://localhost:${PORT}/`);
  console.log(` API Proxy Route: http://localhost:${PORT}/api/gemini/generate`);
  console.log(`=========================================`);
});
