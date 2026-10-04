const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const QRCode = require("qrcode");
const { renderMatrixToGray, grayToRgba } = require("./helpers/render.js");

const ROOT = path.join(__dirname, "..");

/** index.html が読み込んでいるスクリプトを、書かれている順に取り出す。 */
function scriptsFromIndexHtml() {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  return Array.from(html.matchAll(/<script src="([^"]+)"><\/script>/g)).map((m) => m[1]);
}

/**
 * ブラウザに近い環境を作り、index.html と同じ順にスクリプトを読み込む。
 * DOMに触れる ui.js / main.js は対象外。
 */
function loadInBrowserLikeContext() {
  const sandbox = { console, URLSearchParams, setTimeout, clearTimeout };
  sandbox.self = sandbox;
  vm.createContext(sandbox);

  const loaded = [];
  for (const src of scriptsFromIndexHtml()) {
    if (src.endsWith("ui.js") || src.endsWith("main.js")) continue;
    const code = fs.readFileSync(path.join(ROOT, src), "utf8");
    vm.runInContext(code, sandbox, { filename: src });
    loaded.push(src);
  }
  return { sandbox, loaded };
}

test("index.html に書かれた順でスクリプトを読み込める", () => {
  const { loaded } = loadInBrowserLikeContext();
  assert.ok(loaded.includes("js/tables.js"));
  assert.ok(loaded.includes("js/pipeline.js"));
  assert.ok(loaded.includes("js/describe.js"));
});

test("読み込み後、公開する関数がすべて window.QRA に揃っている", () => {
  const { sandbox } = loadInBrowserLikeContext();
  const expected = [
    "TABLES",
    "decodeFormatInfo",
    "decodeVersionInfo",
    "maskBit",
    "symbolSize",
    "buildModuleRoles",
    "dataModuleSequence",
    "formatInfoPositions",
    "versionInfoPositions",
    "codewordCounts",
    "assignCodewordRoles",
    "perspectiveTransform",
    "sampleModuleGrid",
    "classifyPayload",
    "detectAll",
    "rgbaToGray",
    "analyzeGrid",
    "analyzeImageData",
    "roleLabel",
    "payloadLabel",
    "modeLabel",
    "describeModule",
  ];
  for (const name of expected) {
    assert.ok(sandbox.QRA[name], `QRA.${name} が未定義`);
  }
});

test("jsQR がグローバルに載り、detect.js から使える", () => {
  const { sandbox } = loadInBrowserLikeContext();
  assert.strictEqual(typeof sandbox.jsQR, "function");
});

test("ブラウザ側の読み込み経路でも、画像を最後まで解析できる", () => {
  const { sandbox } = loadInBrowserLikeContext();
  const qr = QRCode.create("https://example.com/browser-path", { errorCorrectionLevel: "Q" });
  const r = renderMatrixToGray(qr.modules, { scale: 6 });
  const rgba = grayToRgba(r.gray, r.width, r.height);

  // sandbox 内の Uint8ClampedArray で受け取れるよう、値をそのまま渡す。
  const symbols = sandbox.QRA.analyzeImageData(rgba, r.width, r.height);

  assert.strictEqual(symbols.length, 1);
  assert.strictEqual(symbols[0].text, "https://example.com/browser-path");
  assert.strictEqual(symbols[0].ecLevel, "Q");
  assert.strictEqual(symbols[0].maskPattern, qr.maskPattern);
  assert.match(sandbox.QRA.describeModule(symbols[0], 0, 0), /ファインダパターン/);
});
