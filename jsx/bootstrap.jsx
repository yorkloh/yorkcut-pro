// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 罗永康 · YorkCut Pro
﻿/**
 * YorkCut CEP bootstrap. MUST stay ASCII-only.
 * Full logic lives in host.jsx and is loaded via $.evalFile from the panel.
 */
function yorkcutBootstrapVersion() {
    return "1";
}

function yorkcutPing() {
    var ver = "";
    var hasProj = false;
    try { ver = String(app.version); } catch (e1) {}
    try { hasProj = !!app.project; } catch (e2) {}
    return '{"ok":true,"ping":true,"bootstrap":true,"version":"' + ver.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '","hasProject":' + (hasProj ? "true" : "false") + '}';
}
