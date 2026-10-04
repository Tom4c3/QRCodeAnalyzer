const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { PNG } = require("pngjs");
const { analyzeImageData } = require("../js/pipeline.js");

const SAMPLES = path.join(__dirname, "..", "samples");

/** samples/ の実ファイルを読み、解析して返す。 */
function analyzeSample(name) {
  const png = PNG.sync.read(fs.readFileSync(path.join(SAMPLES, name)));
  return analyzeImageData(new Uint8ClampedArray(png.data), png.width, png.height);
}

test("URLのサンプルを解析できる", () => {
  const [symbol] = analyzeSample("01-url.png");
  assert.strictEqual(symbol.text, "https://example.com/products/12345?ref=qr");
  assert.strictEqual(symbol.payload.type, "url");
  assert.strictEqual(symbol.ecLevel, "M");
  assert.strictEqual(symbol.formatBitErrors, 0);
});

test("誤り訂正レベルHのサンプルを解析できる", () => {
  const [symbol] = analyzeSample("02-url-high-ec.png");
  assert.strictEqual(symbol.ecLevel, "H");
  assert.ok(symbol.counts.ec > symbol.counts.data, "レベルHでは誤り訂正のほうが多い");
});

test("Wi-Fi設定のサンプルからSSIDとパスワードを取り出せる", () => {
  const [symbol] = analyzeSample("03-wifi.png");
  assert.strictEqual(symbol.payload.type, "wifi");
  assert.strictEqual(symbol.payload.fields.ssid, "Office-2F");
  assert.strictEqual(symbol.payload.fields.password, "s3cret-pass");
  assert.strictEqual(symbol.payload.fields.auth, "WPA");
});

test("vCardのサンプルから氏名と電話番号を取り出せる", () => {
  const [symbol] = analyzeSample("04-vcard.png");
  assert.strictEqual(symbol.payload.type, "vcard");
  assert.strictEqual(symbol.payload.fields.name, "山田太郎");
  assert.strictEqual(symbol.payload.fields.tel, "03-1234-5678");
});

test("電話番号のサンプルを解析できる", () => {
  const [symbol] = analyzeSample("05-tel.png");
  assert.strictEqual(symbol.payload.type, "tel");
  assert.strictEqual(symbol.payload.fields.number, "+81-3-1234-5678");
});

test("日本語テキストのサンプルを解析できる", () => {
  const [symbol] = analyzeSample("06-text-japanese.png");
  assert.strictEqual(symbol.text, "会議室Aの予約はこちら");
  assert.strictEqual(symbol.payload.type, "text");
  assert.strictEqual(symbol.payload.url, null);
});

test("バージョン7以上のサンプルでは、バージョン情報も読める", () => {
  const [symbol] = analyzeSample("07-large-version.png");
  assert.ok(symbol.version >= 7, `バージョン${symbol.version}`);
  assert.strictEqual(symbol.versionInfo.version, symbol.version);
  assert.strictEqual(symbol.versionInfo.matchesSize, true);
  assert.strictEqual(symbol.versionAgrees, true);
});

test("数字だけのサンプルは数字モードで符号化されている", () => {
  const [symbol] = analyzeSample("08-numeric.png");
  assert.strictEqual(symbol.segments[0].mode, "numeric");
  assert.strictEqual(symbol.segments[0].length, 40);
});

test("1枚に3つ並んだサンプルから、3つとも取り出せる", () => {
  const symbols = analyzeSample("09-three-in-one.png");
  assert.strictEqual(symbols.length, 3);
  assert.deepStrictEqual(symbols.map((s) => s.text).sort(), [
    "https://example.com/a",
    "https://example.com/b",
    "https://example.com/c",
  ]);
  for (const symbol of symbols) {
    assert.strictEqual(symbol.ecLevel, "M");
    assert.strictEqual(symbol.formatBitErrors, 0);
  }
});

test("白黒反転したサンプルも解析できる", () => {
  const [symbol] = analyzeSample("10-inverted.png");
  assert.strictEqual(symbol.text, "https://example.com/inverted");
  assert.strictEqual(symbol.ecLevel, "M");
});

test("どのサンプルでも、モジュール行列と役割マップが揃っている", () => {
  for (const name of fs.readdirSync(SAMPLES).filter((f) => f.endsWith(".png"))) {
    for (const symbol of analyzeSample(name)) {
      assert.strictEqual(symbol.modules.length, symbol.size * symbol.size, name);
      assert.strictEqual(symbol.roles.length, symbol.size, name);
      assert.strictEqual(symbol.analysisError, null, name);
      assert.ok(symbol.dataModules.length > 0, name);
    }
  }
});
