/**
 * layout.js — シンボル上の各モジュールが「何の領域か」を求める。
 *
 * QRコードの見た目のうち、位置が規格で固定されている部分を機能パターンと呼ぶ。
 * 機能パターン以外のすべてがデータ（＋誤り訂正）の格納場所になる。
 *
 *   finder     … 三隅の大きな四角。シンボルの位置と向きを見つけるための目印。
 *   separator  … ファインダの外側1モジュールの白枠。データと混ざらないようにする。
 *   timing     … 6行目/6列目を走る白黒の縞。モジュールの刻み幅を数えるための物差し。
 *   alignment  … バージョン2以上に現れる小さな四角。歪みを補正する中間の目印。
 *   format     … 誤り訂正レベルとマスクパターン。2箇所に冗長に書かれている。
 *   version    … バージョン番号。バージョン7以上のみ、2箇所に書かれている。
 *   dark       … 常に黒と決まっている1モジュール。
 *   data       … 上記以外。データと誤り訂正コードワードが詰まっている。
 */
(function (global) {
  "use strict";

  var isNode = typeof module === "object" && typeof module.exports === "object";
  var TABLES = isNode ? require("./tables.js") : global.QRA.TABLES;

  function symbolSize(version) {
    return version * 4 + 17;
  }

  function fill(roles, top, left, height, width, role) {
    for (var r = top; r < top + height; r++) {
      for (var c = left; c < left + width; c++) {
        if (r >= 0 && r < roles.length && c >= 0 && c < roles.length) roles[r][c] = role;
      }
    }
  }

  /**
   * フォーマット情報15ビットが置かれる座標を、上位ビットから順に返す。
   * 同じ内容が2箇所に書かれているので、[copy1, copy2] の2本の配列を返す。
   * 6行目・6列目はタイミングパターンが通るため、そこだけ飛ばして配置されている。
   */
  function formatInfoPositions(version) {
    var size = symbolSize(version);
    var copy1 = [];
    var copy2 = [];
    var i;

    for (i = 0; i < 6; i++) copy1.push({ row: 8, col: i });
    copy1.push({ row: 8, col: 7 });
    copy1.push({ row: 8, col: 8 });
    copy1.push({ row: 7, col: 8 });
    for (i = 5; i >= 0; i--) copy1.push({ row: i, col: 8 });

    // 2組目は「左下の縦並びを下から上へ」→「右上の横並びを左から右へ」の順。
    // 1組目とは並べる向きが違うので、素直に左上から読むと逆順になってしまう。
    for (i = size - 1; i >= size - 7; i--) copy2.push({ row: i, col: 8 });
    for (i = size - 8; i < size; i++) copy2.push({ row: 8, col: i });

    return [copy1, copy2];
  }

  /**
   * バージョン情報18ビットが置かれる座標を、上位ビットから順に返す。
   * 左下と右上に6×3の塊がひとつずつ。バージョン7未満では空配列。
   */
  function versionInfoPositions(version) {
    if (version < 7) return [[], []];
    var size = symbolSize(version);
    var bottomLeft = [];
    var topRight = [];
    // 上位ビットから、6×3の塊を列方向→行方向の順に埋めていく。
    for (var i = 17; i >= 0; i--) {
      var a = Math.floor(i / 3);
      var b = i % 3;
      bottomLeft.push({ row: size - 11 + b, col: a });
      topRight.push({ row: a, col: size - 11 + b });
    }
    return [bottomLeft, topRight];
  }

  /** 位置合わせパターンの中心座標を [行, 列] の組で返す。ファインダと重なる3箇所は除く。 */
  function alignmentCenters(version) {
    var coords = TABLES.alignmentCoords[version];
    if (!coords || coords.length === 0) return [];
    var last = coords.length - 1;
    var centers = [];
    for (var i = 0; i <= last; i++) {
      for (var j = 0; j <= last; j++) {
        var isFinderCorner =
          (i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0);
        if (!isFinderCorner) centers.push([coords[i], coords[j]]);
      }
    }
    return centers;
  }

  /**
   * @param {number} version 1〜40
   * @returns {string[][]} roles[row][col] に領域名が入った二次元配列
   */
  function buildModuleRoles(version) {
    var size = symbolSize(version);
    var roles = [];
    var r, c;
    for (r = 0; r < size; r++) {
      roles.push(new Array(size).fill("data"));
    }

    // ファインダと分離パターン。分離パターンはデータ領域側の1モジュール分の白枠。
    [[0, 0], [0, size - 7], [size - 7, 0]].forEach(function (pos) {
      var top = pos[0];
      var left = pos[1];
      fill(roles, top - 1, left - 1, 9, 9, "separator");
      fill(roles, top, left, 7, 7, "finder");
    });

    // タイミングパターン。分離パターンの内側から反対側の分離パターンまで。
    for (var k = 8; k < size - 8; k++) {
      roles[6][k] = "timing";
      roles[k][6] = "timing";
    }

    // 位置合わせパターン（タイミングパターンと重なる場合はこちらが上書きする）。
    alignmentCenters(version).forEach(function (center) {
      fill(roles, center[0] - 2, center[1] - 2, 5, 5, "alignment");
    });

    formatInfoPositions(version).forEach(function (positions) {
      positions.forEach(function (p) {
        roles[p.row][p.col] = "format";
      });
    });

    versionInfoPositions(version).forEach(function (positions) {
      positions.forEach(function (p) {
        roles[p.row][p.col] = "version";
      });
    });

    // 常に黒と決まっているモジュール。フォーマット情報の隣にある。
    roles[4 * version + 9][8] = "dark";

    return roles;
  }

  /**
   * データ領域を読み出す順序を返す。
   *
   * 右下から始めて、2列ずつの縦帯を右から左へたどる。帯の中では右→左、
   * 帯ごとに上向き・下向きを交互に切り替える。縦のタイミングパターンが通る
   * 6列目は帯の数に数えず、まるごと飛ばす。
   *
   * @returns {{row: number, col: number}[]}
   */
  function dataModuleSequence(version) {
    var size = symbolSize(version);
    var roles = buildModuleRoles(version);
    var sequence = [];
    var upward = true;

    for (var col = size - 1; col > 0; col -= 2) {
      if (col === 6) col--; // 縦タイミングパターンの列はデータに使われない
      for (var i = 0; i < size; i++) {
        var row = upward ? size - 1 - i : i;
        for (var offset = 0; offset < 2; offset++) {
          var c = col - offset;
          if (roles[row][c] === "data") sequence.push({ row: row, col: c });
        }
      }
      upward = !upward;
    }

    return sequence;
  }

  var api = {
    symbolSize: symbolSize,
    buildModuleRoles: buildModuleRoles,
    dataModuleSequence: dataModuleSequence,
    formatInfoPositions: formatInfoPositions,
    versionInfoPositions: versionInfoPositions,
    alignmentCenters: alignmentCenters,
  };
  if (isNode) module.exports = api;
  else global.QRA = Object.assign(global.QRA || {}, api);
})(typeof self !== "undefined" ? self : this);
