// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 罗永康 · YorkCut Pro
/**
 * Minimal CSInterface compatible with Premiere CEP evalScript / system paths.
 */
function CSInterface() {}

CSInterface.prototype.evalScript = function (script, callback) {
    var cb = callback || function () {};
    if (!window.__adobe_cep__ || !window.__adobe_cep__.evalScript) {
        cb("EvalScript error.");
        return;
    }
    try {
        window.__adobe_cep__.evalScript(script, cb);
    } catch (err) {
        cb("EvalScript error.");
    }
};

CSInterface.prototype.getSystemPath = function (pathType) {
    if (!window.__adobe_cep__ || !window.__adobe_cep__.getSystemPath) return "";
    try {
        var path = window.__adobe_cep__.getSystemPath(pathType);
        if (path == null) return "";
        path = String(path);
        try { path = decodeURI(path); } catch (e1) {}
        // file:///C:/... -> C:/...
        if (path.indexOf("file://") === 0) {
            path = path.replace(/^file:\/\//i, "");
            if (/^\/[A-Za-z]:/.test(path)) path = path.slice(1);
        }
        return path;
    } catch (err) {
        return "";
    }
};

CSInterface.prototype.getHostEnvironment = function () {
    if (!window.__adobe_cep__ || !window.__adobe_cep__.getHostEnvironment) return null;
    try {
        return JSON.parse(window.__adobe_cep__.getHostEnvironment());
    } catch (err) {
        return null;
    }
};

var SystemPath = {
    USER_DATA: "userData",
    COMMON_FILES: "commonFiles",
    MY_DOCUMENTS: "myDocuments",
    APPLICATION: "application",
    EXTENSION: "extension",
    HOST_APPLICATION: "hostApplication"
};
