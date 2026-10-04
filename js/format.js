/**
 * format.js — フォーマット情報・バージョン情報の復号と、マスク関数。
 *
 * QRコードには、データ本体とは別に「このシンボルの読み方」を書いた領域がある。
 *   フォーマット情報 … 15ビット。誤り訂正レベル(2) + マスクパターン(3) + BCH検査(10)。
 *                      全体が 0x5412 でXORマスクされている（全ゼロ模様を避けるため）。
 *   バージョン情報   … 18ビット。バージョン番号(6) + BCH検査(12)。バージョン7以上のみ。
 *
 * どちらもBCH符号なので、多少ビットが化けても訂正できる。ここでは有効な符号語を
 * 全列挙して、観測値と最も近い（ハミング距離が最小の）ものを選ぶ方式で復号する。
 * 符号語数が32個/34個と少ないので、この総当たりで十分速い。
 */
(function (global) {
  "use strict";

  var FORMAT_MASK = 0x5412;
  var FORMAT_GENERATOR = 0x537; // x^10+x^8+x^5+x^4+x^2+x+1
  var VERSION_GENERATOR = 0x1f25; // x^12+x^11+x^10+x^9+x^8+x^5+x^2+1

  // 誤り訂正レベルの2ビット表現。数値の小ささと訂正能力の高さは一致しない点に注意。
  var EC_LEVELS = ["M", "L", "H", "Q"]; // index = 2ビット値

  function bitLength(n) {
    var len = 0;
    while (n !== 0) {
      len++;
      n >>>= 1;
    }
    return len;
  }

  /** data を degree ビット左シフトし、generator で割った余り（BCH検査ビット）を返す。 */
  function bchRemainder(data, generator, degree) {
    var rem = data << degree;
    var genLen = bitLength(generator);
    while (bitLength(rem) >= genLen) {
      rem ^= generator << (bitLength(rem) - genLen);
    }
    return rem;
  }

  function hammingDistance(a, b) {
    var x = a ^ b;
    var count = 0;
    while (x !== 0) {
      count += x & 1;
      x >>>= 1;
    }
    return count;
  }

  /** 有効な符号語を全列挙し、観測値に最も近いものを返す。同点や誤りすぎなら null。 */
  function closestCodeword(observed, codewords, maxErrors) {
    var bestIndex = -1;
    var bestDistance = Infinity;
    var tie = false;
    for (var i = 0; i < codewords.length; i++) {
      var d = hammingDistance(observed, codewords[i]);
      if (d < bestDistance) {
        bestDistance = d;
        bestIndex = i;
        tie = false;
      } else if (d === bestDistance) {
        tie = true;
      }
    }
    if (bestIndex < 0 || tie || bestDistance > maxErrors) return null;
    return { index: bestIndex, bitErrors: bestDistance };
  }

  // 32通り（誤り訂正レベル4種 × マスク8種）のフォーマット情報を事前計算しておく。
  var FORMAT_CODEWORDS = (function () {
    var list = [];
    for (var data = 0; data < 32; data++) {
      list.push(((data << 10) | bchRemainder(data, FORMAT_GENERATOR, 10)) ^ FORMAT_MASK);
    }
    return list;
  })();

  // バージョン7〜40のバージョン情報。
  var VERSION_CODEWORDS = (function () {
    var list = [];
    for (var v = 7; v <= 40; v++) {
      list.push((v << 12) | bchRemainder(v, VERSION_GENERATOR, 12));
    }
    return list;
  })();

  /**
   * フォーマット情報15ビットを復号する。
   * @param {number} bits 観測した15ビット（マスク適用済みのまま渡す）
   * @returns {{ecLevel: string, maskPattern: number, bitErrors: number}|null}
   */
  function decodeFormatInfo(bits) {
    var hit = closestCodeword(bits & 0x7fff, FORMAT_CODEWORDS, 3);
    if (!hit) return null;
    return {
      ecLevel: EC_LEVELS[(hit.index >> 3) & 0x03],
      maskPattern: hit.index & 0x07,
      bitErrors: hit.bitErrors,
    };
  }

  /**
   * バージョン情報18ビットを復号する。
   * @returns {{version: number, bitErrors: number}|null}
   */
  function decodeVersionInfo(bits) {
    var hit = closestCodeword(bits & 0x3ffff, VERSION_CODEWORDS, 3);
    if (!hit) return null;
    return { version: hit.index + 7, bitErrors: hit.bitErrors };
  }

  /**
   * マスク条件。true のモジュールは白黒が反転している。
   * @param {number} pattern 0〜7
   * @param {number} row 行（上端が0）
   * @param {number} col 列（左端が0）
   */
  function maskBit(pattern, row, col) {
    switch (pattern) {
      case 0:
        return (row + col) % 2 === 0;
      case 1:
        return row % 2 === 0;
      case 2:
        return col % 3 === 0;
      case 3:
        return (row + col) % 3 === 0;
      case 4:
        return (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0;
      case 5:
        return ((row * col) % 2) + ((row * col) % 3) === 0;
      case 6:
        return (((row * col) % 2) + ((row * col) % 3)) % 2 === 0;
      case 7:
        return (((row + col) % 2) + ((row * col) % 3)) % 2 === 0;
      default:
        throw new Error("不正なマスクパターン: " + pattern);
    }
  }

  var api = {
    decodeFormatInfo: decodeFormatInfo,
    decodeVersionInfo: decodeVersionInfo,
    maskBit: maskBit,
  };
  if (typeof module === "object" && typeof module.exports === "object") module.exports = api;
  else global.QRA = Object.assign(global.QRA || {}, api);
})(typeof self !== "undefined" ? self : this);
