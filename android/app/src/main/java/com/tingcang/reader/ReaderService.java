package com.tingcang.reader;

import android.app.*;
import android.content.*;
import android.media.*;
import android.media.session.*;
import android.os.*;
import android.speech.tts.*;
import com.getcapacitor.JSObject;
import org.json.JSONArray;
import java.util.*;

/** Owns the queue independently of the WebView, including while the screen is locked. */
public class ReaderService extends Service {
    public static final String PLAY = "play", PAUSE = "pause", NEXT = "next", PREVIOUS = "previous", STOP = "stop";
    private static final String CHANNEL = "reading";
    private static final int NOTIFICATION = 21;
    public interface Observer { void changed(JSObject state); }
    public final class LocalBinder extends Binder { public ReaderService service() { return ReaderService.this; } }
    private final LocalBinder binder = new LocalBinder();
    private final Handler main = new Handler(Looper.getMainLooper());
    private final List<Observer> observers = new ArrayList<>();
    private TextToSpeech tts;
    private boolean ready, playing, foreground;
    private String error = "", documentId = "", title = "听仓", engine = "", voice = "";
    private JSONArray chunks = new JSONArray(), playlist = new JSONArray();
    private int playlistIndex = -1;
    private int index, serial, engineVersion;
    private float rate = 1;
    private MediaSession media;
    private AudioManager audio;
    private AudioFocusRequest focus;
    private PowerManager.WakeLock wake;
    private final AudioManager.OnAudioFocusChangeListener focusListener = change -> { if (change < 0) main.post(this::pause); };

