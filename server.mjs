import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const port = Number(process.env.PORT || 3000);
const origin = process.env.APP_URL || `http://localhost:${port}`;
const secure = new URL(origin).protocol === 'https:';
const sessions = new Map();
const states = new Map();
const configured = Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET);
const cookie = (name, value, age) => `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secure ? '; Secure' : ''}`;
const cookies = req => Object.fromEntries((req.headers.cookie || '').split(';').filter(x => x.includes('=')).map(x => x.trim().split('=')));
function json(res, status, body) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); }
function redirect(res, location, value) { res.writeHead(302, { Location: location, ...(value ? { 'Set-Cookie': value } : {}) }); res.end(); }
async function github(path, token) {
  const response = await fetch(`https://api.github.com${path}`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'GitHub-Listen', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, signal: AbortSignal.timeout(20000) });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.message || 'GitHub 请求失败'), { status: response.status });
  return data;
}
const types = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css', webmanifest: 'application/manifest+json', svg: 'image/svg+xml', png: 'image/png' };
const files = new Set(['index.html', 'app.js', 'reader.js', 'native.js', 'style.css', 'sw.js', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png']);
export const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, origin);
    const jar = cookies(req);
    const session = sessions.get(jar.session);
    const token = session?.expires > Date.now() ? session.token : undefined;
    if (url.pathname === '/api/session') return json(res, 200, { configured, user: token ? session.user : null });
    if (url.pathname === '/auth/login') {
      if (!configured) return redirect(res, '/?auth=unconfigured');
      const state = randomBytes(32).toString('hex');
      states.set(state, Date.now() + 600000);
      const target = new URL('https://github.com/login/oauth/authorize');
      target.search = new URLSearchParams({ client_id: process.env.GITHUB_CLIENT_ID, redirect_uri: `${origin}/auth/callback`, scope: 'repo read:user', state }).toString();
      return redirect(res, target.href, cookie('oauth_state', state, 600));
    }
    if (url.pathname === '/auth/callback') {
      const state = url.searchParams.get('state') || '';
      const expected = jar.oauth_state || '';
      const expiry = states.get(state); states.delete(state);
      if (!state || state.length !== expected.length || !timingSafeEqual(Buffer.from(state), Buffer.from(expected)) || !(expiry > Date.now()) || !url.searchParams.get('code')) return redirect(res, '/?auth=failed');
      const response = await fetch('https://github.com/login/oauth/access_token', { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ client_id: process.env.GITHUB_CLIENT_ID, client_secret: process.env.GITHUB_CLIENT_SECRET, code: url.searchParams.get('code'), redirect_uri: `${origin}/auth/callback` }), signal: AbortSignal.timeout(20000) });
      const data = await response.json();
      if (!data.access_token) return redirect(res, '/?auth=failed');
      const user = await github('/user', data.access_token);
      const id = randomBytes(32).toString('hex');
      sessions.set(id, { token: data.access_token, user: { login: user.login, avatar_url: user.avatar_url }, expires: Date.now() + 86400000 });
      return redirect(res, '/', [cookie('session', id, 86400), cookie('oauth_state', '', 0)]);
    }
    if (url.pathname === '/auth/logout' && req.method === 'POST') {
      if (req.headers.origin !== origin) return json(res, 403, { message: '来源无效' });
      sessions.delete(jar.session); res.setHeader('Set-Cookie', cookie('session', '', 0)); return json(res, 200, { ok: true });
    }
    if (url.pathname === '/api/github') {
      const path = url.searchParams.get('path') || '';
      if (!/^\/repos\/[\w.-]+\/[\w.-]+(?:\/contents(?:\/[^?]*)?|\/branches)?(?:\?[^#]*)?$/.test(path) && path !== '/user/repos?per_page=100&sort=updated') return json(res, 400, { message: '无效的仓库请求' });
      return json(res, 200, await github(path, token));
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { message: 'Method not allowed' });
    const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    if (!files.has(name)) return json(res, 404, { message: 'Not found' });
    const body = await readFile(fileURLToPath(new URL(`./public/${name}`, import.meta.url)));
    res.writeHead(200, { 'Content-Type': types[name.split('.').pop()] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https://avatars.githubusercontent.com; connect-src 'self' https://api.github.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none'" });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch (error) { json(res, error.status || 500, { message: error.message || '服务暂时不可用' }); }
});
setInterval(() => { const now = Date.now(); for (const [k, v] of sessions) if (v.expires < now) sessions.delete(k); for (const [k, v] of states) if (v < now) states.delete(k); }, 60000).unref();
if (process.argv[1] === fileURLToPath(import.meta.url)) server.listen(port, '0.0.0.0', () => console.log(`GitHub Listen: ${origin}`));
