package com.ddl.app;

import android.Manifest;
import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * 系统通知插件（自研，Capacitor 只自动发现 npm 插件，须在 MainActivity 手动注册）。
 *
 * 两个能力：
 * 1. notify：App 开着时立刻弹一条通知（WebView 里没有 Notification API，只能走原生）；
 * 2. schedule：把未来的提醒交给 AlarmManager，App 退到后台或被关掉也能准时弹。
 */
@CapacitorPlugin(
    name = "DdlNotify",
    permissions = {
        @Permission(alias = DdlNotifyPlugin.PERMISSION_ALIAS, strings = { Manifest.permission.POST_NOTIFICATIONS })
    }
)
public class DdlNotifyPlugin extends Plugin {

    public static final String PERMISSION_ALIAS = "notifications";
    public static final String CHANNEL_ID = "ddl-reminders";
    public static final String ACTION_REMIND = "com.ddl.app.action.REMIND";
    public static final String PREFS = "ddl-scheduled-notifications";

    @Override
    public void load() {
        ensureChannel(getContext());
    }

    /** 建通知渠道（Android 8+ 必须） */
    static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null || manager.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "任务提醒",
            NotificationManager.IMPORTANCE_HIGH
        );
        channel.setDescription("到点提醒你该做的事");
        channel.enableVibration(true);
        manager.createNotificationChannel(channel);
    }

    static boolean notificationsEnabled(Context context) {
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
        }
        return true;
    }

    private static boolean exactAlarmsAllowed(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true;
        AlarmManager manager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        return manager != null && manager.canScheduleExactAlarms();
    }

    @PluginMethod
    public void checkPermission(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("granted", notificationsEnabled(getContext()));
        ret.put("exact", exactAlarmsAllowed(getContext()));
        call.resolve(ret);
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && !notificationsEnabled(getContext())) {
            // 系统弹窗只会在「从未询问过」时出现；已被永久拒绝时这里会直接回调，前端再引导去设置页
            requestPermissionForAlias(PERMISSION_ALIAS, call, "onPermissionResult");
            return;
        }
        resolvePermission(call);
    }

    @PermissionCallback
    private void onPermissionResult(PluginCall call) {
        resolvePermission(call);
    }

    private void resolvePermission(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("granted", notificationsEnabled(getContext()));
        call.resolve(ret);
    }

    /** 打开系统的应用通知设置页（用户之前点过「不允许」时的补救路径） */
    @PluginMethod
    public void openSettings(PluginCall call) {
        Context context = getContext();
        try {
            Intent intent;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
                intent.putExtra(Settings.EXTRA_APP_PACKAGE, context.getPackageName());
            } else {
                intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                intent.setData(Uri.parse("package:" + context.getPackageName()));
            }
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(intent);
            call.resolve();
        } catch (Exception error) {
            call.reject("打不开系统设置：" + error.getMessage());
        }
    }

    @PluginMethod
    public void notify(PluginCall call) {
        int id = call.getInt("id", (int) (System.currentTimeMillis() % 100000));
        String title = call.getString("title", "截止日");
        String body = call.getString("body", "");
        boolean silent = Boolean.TRUE.equals(call.getBoolean("silent", false));
        post(getContext(), id, title, body, silent);
        call.resolve();
    }

    /**
     * 用给定列表整体替换已排期的提醒。
     * items: [{ id, title, body, at }]，at 为毫秒时间戳。
     */
    @PluginMethod
    public void schedule(PluginCall call) {
        Context context = getContext();
        ensureChannel(context);

        JSArray items = call.getArray("items");
        AlarmManager manager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (manager == null) {
            call.reject("系统不支持 AlarmManager");
            return;
        }

        String previous = prefs(context).getString("items", "[]");
        cancelAllAlarms(context, manager, previous);

        long now = System.currentTimeMillis();
        StringBuilder store = new StringBuilder("[");
        int scheduled = 0;

        try {
            if (items != null) {
                for (int index = 0; index < items.length(); index++) {
                    JSONObject item = items.getJSONObject(index);
                    long at = item.optLong("at", 0);
                    if (at <= now) continue; // 过期的不排
                    int id = item.optInt("id", index + 1);
                    String title = item.optString("title", "截止日");
                    String body = item.optString("body", "");

                    PendingIntent pending = buildPendingIntent(context, id, title, body);
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !exactAlarmsAllowed(context)) {
                        manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending);
                    } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                        manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending);
                    } else {
                        manager.setExact(AlarmManager.RTC_WAKEUP, at, pending);
                    }

                    if (scheduled > 0) store.append(',');
                    store
                        .append("{\"id\":")
                        .append(id)
                        .append(",\"at\":")
                        .append(at)
                        .append(",\"title\":")
                        .append(JSONObject.quote(title))
                        .append(",\"body\":")
                        .append(JSONObject.quote(body))
                        .append('}');
                    scheduled++;
                }
            }
        } catch (Exception error) {
            call.reject("排期失败：" + error.getMessage());
            return;
        }
        store.append(']');

        prefs(context).edit().putString("items", store.toString()).apply();

        JSObject ret = new JSObject();
        ret.put("scheduled", scheduled);
        ret.put("exact", exactAlarmsAllowed(context));
        call.resolve(ret);
    }

    @PluginMethod
    public void cancelAll(PluginCall call) {
        Context context = getContext();
        AlarmManager manager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (manager != null) {
            cancelAllAlarms(context, manager, prefs(context).getString("items", "[]"));
        }
        prefs(context).edit().remove("items").apply();
        call.resolve();
    }

    /* ------------------------------ 内部工具 ------------------------------ */

    static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static PendingIntent buildPendingIntent(Context context, int id, String title, String body) {
        Intent intent = new Intent(context, ReminderReceiver.class);
        intent.setAction(ACTION_REMIND);
        intent.putExtra("id", id);
        intent.putExtra("title", title);
        intent.putExtra("body", body);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        // requestCode 用 id，保证每条提醒各自独立
        return PendingIntent.getBroadcast(context, id, intent, flags);
    }

    private static void cancelAllAlarms(Context context, AlarmManager manager, String storedJson) {
        try {
            if (storedJson == null || storedJson.length() <= 2) return;
            JSONArray stored = new JSONArray(storedJson);
            for (int index = 0; index < stored.length(); index++) {
                JSONObject item = stored.getJSONObject(index);
                int id = item.optInt("id", 0);
                if (id == 0) continue;
                PendingIntent pending = buildPendingIntent(context, id, "", "");
                manager.cancel(pending);
                pending.cancel();
            }
        } catch (Exception ignored) {
            // 列表损坏就整体放弃，下次 schedule 会重写
        }
    }

    /** 真正发一条通知；被系统拦（无权限）时静默失败，不影响主流程 */
    static void post(Context context, int id, String title, String body, boolean silent) {
        ensureChannel(context);
        if (!notificationsEnabled(context)) return;

        Intent open = new Intent(context, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent contentIntent = PendingIntent.getActivity(context, id, open, flags);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setSmallIcon(android.R.drawable.ic_popup_reminder)
            .setAutoCancel(true)
            .setContentIntent(contentIntent)
            .setPriority(NotificationCompat.PRIORITY_HIGH);

        if (silent) builder.setSilent(true);

        try {
            NotificationManagerCompat.from(context).notify(id, builder.build());
        } catch (SecurityException ignored) {
            // 没给通知权限
        }
    }
}
