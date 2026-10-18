// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 罗永康 · YorkCut Pro
/**
 * 抽签规则，从 YorkCut engine.py 的权重四级法则移植。
 * 不依赖 CEP，方便在 Premiere 面板和 Node 里共用。
 */
(function (root, factory) {
    var api = factory();
    if (typeof module !== "undefined" && module.exports) module.exports = api;
    root.YorkCutPicker = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
    var WEIGHT_ROOT_KEY = "__root__";
    var WEIGHT_TICKET_BASE = 1000;

    function weightEntryValue(entry) {
        if (entry && typeof entry === "object") {
            var n = parseFloat(entry.weight);
            return isFinite(n) ? n : 0;
        }
        var v = parseFloat(entry);
        return isFinite(v) ? v : 0;
    }

    function weightEntryChildren(entry) {
        if (entry && typeof entry === "object" && entry.children && typeof entry.children === "object") {
            return entry.children;
        }
        return { mode: "pool" };
    }

    function nextWeightSegment(relPath, depth) {
        var parts = String(relPath).split("/");
        if (depth >= parts.length - 1) return WEIGHT_ROOT_KEY;
        return parts[depth];
    }

    function assignFileProbabilities(files, strategy, parentAbs, depth) {
        if (!files || !files.length) return {};
        parentAbs = parentAbs == null ? 1 : parentAbs;
        depth = depth || 0;
        if (!strategy || strategy.mode !== "weight" || !strategy.weights) {
            return equalShare(files, parentAbs);
        }
        var weights = strategy.weights;
        var keys = objectKeys(weights);
        if (!keys.length) return equalShare(files, parentAbs);

        var declaredSum = 0;
        for (var i = 0; i < keys.length; i++) declaredSum += weightEntryValue(weights[keys[i]]);
        if (declaredSum > 100 + 1e-6) return equalShare(files, parentAbs);

        var buckets = {};
        for (var f = 0; f < files.length; f++) {
            var seg = nextWeightSegment(files[f], depth);
            if (!buckets[seg]) buckets[seg] = [];
            buckets[seg].push(files[f]);
        }

        var activeKeys = [];
        var active = {};
        var bkeys = objectKeys(buckets);
        for (var b = 0; b < bkeys.length; b++) {
            var key = bkeys[b];
            var flist = buckets[key];
            if (!weights.hasOwnProperty(key) || !flist.length) continue;
            var w = weightEntryValue(weights[key]);
            if (w <= 0) continue;
            active[key] = { w: w, child: weightEntryChildren(weights[key]), files: flist };
            activeKeys.push(key);
        }
        if (!activeKeys.length) return equalShare(files, parentAbs);

        var totalW = 0;
        for (var a = 0; a < activeKeys.length; a++) totalW += active[activeKeys[a]].w;
        if (totalW <= 0) return equalShare(files, parentAbs);

        var result = {};
        for (var k = 0; k < activeKeys.length; k++) {
            var item = active[activeKeys[k]];
            var childAbs = parentAbs * (item.w / totalW);
            var child = item.child;
            if (child && child.mode === "weight" && child.weights && objectKeys(child.weights).length) {
                var sub = assignFileProbabilities(item.files, child, childAbs, depth + 1);
                copyInto(result, sub);
            } else {
                var share = childAbs / item.files.length;
                for (var n = 0; n < item.files.length; n++) result[item.files[n]] = share;
            }
        }
        return result;
    }

    function equalShare(files, parentAbs) {
        var share = parentAbs / files.length;
        var map = {};
        for (var i = 0; i < files.length; i++) map[files[i]] = share;
        return map;
    }

    function copyInto(dst, src) {
        var keys = objectKeys(src);
        for (var i = 0; i < keys.length; i++) dst[keys[i]] = src[keys[i]];
    }

    function objectKeys(obj) {
        var out = [];
        for (var k in obj) if (obj.hasOwnProperty(k)) out.push(k);
        return out;
    }

    function probsToTicketPool(probMap, rng, base) {
        base = base || WEIGHT_TICKET_BASE;
        var files = objectKeys(probMap);
        if (!files.length) return [[], []];
        var tickets = {};
        for (var i = 0; i < files.length; i++) {
            tickets[files[i]] = Math.round(probMap[files[i]] * base);
        }
        for (var j = 0; j < files.length; j++) {
            if (probMap[files[j]] > 0 && tickets[files[j]] <= 0) tickets[files[j]] = 1;
        }
        var total = 0;
        for (var t = 0; t < files.length; t++) total += tickets[files[t]];
        if (total <= 0) {
            var shuffled = shuffle(files, rng);
            return [shuffled, shuffled.slice()];
        }
        if (total !== base) {
            var top = files[0];
            for (var u = 1; u < files.length; u++) {
                var f = files[u];
                if (tickets[f] > tickets[top] || (tickets[f] === tickets[top] && probMap[f] > probMap[top])) top = f;
            }
            tickets[top] = Math.max(0, tickets[top] + (base - total));
        }
        var raw = [];
        for (var r = 0; r < files.length; r++) {
            var count = tickets[files[r]];
            for (var c = 0; c < count; c++) raw.push(files[r]);
        }
        raw = shuffle(raw, rng);
        // 票数相同的文件必须保持"随机顺序"。
        // 旧实现按文件名兜底排序（a<b?-1:1），于是「权重模式下所有子文件夹百分比相同」时，
        // unique 池会退化成固定的字母序；再配合 pickSmartMedia 的 slice，
        // 「权重 + 不重复」就会每次都抽到同一批文件（这是"权重设了却像没生效/永远同几段"的根因）。
        var unique = shuffle(files.filter(function (f) { return tickets[f] > 0; }), rng);
        var tieBreak = {};
        var ui;
        for (ui = 0; ui < unique.length; ui++) tieBreak[unique[ui]] = ui;
        unique.sort(function (a, b) {
            if (tickets[a] !== tickets[b]) return tickets[b] - tickets[a];
            return tieBreak[a] - tieBreak[b];   // 同票：按打乱后的次序，保证随机且不依赖 sort 稳定性
        });
        return [unique, raw];
    }

    function getSmartMediaPool(relFiles, strategy, rng) {
        var files = (relFiles || []).slice();
        if (!files.length) return [[], []];
        if (!strategy || typeof strategy !== "object") strategy = { mode: "pool" };
        if (strategy.mode === "weight" && strategy.weights) {
            var prob = assignFileProbabilities(files, strategy, 1, 0);
            var filtered = {};
            var keys = objectKeys(prob);
            for (var i = 0; i < keys.length; i++) {
                if (prob[keys[i]] > 0) filtered[keys[i]] = prob[keys[i]];
            }
            if (!objectKeys(filtered).length) {
                var shuffled = shuffle(files, rng);
                return [shuffled, shuffled.slice()];
            }
            return probsToTicketPool(filtered, rng);
        }
        var pool = shuffle(files, rng);
        return [pool, pool.slice()];
    }

    function pickSmartMedia(uniquePool, rawPool, count, isUnique, rng) {
        if (!uniquePool || !uniquePool.length || count <= 0) return [];
        if (isUnique) {
            // 权重模式下 uniquePool 是按票数降序排好的，直接 slice 会每次取到同一批文件
            // （「权重 + 不重复」就永远没有随机性）。因此票数分布不均匀时改成加权不放回抽取；
            // 票数全相等说明没有权重信息（大池模式），保持原来的 slice 行为完全不变，
            // 避免改动无权重路径的随机数消耗（那会让既有自检结果发生位移）。
            var tickets = {};
            for (var r = 0; r < (rawPool || []).length; r++) {
                var key = rawPool[r];
                tickets[key] = (tickets[key] || 0) + 1;
            }
            var baseT = null;
            var weighted = false;
            for (var q = 0; q < uniquePool.length; q++) {
                var tq = tickets[uniquePool[q]];
                if (!(tq > 0)) tq = 1;
                if (baseT == null) baseT = tq;
                else if (tq !== baseT) { weighted = true; break; }
            }
            if (!weighted) return uniquePool.slice(0, Math.min(count, uniquePool.length));
            var random = rng || Math.random;
            var pool = uniquePool.slice();
            var out = [];
            while (out.length < count && pool.length) {
                var total = 0;
                var weights = [];
                for (var p = 0; p < pool.length; p++) {
                    var t = tickets[pool[p]];
                    if (!(t > 0)) t = 1;   // 去重后新增、不在票池里的给最小机会
                    weights.push(t);
                    total += t;
                }
                var cut = Math.floor(random() * total);
                var idx = 0;
                var acc = 0;
                for (idx = 0; idx < pool.length; idx++) {
                    acc += weights[idx];
                    if (cut < acc) break;
                }
                if (idx >= pool.length) idx = pool.length - 1;
                out.push(pool[idx]);
                pool.splice(idx, 1);
            }
            return out;
        }
        if (!rawPool || !rawPool.length) {
            var outUniq = [];
            for (var i = 0; i < count; i++) outUniq.push(choice(uniquePool, rng));
            return outUniq;
        }
        var picked = [];
        for (var j = 0; j < count; j++) picked.push(choice(rawPool, rng));
        return picked;
    }

    function shuffle(list, rng) {
        var a = list.slice();
        var random = rng || Math.random;
        for (var i = a.length - 1; i > 0; i--) {
            var j = Math.floor(random() * (i + 1));
            var tmp = a[i];
            a[i] = a[j];
            a[j] = tmp;
        }
        return a;
    }

    function choice(list, rng) {
        var random = rng || Math.random;
        return list[Math.floor(random() * list.length)];
    }

    /**
     * 权重面板的勾选结果 → 引擎策略。
     * 同级和为 0、未勾选、或超过 100%，本层退回大池。
     * 不足 100% 按勾选值等比放大。
     */
    function compileStrategy(node) {
        var children = (node && node.children) || [];
        var sum = 0;
        var has = false;
        for (var i = 0; i < children.length; i++) {
            if (children[i].checked && children[i].hasMedia !== false) {
                has = true;
                sum += Number(children[i].percent) || 0;
            }
        }
        if (!has || sum > 100 || sum === 0) return { mode: "pool" };
        var norm = sum < 100 ? 100 / sum : 1;
        var weights = {};
        for (var j = 0; j < children.length; j++) {
            var child = children[j];
            if (!child.checked || child.hasMedia === false) continue;
            var sub = child.key === WEIGHT_ROOT_KEY ? { mode: "pool" } : compileStrategy(child);
            weights[child.key] = { weight: (Number(child.percent) || 0) * norm, children: sub };
        }
        return { mode: "weight", weights: weights };
    }

    return {
        WEIGHT_ROOT_KEY: WEIGHT_ROOT_KEY,
        assignFileProbabilities: assignFileProbabilities,
        getSmartMediaPool: getSmartMediaPool,
        pickSmartMedia: pickSmartMedia,
        compileStrategy: compileStrategy,
        shuffle: shuffle
    };
});
