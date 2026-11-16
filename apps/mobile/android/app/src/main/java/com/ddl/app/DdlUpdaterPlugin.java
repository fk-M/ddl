package com.ddl.app;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Android 应用内自更新。
 *
 * 只做两件事：把新 APK 下到应用缓存目录，再通过 FileProvider 拉起系统安装器。
 * 系统会弹「是否更新」，确认后覆盖安装，数据（WebView 的 IndexedDB）不受影响。
 * 前提是新旧两个 APK 用同一把签名密钥，见 android/ddl-release.properties。
 */
@CapacitorPlugin(name = "DdlUpdater")
public class DdlUpdaterPlugin extends Plugin {

    /** 是否已允许「安装未知来源应用」（Android 8+ 必须由用户手动授权一次） */
    @PluginMethod
    public void canInstall(PluginCall call) {
        boolean allowed = true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            allowed = getContext().getPackageManager().canRequestPackageInstalls();
        }
        JSObject result = new JSObject();
        result.put("allowed", allowed);
        call.resolve(result);
    }

    /** 跳到系统设置页，让用户打开本应用的「安装未知应用」开关 */
    @PluginMethod
    public void requestInstallPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Intent intent = new Intent(
                Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:" + getContext().getPackageName())
            );
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
        }
        call.resolve();
    }

    /** 下载并拉起安装器 */
    @PluginMethod
    public void install(PluginCall call) {
        final String url = call.getString("url");
        final String fileName = call.getString("fileName", "ddl-update.apk");
        if (url == null || url.isEmpty()) {
            call.reject("缺少下载地址");
            return;
        }
        final Activity activity = getActivity();
        if (activity == null) {
            call.reject("应用尚未就绪");
            return;
        }

        new Thread(() -> {
            File target = null;
            try {
                File dir = new File(activity.getCacheDir(), "updates");
                if (!dir.exists() && !dir.mkdirs()) throw new IOException("无法创建下载目录");
                target = new File(dir, fileName);

                HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
                connection.setInstanceFollowRedirects(true);
                connection.setConnectTimeout(20000);
                connection.setReadTimeout(120000);
                connection.setRequestProperty("User-Agent", "DDL-Android");
                connection.setRequestProperty("Accept", "application/octet-stream");
                int code = connection.getResponseCode();
                if (code != HttpURLConnection.HTTP_OK) {
                    throw new IOException("下载失败 HTTP " + code);
                }

                try (
                    InputStream input = connection.getInputStream();
                    FileOutputStream output = new FileOutputStream(target)
                ) {
                    byte[] buffer = new byte[81920];
                    int read;
                    while ((read = input.read(buffer)) > 0) {
                        output.write(buffer, 0, read);
                    }
                }
                connection.disconnect();

                final File apk = target;
                activity.runOnUiThread(() -> {
                    try {
                        launchInstaller(activity, apk);
                        JSObject result = new JSObject();
                        result.put("ok", true);
                        call.resolve(result);
                    } catch (Exception error) {
                        call.reject("拉起安装器失败：" + error.getMessage());
                    }
                });
            } catch (Exception error) {
                call.reject("下载更新包失败：" + error.getMessage());
            }
        }).start();
    }

    private void launchInstaller(Activity activity, File apk) {
        Uri uri = FileProvider.getUriForFile(
            activity,
            activity.getPackageName() + ".fileprovider",
            apk
        );
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(uri, "application/vnd.android.package-archive");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        activity.startActivity(intent);
    }
}
