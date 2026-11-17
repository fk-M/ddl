package com.ddl.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 自研插件（Capacitor 只会自动发现 npm 安装的插件，须手动注册）
        registerPlugin(DdlUpdaterPlugin.class);
        registerPlugin(DdlNotifyPlugin.class);
        registerPlugin(DdlWidgetPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
