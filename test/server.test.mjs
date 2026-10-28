import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { server } from '../server.mjs';
let base;
before(async () => { await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); base = `http://127.0.0.1:${server.address().port}`; });
after(() => new Promise(resolve => server.close(resolve)));
test('PWA 安装需要的静态资源均可访问', async () => {
  const manifest = await (await fetch(`${base}/manifest.webmanifest`)).json();
  assert.equal(manifest.display, 'standalone');
  for (const path of ['/', '/app.js', '/reader.js', '/style.css', '/sw.js', ...manifest.icons.map(x => x.src)]) assert.equal((await fetch(base + path)).status, 200, path);
});
test('登录状态接口不泄露 token', async () => { const response = await fetch(base + '/api/session'); assert.equal(response.headers.get('cache-control'), 'no-store'); const body = await response.json(); assert.equal(body.user, null); assert.equal('token' in body, false); });
test('拒绝任意代理请求与目录穿越', async () => { for (const path of ['https://evil.example', '/user', '/repos/a/b/../../user']) assert.equal((await fetch(`${base}/api/github?${new URLSearchParams({ path })}`)).status, 400); assert.equal((await fetch(base + '/.env')).status, 404); });
test('OAuth 回调拒绝伪造 state', async () => { const response = await fetch(base + '/auth/callback?state=fake&code=fake', { redirect: 'manual' }); assert.equal(response.status, 302); assert.equal(response.headers.get('location'), '/?auth=failed'); });
test('退出接口验证来源', async () => { assert.equal((await fetch(base + '/auth/logout', { method: 'POST', headers: { Origin: 'https://evil.example' } })).status, 403); });
