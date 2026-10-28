package com.tingcang.reader;

import android.content.Intent;
import android.net.Uri;
import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONObject;
import java.net.URL;
import java.net.HttpURLConnection;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "NativeGitHub")
public class GitHubPlugin extends Plugin {
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private String deviceCode = "", loginClient = "";
    private long expiresAt;
    private int interval = 5;
    private long nextPoll;

    private JSONObject request(String address, JSONObject body, boolean authenticated) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(address).openConnection();
        connection.setConnectTimeout(20000); connection.setReadTimeout(20000); connection.setInstanceFollowRedirects(false);
        connection.setRequestProperty("Accept", "application/json"); connection.setRequestProperty("User-Agent", "TingCang-Android");
        if (authenticated) { String token = accessToken(); if (!token.isEmpty()) connection.setRequestProperty("Authorization", "Bearer " + token); }
        try {
            if (body != null) { connection.setRequestMethod("POST"); connection.setDoOutput(true); connection.setRequestProperty("Content-Type", "application/json"); try (var output = connection.getOutputStream()) { output.write(body.toString().getBytes(StandardCharsets.UTF_8)); } }
            int status = connection.getResponseCode();
            var stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
            String text; if (stream == null) text = "{}"; else try (stream; var output = new java.io.ByteArrayOutputStream()) { byte[] buffer = new byte[8192]; int count; while ((count = stream.read(buffer)) != -1) { output.write(buffer, 0, count); if (output.size() > 8000000) throw new Exception("GitHub 响应过大"); } text = output.toString("UTF-8"); }
            return new JSONObject().put("status", status).put("body", text);
        } finally { connection.disconnect(); }
    }
    private JSONObject post(String address, JSONObject body) throws Exception {
        JSONObject response = request(address, body, false);
        JSONObject data = new JSONObject(response.getString("body"));
        if (response.getInt("status") >= 400) throw new Exception(data.optString("error_description", data.optString("message", "GitHub 请求失败")));
        return data;
    }
    private String accessToken() throws Exception {
        JSONObject credentials = TokenVault.credentials(getContext());
        if (credentials.optLong("expiresAt", Long.MAX_VALUE) < System.currentTimeMillis() + 60000 && credentials.has("refresh_token")) {
            String clientId = getContext().getSharedPreferences("github", 0).getString("clientId", "");
            JSONObject refreshed = post("https://github.com/login/oauth/access_token", new JSONObject().put("client_id", clientId).put("grant_type", "refresh_token").put("refresh_token", credentials.getString("refresh_token")));
            if (!refreshed.has("access_token")) { TokenVault.clear(getContext()); throw new Exception("GitHub 登录已过期，请重新授权"); }
            if (!refreshed.has("refresh_token")) refreshed.put("refresh_token", credentials.getString("refresh_token"));
            TokenVault.putCredentials(getContext(), refreshed); credentials = TokenVault.credentials(getContext());
        }
        return credentials.optString("access_token", "");
    }
    @PluginMethod public void api(PluginCall call) {
        String path = call.getString("path", "");
        if (!GitHubPaths.allowed(path)) { call.reject("无效的仓库请求"); return; }
        executor.execute(() -> { try { JSONObject result = request("https://api.github.com" + path, null, true); call.resolve(JSObject.fromJSONObject(result)); } catch (Exception e) { call.reject("无法连接 GitHub，请检查网络：" + e.getMessage()); } });
    }
    @PluginMethod public void session(PluginCall call) {
        executor.execute(() -> { try {
            JSObject result = new JSObject(); String token = TokenVault.get(getContext());
            result.put("loggedIn", !token.isEmpty());
            result.put("clientId", getContext().getSharedPreferences("github", 0).getString("clientId", ""));
            result.put("login", getContext().getSharedPreferences("github", 0).getString("login", "GitHub")); call.resolve(result);
        } catch (Exception e) { TokenVault.clear(getContext()); call.reject("凭据已失效，请重新登录"); } });
    }
    @PluginMethod public void startLogin(PluginCall call) {
        String clientId = call.getString("clientId", "").trim();
        if (!clientId.matches("[A-Za-z0-9_]{10,100}")) { call.reject("请输入正确的 GitHub OAuth App Client ID"); return; }
        executor.execute(() -> { try {
            JSONObject data = post("https://github.com/login/device/code", new JSONObject().put("client_id", clientId).put("scope", "repo read:user"));
            if (data.has("error")) throw new Exception(data.optString("error_description", data.getString("error")));
            deviceCode = data.getString("device_code"); loginClient = clientId; interval = data.optInt("interval", 5); nextPoll = 0;
            expiresAt = System.currentTimeMillis() + data.getLong("expires_in") * 1000;
            getContext().getSharedPreferences("github", 0).edit().putString("clientId", clientId).apply();
            JSObject result = new JSObject(); result.put("userCode", data.getString("user_code")); result.put("interval", interval); result.put("expiresIn", data.getInt("expires_in")); call.resolve(result);
        } catch (Exception e) { call.reject("无法开始授权：" + e.getMessage()); } });
    }
    @PluginMethod public void pollLogin(PluginCall call) {
        executor.execute(() -> { try {
            if (deviceCode.isEmpty() || System.currentTimeMillis() >= expiresAt) throw new Exception("授权码已过期，请重新开始");
            if (System.currentTimeMillis() < nextPoll) { call.resolve(new JSObject().put("pending", true).put("interval", interval)); return; }
            nextPoll = System.currentTimeMillis() + interval * 1000L;
            JSONObject data = post("https://github.com/login/oauth/access_token", new JSONObject().put("client_id", loginClient).put("device_code", deviceCode).put("grant_type", "urn:ietf:params:oauth:grant-type:device_code"));
            String error = data.optString("error");
            if (error.equals("authorization_pending") || error.equals("slow_down")) { if (error.equals("slow_down")) interval += 5; call.resolve(new JSObject().put("pending", true).put("interval", interval)); return; }
            if (!error.isEmpty()) { deviceCode = ""; throw new Exception(data.optString("error_description", error)); }
            TokenVault.putCredentials(getContext(), data); deviceCode = "";
            JSONObject userResponse = request("https://api.github.com/user", null, true);
            if (userResponse.getInt("status") != 200) throw new Exception("授权完成，但用户信息读取失败，请重试登录");
            String login = new JSONObject(userResponse.getString("body")).getString("login");
            getContext().getSharedPreferences("github", 0).edit().putString("login", login).apply();
            call.resolve(new JSObject().put("pending", false).put("login", login));
        } catch (Exception e) { call.reject(e.getMessage()); } });
    }
    @PluginMethod public void cancelLogin(PluginCall call) { executor.execute(() -> { deviceCode = ""; call.resolve(); }); }
    @PluginMethod public void logout(PluginCall call) { executor.execute(() -> { deviceCode = ""; TokenVault.clear(getContext()); getContext().getSharedPreferences("github", 0).edit().remove("login").apply(); call.resolve(); }); }
    @PluginMethod public void openAuthorization(PluginCall call) { getActivity().startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("https://github.com/login/device"))); call.resolve(); }
    @PluginMethod public void openSettings(PluginCall call) { getActivity().startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("https://github.com/settings/developers"))); call.resolve(); }
    @Override protected void handleOnDestroy() { executor.shutdown(); }
}
