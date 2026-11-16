package com.ddl.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 自更新插件属于本项目自有代码，Capacitor 只会自动发现 npm 安装的插件，须手动注册
        registerPlugin(DdlUpdaterPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
