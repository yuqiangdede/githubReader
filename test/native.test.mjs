import { test } from 'node:test';
import assert from 'node:assert/strict';
test('安卓无打包器入口使用原生注入的插件，不依赖额外的 registerPlugin 运行时', async () => {
  const github = { api() {} }, tts = { initialize() {} };
  globalThis.window = { Capacitor: { getPlatform: () => 'android', Plugins: { NativeGitHub: github, ReaderTts: tts } } };
  const platform = await import('../public/native.js?android-test');
  assert.equal(platform.isAndroid, true); assert.equal(platform.github, github); assert.equal(platform.tts, tts);
  delete globalThis.window;
});
test('浏览器不访问任何安卓桥接对象', async () => {
  globalThis.window = {};
  const platform = await import('../public/native.js?web-test');
  assert.equal(platform.isAndroid, false); assert.equal(platform.github, null); assert.equal(platform.tts, null);
  delete globalThis.window;
});
