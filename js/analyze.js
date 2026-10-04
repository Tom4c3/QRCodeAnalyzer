/**
 * analyze.js — モジュール格子から、シンボルのパラメータを読み解く。
 *
 * ここが「決まった位置を読むだけ」の部分。格子さえ手に入れば、
 * どこに何が書いてあるかは規格で完全に決まっているので、画像処理は要らない。
 *
 *   1. シンボルの一辺のモジュール数からバージョンが決まる。
 *   2. ファインダの脇のフォーマット情報15ビットを読み、BCH復号して
 *      誤り訂正レベルとマスクパターンを得る。2箇所に同じものが書かれているので、
 *      片方が読めなければもう片方を使う。
 *   3. バージョン7以上なら、バージョン情報18ビットも読んで寸法と突き合わせる。
 *   4. マスクを解除し、データ領域を規定の順にたどってコードワードへ戻す。
 */
(function (global) {
  "use strict";

  var isNode = typeof module === "object" && typeof module.exports === "object";
  var format = isNode ? require("./format.js") : global.QRA;
  var layout = isNode ? require("./layout.js") : global.QRA;
  var codewords = isNode ? require("./codewords.js") : global.QRA;

  // ファインダパターン7×7の決まった形。1が黒。
  var FINDER_TEMPLATE = [
    [1, 1, 1, 1, 1, 1, 1],
    [1, 0, 0, 0, 0, 0, 1],
    [1, 0, 1, 1, 1, 0, 1],
    [1, 0, 1, 1, 1, 0, 1],
    [1, 0, 1, 1, 1, 0, 1],
    [1, 0, 0, 0, 0, 0, 1],
    [1, 1, 1, 1, 1, 1, 1],
  ];

  /**
   * 白黒が反転していれば元に戻す。戻したときだけ true を返す。
   *
   * 黒地に白で刷られたQRを撮ると、サンプリングした格子は全モジュールが反転する。
   * jsQR自身は反転を吸収して文字列を読めてしまうため、こちらで気づかないと
   * フォーマット情報だけが静かに別の値へ化ける。
   * ファインダパターンは黒33・白16と偏った形なので、三隅の一致数を数えれば
   * どちらの向きかを確実に判定できる。
   */
  function normalizeInversion(grid) {
    var size = grid.size;
    var origins = [[0, 0], [0, size - 7], [size - 7, 0]];
    var matches = 0;

    origins.forEach(function (origin) {
      for (var r = 0; r < 7; r++) {
        for (var c = 0; c < 7; c++) {
          if (grid.get(origin[0] + r, origin[1] + c) === FINDER_TEMPLATE[r][c]) matches++;
        }
      }
    });

    if (matches * 2 >= 7 * 7 * origins.length) return false;

    for (var i = 0; i < grid.modules.length; i++) grid.modules[i] ^= 1;
    return true;
  }

  /** 座標列を上位ビットから読み、整数にまとめる。 */
  function readBits(grid, positions) {
    var value = 0;
    for (var i = 0; i < positions.length; i++) {
      value = (value << 1) | grid.get(positions[i].row, positions[i].col);
    }
    return value;
  }

  /**
   * 2組の複製を両方とも復号し、訂正したビット数が少ないほうを採用する。
   *
   * 先に読めたほうを使う、では不十分。BCH符号は最小距離7なので、大きく壊れた
   * 15ビットが「別の正しい符号語」の近くに落ちることがあり、その場合は
   * 訂正に成功したように見えて中身が間違う。訂正量を比べれば健全なほうを選べる。
   */
  function chooseBestCopy(decodedPrimary, decodedSecondary) {
    if (!decodedPrimary && !decodedSecondary) return { info: null, source: null };
    if (!decodedSecondary) return { info: decodedPrimary, source: "primary" };
    if (!decodedPrimary) return { info: decodedSecondary, source: "secondary" };
    return decodedSecondary.bitErrors < decodedPrimary.bitErrors
      ? { info: decodedSecondary, source: "secondary" }
      : { info: decodedPrimary, source: "primary" };
  }

  function readFormat(grid, version) {
    var copies = layout.formatInfoPositions(version);
    return chooseBestCopy(
      format.decodeFormatInfo(readBits(grid, copies[0])),
      format.decodeFormatInfo(readBits(grid, copies[1]))
    );
  }

  function readVersion(grid, version) {
    if (version < 7) return null;

    var copies = layout.versionInfoPositions(version);
    var best = chooseBestCopy(
      format.decodeVersionInfo(readBits(grid, copies[0])),
      format.decodeVersionInfo(readBits(grid, copies[1]))
    );
    if (!best.info) return null;

    return {
      version: best.info.version,
      bitErrors: best.info.bitErrors,
      matchesSize: best.info.version === version,
    };
  }

  /**
   * マスクを解除しながらデータ領域をたどり、コードワード列へ戻す。
   * 末尾の残余ビットは常に0のはずなので、コードワードには含めない。
   */
  function readCodewords(grid, version, maskPattern, counts) {
    var sequence = layout.dataModuleSequence(version);
    var bytes = new Uint8Array(counts.total);

    for (var i = 0; i < counts.total * 8; i++) {
      var p = sequence[i];
      var bit = grid.get(p.row, p.col);
      if (format.maskBit(maskPattern, p.row, p.col)) bit ^= 1;
      bytes[i >> 3] = (bytes[i >> 3] << 1) | bit;
    }

    return bytes;
  }

  /**
   * データ領域の各モジュールに、座標とコードワード上の位置を組にして返す。
   * 可視化で「このマスは第37コードワードの3ビット目」と言えるようにするため。
   */
  function buildDataModules(version, ecLevel) {
    var sequence = layout.dataModuleSequence(version);
    var assignment = codewords.assignCodewordRoles(version, ecLevel);
    return sequence.map(function (p, i) {
      return {
        row: p.row,
        col: p.col,
        index: assignment[i].index,
        kind: assignment[i].kind,
        bit: assignment[i].bit,
      };
    });
  }

  /**
   * @param {{size: number, get: Function}} grid サンプリング済みのモジュール格子
   * @returns {object} 解析結果。フォーマット情報が読めなかった場合、
   *                   ecLevel / maskPattern / codewords は null になる。
   */
  function analyzeGrid(grid) {
    var size = grid.size;
    var version = (size - 17) / 4;
    if (!Number.isInteger(version) || version < 1 || version > 40) {
      throw new Error("QRコードの寸法ではありません: " + size);
    }

    var formatResult = readFormat(grid, version);
    var result = {
      version: version,
      size: size,
      ecLevel: null,
      maskPattern: null,
      formatBitErrors: null,
      formatSource: formatResult.source,
      versionInfo: readVersion(grid, version),
      roles: layout.buildModuleRoles(version),
      counts: null,
      codewords: null,
      dataModules: null,
    };

    if (!formatResult.info) return result;

    result.ecLevel = formatResult.info.ecLevel;
    result.maskPattern = formatResult.info.maskPattern;
    result.formatBitErrors = formatResult.info.bitErrors;
    result.counts = codewords.codewordCounts(version, result.ecLevel);
    result.codewords = readCodewords(grid, version, result.maskPattern, result.counts);
    result.dataModules = buildDataModules(version, result.ecLevel);

    return result;
  }

  var api = { analyzeGrid: analyzeGrid, readBits: readBits, normalizeInversion: normalizeInversion };
  if (isNode) module.exports = api;
  else global.QRA = Object.assign(global.QRA || {}, api);
})(typeof self !== "undefined" ? self : this);
