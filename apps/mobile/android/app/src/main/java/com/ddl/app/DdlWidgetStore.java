package com.ddl.app;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.LinkedHashSet;
import java.util.Set;

/**
 * 小组件的本地存储：一份展示快照 + 两个 id 队列。
 *
 * 为什么需要队列：RemoteViews 点一下只能发广播，改动不了 WebView 里的 IndexedDB。
 * 所以「在桌面上点完成」是这么走的：
 *   1. Provider 把 taskId 记进 PENDING，并把这条从显示里藏掉（HIDDEN）；
 *   2. App 回到前台时，JS 侧通过 DdlWidget.takeCompleted() 取走 PENDING，
 *      真正写成 completed，然后推一份新快照；
 *   3. 新快照到达时清空 HIDDEN（真实数据已经不含它了）。
 */
final class DdlWidgetStore {

    static final String PREFS = "ddl-widget";
    static final String KEY_PAYLOAD = "payload";
    static final String KEY_PENDING = "pendingDone";
    static final String KEY_HIDDEN = "hiddenDone";

    private DdlWidgetStore() {
    }

    static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static String payload(Context context) {
        return prefs(context).getString(KEY_PAYLOAD, null);
    }

    static void putPayload(Context context, String payload) {
        // 拿到新快照说明真实数据已经是最新的，之前「乐观隐藏」的记录可以丢了
        prefs(context).edit()
            .putString(KEY_PAYLOAD, payload)
            .remove(KEY_HIDDEN)
            .apply();
    }

    static JSONObject payloadJson(Context context) {
        String raw = payload(context);
        if (raw == null) return null;
        try {
            return new JSONObject(raw);
        } catch (Exception error) {
            return null;
        }
    }

    static Set<String> readIds(Context context, String key) {
        Set<String> ids = new LinkedHashSet<>();
        String raw = prefs(context).getString(key, null);
        if (raw == null) return ids;
        try {
            JSONArray array = new JSONArray(raw);
            for (int i = 0; i < array.length(); i++) {
                String id = array.optString(i, "");
                if (!id.isEmpty()) ids.add(id);
            }
        } catch (Exception ignored) {
            // 数据坏了就当没有，别让小组件崩在桌面上
        }
        return ids;
    }

    static void writeIds(Context context, String key, Set<String> ids) {
        JSONArray array = new JSONArray();
        for (String id : ids) array.put(id);
        prefs(context).edit().putString(key, array.toString()).apply();
    }

    /** 记一条「用户点了完成」，同时把它藏起来，等 App 起来真正落库 */
    static void markCompleted(Context context, String taskId) {
        if (taskId == null || taskId.isEmpty()) return;
        Set<String> pending = readIds(context, KEY_PENDING);
        pending.add(taskId);
        writeIds(context, KEY_PENDING, pending);

        Set<String> hidden = readIds(context, KEY_HIDDEN);
        hidden.add(taskId);
        writeIds(context, KEY_HIDDEN, hidden);
    }

    /** 交给 JS 处理：取走即清，避免重复写成 completed */
    static JSONArray takeCompleted(Context context) {
        Set<String> pending = readIds(context, KEY_PENDING);
        writeIds(context, KEY_PENDING, new LinkedHashSet<>());
        JSONArray array = new JSONArray();
        for (String id : pending) array.put(id);
        return array;
    }
}
