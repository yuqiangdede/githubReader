package com.tingcang.reader;

import android.Manifest;
import android.content.*;
import android.os.*;
import android.provider.Settings;
import com.getcapacitor.*;
import com.getcapacitor.annotation.*;
import java.util.ArrayList;

@CapacitorPlugin(name = "ReaderTts", permissions = @Permission(alias = "notifications", strings = {Manifest.permission.POST_NOTIFICATIONS}))
public class ReaderTtsPlugin extends Plugin {
    private ReaderService service;
    private final ArrayList<PluginCall> waiting = new ArrayList<>();
    private final ReaderService.Observer observer = state -> notifyListeners("state", state);
    private final ServiceConnection connection = new ServiceConnection() {
        @Override public void onServiceConnected(ComponentName name, IBinder binder) { service = ((ReaderService.LocalBinder) binder).service(); service.addObserver(observer); for (PluginCall call : waiting) call.resolve(service.state()); waiting.clear(); }
        @Override public void onServiceDisconnected(ComponentName name) { service = null; }
    };
    @Override public void load() { getContext().bindService(new Intent(getContext(), ReaderService.class), connection, Context.BIND_AUTO_CREATE); }
    private void main(PluginCall call, Runnable action) { getActivity().runOnUiThread(() -> { if (service == null) { call.reject("朗读服务正在初始化，请稍后重试"); return; } try { action.run(); } catch (Exception e) { call.reject(e.getMessage()); } }); }
    @PluginMethod public void initialize(PluginCall call) { getActivity().runOnUiThread(() -> { if (service == null) waiting.add(call); else call.resolve(service.state()); }); }
    @PluginMethod public void getState(PluginCall call) { main(call, () -> call.resolve(service.state())); }
    @PluginMethod public void voices(PluginCall call) { main(call, () -> call.resolve(service.voices())); }
    @PluginMethod public void position(PluginCall call) { main(call, () -> call.resolve(new JSObject().put("index", service.position(call.getString("documentId", ""))))); }
    @PluginMethod public void clearProgress(PluginCall call) { main(call, () -> { service.clearProgress(); call.resolve(); }); }
    @PluginMethod public void loadQueue(PluginCall call) { main(call, () -> {
        JSArray chunks = call.getArray("chunks");
        if (chunks == null || chunks.length() == 0 || chunks.length() > 50000) { call.reject("朗读内容为空或过长"); return; }
        for (int i = 0; i < chunks.length(); i++) if (chunks.optString(i).length() > 2000) { call.reject("朗读段落过长"); return; }
        service.loadQueue(call.getString("documentId", ""), call.getString("title", "听仓"), chunks, call.getInt("index", 0)); call.resolve(service.state());
    }); }
    @PluginMethod public void loadPlaylist(PluginCall call) { main(call, () -> {
        JSArray documents = call.getArray("documents");
        if (documents == null || documents.length() == 0 || documents.length() > 500) { call.reject("播放队列为空或文件过多"); return; }
        for (int i = 0; i < documents.length(); i++) {
            var document = documents.optJSONObject(i);
            var chunks = document == null ? null : document.optJSONArray("chunks");
            if (document == null || document.optString("documentId").isEmpty() || chunks == null || chunks.length() == 0 || chunks.length() > 50000) { call.reject("队列中的文件无效或过长"); return; }
            for (int j = 0; j < chunks.length(); j++) if (chunks.optString(j).length() > 2000) { call.reject("朗读段落过长"); return; }
        }
        service.loadPlaylist(documents); call.resolve(service.state());
    }); }
    @PluginMethod public void play(PluginCall call) { main(call, () -> { service.startPlayback(); call.resolve(); }); }
    @PluginMethod public void pause(PluginCall call) { main(call, () -> { service.pause(); call.resolve(service.state()); }); }
    @PluginMethod public void seek(PluginCall call) { main(call, () -> { service.seek(call.getInt("index", 0)); call.resolve(service.state()); }); }
    @PluginMethod public void configure(PluginCall call) { main(call, () -> { service.configure(call.getFloat("rate", 1f), call.getString("voice", "")); call.resolve(); }); }
    @PluginMethod public void engine(PluginCall call) { main(call, () -> { service.selectEngine(call.getString("engine", "")); call.resolve(); }); }
    @PluginMethod public void openSettings(PluginCall call) { getActivity().startActivity(new Intent("com.android.settings.TTS_SETTINGS")); call.resolve(); }
    @PluginMethod public void notificationPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT < 33 || getPermissionState("notifications") == PermissionState.GRANTED) call.resolve();
        else requestPermissionForAlias("notifications", call, "notificationResult");
    }
    @PermissionCallback private void notificationResult(PluginCall call) { call.resolve(); }
    @Override protected void handleOnResume() { if (service != null) observer.changed(service.state()); }
    @Override protected void handleOnDestroy() { if (service != null) service.removeObserver(observer); try { getContext().unbindService(connection); } catch (Exception ignored) {} }
}
