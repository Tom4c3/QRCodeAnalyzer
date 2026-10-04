/**
 * grid.js — 画像の中の四角形から、QRのモジュール格子（白黒のマス目）を取り出す。
 *
 * 写真でもスクリーンショットでも、QRは画面上では四角形に写る。傾きや遠近で
 * 平行四辺形や台形に歪むが、モジュールの並び自体は等間隔なので、
 * 「単位正方形 → 画面上の四角形」の射影変換さえ求まれば、各モジュールの中心が
 * 画像のどこに来るかを逆算できる。あとはそこの明るさを読むだけでよい。
 *
 * 二値化のしきい値は、サンプリングした値そのものから大津の方法で決める。
 * 画像全体ではなくシンボル内部の値だけを使うので、背景の明るさに影響されない。
 */
(function (global) {
  "use strict";

  /**
   * 単位正方形 (0,0)-(1,1) を、指定した四角形へ写す関数を作る。
   * @param {{topLeft: {x,y}, topRight: {x,y}, bottomRight: {x,y}, bottomLeft: {x,y}}} quad
   * @returns {(u: number, v: number) => {x: number, y: number}}
   */
  function perspectiveTransform(quad) {
    var x0 = quad.topLeft.x, y0 = quad.topLeft.y;
    var x1 = quad.topRight.x, y1 = quad.topRight.y;
    var x2 = quad.bottomRight.x, y2 = quad.bottomRight.y;
    var x3 = quad.bottomLeft.x, y3 = quad.bottomLeft.y;

    var sx = x0 - x1 + x2 - x3;
    var sy = y0 - y1 + y2 - y3;

    var a11, a21, a31, a12, a22, a32, a13, a23;

    if (sx === 0 && sy === 0) {
      // 平行四辺形。遠近成分が無いのでアフィン変換で足りる。
      a13 = 0;
      a23 = 0;
      a11 = x1 - x0;
      a21 = x2 - x1;
      a31 = x0;
      a12 = y1 - y0;
      a22 = y2 - y1;
      a32 = y0;
    } else {
      var dx1 = x1 - x2, dx2 = x3 - x2;
      var dy1 = y1 - y2, dy2 = y3 - y2;
      var den = dx1 * dy2 - dx2 * dy1;
      a13 = (sx * dy2 - dx2 * sy) / den;
      a23 = (dx1 * sy - sx * dy1) / den;
      a11 = x1 - x0 + a13 * x1;
      a21 = x3 - x0 + a23 * x3;
      a31 = x0;
      a12 = y1 - y0 + a13 * y1;
      a22 = y3 - y0 + a23 * y3;
      a32 = y0;
    }

    return function (u, v) {
      var w = a13 * u + a23 * v + 1;
      return {
        x: (a11 * u + a21 * v + a31) / w,
        y: (a12 * u + a22 * v + a32) / w,
      };
    };
  }

  /**
   * 連続座標を画素の添字に落とし、画像範囲を出ないよう丸める。
   * 画素 n が占める範囲は [n, n+1) なので、切り捨てないと隣の画素を指してしまう
   * （1モジュール1画素のとき、中心 col+0.5 が四捨五入で col+1 になる）。
   */
  function clamp(value, max) {
    var i = Math.floor(value);
    if (i < 0) return 0;
    if (i > max) return max;
    return i;
  }

  /**
   * (x, y) を中心に半径 radius 画素の平均輝度を返す。
   * 1モジュールが十分大きいときはならしてノイズを消し、
   * 1モジュール＝数画素しかないときは半径0（中心の1画素だけ）にして、
   * 隣のモジュールを巻き込まないようにする。
   */
  function sampleAround(gray, width, height, x, y, radius) {
    if (radius <= 0) return gray[clamp(y, height - 1) * width + clamp(x, width - 1)];
    var sum = 0;
    var count = 0;
    for (var dy = -radius; dy <= radius; dy++) {
      for (var dx = -radius; dx <= radius; dx++) {
        sum += gray[clamp(y + dy, height - 1) * width + clamp(x + dx, width - 1)];
        count++;
      }
    }
    return sum / count;
  }

  function distance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  /** 四角形の各辺の長さから、1モジュールがおよそ何画素かを見積もる。 */
  function estimateModulePixels(quad, size) {
    var edges =
      distance(quad.topLeft, quad.topRight) +
      distance(quad.topRight, quad.bottomRight) +
      distance(quad.bottomRight, quad.bottomLeft) +
      distance(quad.bottomLeft, quad.topLeft);
    return edges / 4 / size;
  }

  /**
   * 大津の方法。輝度ヒストグラムを2群に分けたとき、群間分散が最大になる境目を返す。
   * 明暗の絶対値ではなく分布の形で決まるので、コントラストが低くても機能する。
   */
  function otsuThreshold(values) {
    var histogram = new Array(256).fill(0);
    var i;
    for (i = 0; i < values.length; i++) histogram[Math.round(values[i]) & 0xff]++;

    var total = values.length;
    var sum = 0;
    for (i = 0; i < 256; i++) sum += i * histogram[i];

    var sumBackground = 0;
    var countBackground = 0;
    var best = 0;
    var bestVariance = -1;

    for (i = 0; i < 256; i++) {
      countBackground += histogram[i];
      if (countBackground === 0) continue;
      var countForeground = total - countBackground;
      if (countForeground === 0) break;

      sumBackground += i * histogram[i];
      var meanBackground = sumBackground / countBackground;
      var meanForeground = (sum - sumBackground) / countForeground;
      var variance =
        countBackground * countForeground * (meanBackground - meanForeground) * (meanBackground - meanForeground);

      if (variance > bestVariance) {
        bestVariance = variance;
        best = i;
      }
    }

    return best;
  }

  /**
   * 四角形の内側を size×size のモジュール格子として読み取る。
   *
   * @param {Uint8ClampedArray|Uint8Array} gray 幅×高さのグレースケール輝度
   * @param {number} width
   * @param {number} height
   * @param {object} quad シンボル外周の四隅（クワイエットゾーンは含まない）
   * @param {number} size 1辺のモジュール数
   * @returns {{size: number, modules: Uint8Array, luminance: Float64Array, threshold: number, get: Function}}
   */
  function sampleModuleGrid(gray, width, height, quad, size) {
    var map = perspectiveTransform(quad);
    var luminance = new Float64Array(size * size);
    // 1モジュールが5画素以上あるときだけ、周辺をならしてノイズを落とす。
    var radius = estimateModulePixels(quad, size) >= 5 ? 1 : 0;

    for (var row = 0; row < size; row++) {
      for (var col = 0; col < size; col++) {
        // モジュールの中心を狙う。端を踏むと隣のモジュールを拾ってしまう。
        var p = map((col + 0.5) / size, (row + 0.5) / size);
        luminance[row * size + col] = sampleAround(
          gray,
          width,
          height,
          clamp(p.x, width - 1),
          clamp(p.y, height - 1),
          radius
        );
      }
    }

    var threshold = otsuThreshold(luminance);
    var modules = new Uint8Array(size * size);
    for (var i = 0; i < modules.length; i++) {
      modules[i] = luminance[i] <= threshold ? 1 : 0; // 暗い＝黒モジュール＝1
    }

    return {
      size: size,
      modules: modules,
      luminance: luminance,
      threshold: threshold,
      get: function (r, c) {
        return modules[r * size + c];
      },
    };
  }

  var api = { perspectiveTransform: perspectiveTransform, sampleModuleGrid: sampleModuleGrid, otsuThreshold: otsuThreshold };
  if (typeof module === "object" && typeof module.exports === "object") module.exports = api;
  else global.QRA = Object.assign(global.QRA || {}, api);
})(typeof self !== "undefined" ? self : this);
