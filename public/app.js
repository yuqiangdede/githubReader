import { parseRepo, plainText, splitText } from './reader.js';
import { isAndroid, github, tts, defaultClientId } from './native.js';
const $ = id => document.getElementById(id);
let repo = '', branch = '', directory = '', current = null, chunks = [], index = 0, playing = false, generation = 0, sourceMode = false, deferredInstall;
const synth = window.speechSynthesis;
let nativeState = null, notificationAsked = false, authGeneration = 0, authTimer, lastNativeError = '';
let db;
let selectedFiles = [], playlist = [], playlistIndex = -1, attachingDocument = false;
const dbReady = new Promise(resolve => {
  const request = indexedDB.open('github-listen', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('files', { keyPath: 'id' });
  request.onsuccess = () => { db = request.result; resolve(); recent(); };
  request.onerror = () => { notice('设备存储不可用，已读文件无法离线保存'); resolve(); };
});
function transaction(mode, action) { return new Promise((resolve, reject) => { if (!db) return resolve(null); const tx = db.transaction('files', mode); const req = action(tx.objectStore('files')); let value; req.onsuccess = () => value = req.result; tx.oncomplete = () => resolve(value); tx.onerror = () => reject(tx.error); }); }
async function saveCurrent() { if (current && current.cached !== false) { current.position = index; current.updated = Date.now(); try { await transaction('readwrite', s => s.put(current)); } catch { notice('离线存储空间不足'); } } }
async function recent() {
  const rows = await transaction('readonly', s => s.getAll()) || [];
  $('recent').replaceChildren();
  for (const row of rows.sort((a,b) => b.updated-a.updated).slice(0,5)) { const b = document.createElement('button'); b.className = 'text-button'; b.textContent = row.path.split('/').pop(); b.title = `${row.repo} / ${row.path}`; b.onclick = () => run(() => { playlist = []; playlistIndex = -1; return openDocument(row); }); $('recent').append(b); }
}
let noticeTimer;
function notice(message) { $('notice').textContent = message; $('notice').hidden = false; clearTimeout(noticeTimer); noticeTimer = setTimeout(() => $('notice').hidden = true, 6500); }
async function api(path) {
  let response;
  try { response = isAndroid ? await github.api({ path }) : await fetch(`/api/github?${new URLSearchParams({ path })}`); }
  catch (error) { throw new Error(isAndroid ? error.message : '网络不可用，可以从“最近听过”打开离线文件'); }
  const data = isAndroid ? JSON.parse(response.body) : await response.json();
  if (response.status < 200 || response.status >= 300) throw new Error(response.status === 401 ? 'GitHub 登录已失效，请重新授权' : response.status === 403 || response.status === 429 ? 'GitHub 访问额度不足或无权访问，请登录后重试' : response.status === 404 ? '仓库、分支或文件不存在；私有仓库请先登录授权' : data.message);
  return data;
}
function contentPath(path, targetRepo = repo, targetBranch = branch) { return `/repos/${targetRepo}/contents${path ? '/' + path.split('/').map(encodeURIComponent).join('/') : ''}?ref=${encodeURIComponent(targetBranch)}`; }
async function connect() {
  const candidate = parseRepo($('repo').value); $('files').textContent = '正在连接仓库…';
  const info = await api(`/repos/${candidate}`); repo = candidate; branch = info.default_branch; directory = '';
  $('branch').replaceChildren(new Option(branch, branch));
  await browse('');
  try { const branches = await api(`/repos/${repo}/branches`); $('branch').replaceChildren(...branches.map(b => new Option(b.name, b.name, false, b.name === branch))); } catch { /* default branch remains usable */ }
}
async function browse(path) {
  directory = path; $('files').textContent = '正在读取目录…';
  const list = await api(contentPath(path));
  if (!Array.isArray(list)) throw new Error('该路径不是目录');
  $('breadcrumbs').replaceChildren();
  const crumbs = [['仓库', '']]; let accumulated = '';
  for (const part of path.split('/').filter(Boolean)) { accumulated += (accumulated ? '/' : '') + part; crumbs.push([part, accumulated]); }
  for (const [label, target] of crumbs) { const b = document.createElement('button'); b.textContent = label + ' /'; b.onclick = () => run(() => browse(target)); $('breadcrumbs').append(b); }
  $('files').replaceChildren();
  const readable = /\.(md|markdown|txt|text|rst|csv|json|ya?ml|js|ts|tsx|jsx|py|html|css|java|kt|xml|log|sh)$/i;
  for (const item of list.filter(f => f.type === 'dir' || f.type === 'file' && (readable.test(f.name) || !f.name.includes('.'))).sort((a,b) => (a.type !== b.type ? a.type === 'dir' ? -1 : 1 : a.name.localeCompare(b.name, 'zh-CN', { numeric: true })))) {
    const b = document.createElement('button'); b.className = 'file';
    const icon = document.createElement('span'); icon.className = 'file-icon'; icon.textContent = item.type === 'dir' ? '▱' : '☷';
    const name = document.createElement('span'); name.textContent = item.name; b.append(icon,name);
    b.onclick = () => run(async () => { if (item.type === 'dir') return browse(item.path); playlist = []; playlistIndex = -1; await loadFile(item); document.querySelectorAll('.file.active').forEach(el => el.classList.remove('active')); b.classList.add('active'); });
    if (item.type === 'dir') $('files').append(b);
    else {
      const row = document.createElement('div'); row.className = 'file-row';
      const check = document.createElement('input'); check.type = 'checkbox'; check.className = 'file-check'; check.setAttribute('aria-label', '选择 ' + item.name);
      const entry = { ...item, repo, branch, id: `${repo}@${branch}:${item.path}` };
      check.checked = selectedFiles.some(file => file.id === entry.id);
      check.onchange = () => { selectedFiles = selectedFiles.filter(file => file.id !== entry.id); if (check.checked) selectedFiles.push(entry); renderQueue(); };
      row.append(check, b); $('files').append(row);
    }
  }
  if (!$('files').children.length) $('files').textContent = '此目录没有可朗读的文本文件';
}
async function fetchFile(item) {
  const targetRepo = item.repo || repo, targetBranch = item.branch || branch;
  if (item.size > 1000000) throw new Error('请选择小于 1 MB 的文本文件');
  const data = await api(contentPath(item.path, targetRepo, targetBranch));
  if (data.encoding !== 'base64' || typeof data.content !== 'string') throw new Error('此文件无法作为文本读取，请选择较小的文本文件');
  const raw = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(data.content.replace(/\s/g, '')), c => c.charCodeAt(0)));
  if (raw.includes('\0')) throw new Error('此文件包含二进制内容，无法朗读');
  const id = `${targetRepo}@${targetBranch}:${item.path}`;
  const old = await transaction('readonly', s => s.get(id));
  return { id, repo: targetRepo, branch: targetBranch, path: item.path, raw, position: old?.raw === raw ? old.position : 0, resetProgress: old?.raw !== raw, updated: Date.now() };
}
async function loadFile(item) { await openDocument(await fetchFile(item)); }
function renderQueue() {
  $('queue-count').textContent = `${selectedFiles.length} 个文件`;
  $('queue-play').disabled = $('queue-clear').disabled = !selectedFiles.length;
  $('queue-list').replaceChildren(...selectedFiles.map(file => { const li = document.createElement('li'); li.textContent = file.path; li.title = `${file.repo} / ${file.branch}`; return li; }));
}
$('queue-clear').onclick = () => { selectedFiles = []; renderQueue(); document.querySelectorAll('.file-check').forEach(check => check.checked = false); };
$('queue-play').onclick = () => run(async () => {
  const selection = selectedFiles.slice(); if (!selection.length) return;
  $('queue-play').disabled = true; $('queue-play').textContent = '正在加载…';
  try {
    const rows = [];
    for (const file of selection) {
      const row = await fetchFile(file); row.position = 0; row.resetProgress = true;
      const parts = splitText(/\.(md|markdown)$/i.test(row.path) ? plainText(row.raw) : row.raw);
      if (!parts.length) throw new Error(`文件没有可朗读的正文：${row.path}`);
      rows.push({ row, chunks: parts });
    }
    playlist = rows; playlistIndex = 0;
    for (const entry of rows) await transaction('readwrite', store => store.put(entry.row));
    await openDocument(rows[0].row);
    if (isAndroid) await tts.loadPlaylist({ documents: rows.map(entry => ({ documentId: entry.row.id, title: entry.row.path.split('/').pop(), chunks: entry.chunks })) });
    speak();
  } finally { $('queue-play').textContent = '按选择顺序播放'; renderQueue(); }
});
async function advancePlaylist() {
  if (playlistIndex < 0 || playlistIndex + 1 >= playlist.length) { playing = false; update(); await saveCurrent(); notice('播放队列已结束'); return; }
  playlistIndex++; await openDocument(playlist[playlistIndex].row); speak();
}
async function openDocument(row, attach = false) {
  await saveCurrent();
  if (isAndroid) { if (!attach) await tts.pause(); } else stop();
  current = row; chunks = splitText(/\.(md|markdown)$/i.test(row.path) ? plainText(row.raw) : row.raw); index = Math.min(row.position || 0, Math.max(0, chunks.length-1)); sourceMode = false;
  if (isAndroid) {
    const saved = await tts.position({ documentId: row.id });
    if (!row.resetProgress && saved.index >= 0) index = Math.min(saved.index, Math.max(0, chunks.length-1));
    delete row.resetProgress;
    if (attach && nativeState?.total > 0) { index = nativeState.index; playing = nativeState.playing; }
    else if (chunks.length) { await tts.loadQueue({ documentId: row.id, title: row.path.split('/').pop(), chunks, index }); playing = false; }
  }
  $('file-title').textContent = row.path.split('/').pop(); $('track-name').textContent = $('file-title').textContent;
  $('file-meta').textContent = `${row.raw.length.toLocaleString()} 字符`;
  $('track-detail').textContent = row.repo; $('reading-status').textContent = `${row.branch} · 点击句子，从这里播放`;
  $('mode').disabled = false; $('mode').textContent = '查看原文';
  for (const id of ['play','previous','next','progress']) $(id).disabled = !chunks.length || (!isAndroid && !synth);
  $('progress').max = Math.max(0, chunks.length-1); $('total').textContent = `${chunks.length} 段`;
  document.body.classList.add('reading-mode'); setLibraryOpen(false);
  render(); update(); await saveCurrent(); await recent();
  if (!chunks.length) notice('文件没有可朗读的正文');
}
function setLibraryOpen(open) {
  $('library').hidden = !open;
  $('library-toggle').setAttribute('aria-expanded', String(open));
  $('library-toggle').textContent = open ? '收起书架' : '打开书架';
  document.querySelector('.workspace').classList.toggle('library-closed', !open);
}
$('library-toggle').onclick = () => setLibraryOpen($('library').hidden);
$('library-close').onclick = () => setLibraryOpen(false);
function render() {
  $('document').replaceChildren();
  if (sourceMode) { const pre = document.createElement('pre'); pre.className = 'source'; pre.textContent = current.raw; $('document').append(pre); return; }
  const fragment = document.createDocumentFragment();
  chunks.forEach((text,i) => { const p = document.createElement('p'); p.className = 'segment'; p.textContent = text; p.dataset.index = i; p.tabIndex = 0; p.setAttribute('role', 'button'); p.setAttribute('aria-label', `从此句开始播放：${text}`); p.onclick = () => { if (!window.getSelection()?.toString()) playFrom(i); }; p.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); playFrom(i); } }; fragment.append(p); });
  $('document').append(fragment);
}
function update() {
  $('progress').value = index; $('position').textContent = chunks.length ? index + 1 : 0;
  $('play').textContent = playing ? 'Ⅱ' : '▶'; $('play').setAttribute('aria-label', playing ? '暂停' : '播放');
  $('document').querySelector('.current')?.classList.remove('current');
  const el = $('document').querySelector(`[data-index="${index}"]`); if (playing) el?.classList.add('current');
  if (playing && el) $('document').scrollTo({ top: el.offsetTop - 40, behavior: 'smooth' });
}
function stop() { generation++; playing = false; if (isAndroid) run(() => tts.pause()); else synth?.cancel(); update(); }
function speak() {
  if (isAndroid) { run(async () => { if (!notificationAsked) { notificationAsked = true; await tts.notificationPermission(); } await tts.play(); }); return; }
  if (!synth || !chunks.length) return;
  const version = ++generation; synth.cancel(); playing = true; update();
  function next() {
    if (version !== generation || !playing) return;
    const utterance = new SpeechSynthesisUtterance(chunks[index]);
    utterance.rate = Number($('rate').value); utterance.lang = 'zh-CN';
    const voice = synth.getVoices().find(v => v.voiceURI === $('voice').value); if (voice) { utterance.voice = voice; utterance.lang = voice.lang; }
    utterance.onend = () => { if (version !== generation) return; if (index < chunks.length-1) { index++; update(); saveCurrent(); next(); } else { playing = false; update(); if (playlistIndex >= 0) run(advancePlaylist); else { saveCurrent(); notice('这份文字已朗读完毕'); } } };
    utterance.onerror = e => { if (version !== generation) return; playing = false; update(); if (!['canceled','interrupted'].includes(e.error)) notice('设备朗读失败，请检查系统 TTS 或切换声音后重试'); };
    synth.speak(utterance);
  }
  next();
}
function playFrom(value) {
  if (isAndroid) { run(async () => { const resume = playing; await tts.seek({ index: value }); if (!resume) { if (!notificationAsked) { notificationAsked = true; await tts.notificationPermission(); } await tts.play(); } }); return; }
  if (!synth) return;
  const wasPlaying = playing; seek(value); if (!wasPlaying) speak();
}
function seek(value) { if (isAndroid) { run(() => tts.seek({ index: value })); return; } const resume = playing; stop(); index = Math.max(0,Math.min(chunks.length-1,value)); update(); saveCurrent(); if (resume) speak(); }
async function run(action) { try { await action(); } catch (e) { notice(e.message); if ($('files').textContent.includes('正在')) $('files').textContent = e.message; } }
$('repo-form').onsubmit = e => { e.preventDefault(); run(connect); };
$('demo').onclick = () => run(connect);
$('branch').onchange = () => { branch = $('branch').value; run(() => browse('')); };
$('play').onclick = () => playing ? (stop(), saveCurrent()) : speak();
$('previous').onclick = () => seek(index-1); $('next').onclick = () => seek(index+1);
$('progress').oninput = () => seek(Number($('progress').value));
$('rate').value = localStorage.getItem('rate') || '1';
$('rate').onchange = () => { localStorage.setItem('rate', $('rate').value); if (isAndroid) run(configureNative); else if (playing) speak(); };
function voices() { const preferred = localStorage.getItem('voice') || ''; $('voice').replaceChildren(new Option('系统默认', '')); for (const v of synth.getVoices().sort((a,b) => Number(b.lang.startsWith('zh'))-Number(a.lang.startsWith('zh')))) $('voice').append(new Option(`${v.name}${v.localService ? ' · 本机' : ' · 网络'}`, v.voiceURI, false, v.voiceURI === preferred)); }
if (!isAndroid) { if (synth) { voices(); synth.addEventListener('voiceschanged', voices); } else notice('此浏览器不支持 TTS，请使用安卓 Chrome 或 Edge'); }
$('voice').onchange = () => { localStorage.setItem('voice', $('voice').value); if (isAndroid) run(configureNative); else if (playing) speak(); };
$('mode').onclick = () => { sourceMode = !sourceMode; $('mode').textContent = sourceMode ? '返回朗读正文' : '查看原文'; render(); update(); };
$('clear-cache').onclick = () => run(async () => { if (!confirm('清除本设备所有离线文件和已保存进度？')) return; if (current) current.cached = false; await transaction('readwrite', s => s.clear()); if (isAndroid) await tts.clearProgress(); await recent(); notice('已清除离线文件'); });
$('login').onclick = () => run(async () => {
  if (isAndroid) {
    if ($('login').dataset.logged === 'true') { await github.logout(); setLogin(false); $('repos').hidden = true; notice('已退出 GitHub；离线文件可在书架中清除'); }
    else { $('auth-dialog').showModal(); $('auth-error').textContent = ''; }
    return;
  }
  if ($('login').dataset.logged === 'true') { await fetch('/auth/logout', { method: 'POST' }); location.reload(); } else if ($('login').dataset.configured === 'true') location.href = '/auth/login'; else notice('请先在服务端 .env 中配置 GITHUB_CLIENT_ID 和 GITHUB_CLIENT_SECRET，详见 README');
});
$('my-repos').onclick = () => run(async () => { if ($('login').dataset.logged !== 'true') throw new Error('请先通过 GitHub 网页登录'); const list = await api('/user/repos?per_page=100&sort=updated'); $('repos').replaceChildren(new Option('选择仓库', ''), ...list.map(r => new Option(r.full_name,r.full_name))); $('repos').hidden = false; });
$('repos').onchange = () => { if ($('repos').value) { $('repo').value = $('repos').value; run(connect); } };
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; $('install').hidden = false; });
$('install').onclick = async () => { await deferredInstall?.prompt(); deferredInstall = null; $('install').hidden = true; };
window.addEventListener('online', () => $('connection').textContent = '设备朗读'); window.addEventListener('offline', () => { $('connection').textContent = '离线模式'; notice('已离线，可继续打开“最近听过”的文件'); });
window.addEventListener('pagehide', () => { saveCurrent(); if (!isAndroid) synth?.cancel(); });
if (!isAndroid && 'serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => notice('离线功能未能启用，请确认使用 HTTPS 或 localhost'));
await dbReady;
function setLogin(logged, login) { $('login').dataset.logged = String(logged); $('login').textContent = logged ? `${login} · 退出` : 'GitHub 登录 ↗'; }
async function configureNative() { await tts.configure({ rate: Number($('rate').value), voice: $('voice').value }); }
async function nativeVoices() {
  const data = await tts.voices();
  $('voice').replaceChildren(new Option('引擎默认声音', ''), ...data.voices.sort((a,b) => Number(b.lang.startsWith('zh'))-Number(a.lang.startsWith('zh'))).map(v => new Option(`${v.name} · ${v.local ? '离线' : '需联网'}`,v.id,false,v.id === nativeState.voice)));
  $('engine').replaceChildren(new Option('系统默认引擎', ''), ...data.engines.map(e => new Option(e.name,e.id,false,e.id === nativeState.engine)));
}
if (isAndroid) {
  document.body.classList.add('android'); $('connection').textContent = '安卓原生 TTS'; $('native-settings').hidden = false;
  $('platform-note').textContent = '手机独立运行 · 原生 TTS · 支持锁屏朗读';
  $('client-id').value = defaultClientId;
  $('tts-settings').onclick = () => run(() => tts.openSettings());
  $('engine').onchange = () => run(() => tts.engine({ engine: $('engine').value }));
  await tts.addListener('state', state => {
    const refresh = state.ready && (!nativeState?.ready || nativeState.engine !== state.engine);
    nativeState = state;
    if (current?.id === state.documentId) { index = state.index; playing = state.playing; update(); saveCurrent(); }
    else if (state.playing && state.documentId && !attachingDocument) {
      attachingDocument = true;
      run(async () => { try {
        const row = await transaction('readonly', store => store.get(state.documentId));
        if (row && nativeState?.documentId === state.documentId) {
          playlistIndex = playlist.findIndex(entry => entry.row.id === state.documentId);
          await openDocument(row, true);
        }
      } finally { attachingDocument = false; } });
    }
    if (state.error && state.error !== lastNativeError) notice(state.error); lastNativeError = state.error;
    if (refresh) run(nativeVoices);
  });
  try {
    nativeState = await tts.initialize();
    if (nativeState.ready) await nativeVoices();
    $('rate').value = String(nativeState.rate || 1);
    if (nativeState.documentId) { const row = await transaction('readonly', s => s.get(nativeState.documentId)); if (row) await openDocument(row, true); }
  } catch (e) { notice(e.message); }
  try { const session = await github.session(); setLogin(session.loggedIn, session.login); $('client-id').value = session.clientId || defaultClientId; } catch (e) { notice(e.message); }
  $('open-oauth-settings').onclick = () => run(() => github.openSettings());
  $('open-authorization').onclick = () => run(() => github.openAuthorization());
  $('auth-dialog').addEventListener('close', () => { authGeneration++; clearTimeout(authTimer); github.cancelLogin(); $('device-step').hidden = true; $('start-auth').disabled = false; });
  $('close-auth').onclick = () => $('auth-dialog').close();
  $('auth-form').onsubmit = async e => {
    e.preventDefault(); const version = ++authGeneration; clearTimeout(authTimer); $('auth-error').textContent = ''; $('start-auth').disabled = true;
    try {
      const flow = await github.startLogin({ clientId: $('client-id').value.trim() });
      if (version !== authGeneration) return;
      $('device-code').textContent = flow.userCode; $('device-step').hidden = false;
      const expires = Date.now() + flow.expiresIn * 1000;
      const poll = async () => {
        if (version !== authGeneration) return;
        try {
          if (Date.now() >= expires) throw new Error('授权码已过期，请重新开始');
          const result = await github.pollLogin();
          if (version !== authGeneration) return;
          if (result.pending) authTimer = setTimeout(poll, result.interval * 1000);
          else { setLogin(true, result.login); $('auth-dialog').close(); notice('GitHub 登录成功，现在可以浏览授权的仓库'); }
        } catch (error) { if (version === authGeneration) { $('auth-error').textContent = error.message; $('start-auth').disabled = false; } }
      };
      authTimer = setTimeout(poll, flow.interval * 1000);
    } catch (error) { $('auth-error').textContent = error.message; $('start-auth').disabled = false; }
  };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) run(async () => { const state = await tts.getState(); nativeState = state; if (current?.id === state.documentId) { index = state.index; playing = state.playing; update(); } }); });
} else {
  try { const response = await fetch('/api/session'); const data = await response.json(); $('login').dataset.configured = String(data.configured); setLogin(Boolean(data.user), data.user?.login); } catch { /* offline library works */ }
}
if (new URLSearchParams(location.search).has('auth')) { notice('GitHub 登录未完成，请检查 OAuth 配置后重试'); history.replaceState(null, '', '/'); }
