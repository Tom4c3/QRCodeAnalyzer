const test = require("node:test");
const assert = require("node:assert");
const QRCode = require("qrcode");
const { analyzeImageData } = require("../js/pipeline.js");
const { renderMatrixToGray, grayToRgba, tileGray } = require("./helpers/render.js");

function imageOf(text, options) {
  const qr = QRCode.create(text, options);
  const r = renderMatrixToGray(qr.modules, { scale: 6 });
  return { qr, rgba: grayToRgba(r.gray, r.width, r.height), width: r.width, height: r.height };
}

test("URLのQRを解析し、中身とパラメータをまとめて返す", () => {
  const { qr, rgba, width, height } = imageOf("https://example.com/report?id=42", {
    errorCorrectionLevel: "Q",
  });

  const [symbol] = analyzeImageData(rgba, width, height);

  assert.strictEqual(symbol.text, "https://example.com/report?id=42");
  assert.strictEqual(symbol.payload.type, "url");
  assert.strictEqual(symbol.payload.url, "https://example.com/report?id=42");
  assert.strictEqual(symbol.version, qr.version);
  assert.strictEqual(symbol.ecLevel, "Q");
  assert.strictEqual(symbol.maskPattern, qr.maskPattern);
  assert.strictEqual(symbol.formatBitErrors, 0);
});

test("エンコードモードと文字数を返す", () => {
  const { rgba, width, height } = imageOf("HELLO WORLD 123", { errorCorrectionLevel: "L" });
  const [symbol] = analyzeImageData(rgba, width, height);
  assert.deepStrictEqual(symbol.segments, [{ mode: "alphanumeric", length: 15 }]);
});

test("8ビットバイトモードは文字数ではなくバイト数で数える", () => {
  const { rgba, width, height } = imageOf("日本語", { errorCorrectionLevel: "M" });
  const [symbol] = analyzeImageData(rgba, width, height);
  assert.strictEqual(symbol.segments.length, 1);
  assert.ok(["byte", "kanji"].includes(symbol.segments[0].mode));
});

test("描画に使うモジュール行列と役割マップを返す", () => {
  const { qr, rgba, width, height } = imageOf("https://example.com/draw", { errorCorrectionLevel: "M" });
  const [symbol] = analyzeImageData(rgba, width, height);

  assert.strictEqual(symbol.size, qr.modules.size);
  assert.strictEqual(symbol.modules.length, qr.modules.size * qr.modules.size);
  for (let i = 0; i < symbol.modules.length; i++) {
    assert.strictEqual(symbol.modules[i], qr.modules.data[i] ? 1 : 0, `モジュール${i}`);
  }
  assert.strictEqual(symbol.roles[0][0], "finder");
});

test("自前解析のバージョンがjsQRの読み取り結果と一致したことを報告する", () => {
  const { rgba, width, height } = imageOf("https://example.com/agree", { errorCorrectionLevel: "H" });
  const [symbol] = analyzeImageData(rgba, width, height);
  assert.strictEqual(symbol.versionAgrees, true);
});

test("1枚に複数のQRがあれば、すべて解析して返す", () => {
  const texts = ["https://example.com/x", "WIFI:T:WPA;S:Office;P:secret;;", "090-1234-5678"];
  const tiles = texts.map((t) =>
    renderMatrixToGray(QRCode.create(t, { errorCorrectionLevel: "M" }).modules, { scale: 5 })
  );
  const sheet = tileGray(tiles, 24);

  const symbols = analyzeImageData(grayToRgba(sheet.gray, sheet.width, sheet.height), sheet.width, sheet.height);

  assert.strictEqual(symbols.length, 3);
  assert.deepStrictEqual(symbols.map((s) => s.text).sort(), texts.slice().sort());
  const wifi = symbols.find((s) => s.payload.type === "wifi");
  assert.strictEqual(wifi.payload.fields.ssid, "Office");
});

test("QRが無い画像では空の配列を返す", () => {
  const width = 100;
  const height = 100;
  const rgba = new Uint8ClampedArray(width * height * 4).fill(255);
  assert.deepStrictEqual(analyzeImageData(rgba, width, height), []);
});

// フォーマット情報が2箇所に書かれているのは、片方が汚れても読めるようにするため。
// 実際に片方を潰した画像で、読み取りもパラメータ解読も生き延びることを確かめる。
// （両方潰すとjsQR自身が読み取れなくなるので、それは検出できないケースになる）
test("フォーマット情報の片方が潰れた画像でも、内容とパラメータを両方返す", () => {
  const qr = QRCode.create("https://example.com/broken-format", { errorCorrectionLevel: "M" });
  const scale = 6;
  const quiet = 4;
  const r = renderMatrixToGray(qr.modules, { scale, quiet });
  const rgba = grayToRgba(r.gray, r.width, r.height);

  // 1組目のフォーマット情報だけを画素の上から塗り替える（データ領域には触れない）。
  const paint = (row, col, value) => {
    for (let y = 0; y < scale; y++) {
      for (let x = 0; x < scale; x++) {
        const i = (((row + quiet) * scale + y) * r.width + (col + quiet) * scale + x) * 4;
        rgba[i] = rgba[i + 1] = rgba[i + 2] = value;
      }
    }
  };
  for (let col = 0; col < 6; col++) paint(8, col, col % 2 ? 0 : 255);
  for (let row = 0; row < 6; row++) paint(row, 8, row % 2 ? 0 : 255);

  const symbols = analyzeImageData(rgba, r.width, r.height);

  assert.strictEqual(symbols.length, 1);
  assert.strictEqual(symbols[0].text, "https://example.com/broken-format");
  assert.strictEqual(symbols[0].ecLevel, "M");
  assert.strictEqual(symbols[0].maskPattern, qr.maskPattern);
  assert.strictEqual(symbols[0].formatSource, "secondary");
  assert.strictEqual(symbols[0].analysisError, null);
});

test("黒地に白のQRでも、パラメータまで正しく解析して反転を報告する", () => {
  const qr = QRCode.create("https://example.com/inverted-pipeline", { errorCorrectionLevel: "M" });
  const r = renderMatrixToGray(qr.modules, { scale: 6, dark: 255, light: 0 });

  const [symbol] = analyzeImageData(grayToRgba(r.gray, r.width, r.height), r.width, r.height);

  assert.strictEqual(symbol.text, "https://example.com/inverted-pipeline");
  assert.strictEqual(symbol.ecLevel, "M");
  assert.strictEqual(symbol.maskPattern, qr.maskPattern);
  assert.strictEqual(symbol.formatBitErrors, 0);
  assert.strictEqual(symbol.inverted, true);
  // 表示用のモジュール行列も、白地に黒の向きへ揃えて返す。
  for (let i = 0; i < symbol.modules.length; i++) {
    assert.strictEqual(symbol.modules[i], qr.modules.data[i] ? 1 : 0, `モジュール${i}`);
  }
});

test("通常のQRでは反転していないと報告する", () => {
  const { rgba, width, height } = imageOf("https://example.com/not-inverted", { errorCorrectionLevel: "L" });
  assert.strictEqual(analyzeImageData(rgba, width, height)[0].inverted, false);
});
