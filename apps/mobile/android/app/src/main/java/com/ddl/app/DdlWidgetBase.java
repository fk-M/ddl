package com.ddl.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;

/**
 * 桌面小组件的公共实现。
 *
 * 四种类型（四象限 / 今天 / 收件箱 / 最近 7 天）各是一个 AppWidgetProvider，
 * 用户可以把它们同时放到桌面上，也可以同一种放好几块。渲染逻辑全在这里，
 * 子类只声明 {@link #kind()}。
 *
 * 数据来源：WebView 里的 IndexedDB 原生读不到，所以由 JS 侧
 * （apps/web/src/lib/widget.ts）在数据变化时把四种视图都压成一段 JSON，
 * 通过 DdlWidgetPlugin 写进 SharedPreferences；这里只负责把它们渲染到 RemoteViews。
 *
 * 直接操作：每行任务点了会发一条 ACTION_COMPLETE 广播给自己，
 * 记进本地队列并立刻把这条藏起来（视觉上等于完成了），App 下次回到前台再真正落库。
 */
public abstract class DdlWidgetBase extends AppWidgetProvider {

    /** 桌面上点掉一条任务 */
    public static final String ACTION_COMPLETE = "com.ddl.app.widget.COMPLETE";
    /** 立刻重绘（尺寸变化 / 用户手动刷新） */
    public static final String ACTION_REFRESH = "com.ddl.app.widget.REFRESH";

    /** 四种类型的类名，refreshAll 要挨个刷 */
    private static final Class<?>[] PROVIDERS = {
        DdlWidgetProvider.class,
        DdlWidgetToday.class,
        DdlWidgetInbox.class,
        DdlWidgetNext7.class,
    };

    /** 子类声明自己是哪一种：quadrant / today / inbox / next7 */
    public abstract String kind();

    /** 列表型最多的行数；列表布局里固定有 8 行 */
    private static final int[] ROW_IDS = {
        R.id.ddl_row_1, R.id.ddl_row_2, R.id.ddl_row_3, R.id.ddl_row_4,
        R.id.ddl_row_5, R.id.ddl_row_6, R.id.ddl_row_7, R.id.ddl_row_8,
    };
    private static final int[] ROW_TITLE_IDS = {
        R.id.ddl_row_1_title, R.id.ddl_row_2_title, R.id.ddl_row_3_title, R.id.ddl_row_4_title,
        R.id.ddl_row_5_title, R.id.ddl_row_6_title, R.id.ddl_row_7_title, R.id.ddl_row_8_title,
    };
    private static final int[] ROW_DUE_IDS = {
        R.id.ddl_row_1_due, R.id.ddl_row_2_due, R.id.ddl_row_3_due, R.id.ddl_row_4_due,
        R.id.ddl_row_5_due, R.id.ddl_row_6_due, R.id.ddl_row_7_due, R.id.ddl_row_8_due,
    };

    /** 四象限：(计数 id, 任务行 id 数组, 空态 id)，顺序与前端 QUADRANT_META 一致 */
    private static final int[] COUNT_IDS = {
        R.id.ddl_q1_count, R.id.ddl_q2_count, R.id.ddl_q3_count, R.id.ddl_q4_count,
    };
    private static final int[][] TASK_IDS = {
        { R.id.ddl_q1_t1, R.id.ddl_q1_t2 },
        { R.id.ddl_q2_t1, R.id.ddl_q2_t2 },
        { R.id.ddl_q3_t1, R.id.ddl_q3_t2 },
        { R.id.ddl_q4_t1, R.id.ddl_q4_t2 },
    };
    private static final int[] EMPTY_IDS = {
        R.id.ddl_q1_empty, R.id.ddl_q2_empty, R.id.ddl_q3_empty, R.id.ddl_q4_empty,
    };

    public static final String EXTRA_TASK_ID = "taskId";
    public static final String EXTRA_APP_WIDGET_ID = "appWidgetId";

