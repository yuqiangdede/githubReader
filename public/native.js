export const isAndroid = window.Capacitor?.getPlatform?.() === 'android';
// The buildless WebView uses the plugin wrappers injected by Capacitor's JSExport.
export const github = isAndroid ? window.Capacitor.Plugins.NativeGitHub : null;
export const tts = isAndroid ? window.Capacitor.Plugins.ReaderTts : null;
export const defaultClientId = 'Ov23liooFpbThbrzwAY1';
