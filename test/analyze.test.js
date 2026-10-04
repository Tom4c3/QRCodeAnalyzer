const test = require("node:test");
const assert = require("node:assert");
const QRCode = require("qrcode");
const { sampleModuleGrid } = require("../js/grid.js");
const { analyzeGrid } = require("../js/analyze.js");
const { renderMatrixToGray } = require("./helpers/render.js");

/** 指定の内容でQRを作り、画像として描き出してから解析し直す。 */
function roundTrip(text, options) {
  const qr = QRCode.create(text, options);
  const { gray, width, height, quad } = renderMatrixToGray(qr.modules, { scale: 5 });
  const grid = sampleModuleGrid(gray, width, height, quad, qr.modules.size);
  return { qr, analysis: analyzeGrid(grid) };
}

test("シンボル寸法からバージョンを求める", () => {
  const { qr, analysis } = roundTrip("https://example.com/", { errorCorrectionLevel: "M" });
  assert.strictEqual(analysis.version, qr.version);
  assert.strictEqual(analysis.size, qr.modules.size);
});

test("画像から読んだフォーマット情報が、生成時の誤り訂正レベルと一致する", () => {
  for (const level of ["L", "M", "Q", "H"]) {
    const { analysis } = roundTrip("https://example.com/format-check", {
      errorCorrectionLevel: level,
    });
    assert.strictEqual(analysis.ecLevel, level, `誤り訂正レベル${level}`);
    assert.strictEqual(analysis.formatBitErrors, 0);
  }
});

test("画像から読んだマスクパターンが、生成時のマスクパターンと一致する", () => {
  // 内容を変えるとエンコーダが選ぶマスクも変わるので、複数の内容で確かめる。
  const samples = ["A", "https://example.com/1", "12345678901234567890", "日本語テキスト"];
  for (const text of samples) {
    const { qr, analysis } = roundTrip(text, { errorCorrectionLevel: "Q" });
    assert.strictEqual(analysis.maskPattern, qr.maskPattern, `内容: ${text}`);
  }
});

test("バージョン7以上ではバージョン情報も読み、シンボル寸法と一致することを確かめる", () => {
  const { qr, analysis } = roundTrip("x".repeat(200), { errorCorrectionLevel: "M" });
  assert.ok(qr.version >= 7, `テスト前提: バージョン7以上 (実際は${qr.version})`);
  assert.strictEqual(analysis.versionInfo.version, qr.version);
  assert.strictEqual(analysis.versionInfo.bitErrors, 0);
  assert.strictEqual(analysis.versionInfo.matchesSize, true);
});

test("バージョン6以下にはバージョン情報が無い", () => {
  const { analysis } = roundTrip("short", { errorCorrectionLevel: "L" });
  assert.strictEqual(analysis.versionInfo, null);
});

test("コードワード数の内訳を返す", () => {
  const { analysis } = roundTrip("https://example.com/", { errorCorrectionLevel: "M", version: 2 });
  assert.deepStrictEqual(analysis.counts, {
    total: 44,
    data: 28,
    ec: 16,
    blocks: 1,
    remainderBits: 7,
  });
});

// マスクを解除してジグザグに読み直すと、最初のコードワードには
// モード指示子（4ビット）と文字数指示子が現れる。ここが合えば、
// 格子・マスク・読み出し順のすべてが正しいことになる。
test("数字モードのコードワード先頭に、モード指示子1と文字数が現れる", () => {
  const { analysis } = roundTrip("12345", { errorCorrectionLevel: "L", version: 1 });
  const c = analysis.codewords;
  assert.strictEqual(c[0] >> 4, 1, "モード指示子は数字モードの1");
  assert.strictEqual(((c[0] & 0x0f) << 6) | (c[1] >> 2), 5, "文字数は5");
});

test("8ビットバイトモードのコードワード先頭に、モード指示子4と文字数が現れる", () => {
  const text = "https://example.com/";
  const { analysis } = roundTrip(text, { errorCorrectionLevel: "L", version: 2 });
  const c = analysis.codewords;
  assert.strictEqual(c[0] >> 4, 4, "モード指示子は8ビットバイトモードの4");
  assert.strictEqual(((c[0] & 0x0f) << 4) | (c[1] >> 4), text.length, "文字数");
});

test("英数字モードのコードワード先頭に、モード指示子2が現れる", () => {
  const { analysis } = roundTrip("HELLO WORLD", { errorCorrectionLevel: "L", version: 1 });
  assert.strictEqual(analysis.codewords[0] >> 4, 2);
});

test("コードワード配列の長さは規格の総コードワード数と一致する", () => {
  const { analysis } = roundTrip("https://example.com/", { errorCorrectionLevel: "H", version: 5 });
  assert.strictEqual(analysis.codewords.length, 134);
});

test("モジュール役割マップと、コードワード割り当てを返す", () => {
  const { analysis } = roundTrip("https://example.com/", { errorCorrectionLevel: "M", version: 2 });
  assert.strictEqual(analysis.roles[0][0], "finder");
  assert.strictEqual(analysis.roles.length, 25);
  assert.strictEqual(analysis.dataModules.length, 359);
  assert.deepStrictEqual(analysis.dataModules[0], {
    row: 24,
    col: 24,
    index: 0,
    kind: "data",
    bit: 0,
  });
});

