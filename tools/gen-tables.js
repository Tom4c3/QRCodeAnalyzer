/**
 * tools/gen-tables.js — js/tables.js を生成する。
 *
 * QR規格の「バージョンごとの総コードワード数」「誤り訂正コードワード数」
 * 「位置合わせパターンの中心座標」は手打ちすると必ず間違えるので、
 * 開発依存の qrcode パッケージが持つ既知のテーブルから機械的に書き出す。
 *
 * 実行: node tools/gen-tables.js
 */
const fs = require("node:fs");
const path = require("node:path");
const utils = require("qrcode/lib/core/utils");
const ecc = require("qrcode/lib/core/error-correction-code");
const ECLevel = require("qrcode/lib/core/error-correction-level");
const alignment = require("qrcode/lib/core/alignment-pattern");

const LEVELS = { L: ECLevel.L, M: ECLevel.M, Q: ECLevel.Q, H: ECLevel.H };

const totalCodewords = [null];
const ecCodewords = { L: [null], M: [null], Q: [null], H: [null] };
const ecBlocks = { L: [null], M: [null], Q: [null], H: [null] };
const alignmentCoords = [null];

for (let v = 1; v <= 40; v++) {
  totalCodewords.push(utils.getSymbolTotalCodewords(v));
  for (const name of Object.keys(LEVELS)) {
    ecCodewords[name].push(ecc.getTotalCodewordsCount(v, LEVELS[name]));
    ecBlocks[name].push(ecc.getBlocksCount(v, LEVELS[name]));
  }
  // getPositions は [行, 列] の全組み合わせを返すが、ここでは中心座標の一次元列を持つ。
  alignmentCoords.push(alignment.getRowColCoords(v));
}

function rows(arr, perLine) {
  const out = [];
  for (let i = 1; i < arr.length; i += perLine) {
    out.push("    " + arr.slice(i, i + perLine).join(", ") + ",");
  }
  return out.join("\n");
}

function levelTable(table, perLine) {
  return Object.keys(table)
    .map((k) => `    ${k}: [\n      null,\n` + rows(table[k], perLine).replace(/^ {4}/gm, "      ") + "\n    ],")
    .join("\n");
}

const body = `/**
 * tables.js — QR規格に定められた、バージョンごとの固定値テーブル。
 *
 * !!! このファイルは tools/gen-tables.js が生成する。直接編集しないこと !!!
 * 再生成: node tools/gen-tables.js
 *
 * 添字はバージョン番号（1〜40）。添字0は使わないので null を置いてある。
 */
(function (global) {
  "use strict";

  var TABLES = {
    /** シンボル全体のコードワード（8ビット単位）の総数。データ＋誤り訂正。 */
    totalCodewords: [
      null,
${rows(totalCodewords, 10)}
    ],

    /** 誤り訂正コードワード数。残りがデータコードワード数になる。 */
    ecCodewords: {
${levelTable(ecCodewords, 10)}
    },

    /** 誤り訂正ブロック数。データはこのブロック数に分割してインターリーブされる。 */
    ecBlocks: {
${levelTable(ecBlocks, 10)}
    },

    /** 位置合わせパターンの中心座標（行・列に共通）。バージョン1は無し。 */
    alignmentCoords: [
      null,
${alignmentCoords
  .slice(1)
  .map((c) => "      [" + c.join(", ") + "],")
  .join("\n")}
    ],
  };

  if (typeof module === "object" && typeof module.exports === "object") module.exports = TABLES;
  else global.QRA = Object.assign(global.QRA || {}, { TABLES: TABLES });
})(typeof self !== "undefined" ? self : this);
`;

fs.writeFileSync(path.join(__dirname, "..", "js", "tables.js"), body, "utf8");
console.log("js/tables.js を生成しました");
