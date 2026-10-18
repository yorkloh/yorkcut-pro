// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 罗永康 · YorkCut Pro
/**
 * 面板内可拖拽浮动层：浮出 / 停靠，位置写入 localStorage。
 */
(function (root) {
    var STORE_KEY = "yorkcut.floatLayout";
    var drag = null;
    var zBase = 50;

    function loadLayout() {
        try {
            return JSON.parse(localStorage.getItem(STORE_KEY) || "{}") || {};
        } catch (e) {
            return {};
        }
    }

    function saveLayout(map) {
        try {
            localStorage.setItem(STORE_KEY, JSON.stringify(map || {}));
        } catch (e) {}
    }

    function ensureLayer() {
        var layer = document.getElementById("floatLayer");
        if (!layer) {
            layer = document.createElement("div");
            layer.id = "floatLayer";
            layer.className = "float-layer";
            document.body.appendChild(layer);
        }
        return layer;
    }

    function isButtonTarget(target) {
        if (!target) return false;
        if (target.closest) return !!target.closest("button");
        var el = target;
        while (el && el.nodeType === 1) {
            if (el.tagName === "BUTTON") return true;
            el = el.parentElement || el.parentNode;
        }
        return false;
    }

    function bindOne(box) {
        var id = box.getAttribute("data-float-id");
        if (!id) return;
        var head = box.querySelector(".float-head");
        var btnPop = box.querySelector("[data-float-act=pop]");
        var btnDock = box.querySelector("[data-float-act=dock]");
        var home = box.parentNode;
        var placeholder = document.createElement("div");
        placeholder.className = "float-placeholder";
        placeholder.setAttribute("data-for", id);
        placeholder.style.display = "none";
        if (home) home.insertBefore(placeholder, box);

        function applyFloating(pos) {
            var layer = ensureLayer();
            if (placeholder.parentNode) placeholder.classList.add("shown");
            if (box.parentNode !== layer) layer.appendChild(box);
            box.classList.add("is-floating");
            box.style.left = (pos && pos.x != null ? pos.x : 24) + "px";
            box.style.top = (pos && pos.y != null ? pos.y : 72) + "px";
            box.style.zIndex = String(++zBase);
            if (btnPop) btnPop.classList.add("hidden");
            if (btnDock) btnDock.classList.remove("hidden");
        }

        function applyDocked() {
            box.classList.remove("is-floating");
            box.style.left = "";
            box.style.top = "";
            box.style.zIndex = "";
            if (placeholder.parentNode) {
                placeholder.parentNode.insertBefore(box, placeholder);
                placeholder.classList.remove("shown");
            } else if (home) {
                home.appendChild(box);
            }
            if (btnPop) btnPop.classList.remove("hidden");
            if (btnDock) btnDock.classList.add("hidden");
        }

        function persist(floating, x, y) {
            var map = loadLayout();
            if (floating) map[id] = { floating: true, x: x, y: y };
            else delete map[id];
            saveLayout(map);
        }

        function raise() {
            if (box.classList.contains("is-floating")) {
                box.style.zIndex = String(++zBase);
            }
        }

        if (btnPop) {
            btnPop.onclick = function (event) {
                event.preventDefault();
                event.stopPropagation();
                var rect = box.getBoundingClientRect();
                var x = Math.max(8, Math.round(rect.left));
                var y = Math.max(8, Math.round(rect.top));
                applyFloating({ x: x, y: y });
                persist(true, x, y);
            };
        }
        if (btnDock) {
            btnDock.onclick = function (event) {
                event.preventDefault();
                event.stopPropagation();
                applyDocked();
                persist(false);
            };
            btnDock.classList.add("hidden");
        }

        box.addEventListener("mousedown", function () { raise(); }, true);

        if (head) {
            head.title = "浮出后可拖动；双击标题可停靠/浮出";
            head.onmousedown = function (event) {
                if (!box.classList.contains("is-floating")) return;
                if (isButtonTarget(event.target)) return;
                event.preventDefault();
                raise();
                drag = {
                    box: box,
                    id: id,
                    startX: event.clientX,
                    startY: event.clientY,
                    origX: parseInt(box.style.left, 10) || 0,
                    origY: parseInt(box.style.top, 10) || 0
                };
            };
            head.ondblclick = function (event) {
                if (isButtonTarget(event.target)) return;
                event.preventDefault();
                if (box.classList.contains("is-floating")) {
                    applyDocked();
                    persist(false);
                } else if (btnPop) {
                    btnPop.click();
                }
            };
        }

        var saved = loadLayout()[id];
        if (saved && saved.floating) {
            applyFloating({ x: saved.x, y: saved.y });
        }
    }

    function onMove(event) {
        if (!drag) return;
        var x = drag.origX + (event.clientX - drag.startX);
        var y = drag.origY + (event.clientY - drag.startY);
        var maxX = Math.max(40, window.innerWidth - 80);
        var maxY = Math.max(40, window.innerHeight - 40);
        x = Math.max(0, Math.min(maxX, x));
        y = Math.max(0, Math.min(maxY, y));
        drag.box.style.left = x + "px";
        drag.box.style.top = y + "px";
    }

    function onUp() {
        if (!drag) return;
        var map = loadLayout();
        map[drag.id] = {
            floating: true,
            x: parseInt(drag.box.style.left, 10) || 0,
            y: parseInt(drag.box.style.top, 10) || 0
        };
        saveLayout(map);
        drag = null;
    }

    function init() {
        ensureLayer();
        var nodes = document.querySelectorAll(".floatable[data-float-id]");
        for (var i = 0; i < nodes.length; i++) bindOne(nodes[i]);
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
    }

    function reset() {
        saveLayout({});
        var docks = document.querySelectorAll(".floatable.is-floating [data-float-act=dock]");
        for (var i = 0; i < docks.length; i++) {
            try { docks[i].click(); } catch (e) {}
        }
    }

    root.YorkCutFloatUi = { init: init, loadLayout: loadLayout, reset: reset };
})(typeof window !== "undefined" ? window : globalThis);
