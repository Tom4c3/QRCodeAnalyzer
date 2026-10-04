const test = require("node:test");
const assert = require("node:assert");
const { symbolSize, buildModuleRoles, dataModuleSequence } = require("../js/layout.js");
const TABLES = require("../js/tables.js");

function countRole(roles, role) {
  let n = 0;
  for (const row of roles) for (const r of row) if (r === role) n++;
  return n;
}

test("シンボル寸法はバージョン×4＋17", () => {
  assert.strictEqual(symbolSize(1), 21);
  assert.strictEqual(symbolSize(7), 45);
  assert.strictEqual(symbolSize(40), 177);
});

test("三隅のファインダパターンは7×7で計147モジュール", () => {
  const roles = buildModuleRoles(1);
  assert.strictEqual(roles[0][0], "finder");
  assert.strictEqual(roles[6][6], "finder");
  assert.strictEqual(roles[0][20], "finder");
  assert.strictEqual(roles[20][0], "finder");
  assert.strictEqual(countRole(roles, "finder"), 147);
});

test("ファインダパターンの外周1モジュールは分離パターン", () => {
  const roles = buildModuleRoles(1);
  assert.strictEqual(roles[7][0], "separator");
  assert.strictEqual(roles[0][7], "separator");
  assert.strictEqual(roles[7][7], "separator");
  assert.strictEqual(roles[13][0], "separator");
});

test("タイミングパターンは6行目と6列目を走る", () => {
  const roles = buildModuleRoles(1);
  assert.strictEqual(roles[6][8], "timing");
  assert.strictEqual(roles[6][12], "timing");
  assert.strictEqual(roles[8][6], "timing");
  assert.strictEqual(roles[12][6], "timing");
});

test("フォーマット情報は8行目・8列目に2組（計31モジュール、うち1つは固定暗モジュール）", () => {
  const roles = buildModuleRoles(1);
  assert.strictEqual(roles[8][0], "format");
  assert.strictEqual(roles[8][8], "format");
  assert.strictEqual(roles[0][8], "format");
  assert.strictEqual(roles[8][20], "format");
  assert.strictEqual(countRole(roles, "format"), 30);
});

test("タイミングパターンが通る位置はフォーマット情報にしない", () => {
  const roles = buildModuleRoles(1);
  assert.strictEqual(roles[6][8], "timing");
  assert.strictEqual(roles[8][6], "timing");
});

test("固定の暗モジュールは (4×バージョン+9, 8) にひとつだけある", () => {
  const roles1 = buildModuleRoles(1);
  assert.strictEqual(roles1[13][8], "dark");
  assert.strictEqual(countRole(roles1, "dark"), 1);

  const roles7 = buildModuleRoles(7);
  assert.strictEqual(roles7[37][8], "dark");
});

test("バージョン1には位置合わせパターンが無い", () => {
  assert.strictEqual(countRole(buildModuleRoles(1), "alignment"), 0);
});

test("バージョン2の位置合わせパターンは (18,18) 中心の5×5がひとつ", () => {
  const roles = buildModuleRoles(2);
  assert.strictEqual(roles[18][18], "alignment");
  assert.strictEqual(roles[16][16], "alignment");
  assert.strictEqual(roles[20][20], "alignment");
  assert.strictEqual(roles[15][15], "data");
  assert.strictEqual(countRole(roles, "alignment"), 25);
});

test("バージョン7の位置合わせパターンは6個（ファインダと重なる3箇所を除く）", () => {
  assert.strictEqual(countRole(buildModuleRoles(7), "alignment"), 6 * 25);
});

test("バージョン情報はバージョン7以上にだけ、6×3の塊が2組ある", () => {
  assert.strictEqual(countRole(buildModuleRoles(6), "version"), 0);

  const roles = buildModuleRoles(7);
  assert.strictEqual(roles[0][34], "version");
  assert.strictEqual(roles[5][36], "version");
  assert.strictEqual(roles[34][0], "version");
  assert.strictEqual(roles[36][5], "version");
  assert.strictEqual(countRole(roles, "version"), 2 * 18);
});

// 機能パターン以外の全モジュールがデータ・誤り訂正の格納場所になる。
// 規格の「総コードワード数×8＋残余ビット」と一致すれば、配置の計算が正しい。
test("データ領域のモジュール数が規格の総コードワード数と整合する", () => {
  const remainderBits = { 1: 0, 2: 7, 7: 0, 14: 3, 21: 4, 28: 3, 35: 0, 40: 0 };
  for (const v of [1, 2, 7, 14, 21, 28, 35, 40]) {
    const expected = TABLES.totalCodewords[v] * 8 + remainderBits[v];
    assert.strictEqual(
      countRole(buildModuleRoles(v), "data"),
      expected,
      `バージョン${v}のデータ領域モジュール数`
    );
  }
});

test("データ読み出し順は右下から始まり、2列ずつジグザグに上る", () => {
  const seq = dataModuleSequence(1);
  assert.deepStrictEqual(seq.slice(0, 4), [
    { row: 20, col: 20 },
    { row: 20, col: 19 },
    { row: 19, col: 20 },
    { row: 19, col: 19 },
  ]);
});

test("データ読み出し順の長さはデータ領域のモジュール数と一致する", () => {
  for (const v of [1, 2, 7, 40]) {
    assert.strictEqual(dataModuleSequence(v).length, countRole(buildModuleRoles(v), "data"));
  }
});

test("データ読み出し順は6列目（縦タイミングパターン）を飛ばす", () => {
  const seq = dataModuleSequence(1);
  assert.ok(seq.every((p) => p.col !== 6));
});

test("データ読み出し順に重複が無い", () => {
  const seq = dataModuleSequence(7);
  const seen = new Set(seq.map((p) => p.row + "," + p.col));
  assert.strictEqual(seen.size, seq.length);
});
