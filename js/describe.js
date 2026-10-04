/**
 * describe.js — 解析結果を人が読む日本語にする。
 *
 * 画面に出す文言だけを集めてある。DOMには触れないので、
 * 「このマスは何なのか」の説明そのものをテストで確かめられる。
 */
(function (global) {
  "use strict";

  var isNode = typeof module === "object" && typeof module.exports === "object";
  var format = isNode ? require("./format.js") : global.QRA;

  var ROLE_LABELS = {
    finder: "ファインダパターン",
    separator: "分離パターン",
    timing: "タイミングパターン",
    alignment: "位置合わせパターン",
    format: "フォーマット情報",
    version: "バージョン情報",
    dark: "固定の暗モジュール",
    data: "データ領域",
  };

  var ROLE_NOTES = {
    finder: "三隅にあり、シンボルの位置と向きを見つけるための目印。",
    separator: "ファインダパターンとデータが混ざらないようにする白い枠。",
    timing: "白黒が交互に並び、モジュールの刻み幅を数える物差しになる。",
    alignment: "歪んだ画像でも座標がずれないようにする、中間の目印。",
    version: "シンボルの大きさを冗長に記録した領域。バージョン7以上だけにある。",
  };

  var PAYLOAD_LABELS = {
    url: "URL",
    text: "テキスト",
    wifi: "Wi-Fi設定",
    vcard: "連絡先",
    mailto: "メール",
    tel: "電話番号",
    sms: "SMS",
    geo: "位置情報",
  };

  var MODE_LABELS = {
    numeric: "数字",
    alphanumeric: "英数字",
    byte: "8ビットバイト",
    kanji: "漢字",
    eci: "文字コード指定",
  };

  function roleLabel(role) {
    return ROLE_LABELS[role] || role;
  }

  function payloadLabel(type) {
    return PAYLOAD_LABELS[type] || type;
  }

  function modeLabel(mode) {
    return MODE_LABELS[mode] || mode;
  }

  function toHex(value) {
    return "0x" + value.toString(16).toUpperCase().padStart(2, "0");
  }

  /** データ領域の座標から、コードワード上の位置を引けるようにしておく。 */
  function dataModuleLookup(symbol) {
    if (symbol._dataModuleLookup) return symbol._dataModuleLookup;
    var lookup = {};
    if (symbol.dataModules) {
      for (var i = 0; i < symbol.dataModules.length; i++) {
        var m = symbol.dataModules[i];
        lookup[m.row * symbol.size + m.col] = m;
      }
    }
    // 何度もホバーするので、シンボルに覚えさせて作り直さない。
    Object.defineProperty(symbol, "_dataModuleLookup", { value: lookup, enumerable: false });
    return lookup;
  }

  function describeDataModule(symbol, row, col, isDark) {
    var entry = dataModuleLookup(symbol)[row * symbol.size + col];
    if (!entry) return "データ領域";

    if (entry.kind === "remainder") {
      return "残余ビット — コードワードの整数倍に足りない余りの場所。常に0が入り、意味を持たない。";
    }

    var kindLabel = entry.kind === "ec" ? "誤り訂正コードワード" : "データコードワード";
    var parts = [kindLabel + " 第" + (entry.index + 1) + "コードワードの" + (entry.bit + 1) + "ビット目"];

    if (symbol.maskPattern !== null && symbol.maskPattern !== undefined) {
      var unmasked = format.maskBit(symbol.maskPattern, row, col) ? 1 - isDark : isDark;
      parts.push("マスク解除後の値 " + unmasked);
    }
    if (symbol.codewords && entry.index < symbol.codewords.length) {
      parts.push("このコードワードの値 " + toHex(symbol.codewords[entry.index]));
    }

    return parts.join(" / ");
  }

  function describeFormatModule(symbol) {
    if (symbol.ecLevel === null || symbol.ecLevel === undefined) {
      return "フォーマット情報 — 誤り訂正レベルとマスクパターンを記録した15ビット。この画像からは読み取れなかった。";
    }
    return (
      "フォーマット情報 — 誤り訂正レベル " +
      symbol.ecLevel +
      "、マスクパターン " +
      symbol.maskPattern +
      "。同じ内容が2箇所に書かれている。"
    );
  }

  /**
   * ホバーしたモジュール1つを説明する文章を組み立てる。
   * @param {object} symbol pipeline が返したシンボル
   * @param {number} row
   * @param {number} col
   * @returns {string}
   */
  function describeModule(symbol, row, col) {
    var isDark = symbol.modules[row * symbol.size + col];
    var role = symbol.roles ? symbol.roles[row][col] : "data";
    var head = "行" + row + " 列" + col + "・" + (isDark ? "黒" : "白");

    var body;
    if (role === "data") {
      body = describeDataModule(symbol, row, col, isDark);
    } else if (role === "format") {
      body = describeFormatModule(symbol);
    } else if (role === "dark") {
      body = "固定の暗モジュール — 内容によらず常に黒と決まっている1マス。";
    } else if (role === "version" && symbol.versionInfo) {
      body = roleLabel(role) + " — バージョン " + symbol.versionInfo.version + "。" + ROLE_NOTES[role];
    } else {
      body = roleLabel(role) + (ROLE_NOTES[role] ? " — " + ROLE_NOTES[role] : "");
    }

    return head + "\n" + body;
  }

  var api = {
    roleLabel: roleLabel,
    payloadLabel: payloadLabel,
    modeLabel: modeLabel,
    describeModule: describeModule,
    toHex: toHex,
  };
  if (isNode) module.exports = api;
  else global.QRA = Object.assign(global.QRA || {}, api);
})(typeof self !== "undefined" ? self : this);
