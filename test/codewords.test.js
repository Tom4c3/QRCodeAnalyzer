const test = require("node:test");
const assert = require("node:assert");
const { codewordCounts, assignCodewordRoles } = require("../js/codewords.js");

// ISO/IEC 18004 表7・表9 の既知の値。
test("バージョン1の各誤り訂正レベルのデータ/誤り訂正コードワード数", () => {
  assert.deepStrictEqual(
    ["L", "M", "Q", "H"].map((l) => {
      const c = codewordCounts(1, l);
      return [c.data, c.ec];
    }),
    [
      [19, 7],
      [16, 10],
      [13, 13],
      [9, 17],
    ]
  );
});

test("バージョン40-Lは データ2956 / 誤り訂正750 コードワード", () => {
  const c = codewordCounts(40, "L");
  assert.strictEqual(c.total, 3706);
  assert.strictEqual(c.data, 2956);
  assert.strictEqual(c.ec, 750);
});

test("誤り訂正ブロック数を返す", () => {
  assert.strictEqual(codewordCounts(1, "L").blocks, 1);
  assert.strictEqual(codewordCounts(5, "Q").blocks, 4);
  assert.strictEqual(codewordCounts(40, "H").blocks, 81);
});

// データ領域はコードワードの整数倍にならないことがあり、余った数モジュールは
// 「残余ビット」として常に0が詰められる。
test("残余ビット数はバージョンごとに規格どおり", () => {
  assert.strictEqual(codewordCounts(1, "L").remainderBits, 0);
  assert.strictEqual(codewordCounts(2, "M").remainderBits, 7);
  assert.strictEqual(codewordCounts(14, "Q").remainderBits, 3);
  assert.strictEqual(codewordCounts(21, "H").remainderBits, 4);
  assert.strictEqual(codewordCounts(40, "L").remainderBits, 0);
});

test("データ領域の各モジュールに、何番目のコードワードの何ビット目かを割り当てる", () => {
  const roles = assignCodewordRoles(1, "L");
  assert.strictEqual(roles.length, 208);
  assert.deepStrictEqual(roles[0], { index: 0, kind: "data", bit: 0 });
  assert.deepStrictEqual(roles[7], { index: 0, kind: "data", bit: 7 });
  assert.deepStrictEqual(roles[8], { index: 1, kind: "data", bit: 0 });
});

// インターリーブ後の並びは「全ブロックのデータ」→「全ブロックの誤り訂正」の順なので、
// データコードワード数を境に、そこから先はすべて誤り訂正になる。
test("データコードワードの後ろは誤り訂正コードワードになる", () => {
  const roles = assignCodewordRoles(1, "L");
  assert.deepStrictEqual(roles[19 * 8], { index: 19, kind: "ec", bit: 0 });
  assert.deepStrictEqual(roles[207], { index: 25, kind: "ec", bit: 7 });
});

test("コードワードに収まりきらない末尾は残余ビットとして印を付ける", () => {
  const roles = assignCodewordRoles(2, "M");
  assert.strictEqual(roles.length, 359);
  assert.deepStrictEqual(roles[351], { index: 43, kind: "ec", bit: 7 });
  assert.deepStrictEqual(roles[352], { index: null, kind: "remainder", bit: null });
  assert.deepStrictEqual(roles[358], { index: null, kind: "remainder", bit: null });
});

test("不正な誤り訂正レベルは例外にする", () => {
  assert.throws(() => codewordCounts(1, "X"), /誤り訂正レベル/);
});
