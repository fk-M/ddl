package com.ddl.app;

import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.os.Build;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;

/**
 * 桌面小组件插件（自研，须在 MainActivity 手动注册）。
 *
 * 做四件事：写入快照、立刻重绘、按类型请求系统钉到桌面、取走「桌面上点掉的任务」。
 * 真正的渲染在 DdlWidgetBase 里，插件不碰 RemoteViews。
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
        // putPayload 会顺手清掉 hiddenDone：新快照已经是最新数据，之前乐观隐藏的不用再记着
        DdlWidgetStore.putPayload(context, payload);
        DdlWidgetBase.refreshAll(context);

        JSObject ret = new JSObject();
        ret.put("ok", true);
        call.resolve(ret);
    }

    /** 强制重绘（比如用户点了设置里的「立即刷新」） */
    @PluginMethod
    public void refresh(PluginCall call) {
        DdlWidgetBase.refreshAll(getContext());
        JSObject ret = new JSObject();
        ret.put("ok", true);
        call.resolve(ret);
    }

    /**
     * 请求把某一种小组件添加到桌面。
     * Android 8.0+ 才支持「一键添加」；不支持或用户取消时返回 requested=false，
     * 前端据此提示「请长按桌面从小组件列表里添加」。
     */
    @PluginMethod
    public void requestPin(PluginCall call) {
        Context context = getContext();
        String kind = call.getString("kind", "quadrant");

        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            resolvePin(call, false);
            return;
        }
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        if (manager == null || !manager.isRequestPinAppWidgetSupported()) {
            resolvePin(call, false);
            return;
        }
        // 不传 successCallback：不需要「是否真的加上了」的回执，少一个跨进程 PendingIntent 就少一处失败点
        ComponentName provider = new ComponentName(context, DdlWidgetBase.providerFor(kind));
        boolean requested = manager.requestPinAppWidget(provider, null, null);
        resolvePin(call, requested);
    }

    /**
     * 取走「用户在桌面上点掉的任务」。
     * 原生改不了 WebView 的 IndexedDB，只能排队；JS 拿到后写成 completed 再推新快照。
     */
    @PluginMethod
    public void takeCompleted(PluginCall call) {
        JSONArray ids = DdlWidgetStore.takeCompleted(getContext());
        JSArray array = new JSArray();
        for (int i = 0; i < ids.length(); i++) {
            array.put(ids.optString(i, ""));
        }
        JSObject ret = new JSObject();
        ret.put("ids", array);
        call.resolve(ret);
    }

    private void resolvePin(PluginCall call, boolean requested) {
        JSObject ret = new JSObject();
        ret.put("requested", requested);
        call.resolve(ret);
    }
}
