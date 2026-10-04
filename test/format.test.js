const test = require("node:test");
const assert = require("node:assert");
const { decodeFormatInfo, decodeVersionInfo, maskBit } = require("../js/format.js");

// ISO/IEC 18004 の付表にある「フォーマット情報15ビット」の既知の値。
// 下位10ビットはBCH(15,5)の検査ビットで、全体が 0x5412 でマスクされている。
test("フォーマット情報 0x5412 は 誤り訂正レベルM・マスク0", () => {
  assert.deepStrictEqual(decodeFormatInfo(0x5412), {
    ecLevel: "M",
    maskPattern: 0,
    bitErrors: 0,
  });
});

test("フォーマット情報 0x77C4 は 誤り訂正レベルL・マスク0", () => {
  const r = decodeFormatInfo(0x77c4);
  assert.strictEqual(r.ecLevel, "L");
  assert.strictEqual(r.maskPattern, 0);
});

test("フォーマット情報 0x355F は 誤り訂正レベルQ・マスク0", () => {
  const r = decodeFormatInfo(0x355f);
  assert.strictEqual(r.ecLevel, "Q");
  assert.strictEqual(r.maskPattern, 0);
});

test("フォーマット情報 0x083B は 誤り訂正レベルH・マスク7", () => {
  const r = decodeFormatInfo(0x083b);
  assert.strictEqual(r.ecLevel, "H");
  assert.strictEqual(r.maskPattern, 7);
});

test("1ビット化けたフォーマット情報をBCH復号で訂正し、訂正数を報告する", () => {
  const r = decodeFormatInfo(0x5412 ^ 0x0001);
  assert.strictEqual(r.ecLevel, "M");
  assert.strictEqual(r.maskPattern, 0);
  assert.strictEqual(r.bitErrors, 1);
});

test("3ビット化けても訂正できる", () => {
  const r = decodeFormatInfo(0x083b ^ 0b1010100);
  assert.strictEqual(r.ecLevel, "H");
  assert.strictEqual(r.maskPattern, 7);
  assert.strictEqual(r.bitErrors, 3);
});

test("訂正能力を超えて壊れたフォーマット情報は復号失敗を返す", () => {
  assert.strictEqual(decodeFormatInfo(0x0000), null);
});

// バージョン情報18ビット（バージョン7以上のみ配置される）。BCH(18,6)、マスクなし。
test("バージョン情報 0x07C94 はバージョン7", () => {
  const r = decodeVersionInfo(0x07c94);
  assert.strictEqual(r.version, 7);
  assert.strictEqual(r.bitErrors, 0);
});

test("バージョン情報 0x28C69 はバージョン40", () => {
  assert.strictEqual(decodeVersionInfo(0x28c69).version, 40);
});

test("1ビット化けたバージョン情報を訂正する", () => {
  const r = decodeVersionInfo(0x07c94 ^ 0x0002);
  assert.strictEqual(r.version, 7);
  assert.strictEqual(r.bitErrors, 1);
});

test("壊れすぎたバージョン情報は復号失敗を返す", () => {
  assert.strictEqual(decodeVersionInfo(0x3ffff), null);
});

// マスクは「データ領域の白黒を規則的に反転させる」8種類の関数。
// 条件が真のモジュールが反転する。
test("マスク0は (行+列) が偶数のとき反転する", () => {
  assert.strictEqual(maskBit(0, 0, 0), true);
  assert.strictEqual(maskBit(0, 0, 1), false);
  assert.strictEqual(maskBit(0, 1, 1), true);
});

test("マスク1は行が偶数のとき反転する", () => {
  assert.strictEqual(maskBit(1, 0, 5), true);
  assert.strictEqual(maskBit(1, 1, 5), false);
});

test("マスク4は (行÷2 + 列÷3) の整数部の和が偶数のとき反転する", () => {
  assert.strictEqual(maskBit(4, 0, 0), true);
  assert.strictEqual(maskBit(4, 2, 0), false);
  assert.strictEqual(maskBit(4, 0, 3), false);
});

test("マスク7は ((行+列)%2 + (行×列)%3) が偶数のとき反転する", () => {
  assert.strictEqual(maskBit(7, 0, 0), true);
  assert.strictEqual(maskBit(7, 0, 1), false);
});
