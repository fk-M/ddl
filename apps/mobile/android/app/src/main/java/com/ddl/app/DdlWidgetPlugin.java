package com.ddl.app;

import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 桌面小组件插件（自研，须在 MainActivity 手动注册）。
 *
 * 只做三件事：写入快照、立刻重绘、请求系统把小组件钉到桌面。
 * 真正的渲染在 DdlWidgetProvider 里，插件不碰 RemoteViews。
 */
@CapacitorPlugin(name = "DdlWidget")
public class DdlWidgetPlugin extends Plugin {

    /** 覆盖写入一份新的展示快照（JSON 字符串） */
    @PluginMethod
    public void update(PluginCall call) {
        String payload = call.getString("payload");
        if (payload == null) {
            call.reject("payload 不能为空");
            return;
        }
        Context context = getContext();
        DdlWidgetProvider.prefs(context).edit()
            .putString(DdlWidgetProvider.KEY_PAYLOAD, payload)
            .apply();
        DdlWidgetProvider.refreshAll(context);

        JSObject ret = new JSObject();
        ret.put("ok", true);
        call.resolve(ret);
    }

    /** 强制重绘（比如用户点了设置里的「立即刷新」） */
    @PluginMethod
    public void refresh(PluginCall call) {
        DdlWidgetProvider.refreshAll(getContext());
        JSObject ret = new JSObject();
        ret.put("ok", true);
        call.resolve(ret);
    }

    /**
     * 请求把小组件添加到桌面。
     * Android 8.0+ 才支持"一键添加"；不支持或用户取消时返回 requested=false，
     * 前端据此提示"请长按桌面从小组件列表里添加"。
     */
    @PluginMethod
    public void requestPin(PluginCall call) {
        Context context = getContext();
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            resolvePin(call, false);
            return;
        }
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        if (manager == null || !manager.isRequestPinAppWidgetSupported()) {
            resolvePin(call, false);
            return;
        }
        // 不传 successCallback：我们不需要"是否真的加上了"的回执，
        // 少一个跨进程 PendingIntent 就少一处失败点。
        ComponentName provider = new ComponentName(context, DdlWidgetProvider.class);
        boolean requested = manager.requestPinAppWidget(provider, null, null);
        resolvePin(call, requested);
    }

    private void resolvePin(PluginCall call, boolean requested) {
        JSObject ret = new JSObject();
        ret.put("requested", requested);
        call.resolve(ret);
    }
}
