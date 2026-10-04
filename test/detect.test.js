const test = require("node:test");
const assert = require("node:assert");
const QRCode = require("qrcode");
const { detectAll, rgbaToGray } = require("../js/detect.js");
const { sampleModuleGrid } = require("../js/grid.js");
const { renderMatrixToGray, grayToRgba, tileGray } = require("./helpers/render.js");

function imageOf(text, options) {
  const qr = QRCode.create(text, options);
  const rendered = renderMatrixToGray(qr.modules, Object.assign({ scale: 6 }, options));
  return { qr, rendered, rgba: grayToRgba(rendered.gray, rendered.width, rendered.height) };
}

test("RGBA画像をグレースケールへ変換する", () => {
  const rgba = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]);
  const gray = rgbaToGray(rgba, 2, 1);
  assert.strictEqual(gray.length, 2);
  assert.strictEqual(gray[0], 255);
  assert.strictEqual(gray[1], 0);
});

test("色つきの画素も輝度へ落とす（緑がいちばん明るく効く）", () => {
  const rgba = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]);
  const gray = rgbaToGray(rgba, 3, 1);
  assert.ok(gray[1] > gray[0], "緑は赤より明るい");
  assert.ok(gray[0] > gray[2], "赤は青より明るい");
});

test("1枚の画像から1つのQRを検出して内容を返す", () => {
  const { qr, rgba, rendered } = imageOf("https://example.com/single", { errorCorrectionLevel: "M" });
  const found = detectAll(rgba, rendered.width, rendered.height);
  assert.strictEqual(found.length, 1);
  assert.strictEqual(found[0].text, "https://example.com/single");
  assert.strictEqual(found[0].version, qr.version);
});

test("検出した四隅からモジュール格子を取り直すと、元の行列と一致する", () => {
  const { qr, rgba, rendered } = imageOf("https://example.com/corners", { errorCorrectionLevel: "Q" });
  const found = detectAll(rgba, rendered.width, rendered.height);
  const gray = rgbaToGray(rgba, rendered.width, rendered.height);

  const grid = sampleModuleGrid(gray, rendered.width, rendered.height, found[0].quad, qr.modules.size);

  for (let row = 0; row < grid.size; row++) {
    for (let col = 0; col < grid.size; col++) {
      assert.strictEqual(grid.get(row, col), qr.modules.data[row * grid.size + col] ? 1 : 0, `(${row},${col})`);
    }
  }
});

test("1枚に3つ並んだQRを、すべて検出する", () => {
  const texts = ["https://example.com/a", "https://example.com/b", "12345678"];
  const tiles = texts.map((t) => renderMatrixToGray(QRCode.create(t, { errorCorrectionLevel: "M" }).modules, { scale: 5 }));
  const sheet = tileGray(tiles, 24);

  const found = detectAll(grayToRgba(sheet.gray, sheet.width, sheet.height), sheet.width, sheet.height);

  assert.strictEqual(found.length, 3);
  assert.deepStrictEqual(found.map((f) => f.text).sort(), texts.slice().sort());
});

test("複数検出しても、それぞれの四隅は別の場所を指す", () => {
  const tiles = ["one", "two"].map((t) =>
    renderMatrixToGray(QRCode.create(t, { errorCorrectionLevel: "L" }).modules, { scale: 5 })
  );
  const sheet = tileGray(tiles, 24);

  const found = detectAll(grayToRgba(sheet.gray, sheet.width, sheet.height), sheet.width, sheet.height);

  assert.strictEqual(found.length, 2);
  const centers = found.map((f) => f.quad.topLeft.x);
  assert.ok(Math.abs(centers[0] - centers[1]) > 50, "検出位置が離れていること");
});

test("QRが写っていない画像では空の配列を返す", () => {
  const width = 80;
  const height = 80;
  const rgba = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
  assert.deepStrictEqual(detectAll(rgba, width, height), []);
});

test("検出数の上限を超えて探し続けない", () => {
  const tiles = ["a", "b", "c"].map((t) =>
    renderMatrixToGray(QRCode.create(t, { errorCorrectionLevel: "L" }).modules, { scale: 5 })
  );
  const sheet = tileGray(tiles, 24);

  const found = detectAll(grayToRgba(sheet.gray, sheet.width, sheet.height), sheet.width, sheet.height, {
    maxSymbols: 2,
  });

  assert.strictEqual(found.length, 2);
});

test("白黒反転したQRも検出する", () => {
  const qr = QRCode.create("https://example.com/inverted", { errorCorrectionLevel: "M" });
  const rendered = renderMatrixToGray(qr.modules, { scale: 6, dark: 255, light: 0 });
  const found = detectAll(grayToRgba(rendered.gray, rendered.width, rendered.height), rendered.width, rendered.height);
  assert.strictEqual(found.length, 1);
  assert.strictEqual(found[0].text, "https://example.com/inverted");
});

// 窓をずらして走査する以上、画像が大きいほど窓の数は増える。QRが1つも無い画像では
// 「見つかったから打ち切る」が効かないので、探索が発散しないことを別に確かめておく。
const { scanLevels } = require("../js/detect.js");

test("大きな画像でも、粗いほうから4段ぶんの窓数は抑えられている", () => {
  const levels = scanLevels(2400, 1800);
  const count = levels.slice(0, 4).reduce((sum, level) => sum + level.length, 0);
  assert.ok(count < 120, `窓数 ${count} が多すぎる`);
});

test("窓が小さくなりすぎる段は作らない", () => {
  const levels = scanLevels(2400, 1800);
  const smallest = levels[levels.length - 1][0];
  assert.ok(smallest.w >= 80, `最小の窓が ${smallest.w} 画素`);
});

test("QRの無い雑然とした画像でも、走査を打ち切って空配列を返す", () => {
  const width = 1200;
  const height = 900;
  const rgba = new Uint8ClampedArray(width * height * 4);
  // 一様な白だと窓が全部飛ばされるので、コントラストのある模様で埋める。
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = (x * 7 + y * 13) % 255 < 128 ? 0 : 255;
      const i = (y * width + x) * 4;
      rgba[i] = rgba[i + 1] = rgba[i + 2] = v;
      rgba[i + 3] = 255;
    }
  }

  const started = Date.now();
  assert.deepStrictEqual(detectAll(rgba, width, height), []);
  assert.ok(Date.now() - started < 15000, "走査に時間がかかりすぎている");
});

test("走査回数の上限を渡すと、それ以上は探さない", () => {
  const tiles = ["a", "b", "c"].map((t) =>
    renderMatrixToGray(QRCode.create(t, { errorCorrectionLevel: "L" }).modules, { scale: 5 })
  );
  const sheet = tileGray(tiles, 24);
  const rgba = grayToRgba(sheet.gray, sheet.width, sheet.height);

  // 画像全体を1回走査するだけでは、複数QRのせいでjsQRは何も返さない。
  assert.deepStrictEqual(detectAll(rgba, sheet.width, sheet.height, { maxScans: 1 }), []);
  assert.strictEqual(detectAll(rgba, sheet.width, sheet.height).length, 3);
});
