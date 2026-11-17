package com.ddl.app;

/**
 * 「四象限」小组件：重要 × 紧急铺成 2×2。
 * 渲染逻辑都在 {@link DdlWidgetBase}，这里只声明类型。
 */
public class DdlWidgetProvider extends DdlWidgetBase {
    @Override
    public String kind() {
        return "quadrant";
    }
}
