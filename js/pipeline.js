/**
 * pipeline.js — 1枚の画像を、表示できる解析結果の一覧へ変える。
 *
 *   検出（detect） → 格子サンプリング（grid） → パラメータ解読（analyze）
 *   → 中身の種別判定（payload）
 *
 * jsQRが読み取った文字列と、自前で解読したパラメータの両方を1つにまとめる。
 * どちらか一方が欠けても、もう一方は返す。URLだけ欲しい場面で
 * パラメータ解読の失敗に巻き込まれないようにするため。
 */
(function (global) {
  "use strict";

  var isNode = typeof module === "object" && typeof module.exports === "object";
  var detect = isNode ? require("./detect.js") : global.QRA;
  var grid = isNode ? require("./grid.js") : global.QRA;
  var analyze = isNode ? require("./analyze.js") : global.QRA;
  var payload = isNode ? require("./payload.js") : global.QRA;
  var layout = isNode ? require("./layout.js") : global.QRA;

  /**
   * jsQRが返すチャンクを、モードと長さの一覧へ整える。
   * QRは1つのシンボルの中でモードを切り替えられるので、複数返ることがある。
   * ECIチャンク（文字コードの指定）は表示対象にしない。
   */
  function toSegments(chunks) {
    if (!chunks) return [];
    return chunks
      .filter(function (chunk) {
        return chunk.type !== "eci";
      })
      .map(function (chunk) {
        return {
          mode: chunk.type,
          length: chunk.type === "byte" && chunk.bytes ? chunk.bytes.length : chunk.text.length,
        };
      });
  }

  /**
   * 1つのシンボルについて、格子を取り直してパラメータを解読する。
   * 失敗しても例外を投げず、analysisError に理由を入れて返す。
   */
  function analyzeSymbol(gray, width, height, symbol) {
    var size = layout.symbolSize(symbol.version);
    var sampled = grid.sampleModuleGrid(gray, width, height, symbol.quad, size);

    // 黒地に白で刷られていた場合はここで向きを揃える。以降の解読も表示も、
    // 白地に黒のつもりで扱えるようになる。
    var inverted = analyze.normalizeInversion(sampled);

    var result = {
      size: size,
      modules: sampled.modules,
      threshold: sampled.threshold,
      inverted: inverted,
      ecLevel: null,
      maskPattern: null,
      formatBitErrors: null,
      formatSource: null,
      versionInfo: null,
      counts: null,
      codewords: null,
      roles: null,
      dataModules: null,
      analysisError: null,
    };

    try {
      var analysis = analyze.analyzeGrid(sampled);
      result.ecLevel = analysis.ecLevel;
      result.maskPattern = analysis.maskPattern;
      result.formatBitErrors = analysis.formatBitErrors;
      result.formatSource = analysis.formatSource;
      result.versionInfo = analysis.versionInfo;
      result.counts = analysis.counts;
      result.codewords = analysis.codewords;
      result.roles = analysis.roles;
      result.dataModules = analysis.dataModules;
    } catch (error) {
      result.analysisError = error.message;
    }

    return result;
  }

  /**
   * 画像1枚を解析する。
   *
   * @param {Uint8ClampedArray} rgba
   * @param {number} width
   * @param {number} height
   * @param {{maxSymbols?: number}} [options]
   * @returns {object[]} 見つかったシンボルごとの解析結果
   */
  function analyzeImageData(rgba, width, height, options) {
    var symbols = detect.detectAll(rgba, width, height, options);
    if (symbols.length === 0) return [];

    var gray = detect.rgbaToGray(rgba, width, height);

    return symbols.map(function (symbol) {
      var analysis = analyzeSymbol(gray, width, height, symbol);
      return Object.assign(
        {
          text: symbol.text,
          bytes: symbol.bytes,
          payload: payload.classifyPayload(symbol.text),
          segments: toSegments(symbol.chunks),
          version: symbol.version,
          quad: symbol.quad,
          bounds: symbol.bounds,
          // 自前で読んだバージョン情報が、jsQRの判断と食い違っていないか。
          versionAgrees:
            analysis.versionInfo === null || analysis.versionInfo.version === symbol.version,
        },
        analysis
      );
    });
  }

  var api = { analyzeImageData: analyzeImageData, toSegments: toSegments };
  if (isNode) module.exports = api;
  else global.QRA = Object.assign(global.QRA || {}, api);
})(typeof self !== "undefined" ? self : this);
