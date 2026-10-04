const test = require("node:test");
const assert = require("node:assert");
const QRCode = require("qrcode");
const { analyzeImageData } = require("../js/pipeline.js");
const { roleLabel, payloadLabel, modeLabel, describeModule } = require("../js/describe.js");
const { renderMatrixToGray, grayToRgba } = require("./helpers/render.js");

/** バージョン3（残余ビットが7ある）のシンボルを1つ用意する。 */
function sampleSymbol() {
  const qr = QRCode.create("https://example.com/describe", {
    errorCorrectionLevel: "M",
    version: 3,
  });
  const r = renderMatrixToGray(qr.modules, { scale: 6 });
  return analyzeImageData(grayToRgba(r.gray, r.width, r.height), r.width, r.height)[0];
}

test("領域名を日本語で返す", () => {
  assert.strictEqual(roleLabel("finder"), "ファインダパターン");
  assert.strictEqual(roleLabel("separator"), "分離パターン");
  assert.strictEqual(roleLabel("timing"), "タイミングパターン");
  assert.strictEqual(roleLabel("alignment"), "位置合わせパターン");
  assert.strictEqual(roleLabel("format"), "フォーマット情報");
  assert.strictEqual(roleLabel("version"), "バージョン情報");
  assert.strictEqual(roleLabel("dark"), "固定の暗モジュール");
});

test("知らない領域名はそのまま返す", () => {
  assert.strictEqual(roleLabel("なにか"), "なにか");
});

test("ペイロード種別を日本語で返す", () => {
  assert.strictEqual(payloadLabel("url"), "URL");
  assert.strictEqual(payloadLabel("wifi"), "Wi-Fi設定");
  assert.strictEqual(payloadLabel("vcard"), "連絡先");
  assert.strictEqual(payloadLabel("text"), "テキスト");
});

test("エンコードモードを日本語で返す", () => {
  assert.strictEqual(modeLabel("numeric"), "数字");
  assert.strictEqual(modeLabel("alphanumeric"), "英数字");
  assert.strictEqual(modeLabel("byte"), "8ビットバイト");
  assert.strictEqual(modeLabel("kanji"), "漢字");
});

test("ファインダパターンのモジュールを説明する", () => {
  const text = describeModule(sampleSymbol(), 0, 0);
  assert.match(text, /ファインダパターン/);
  assert.match(text, /行0[^\d]/);
  assert.match(text, /列0/);
});

test("フォーマット情報のモジュールには、そこから読めた値を添える", () => {
  const symbol = sampleSymbol();
  const text = describeModule(symbol, 8, 0);
  assert.match(text, /フォーマット情報/);
  assert.match(text, /誤り訂正レベル M/);
  assert.match(text, new RegExp(`マスクパターン ${symbol.maskPattern}`));
});

test("データコードワードのモジュールには、何番目の何ビット目かと値を添える", () => {
  const symbol = sampleSymbol();
  const first = symbol.dataModules[0];
  const text = describeModule(symbol, first.row, first.col);
  assert.match(text, /データコードワード/);
  assert.match(text, /第1コードワード/);
  assert.match(text, /1ビット目/);
  assert.match(text, /0x/);
});

test("誤り訂正コードワードのモジュールは、データと区別して説明する", () => {
  const symbol = sampleSymbol();
  const ecModule = symbol.dataModules.find((m) => m.kind === "ec");
  const text = describeModule(symbol, ecModule.row, ecModule.col);
  assert.match(text, /誤り訂正コードワード/);
});

test("残余ビットのモジュールは、意味を持たないことを説明する", () => {
  const symbol = sampleSymbol();
  const remainder = symbol.dataModules.find((m) => m.kind === "remainder");
  assert.ok(remainder, "バージョン3には残余ビットがある");
  const text = describeModule(symbol, remainder.row, remainder.col);
  assert.match(text, /残余ビット/);
});

test("固定の暗モジュールを説明する", () => {
  const symbol = sampleSymbol();
  const text = describeModule(symbol, 4 * symbol.version + 9, 8);
  assert.match(text, /常に黒/);
});

test("モジュールの白黒を説明に含める", () => {
  const symbol = sampleSymbol();
  const dark = describeModule(symbol, 0, 0); // ファインダの角は必ず黒
  const light = describeModule(symbol, 7, 7); // 分離パターンは必ず白
  assert.match(dark, /黒/);
  assert.match(light, /白/);
});

test("マスク解除後の値もデータ領域では併記する", () => {
  const symbol = sampleSymbol();
  const first = symbol.dataModules[0];
  const text = describeModule(symbol, first.row, first.col);
  assert.match(text, /マスク解除後/);
});

test("フォーマット情報が読めなかったシンボルでも説明を返す", () => {
  const symbol = sampleSymbol();
  const broken = Object.assign({}, symbol, {
    ecLevel: null,
    maskPattern: null,
    dataModules: null,
    codewords: null,
  });
  const text = describeModule(broken, 8, 0);
  assert.match(text, /フォーマット情報/);
  assert.doesNotMatch(text, /undefined|null/);
});