    @Override public void onCreate() {
        super.onCreate();
        var saved = getSharedPreferences("playback", MODE_PRIVATE);
        documentId = saved.getString("documentId", ""); index = saved.getInt("index", 0);
        engine = saved.getString("engine", ""); voice = saved.getString("voice", ""); rate = saved.getFloat("rate", 1);
        audio = (AudioManager) getSystemService(AUDIO_SERVICE);
        wake = ((PowerManager) getSystemService(POWER_SERVICE)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "tingcang:reading");
        if (Build.VERSION.SDK_INT >= 26) ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).createNotificationChannel(new NotificationChannel(CHANNEL, "文字朗读", NotificationManager.IMPORTANCE_LOW));
        media = new MediaSession(this, "听仓");
        media.setCallback(new MediaSession.Callback() {
            @Override public void onPlay() { startPlayback(); }
            @Override public void onPause() { pause(); }
            @Override public void onSkipToNext() { seek(index + 1); }
            @Override public void onSkipToPrevious() { seek(index - 1); }
            @Override public void onStop() { finishPlayback(); }
        });
        media.setFlags(MediaSession.FLAG_HANDLES_MEDIA_BUTTONS | MediaSession.FLAG_HANDLES_TRANSPORT_CONTROLS);
        initTts();
    }
    private void initTts() {
        int version = ++engineVersion;
        ready = false; error = "";
        tts = new TextToSpeech(getApplicationContext(), status -> main.post(() -> {
            if (version != engineVersion) return;
            ready = status == TextToSpeech.SUCCESS;
            if (!ready) { error = "TTS 初始化失败，请在系统设置安装或启用语音引擎"; emit(); return; }
            tts.setLanguage(Locale.SIMPLIFIED_CHINESE);
            tts.setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build());
            tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                @Override public void onStart(String id) {}
                @Override public void onDone(String id) { main.post(() -> { if (!playing || !id.equals(String.valueOf(serial))) return; if (index + 1 < chunks.length()) { index++; speakCurrent(); } else if (playlistIndex >= 0 && playlistIndex + 1 < playlist.length()) { save(); playlistIndex++; selectPlaylistDocument(); speakCurrent(); } else { playing = false; releaseAudio(); save(); emit(); updateMedia(); stopForeground(STOP_FOREGROUND_REMOVE); foreground = false; stopSelf(); } }); }
                @Override public void onError(String id) { main.post(() -> { if (!id.equals(String.valueOf(serial))) return; error = "朗读失败，请检查语音包或切换声音"; pause(); }); }
            });
            applyVoice(); emit();
        }), engine.isEmpty() ? null : engine);
    }
    @Override public IBinder onBind(Intent intent) { return binder; }
    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? STOP : intent.getAction();
        if (PLAY.equals(action)) { startForeground(NOTIFICATION, notification()); foreground = true; play(); }
        else if (PAUSE.equals(action)) pause();
        else if (NEXT.equals(action)) seek(index + 1);
        else if (PREVIOUS.equals(action)) seek(index - 1);
        else finishPlayback();
        return START_NOT_STICKY;
    }
    public void addObserver(Observer observer) { observers.add(observer); }
    public void removeObserver(Observer observer) { observers.remove(observer); }
    public JSObject state() { return new JSObject().put("ready", ready).put("playing", playing).put("documentId", documentId).put("index", index).put("total", chunks.length()).put("error", error).put("engine", engine).put("voice", voice).put("rate", rate); }
    private void emit() { JSObject state = state(); for (Observer observer : new ArrayList<>(observers)) observer.changed(state); }
    private void save() {
        var editor = getSharedPreferences("playback", MODE_PRIVATE).edit().putString("documentId", documentId).putInt("index", index).putString("engine", engine).putString("voice", voice).putFloat("rate", rate);
        if (!documentId.isEmpty()) editor.putInt("position:" + documentId, index); editor.apply();
    }
    public int position(String id) { return getSharedPreferences("playback", MODE_PRIVATE).getInt("position:" + id, -1); }
    public void clearProgress() { pause(); getSharedPreferences("playback", MODE_PRIVATE).edit().clear().apply(); }
    public void loadQueue(String id, String name, JSONArray text, int start) {
        pause(); playlist = new JSONArray(); playlistIndex = -1; documentId = id; title = name; chunks = text; index = Math.max(0, Math.min(start, chunks.length() - 1)); error = ""; save(); emit(); updateMedia();
    }
    public void loadPlaylist(JSONArray documents) {
        pause(); playlist = documents; playlistIndex = 0; selectPlaylistDocument(); error = ""; save(); emit(); updateMedia();
    }
    private void selectPlaylistDocument() {
        var document = playlist.optJSONObject(playlistIndex);
        documentId = document.optString("documentId"); title = document.optString("title", "听仓");
        chunks = document.optJSONArray("chunks"); index = 0;
    }
    public void configure(float speed, String selectedVoice) {
        rate = Math.max(.5f, Math.min(2f, speed)); voice = selectedVoice; applyVoice(); save(); if (playing) speakCurrent();
    }
    public void selectEngine(String selected) { pause(); if (tts != null) { tts.stop(); tts.shutdown(); } engine = selected; voice = ""; save(); initTts(); }
    private void applyVoice() {
        if (!ready) return;
        tts.setSpeechRate(rate);
        if (voice.isEmpty()) { Voice defaultVoice = tts.getDefaultVoice(); if (defaultVoice != null) tts.setVoice(defaultVoice); return; }
        if (!voice.isEmpty() && tts.getVoices() != null) for (Voice v : tts.getVoices()) if (v.getName().equals(voice)) { tts.setVoice(v); return; }
    }
    public JSObject voices() {
        var result = new JSObject(); var voices = new com.getcapacitor.JSArray(); var engines = new com.getcapacitor.JSArray();
        if (tts != null) for (TextToSpeech.EngineInfo e : tts.getEngines()) engines.put(new JSObject().put("id", e.name).put("name", e.label));
        if (ready && tts.getVoices() != null) for (Voice v : tts.getVoices()) voices.put(new JSObject().put("id", v.getName()).put("name", v.getName()).put("lang", v.getLocale().toLanguageTag()).put("local", !v.isNetworkConnectionRequired()));
        return result.put("voices", voices).put("engines", engines);
    }
    public void startPlayback() {
        Intent intent = new Intent(this, ReaderService.class).setAction(PLAY);
        if (Build.VERSION.SDK_INT >= 26) startForegroundService(intent); else startService(intent);
    }
    private void play() {
        if (!ready || chunks.length() == 0) { error = ready ? "请先选择文本文件" : "语音引擎尚未就绪，请稍后重试"; pause(); stopForeground(STOP_FOREGROUND_REMOVE); foreground = false; stopSelf(); return; }
        AudioAttributes attributes = new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build();
        int granted;
        if (Build.VERSION.SDK_INT >= 26) { focus = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN).setAudioAttributes(attributes).setOnAudioFocusChangeListener(focusListener).build(); granted = audio.requestAudioFocus(focus); }
        else granted = audio.requestAudioFocus(focusListener, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN);
        if (granted != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) { error = "暂时无法获得音频播放权限，请稍后重试"; pause(); return; }
        playing = true; error = ""; if (!wake.isHeld()) wake.acquire(60 * 60 * 1000L); speakCurrent();
    }
    private void speakCurrent() {
        serial++; tts.stop();
        int result = tts.speak(chunks.optString(index), TextToSpeech.QUEUE_FLUSH, null, String.valueOf(serial));
        if (result == TextToSpeech.ERROR) { error = "语音不可用，请检查系统 TTS 设置及离线语音包"; pause(); return; }
        if (!wake.isHeld()) wake.acquire(60 * 60 * 1000L);
        save(); emit(); updateMedia();
    }
    public void pause() { serial++; playing = false; if (tts != null) tts.stop(); releaseAudio(); save(); emit(); updateMedia(); }
    private void releaseAudio() { if (wake.isHeld()) wake.release(); if (Build.VERSION.SDK_INT >= 26 && focus != null) { audio.abandonAudioFocusRequest(focus); focus = null; } else audio.abandonAudioFocus(focusListener); }
    public void seek(int target) { if (chunks.length() == 0) return; index = Math.max(0, Math.min(chunks.length() - 1, target)); if (playing) speakCurrent(); else { save(); emit(); updateMedia(); } }
    private void finishPlayback() { pause(); stopForeground(STOP_FOREGROUND_REMOVE); foreground = false; media.setActive(false); stopSelf(); }
    private PendingIntent action(String name) { return PendingIntent.getService(this, name.hashCode(), new Intent(this, ReaderService.class).setAction(name), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE); }
    private Notification notification() {
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
        return builder.setSmallIcon(R.drawable.ic_reading).setContentTitle(title).setContentText((playing ? "正在朗读" : "已暂停") + " · " + (index + 1) + "/" + chunks.length() + " 段").setContentIntent(open).setVisibility(Notification.VISIBILITY_PRIVATE).setOnlyAlertOnce(true).setOngoing(playing)
            .addAction(new Notification.Action.Builder(android.R.drawable.ic_media_previous, "上一段", action(PREVIOUS)).build())
            .addAction(new Notification.Action.Builder(playing ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play, playing ? "暂停" : "播放", action(playing ? PAUSE : PLAY)).build())
            .addAction(new Notification.Action.Builder(android.R.drawable.ic_media_next, "下一段", action(NEXT)).build())
            .addAction(new Notification.Action.Builder(android.R.drawable.ic_menu_close_clear_cancel, "停止", action(STOP)).build())
            .setStyle(new Notification.MediaStyle().setMediaSession(media.getSessionToken()).setShowActionsInCompactView(0, 1, 2)).build();
    }
    private void updateMedia() {
        media.setActive(chunks.length() > 0);
        media.setMetadata(new MediaMetadata.Builder().putString(MediaMetadata.METADATA_KEY_TITLE, title).putString(MediaMetadata.METADATA_KEY_ARTIST, "听仓 · 第 " + (index + 1) + " 段").build());
        media.setPlaybackState(new PlaybackState.Builder().setActions(PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_PLAY_PAUSE | PlaybackState.ACTION_SKIP_TO_NEXT | PlaybackState.ACTION_SKIP_TO_PREVIOUS | PlaybackState.ACTION_STOP).setState(playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED, index, 1).build());
        if (foreground) ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).notify(NOTIFICATION, notification());
    }
    @Override public void onTaskRemoved(Intent rootIntent) { if (!playing) { stopForeground(STOP_FOREGROUND_REMOVE); stopSelf(); } }
    @Override public void onDestroy() { serial++; releaseAudio(); if (tts != null) { tts.stop(); tts.shutdown(); } media.release(); super.onDestroy(); }
}
