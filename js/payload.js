/**
 * payload.js — QRコードから復号した文字列が「何なのか」を判定する。
 *
 * QRコード自体は単なるバイト列を運ぶだけで、中身の意味は決めていない。
 * URL・Wi-Fi設定・vCardなどは、業界慣習として定着した書式にすぎない。
 * ここではその慣習を解釈して、表示に使える形へ整える。
 */
(function (global) {
  "use strict";

  // スキームなしでもホスト名に見える文字列（例: example.com/path）。
  // 末尾ラベルが2文字以上の英字であることを要求し、"3.14" のような数値を弾く。
  var BARE_HOST =
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}(?::\d+)?(?:[\/?#]\S*)?$/i;

  function result(type, url, fields) {
    return { type: type, url: url || null, fields: fields || {} };
  }

  /** Wi-Fi/vCard書式のエスケープ（\; \, \: \\）を元の文字へ戻す。 */
  function unescapeValue(s) {
    return s.replace(/\\(.)/g, "$1");
  }

  /**
   * "WIFI:T:WPA;S:name;P:pass;;" を key→value に分解する。
   * 値の中の "\;" は区切りではないので、1文字ずつ走査して判断する。
   */
  function parseWifi(body) {
    var fields = {};
    var key = null;
    var buf = "";
    for (var i = 0; i < body.length; i++) {
      var c = body[i];
      if (c === "\\") {
        buf += c + (body[++i] || "");
      } else if (c === ":" && key === null) {
        key = buf;
        buf = "";
      } else if (c === ";") {
        if (key !== null) fields[key.toUpperCase()] = unescapeValue(buf);
        key = null;
        buf = "";
      } else {
        buf += c;
      }
    }
    return {
      ssid: fields.S || "",
      auth: fields.T || "nopass",
      password: fields.P || "",
      hidden: fields.H === "true",
    };
  }

  function parseVCard(text) {
    var fields = {};
    text.split(/\r\n|\r|\n/).forEach(function (line) {
      var m = /^([A-Za-z][A-Za-z0-9-]*)(?:;[^:]*)?:(.*)$/.exec(line);
      if (!m) return;
      var name = m[1].toUpperCase();
      if (name === "FN" && !fields.name) fields.name = m[2];
      else if (name === "N" && !fields.name) fields.name = m[2].replace(/;+/g, " ").trim();
      else if (name === "TEL" && !fields.tel) fields.tel = m[2];
      else if (name === "EMAIL" && !fields.email) fields.email = m[2];
      else if (name === "ORG" && !fields.org) fields.org = m[2];
      else if (name === "URL" && !fields.url) fields.url = m[2];
    });
    return fields;
  }

  function classifyPayload(text) {
    if (typeof text !== "string" || text === "") return result("text", null, {});

    if (/^https?:\/\//i.test(text)) return result("url", text, {});

    if (/^WIFI:/i.test(text)) {
      return result("wifi", null, parseWifi(text.slice(5)));
    }

    if (/^BEGIN:VCARD/i.test(text)) {
      return result("vcard", null, parseVCard(text));
    }

    if (/^MECARD:/i.test(text)) {
      var mecard = {};
      text.slice(7).split(";").forEach(function (part) {
        var m = /^([A-Za-z]+):(.*)$/.exec(part);
        if (m) mecard[m[1].toLowerCase()] = unescapeValue(m[2]);
      });
      return result("vcard", null, { name: mecard.n || "", tel: mecard.tel || "", email: mecard.email || "" });
    }

    if (/^mailto:/i.test(text)) {
      var to = text.slice(7);
      var q = "";
      var qi = to.indexOf("?");
      if (qi >= 0) {
        q = to.slice(qi + 1);
        to = to.slice(0, qi);
      }
      var params = new URLSearchParams(q);
      return result("mailto", null, {
        to: decodeURIComponent(to),
        subject: params.get("subject") || "",
        body: params.get("body") || "",
      });
    }

    if (/^tel:/i.test(text)) return result("tel", null, { number: text.slice(4) });

    if (/^(SMSTO|SMS|MATMSG):/i.test(text)) {
      var rest = text.slice(text.indexOf(":") + 1);
      var sep = rest.indexOf(":");
      return result("sms", null, {
        number: sep >= 0 ? rest.slice(0, sep) : rest,
        body: sep >= 0 ? rest.slice(sep + 1) : "",
      });
    }

    if (/^geo:/i.test(text)) {
      var parts = text.slice(4).split(",");
      var lat = parseFloat(parts[0]);
      var lon = parseFloat(parts[1]);
      if (isFinite(lat) && isFinite(lon)) return result("geo", null, { lat: lat, lon: lon });
    }

    // スキームなしのホスト名。https を補ってリンク可能にする。
    if (BARE_HOST.test(text)) return result("url", "https://" + text, {});

    // http/https 以外のスキーム（javascript: など）は決してリンク化しない。
    return result("text", null, {});
  }

  var api = { classifyPayload: classifyPayload };
  if (typeof module === "object" && typeof module.exports === "object") module.exports = api;
  else global.QRA = Object.assign(global.QRA || {}, api);
})(typeof self !== "undefined" ? self : this);
