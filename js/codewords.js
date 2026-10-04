/**
 * codewords.js — データ領域の各モジュールが「何番目のコードワードの何ビット目か」を求める。
 *
 * データ領域には、まずデータコードワードが並び、その後ろに誤り訂正コードワードが並ぶ。
 * 複数ブロックに分かれる場合も、ブロックごとにまとめて置かれるのではなく
 * 「全ブロックのデータを1バイトずつ交互に」→「全ブロックの誤り訂正を1バイトずつ交互に」
 * という順で並べ替えられる（インターリーブ）。
 * どちらにせよ、データと誤り訂正の境目は「データコードワード数」の位置で一本の線になる。
 * 領域の色分けにはこの境目さえ分かればよいので、ブロック内訳までは扱わない。
 *
 * 末尾には、コードワードの整数倍に足りない数モジュール分の「残余ビット」が付く。
 * ここには常に0が詰められ、意味を持たない。
 */
(function (global) {
  "use strict";

  var isNode = typeof module === "object" && typeof module.exports === "object";
  var TABLES = isNode ? require("./tables.js") : global.QRA.TABLES;
  var layout = isNode ? require("./layout.js") : global.QRA;

  var EC_LEVELS = ["L", "M", "Q", "H"];

  /**
   * @param {number} version 1〜40
   * @param {string} ecLevel "L" | "M" | "Q" | "H"
   * @returns {{total: number, data: number, ec: number, blocks: number, remainderBits: number}}
   */
  function codewordCounts(version, ecLevel) {
    if (EC_LEVELS.indexOf(ecLevel) < 0) {
      throw new Error("不正な誤り訂正レベル: " + ecLevel);
    }
    var total = TABLES.totalCodewords[version];
    var ec = TABLES.ecCodewords[ecLevel][version];
    var moduleCount = layout.dataModuleSequence(version).length;
    return {
      total: total,
      data: total - ec,
      ec: ec,
      blocks: TABLES.ecBlocks[ecLevel][version],
      remainderBits: moduleCount - total * 8,
    };
  }

  /**
   * dataModuleSequence(version) と同じ並び・同じ長さで、各モジュールの役割を返す。
   * @returns {{index: number|null, kind: string, bit: number|null}[]}
   */
  function assignCodewordRoles(version, ecLevel) {
    var counts = codewordCounts(version, ecLevel);
    var roles = new Array(counts.total * 8 + counts.remainderBits);

    for (var i = 0; i < counts.total * 8; i++) {
      var index = Math.floor(i / 8);
      roles[i] = {
        index: index,
        kind: index < counts.data ? "data" : "ec",
        bit: i % 8,
      };
    }
    for (var j = counts.total * 8; j < roles.length; j++) {
      roles[j] = { index: null, kind: "remainder", bit: null };
    }

    return roles;
  }

  var api = { codewordCounts: codewordCounts, assignCodewordRoles: assignCodewordRoles };
  if (isNode) module.exports = api;
  else global.QRA = Object.assign(global.QRA || {}, api);
})(typeof self !== "undefined" ? self : this);