    /* ============================== 生命周期 ============================== */

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] appWidgetIds) {
        for (int id : appWidgetIds) render(context, manager, id);
    }

    @Override
    public void onAppWidgetOptionsChanged(
        Context context,
        AppWidgetManager manager,
        int appWidgetId,
        Bundle newOptions
    ) {
        // 用户拉伸了尺寸：能放的行数要跟着变
        render(context, manager, appWidgetId);
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        String action = intent.getAction();
        if (ACTION_COMPLETE.equals(action)) {
            DdlWidgetStore.markCompleted(context, intent.getStringExtra(EXTRA_TASK_ID));
            refreshAll(context);
            return;
        }
        if (ACTION_REFRESH.equals(action)) {
            refreshAll(context);
        }
    }

    /** 重绘所有类型的所有实例（数据变了、或者刚点掉了某条） */
    static void refreshAll(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        if (manager == null) return;
        for (Class<?> provider : PROVIDERS) {
            int[] ids = manager.getAppWidgetIds(new ComponentName(context, provider));
            if (ids == null || ids.length == 0) continue;
            for (int id : ids) {
                // 用实例自己的类型去渲染，不能拿调用者的 kind 一把刷
                RemoteViews views = DdlWidgetRenderer.build(context, manager, provider, id);
                if (views != null) manager.updateAppWidget(id, views);
            }
        }
    }

    void render(Context context, AppWidgetManager manager, int appWidgetId) {
        RemoteViews views = DdlWidgetRenderer.build(context, manager, getClass(), appWidgetId);
        if (views != null) manager.updateAppWidget(appWidgetId, views);
    }

    /* ============================== 公共小工具 ============================== */

    /**
     * 广播必须发给「真正被点击的那个 provider」，否则 onReceive 里不知道要刷哪个。
     * 这里按类名建 Intent，不能统一发给 DdlWidgetProvider。
     */
    static PendingIntent broadcastTo(
        Context context,
        Class<?> provider,
        String action,
        String taskId,
        int requestCode
    ) {
        Intent intent = new Intent(context, provider);
        intent.setAction(action);
        if (taskId != null) intent.putExtra(EXTRA_TASK_ID, taskId);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getBroadcast(context, requestCode, intent, flags);
    }

    static PendingIntent openApp(Context context, int requestCode) {
        Intent open = new Intent(context, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getActivity(context, requestCode, open, flags);
    }

    /**
     * 这一共能放几行：拿系统给的可用高度估算，一行约 22dp（标题 + 时间两行）。
     * 拿不到尺寸时按 4 行处理。
     */
    static int listCapacity(AppWidgetManager manager, int appWidgetId) {
        Bundle options = manager.getAppWidgetOptions(appWidgetId);
        int heightDp = options == null ? 0 : options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0);
        if (heightDp >= 300) return 8;
        if (heightDp >= 240) return 6;
        if (heightDp >= 180) return 5;
        if (heightDp == 0) return 4;
        return 4;
    }

    static int rowsPerQuadrant(AppWidgetManager manager, int appWidgetId) {
        Bundle options = manager.getAppWidgetOptions(appWidgetId);
        int heightDp = options == null ? 0 : options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0);
        return heightDp >= 260 ? 3 : 2;
    }

    /** 按 kind 找 provider 类，插件 requestPin 要用 */
    static Class<?> providerFor(String kind) {
        if ("today".equals(kind)) return DdlWidgetToday.class;
        if ("inbox".equals(kind)) return DdlWidgetInbox.class;
        if ("next7".equals(kind)) return DdlWidgetNext7.class;
        return DdlWidgetProvider.class;
    }

    /* ============================== 渲染分发 ============================== */

    /**
     * 单独的渲染器：refreshAll 里要用「每个实例自己的类型」渲染，
     * 不能在实例方法上取巧，所以抽成静态类。
     */
    static final class DdlWidgetRenderer {

        private DdlWidgetRenderer() {
        }

        static RemoteViews build(
            Context context,
            AppWidgetManager manager,
            Class<?> provider,
            int appWidgetId
        ) {
            String kind = kindOf(provider);
            if ("quadrant".equals(kind)) {
                return buildQuadrant(context, manager, appWidgetId);
            }
            return buildList(context, manager, appWidgetId, kind);
        }

        static String kindOf(Class<?> provider) {
            if (provider == DdlWidgetToday.class) return "today";
            if (provider == DdlWidgetInbox.class) return "inbox";
            if (provider == DdlWidgetNext7.class) return "next7";
            return "quadrant";
        }

        static String fallbackTitle(String kind) {
            if ("today".equals(kind)) return "今天";
            if ("inbox".equals(kind)) return "收件箱";
            if ("next7".equals(kind)) return "最近 7 天";
            return "今天";
        }

        /* --------------------------- 四象限 --------------------------- */

        static RemoteViews buildQuadrant(Context context, AppWidgetManager manager, int appWidgetId) {
            RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.ddl_widget);

            String title = "今天";
            String countText = "";
            JSONArray quadrants = new JSONArray();
            String footer = "";

            JSONObject payload = DdlWidgetStore.payloadJson(context);
            if (payload != null) {
                title = payload.optString("title", title);
                int total = payload.optInt("total", 0);
                countText = total > 0 ? total + " 项" : "";
                quadrants = payload.optJSONArray("quadrants");
                footer = payload.optString("footer", "");
            }

            Set<String> hidden = DdlWidgetStore.readIds(context, DdlWidgetStore.KEY_HIDDEN);
            views.setTextViewText(R.id.ddl_widget_title, title);
            views.setTextViewText(R.id.ddl_widget_count, countText);

            int limit = rowsPerQuadrant(manager, appWidgetId);

            for (int q = 0; q < 4; q++) {
                JSONObject cell = null;
                if (quadrants != null && q < quadrants.length()) {
                    cell = quadrants.optJSONObject(q);
                }

                JSONArray items = cell == null ? null : cell.optJSONArray("i");
                List<JSONObject> visible = new ArrayList<>();
                if (items != null) {
                    for (int i = 0; i < items.length(); i++) {
                        JSONObject item = items.optJSONObject(i);
                        if (item == null) continue;
                        if (hidden.contains(item.optString("id", ""))) continue;
                        visible.add(item);
                    }
                }

                int rawCount = cell == null ? 0 : cell.optInt("n", 0);
                // 原数量是真实总数，items 只带了前 3 条；差额只算「本格被点掉的」
                int hiddenInCell = Math.max(0, (items == null ? 0 : items.length()) - visible.size());
                int shownCount = Math.max(0, rawCount - hiddenInCell);
                views.setTextViewText(COUNT_IDS[q], shownCount > 0 ? String.valueOf(shownCount) : "");

                int shown = Math.min(limit, visible.size());
                for (int row = 0; row < TASK_IDS[q].length; row++) {
                    if (row < shown) {
                        JSONObject item = visible.get(row);
                        String text = item.optString("t", "");
                        String due = item.optString("d", "");
                        boolean overdue = item.optBoolean("o", false);
                        views.setViewVisibility(TASK_IDS[q][row], View.VISIBLE);
                        views.setTextViewText(
                            TASK_IDS[q][row],
                            due.isEmpty() ? text : text + "  ·  " + due
                        );
                        views.setTextColor(TASK_IDS[q][row], overdue ? 0xFFF43F5E : 0xFF374151);
                        // 点这一行 = 直接完成
                        views.setOnClickPendingIntent(
                            TASK_IDS[q][row],
                            DdlWidgetBase.broadcastTo(
                                context,
                                DdlWidgetProvider.class,
                                ACTION_COMPLETE,
                                item.optString("id", ""),
                                appWidgetId * 100 + q * 10 + row
                            )
                        );
                    } else {
                        views.setViewVisibility(TASK_IDS[q][row], View.GONE);
                    }
                }

                views.setViewVisibility(EMPTY_IDS[q], shown == 0 ? View.VISIBLE : View.GONE);
            }

            if (footer == null || footer.isEmpty()) {
                views.setViewVisibility(R.id.ddl_widget_footer, View.GONE);
            } else {
                views.setViewVisibility(R.id.ddl_widget_footer, View.VISIBLE);
                views.setTextViewText(R.id.ddl_widget_footer, footer);
            }

            views.setOnClickPendingIntent(R.id.ddl_widget_root, DdlWidgetBase.openApp(context, appWidgetId));
            return views;
        }

        /* --------------------------- 列表型 --------------------------- */

        static RemoteViews buildList(
            Context context,
            AppWidgetManager manager,
            int appWidgetId,
            String kind
        ) {
            RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.ddl_widget_list);

            String title = fallbackTitle(kind);
            String footer = "";
            String empty = "没有待办";
            int rawCount = 0;
            List<JSONObject> items = new ArrayList<>();

            JSONObject payload = DdlWidgetStore.payloadJson(context);
            if (payload != null) {
                footer = payload.optString("footer", "");
                JSONObject kinds = payload.optJSONObject("kinds");
                JSONObject data = kinds == null ? null : kinds.optJSONObject(kind);
                if (data != null) {
                    title = data.optString("title", title);
                    empty = data.optString("empty", empty);
                    rawCount = data.optInt("count", 0);
                    JSONArray array = data.optJSONArray("items");
                    if (array != null) {
                        for (int i = 0; i < array.length(); i++) {
                            JSONObject item = array.optJSONObject(i);
                            if (item != null) items.add(item);
                        }
                    }
                }
            }

            // 在桌面上点掉的，先乐观隐藏
            Set<String> hidden = DdlWidgetStore.readIds(context, DdlWidgetStore.KEY_HIDDEN);
            List<JSONObject> visible = new ArrayList<>();
            for (JSONObject item : items) {
                if (hidden.contains(item.optString("id", ""))) continue;
                visible.add(item);
            }

            int count = Math.max(0, rawCount - Math.max(0, items.size() - visible.size()));
            views.setTextViewText(R.id.ddl_list_title, title);
            views.setTextViewText(R.id.ddl_list_count, count > 0 ? count + " 项" : "");

            int capacity = Math.min(listCapacity(manager, appWidgetId), ROW_IDS.length);
            int shown = Math.min(capacity, visible.size());

            for (int i = 0; i < ROW_IDS.length; i++) {
                if (i < shown) {
                    JSONObject item = visible.get(i);
                    String text = item.optString("t", "");
                    String due = item.optString("d", "");
                    boolean overdue = item.optBoolean("o", false);
                    views.setViewVisibility(ROW_IDS[i], View.VISIBLE);
                    views.setTextViewText(ROW_TITLE_IDS[i], text);
                    if (due.isEmpty()) {
                        views.setViewVisibility(ROW_DUE_IDS[i], View.GONE);
                    } else {
                        views.setViewVisibility(ROW_DUE_IDS[i], View.VISIBLE);
                        views.setTextViewText(ROW_DUE_IDS[i], due);
                        views.setTextColor(ROW_DUE_IDS[i], overdue ? 0xFFF43F5E : 0xFF9CA3AF);
                    }
                    views.setOnClickPendingIntent(
                        ROW_IDS[i],
                        DdlWidgetBase.broadcastTo(
                            context,
                            DdlWidgetBase.providerFor(kind),
                            ACTION_COMPLETE,
                            item.optString("id", ""),
                            appWidgetId * 100 + i
                        )
                    );
                } else {
                    views.setViewVisibility(ROW_IDS[i], View.GONE);
                }
            }

            if (shown == 0) {
                views.setViewVisibility(R.id.ddl_list_empty, View.VISIBLE);
                views.setTextViewText(R.id.ddl_list_empty, empty);
            } else {
                views.setViewVisibility(R.id.ddl_list_empty, View.GONE);
            }

            if (footer == null || footer.isEmpty()) {
                views.setViewVisibility(R.id.ddl_list_footer, View.GONE);
            } else {
                views.setViewVisibility(R.id.ddl_list_footer, View.VISIBLE);
                views.setTextViewText(R.id.ddl_list_footer, footer);
            }

            views.setOnClickPendingIntent(R.id.ddl_list_root, DdlWidgetBase.openApp(context, appWidgetId));
            return views;
        }
    }
}
