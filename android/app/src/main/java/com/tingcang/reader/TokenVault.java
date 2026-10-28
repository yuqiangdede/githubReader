package com.tingcang.reader;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONObject;

final class TokenVault {
    private static SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null);
        if (store.containsAlias("github_token")) return ((KeyStore.SecretKeyEntry) store.getEntry("github_token", null)).getSecretKey();
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder("github_token", KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
        return generator.generateKey();
    }
    static void put(Context context, String token) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, key());
        String value = Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + ":" + Base64.encodeToString(cipher.doFinal(token.getBytes(java.nio.charset.StandardCharsets.UTF_8)), Base64.NO_WRAP);
        if (!context.getSharedPreferences("vault", Context.MODE_PRIVATE).edit().putString("token", value).commit()) throw new Exception("无法保存登录凭据");
    }
    static String get(Context context) throws Exception {
        String value = context.getSharedPreferences("vault", Context.MODE_PRIVATE).getString("token", "");
        if (value.isEmpty()) return "";
        String[] parts = value.split(":", 2); Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)));
        return new String(cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), java.nio.charset.StandardCharsets.UTF_8);
    }
    static void putCredentials(Context context, JSONObject data) throws Exception {
        JSONObject value = new JSONObject().put("access_token", data.getString("access_token"));
        if (data.has("refresh_token")) value.put("refresh_token", data.getString("refresh_token"));
        if (data.has("expires_in")) value.put("expiresAt", System.currentTimeMillis() + data.getLong("expires_in") * 1000);
        put(context, value.toString());
    }
    static JSONObject credentials(Context context) throws Exception {
        String value = get(context); return value.isEmpty() ? new JSONObject() : new JSONObject(value);
    }
    static void clear(Context context) { context.getSharedPreferences("vault", Context.MODE_PRIVATE).edit().clear().commit(); }
}
