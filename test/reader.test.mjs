import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRepo, plainText, splitText } from '../public/reader.js';
test('仓库地址验证和规范化', () => { assert.equal(parseRepo('https://github.com/yuqiangdede/The-Last-Watch.git'), 'yuqiangdede/The-Last-Watch'); for (const bad of ['https://evil.com/a/b', '../owner/repo', 'a/b/tree/main', 'a']) assert.throws(() => parseRepo(bad)); });
test('Markdown 清理保留链接正文、去除代码和图片', () => { assert.equal(plainText('# 标题\n[正文](https://example.com)\n![图](a.png)\n```js\nsecret\n```'), '标题\n正文'); });
test('长段落分段不丢失字符，也不拆开 emoji', () => { const input = '😀中文'.repeat(200); const chunks = splitText(input); assert.equal(chunks.join(''), input); assert.ok(chunks.every(c => Array.from(c).length <= 160)); });
test('空文本与中文句号', () => { assert.deepEqual(splitText(' \n'), []); assert.deepEqual(splitText('第一句。第二句！'), ['第一句。', '第二句！']); });