test("フォーマット情報が片方壊れていても、もう片方から復元する", () => {
  const qr = QRCode.create("https://example.com/", { errorCorrectionLevel: "Q" });
  const { gray, width, height, quad } = renderMatrixToGray(qr.modules, { scale: 5 });
  const grid = sampleModuleGrid(gray, width, height, quad, qr.modules.size);

  // 1組目のフォーマット情報（8行目の左端側）を大きく壊す。
  for (let col = 0; col < 6; col++) grid.modules[8 * grid.size + col] ^= 1;
  for (let row = 0; row < 6; row++) grid.modules[row * grid.size + 8] ^= 1;

  const analysis = analyzeGrid(grid);
  assert.strictEqual(analysis.ecLevel, "Q");
  assert.strictEqual(analysis.maskPattern, qr.maskPattern);
  assert.strictEqual(analysis.formatSource, "secondary");
});

test("両方のフォーマット情報が壊れていたら解析失敗を報告する", () => {
  const qr = QRCode.create("https://example.com/", { errorCorrectionLevel: "Q" });
  const { gray, width, height, quad } = renderMatrixToGray(qr.modules, { scale: 5 });
  const grid = sampleModuleGrid(gray, width, height, quad, qr.modules.size);
  for (let i = 0; i < grid.modules.length; i++) grid.modules[i] = i % 2;

  const analysis = analyzeGrid(grid);
  assert.strictEqual(analysis.ecLevel, null);
  assert.strictEqual(analysis.maskPattern, null);
  assert.strictEqual(analysis.formatSource, null);
});

// 2箇所ある複製は、それぞれ単独で正しく読めなければ冗長性の意味がない。
// 片方だけ正しくても analyzeGrid は成功してしまうので、複製ごとに検証する。
const layout = require("../js/layout.js");
const { decodeFormatInfo, decodeVersionInfo } = require("../js/format.js");
const { readBits } = require("../js/analyze.js");

function gridOf(text, options) {
  const qr = QRCode.create(text, options);
  const { gray, width, height, quad } = renderMatrixToGray(qr.modules, { scale: 5 });
  return { qr, grid: sampleModuleGrid(gray, width, height, quad, qr.modules.size) };
}

test("フォーマット情報は2組とも単独で正しく復号できる", () => {
  for (const level of ["L", "M", "Q", "H"]) {
    const { qr, grid } = gridOf("https://example.com/copies", { errorCorrectionLevel: level });
    const [copy1, copy2] = layout.formatInfoPositions(qr.version);
    const expected = { ecLevel: level, maskPattern: qr.maskPattern, bitErrors: 0 };
    assert.deepStrictEqual(decodeFormatInfo(readBits(grid, copy1)), expected, `${level} 1組目`);
    assert.deepStrictEqual(decodeFormatInfo(readBits(grid, copy2)), expected, `${level} 2組目`);
  }
});

test("バージョン情報は2組とも単独で正しく復号できる", () => {
  for (const length of [200, 500, 1200]) {
    const { qr, grid } = gridOf("x".repeat(length), { errorCorrectionLevel: "M" });
    assert.ok(qr.version >= 7, `テスト前提: バージョン7以上 (実際は${qr.version})`);
    const [copy1, copy2] = layout.versionInfoPositions(qr.version);
    const expected = { version: qr.version, bitErrors: 0 };
    assert.deepStrictEqual(decodeVersionInfo(readBits(grid, copy1)), expected, `v${qr.version} 1組目`);
    assert.deepStrictEqual(decodeVersionInfo(readBits(grid, copy2)), expected, `v${qr.version} 2組目`);
  }
});

// 白地に黒のQRとは限らない。黒地に白で印刷されていると、サンプリングした格子は
// 全モジュールが反転する。中身はjsQRが読めてしまうぶん、パラメータだけ静かに
// 間違うのが厄介なので、ファインダパターンの既知の形と照合して判定する。
const { normalizeInversion } = require("../js/analyze.js");

test("通常の向きの格子は反転させない", () => {
  const { grid } = gridOf("https://example.com/normal", { errorCorrectionLevel: "M" });
  const before = Uint8Array.from(grid.modules);
  assert.strictEqual(normalizeInversion(grid), false);
  assert.deepStrictEqual(Uint8Array.from(grid.modules), before);
});

test("全モジュールが反転した格子は、元に戻して true を返す", () => {
  const { grid } = gridOf("https://example.com/flip", { errorCorrectionLevel: "M" });
  const original = Uint8Array.from(grid.modules);
  for (let i = 0; i < grid.modules.length; i++) grid.modules[i] ^= 1;

  assert.strictEqual(normalizeInversion(grid), true);
  assert.deepStrictEqual(Uint8Array.from(grid.modules), original);
});

test("反転を戻せば、フォーマット情報も正しく読める", () => {
  const { qr, grid } = gridOf("https://example.com/flip-format", { errorCorrectionLevel: "H" });
  for (let i = 0; i < grid.modules.length; i++) grid.modules[i] ^= 1;

  normalizeInversion(grid);
  const analysis = analyzeGrid(grid);

  assert.strictEqual(analysis.ecLevel, "H");
  assert.strictEqual(analysis.maskPattern, qr.maskPattern);
  assert.strictEqual(analysis.formatBitErrors, 0);
});
