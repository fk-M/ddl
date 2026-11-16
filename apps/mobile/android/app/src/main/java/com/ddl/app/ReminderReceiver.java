package com.ddl.app;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * 提醒闹钟的落地端：
 * - 收到自己排的 REMIND 广播 → 弹系统通知；
 * - 开关机/应用更新后 AlarmManager 里的闹钟会丢，这里按持久化的列表重新排一遍。
 */
public class ReminderReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();

        if (Intent.ACTION_BOOT_COMPLETED.equals(action) || Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) {
            reschedule(context);
            return;
        }

        int id = intent.getIntExtra("id", 1);
        String title = intent.getStringExtra("title");
        String body = intent.getStringExtra("body");
        DdlNotifyPlugin.post(context, id, title == null ? "截止日" : title, body == null ? "" : body, false);
    }

    /** 开机后把未来的提醒重新交给 AlarmManager（App 被关掉期间排的闹钟不会自动恢复） */
    private void reschedule(Context context) {
        String stored = DdlNotifyPlugin.prefs(context).getString("items", "[]");
        AlarmManager manager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (manager == null) return;

        long now = System.currentTimeMillis();
        try {
            JSONArray items = new JSONArray(stored);
            for (int index = 0; index < items.length(); index++) {
                JSONObject item = items.getJSONObject(index);
                long at = item.optLong("at", 0);
                if (at <= now) continue;
                int id = item.optInt("id", index + 1);
                PendingIntent pending = DdlNotifyPlugin.buildPendingIntent(
                    context,
                    id,
                    item.optString("title", "截止日"),
                    item.optString("body", "")
                );
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    AlarmManager alarms = manager;
                    if (alarms.canScheduleExactAlarms()) {
                        alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending);
                    } else {
                        alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending);
                    }
                } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending);
                } else {
                    manager.setExact(AlarmManager.RTC_WAKEUP, at, pending);
                }
            }
        } catch (Exception ignored) {
            // 数据损坏就不恢复，等 App 下次启动重新排期
        }
    }
}
