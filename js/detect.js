/**
 * detect.js — 画像の中からQRシンボルを見つけ出す。
 *
 * 二値化・ファインダパターン検出・傾き補正・誤り訂正といった重い処理は
 * jsQR（Apache-2.0、js/vendor/ に同梱）に任せる。ここがやるのは2つ。
 *
 *   1. 複数QRへの対応。jsQRは1回に1つしか返さないうえ、1枚に複数写っていると
 *      ファインダパターンを取り違えて「1つも見つからない」ことがある。
 *      そこで、正方形の窓を半分ずつ重ねながらずらして切り出し、窓ごとに走査する。
 *      見つけたシンボルは元画像から白く塗り潰し、二重に数えないようにする。
 *   2. jsQRが返す四隅を、格子サンプリングが使える形（quad）に整える。
 *      jsQRの四隅はシンボルの外周そのものを指しているので、そのまま使える。
 */
(function (global) {
  "use strict";

  var isNode = typeof module === "object" && typeof module.exports === "object";
  var jsQR = isNode ? require("./vendor/jsqr.js") : global.jsQR;

  var DEFAULT_MAX_SYMBOLS = 20;
  var MIN_WINDOW = 80; // これより小さい窓に収まるQRは、そもそも解像度が足りない
  var DEFAULT_MAX_SCANS = 400; // jsQRを呼ぶ回数の上限。走査が発散しないための保険
  // 何も見つからないまま、ここまでの段を試したら諦める。
  // 段が1つ深くなるごとに窓は半分になるので、短辺の約1/8のQRまでは届く。
  var MAX_EMPTY_LEVELS = 4;
  var JSQR_OPTIONS = { inversionAttempts: "attemptBoth" };

  /** RGBA画素配列を、人の明るさ感覚に合わせた輝度（0〜255）へ落とす。 */
  function rgbaToGray(rgba, width, height) {
    var gray = new Uint8ClampedArray(width * height);
    for (var i = 0; i < gray.length; i++) {
      gray[i] = (rgba[i * 4] * 299 + rgba[i * 4 + 1] * 587 + rgba[i * 4 + 2] * 114) / 1000;
    }
    return gray;
  }

  function toQuad(location, offsetX, offsetY) {
    function shift(p) {
      return { x: p.x + offsetX, y: p.y + offsetY };
    }
    return {
      topLeft: shift(location.topLeftCorner),
      topRight: shift(location.topRightCorner),
      bottomRight: shift(location.bottomRightCorner),
      bottomLeft: shift(location.bottomLeftCorner),
    };
  }

  function quadBounds(quad) {
    var xs = [quad.topLeft.x, quad.topRight.x, quad.bottomRight.x, quad.bottomLeft.x];
    var ys = [quad.topLeft.y, quad.topRight.y, quad.bottomRight.y, quad.bottomLeft.y];
    return {
      left: Math.min.apply(null, xs),
      right: Math.max.apply(null, xs),
      top: Math.min.apply(null, ys),
      bottom: Math.max.apply(null, ys),
    };
  }

  /**
   * 検出済みシンボルを白で塗り潰し、次の走査で再び見つからないようにする。
   * 外周より少し広く消す。クワイエットゾーンの輪郭が残ると再検出されることがある。
   */
  function eraseSymbol(rgba, width, height, quad) {
    var b = quadBounds(quad);
    var margin = Math.max(b.right - b.left, b.bottom - b.top) * 0.05 + 2;
    var left = Math.max(0, Math.floor(b.left - margin));
    var right = Math.min(width - 1, Math.ceil(b.right + margin));
    var top = Math.max(0, Math.floor(b.top - margin));
    var bottom = Math.min(height - 1, Math.ceil(b.bottom + margin));

    for (var y = top; y <= bottom; y++) {
      for (var x = left; x <= right; x++) {
        var i = (y * width + x) * 4;
        rgba[i] = 255;
        rgba[i + 1] = 255;
        rgba[i + 2] = 255;
        rgba[i + 3] = 255;
      }
    }
  }

  function cropRgba(rgba, width, win) {
    var out = new Uint8ClampedArray(win.w * win.h * 4);
    for (var y = 0; y < win.h; y++) {
      var from = ((win.y + y) * width + win.x) * 4;
      out.set(rgba.subarray(from, from + win.w * 4), y * win.w * 4);
    }
    return out;
  }

  /**
   * 窓の中に濃淡があるかを粗く調べる。真っ白な余白を切り出して
   * jsQRを呼ぶのは無駄なので、明暗差が乏しい窓は最初から飛ばす。
   */
  function hasContrast(rgba, width, win) {
    var min = 255;
    var max = 0;
    for (var y = 0; y < win.h; y += 4) {
      for (var x = 0; x < win.w; x += 4) {
        var v = rgba[((win.y + y) * width + (win.x + x)) * 4 + 1]; // 緑成分で代用
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    return max - min > 40;
  }

  /** 一辺 side の正方形の窓を、半分ずつ重ねながら画像全体に敷き詰める。 */
  function squareWindows(width, height, side) {
    var step = Math.max(1, Math.floor(side / 2));
    var windows = [];
    for (var y = 0; ; y += step) {
      var top = Math.min(y, Math.max(0, height - side));
      for (var x = 0; ; x += step) {
        var left = Math.min(x, Math.max(0, width - side));
        windows.push({
          x: left,
          y: top,
          w: Math.min(side, width - left),
          h: Math.min(side, height - top),
        });
        if (left + side >= width) break;
      }
      if (top + side >= height) break;
    }
    return windows;
  }

  /**
   * 走査に使う窓を、粗い順に並べて返す。
   * まず画像全体を1枚として試し、次に一辺が短辺と同じ正方形、その半分、と細かくする。
   */
  function scanLevels(width, height) {
    var levels = [[{ x: 0, y: 0, w: width, h: height }]];
    var side = Math.min(width, height);
    while (side >= MIN_WINDOW) {
      levels.push(squareWindows(width, height, side));
      side = Math.floor(side / 2);
    }
    return levels;
  }

  /** ひとつの窓を、見つからなくなるまで繰り返し走査する。 */
  function scanWindow(work, width, height, win, found, budget) {
    var count = 0;
    while (found.length < budget.maxSymbols && budget.scansLeft > 0) {
      var isWholeImage = win.x === 0 && win.y === 0 && win.w === width && win.h === height;
      var pixels = isWholeImage ? work : cropRgba(work, width, win);
      budget.scansLeft--;
      var code = jsQR(pixels, win.w, win.h, JSQR_OPTIONS);
      if (!code) break;

      var quad = toQuad(code.location, win.x, win.y);
      found.push({
        text: code.data,
        bytes: code.binaryData,
        chunks: code.chunks,
        version: code.version,
        quad: quad,
        bounds: quadBounds(quad),
      });
      eraseSymbol(work, width, height, quad);
      count++;
    }
    return count;
  }

  /**
   * 画像に写っているQRをすべて検出する。
   *
   * @param {Uint8ClampedArray} rgba 元画像のRGBA画素（この配列は変更しない）
   * @param {number} width
   * @param {number} height
   * @param {{maxSymbols?: number, maxScans?: number}} [options]
   * @returns {object[]} 検出したシンボル。text / version / quad などを持つ。
   */
  function detectAll(rgba, width, height, options) {
    var budget = {
      maxSymbols: (options && options.maxSymbols) || DEFAULT_MAX_SYMBOLS,
      scansLeft: (options && options.maxScans) || DEFAULT_MAX_SCANS,
    };
    var work = new Uint8ClampedArray(rgba); // 塗り潰しで壊すので複製して使う
    var found = [];
    var levels = scanLevels(width, height);

    for (var l = 0; l < levels.length; l++) {
      if (found.length >= budget.maxSymbols || budget.scansLeft <= 0) break;

      var foundAtLevel = 0;
      var windows = levels[l];

      for (var w = 0; w < windows.length; w++) {
        if (found.length >= budget.maxSymbols || budget.scansLeft <= 0) break;
        if (!hasContrast(work, width, windows[w])) continue;
        foundAtLevel += scanWindow(work, width, height, windows[w], found, budget);
      }

      // 何も出ない段まで来たら、これ以上細かくしても無駄。
      // ただし一度も見つかっていないうちは、何段かは細かい窓を試す価値がある。
      if (foundAtLevel === 0 && (found.length > 0 || l + 1 >= MAX_EMPTY_LEVELS)) break;
    }

    return found;
  }

  var api = {
    detectAll: detectAll,
    rgbaToGray: rgbaToGray,
    squareWindows: squareWindows,
    scanLevels: scanLevels,
  };
  if (isNode) module.exports = api;
  else global.QRA = Object.assign(global.QRA || {}, api);
})(typeof self !== "undefined" ? self : this);
