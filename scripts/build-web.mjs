import { mkdir, readdir, copyFile, readFile, writeFile } from 'node:fs/promises';
await mkdir('dist', { recursive: true });
for (const name of await readdir('public')) await copyFile(`public/${name}`, `dist/${name}`);
let html = await readFile('dist/index.html', 'utf8');
html = html.replace('<head>', `<head><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' https://localhost; style-src 'self'; img-src 'self' https://avatars.githubusercontent.com data:; connect-src 'self' https://api.github.com https://github.com; object-src 'none'; base-uri 'self'">`);
await writeFile('dist/index.html', html);
console.log('Bundled offline web assets → dist/');
