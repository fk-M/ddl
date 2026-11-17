package com.ddl.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * 桌面小组件（AppWidget）。
 *
 * 数据来源：WebView 里的 IndexedDB 原生读不到，所以由 JS 侧（lib/widget.ts）
 * 在数据变化时把「今天要显示的几条」压成一段 JSON，通过 DdlWidgetPlugin 写进
 * SharedPreferences；这里只负责把这些字渲染到 RemoteViews。
 *
 * 因此小组件永远显示「最后一次 App 运行时」的快照，不会自己联网刷新——
 * 这是 Android 小组件的正常形态，桌面端悬浮窗才是实时的。
 */
public class DdlWidgetProvider extends AppWidgetProvider {

    public static final String PREFS = "ddl-widget";
    public static final String KEY_PAYLOAD = "payload";

    private static final int[] ROW_IDS = {
        R.id.ddl_widget_row1,
        R.id.ddl_widget_row2,
        R.id.ddl_widget_row3,
        R.id.ddl_widget_row4,
    };
    private static final int[] ROW_TITLE_IDS = {
        R.id.ddl_widget_row1_title,
        R.id.ddl_widget_row2_title,
        R.id.ddl_widget_row3_title,
        R.id.ddl_widget_row4_title,
    };
    private static final int[] ROW_DUE_IDS = {
        R.id.ddl_widget_row1_due,
        R.id.ddl_widget_row2_due,
        R.id.ddl_widget_row3_due,
        R.id.ddl_widget_row4_due,
    };

    static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** JS 侧写完数据后调用，重绘所有已放置的小组件实例 */
    static void refreshAll(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        if (manager == null) return;
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, DdlWidgetProvider.class));
        for (int id : ids) {
            render(context, manager, id);
        }
    }

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] appWidgetIds) {
        for (int id : appWidgetIds) {
            render(context, manager, id);
        }
    }

    @Override
    public void onAppWidgetOptionsChanged(
        Context context,
        AppWidgetManager manager,
        int appWidgetId,
        Bundle newOptions
    ) {
        // 用户拉伸了尺寸：行数要跟着变
        render(context, manager, appWidgetId);
    }

    private static String readPayload(Context context) {
        return prefs(context).getString(KEY_PAYLOAD, null);
    }

    /**
     * 能塞几行。这是估算：桌面网格一格约 70dp，
     * 高度 140dp 以下只放两行，否则标题和行距会挤在一起。
     */
    private static int maxRows(AppWidgetManager manager, int appWidgetId) {
        Bundle options = manager.getAppWidgetOptions(appWidgetId);
        int heightDp = options == null ? 0 : options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0);
        if (heightDp >= 230) return 4;
        if (heightDp >= 170) return 3;
        if (heightDp == 0) return 3;
        return 2;
    }

    static void render(Context context, AppWidgetManager manager, int appWidgetId) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.ddl_widget);

        String title = "今天";
        int count = 0;
        JSONArray items = new JSONArray();
        String footer = "";
        String emptyText = "还没有待办";

        try {
            String raw = readPayload(context);
            if (raw != null) {
                JSONObject payload = new JSONObject(raw);
                title = payload.optString("title", title);
                count = payload.optInt("count", 0);
                items = payload.optJSONArray("items");
                footer = payload.optString("footer", "");
                emptyText = payload.optString("emptyText", "今天清空了");
            }
        } catch (Exception ignored) {
            // 数据损坏就按空状态渲染，不要崩在桌面上
        }

        views.setTextViewText(R.id.ddl_widget_title, title);
        views.setTextViewText(R.id.ddl_widget_count, count > 0 ? count + " 项" : "");

        int limit = Math.min(maxRows(manager, appWidgetId), items == null ? 0 : items.length());
        for (int index = 0; index < ROW_IDS.length; index++) {
            if (index < limit) {
                JSONObject item = items.optJSONObject(index);
                String text = item == null ? "" : item.optString("t", "");
                String due = item == null ? "" : item.optString("d", "");
                boolean overdue = item != null && item.optBoolean("o", false);
                views.setViewVisibility(ROW_IDS[index], View.VISIBLE);
                views.setTextViewText(ROW_TITLE_IDS[index], text);
                views.setTextViewText(ROW_DUE_IDS[index], due);
                views.setTextColor(ROW_DUE_IDS[index], overdue ? 0xFFF43F5E : 0xFF9CA3AF);
            } else {
                views.setViewVisibility(ROW_IDS[index], View.GONE);
            }
        }

        boolean isEmpty = limit == 0;
        views.setViewVisibility(R.id.ddl_widget_empty, isEmpty ? View.VISIBLE : View.GONE);
        views.setTextViewText(R.id.ddl_widget_empty, emptyText);

        if (footer == null || footer.isEmpty()) {
            views.setViewVisibility(R.id.ddl_widget_footer, View.GONE);
        } else {
            views.setViewVisibility(R.id.ddl_widget_footer, View.VISIBLE);
            views.setTextViewText(R.id.ddl_widget_footer, footer);
        }

        // 点整块卡片回到 App
        Intent open = new Intent(context, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        PendingIntent pending = PendingIntent.getActivity(context, 0, open, flags);
        views.setOnClickPendingIntent(R.id.ddl_widget_root, pending);

        manager.updateAppWidget(appWidgetId, views);
    }
}
