const test = require("node:test");
const assert = require("node:assert");
const { classifyPayload } = require("../js/payload.js");

test("https のURLをリンク可能なURLとして扱う", () => {
  const r = classifyPayload("https://example.com/a?b=1");
  assert.strictEqual(r.type, "url");
  assert.strictEqual(r.url, "https://example.com/a?b=1");
});

test("http のURLもリンク可能", () => {
  assert.strictEqual(classifyPayload("http://example.com").type, "url");
});

test("スキームなしのドメインは https:// を補ってリンク可能にする", () => {
  const r = classifyPayload("example.com/path");
  assert.strictEqual(r.type, "url");
  assert.strictEqual(r.url, "https://example.com/path");
});

test("javascript: スキームはリンク化せずテキスト扱いにする", () => {
  const r = classifyPayload("javascript:alert(1)");
  assert.strictEqual(r.type, "text");
  assert.strictEqual(r.url, null);
});

test("数値だけの文字列はURLと誤判定しない", () => {
  assert.strictEqual(classifyPayload("3.14").type, "text");
});

test("WIFI設定をSSID・暗号化方式・パスワードに分解する", () => {
  const r = classifyPayload("WIFI:T:WPA;S:MyNet;P:pass123;H:true;;");
  assert.strictEqual(r.type, "wifi");
  assert.deepStrictEqual(r.fields, {
    ssid: "MyNet",
    auth: "WPA",
    password: "pass123",
    hidden: true,
  });
});

test("WIFI設定でエスケープされた区切り文字を復元する", () => {
  const r = classifyPayload("WIFI:S:My\\;Net;P:a\\\\b;;");
  assert.strictEqual(r.fields.ssid, "My;Net");
  assert.strictEqual(r.fields.password, "a\\b");
});

test("vCardから表示名を取り出す", () => {
  const r = classifyPayload("BEGIN:VCARD\r\nVERSION:3.0\r\nFN:山田太郎\r\nTEL:0312345678\r\nEND:VCARD");
  assert.strictEqual(r.type, "vcard");
  assert.strictEqual(r.fields.name, "山田太郎");
  assert.strictEqual(r.fields.tel, "0312345678");
});

test("mailto を宛先と件名に分解する", () => {
  const r = classifyPayload("mailto:a@b.com?subject=hello");
  assert.strictEqual(r.type, "mailto");
  assert.strictEqual(r.fields.to, "a@b.com");
  assert.strictEqual(r.fields.subject, "hello");
});

test("tel を電話番号として扱う", () => {
  const r = classifyPayload("tel:+81-3-1234-5678");
  assert.strictEqual(r.type, "tel");
  assert.strictEqual(r.fields.number, "+81-3-1234-5678");
});

test("SMSTO を宛先と本文に分解する", () => {
  const r = classifyPayload("SMSTO:09012345678:あとで電話して");
  assert.strictEqual(r.type, "sms");
  assert.strictEqual(r.fields.number, "09012345678");
  assert.strictEqual(r.fields.body, "あとで電話して");
});

test("geo を緯度経度に分解する", () => {
  const r = classifyPayload("geo:35.681236,139.767125");
  assert.strictEqual(r.type, "geo");
  assert.strictEqual(r.fields.lat, 35.681236);
  assert.strictEqual(r.fields.lon, 139.767125);
});

test("どれにも当てはまらない文字列はテキスト", () => {
  const r = classifyPayload("ただのメモ書きです");
  assert.strictEqual(r.type, "text");
  assert.strictEqual(r.url, null);
});
