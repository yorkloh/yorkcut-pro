/**
 * YorkCut Pro · 发行配置
 *
 * 历史说明：早期版本的卡密 / 云接口账号门禁（js/license.js、js/cloud-api.js）与
 * 加密日志（js/securelog.js）已全部移除 —— 本项目不联网、不校验账号、日志完全明文。
 */
(function (root) {
    root.YorkCutConfig = {
        appVersion: "1.0.0",
        /** 作者签名（字母藏头：把每个词的首字母连起来读） */
        signature: "YorkCutmadebyLuoYongkang",
        author: "罗永康",
        /** 面板可选的 Premiere 转场名（需本机已安装；内置名开箱即用） */
        transitionLibrary: [
            "Cross Dissolve",
            "Dip to Black",
            "Dip to White",
            "Push",
            "Slide",
            "Wipe",
            "Iris Round",
            "MorphCut"
        ]
    };
})(typeof window !== "undefined" ? window : globalThis);
