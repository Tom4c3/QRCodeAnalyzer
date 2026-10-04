const test = require("node:test");
const assert = require("node:assert");
const QRCode = require("qrcode");
const { perspectiveTransform, sampleModuleGrid } = require("../js/grid.js");
const { renderMatrixToGray } = require("./helpers/render.js");

const SQUARE = {
  topLeft: { x: 10, y: 20 },
  topRight: { x: 110, y: 20 },
  bottomRight: { x: 110, y: 120 },
  bottomLeft: { x: 10, y: 120 },
};

test("射影変換は単位正方形の四隅を四角形の四隅へ正確に写す", () => {
  const map = perspectiveTransform(SQUARE);
  assert.deepStrictEqual(map(0, 0), { x: 10, y: 20 });
  assert.deepStrictEqual(map(1, 0), { x: 110, y: 20 });
  assert.deepStrictEqual(map(1, 1), { x: 110, y: 120 });
  assert.deepStrictEqual(map(0, 1), { x: 10, y: 120 });
});

test("軸に平行な四角形なら中心は線形補間になる", () => {
  const map = perspectiveTransform(SQUARE);
  const p = map(0.5, 0.5);
  assert.ok(Math.abs(p.x - 60) < 1e-9, `x=${p.x}`);
  assert.ok(Math.abs(p.y - 70) < 1e-9, `y=${p.y}`);
});

test("台形でも四隅は正確に写り、中心は遠近に応じて偏る", () => {
  const trapezoid = {
    topLeft: { x: 20, y: 0 },
    topRight: { x: 80, y: 0 },
    bottomRight: { x: 100, y: 100 },
    bottomLeft: { x: 0, y: 100 },
  };
  const map = perspectiveTransform(trapezoid);
  assert.deepStrictEqual(map(0, 0), { x: 20, y: 0 });
  assert.deepStrictEqual(map(1, 1), { x: 100, y: 100 });
  const mid = map(0.5, 0.5);
  assert.ok(Math.abs(mid.x - 50) < 1e-9, `x=${mid.x}`);
  // 上底が短い台形では、v=0.5 の高さは幾何的な中央より上に来る。
  assert.ok(mid.y < 50, `y=${mid.y} は50より小さいはず`);
});

test("描き出したQR画像から、元のモジュール行列をそのまま復元できる", () => {
  const qr = QRCode.create("https://example.com/hello", { errorCorrectionLevel: "M" });
  const { gray, width, height, quad } = renderMatrixToGray(qr.modules, { scale: 6 });

  const grid = sampleModuleGrid(gray, width, height, quad, qr.modules.size);

  assert.strictEqual(grid.size, qr.modules.size);
  for (let row = 0; row < grid.size; row++) {
    for (let col = 0; col < grid.size; col++) {
      assert.strictEqual(
        grid.get(row, col),
        qr.modules.data[row * grid.size + col] ? 1 : 0,
        `(${row}, ${col}) のモジュールが一致しない`
      );
    }
  }
});

test("1モジュール1ピクセルまで縮んだ画像でも復元できる", () => {
  const qr = QRCode.create("TEST", { errorCorrectionLevel: "H" });
  const { gray, width, height, quad } = renderMatrixToGray(qr.modules, { scale: 1, quiet: 2 });

  const grid = sampleModuleGrid(gray, width, height, quad, qr.modules.size);

  let mismatches = 0;
  for (let row = 0; row < grid.size; row++) {
    for (let col = 0; col < grid.size; col++) {
      if (grid.get(row, col) !== (qr.modules.data[row * grid.size + col] ? 1 : 0)) mismatches++;
    }
  }
  assert.strictEqual(mismatches, 0);
});

test("コントラストが低い画像でも、明暗の相対差で二値化できる", () => {
  const qr = QRCode.create("LOW CONTRAST", { errorCorrectionLevel: "Q" });
  const { gray, width, height, quad } = renderMatrixToGray(qr.modules, {
    scale: 5,
    dark: 110,
    light: 160,
  });

  const grid = sampleModuleGrid(gray, width, height, quad, qr.modules.size);

  for (let row = 0; row < grid.size; row++) {
    for (let col = 0; col < grid.size; col++) {
      assert.strictEqual(grid.get(row, col), qr.modules.data[row * grid.size + col] ? 1 : 0);
    }
  }
});

test("画像の外を指す四角形を渡されても例外を投げずに処理する", () => {
  const qr = QRCode.create("EDGE", { errorCorrectionLevel: "L" });
  const { gray, width, height } = renderMatrixToGray(qr.modules, { scale: 4 });
  const outside = {
    topLeft: { x: -50, y: -50 },
    topRight: { x: width + 50, y: -50 },
    bottomRight: { x: width + 50, y: height + 50 },
    bottomLeft: { x: -50, y: height + 50 },
  };

  const grid = sampleModuleGrid(gray, width, height, outside, qr.modules.size);
  assert.strictEqual(grid.size, qr.modules.size);
});
