const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const QRCode = require("qrcode");
const { JSDOM } = require("jsdom");
const { analyzeImageData } = require("../js/pipeline.js");
const { renderMatrixToGray, grayToRgba } = require("./helpers/render.js");

const ROOT = path.join(__dirname, "..");

/**
 * index.html を jsdom で開き、スクリプトを実際の順で読み込む。
 * canvas は jsdom が実装を持たないので、呼び出しを記録するだけの偽物を挿す。
 * ここで見たいのは「描画処理が例外を出さずに最後まで走るか」なので十分。
 */
function openPage() {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const dom = new JSDOM(html, { pretendToBeVisual: true, runScripts: "outside-only" });
  const { window } = dom;

  const calls = [];
  window.HTMLCanvasElement.prototype.getContext = function () {
    return new Proxy(
      {},
      {
        get(target, prop) {
          if (prop in target) return target[prop];
          return function () {
            calls.push(String(prop));
          };
        },
        set(target, prop, value) {
          target[prop] = value;
          return true;
        },
      }
    );
  };

  for (const src of Array.from(html.matchAll(/<script src="([^"]+)"><\/script>/g)).map((m) => m[1])) {
    if (src.endsWith("main.js")) continue; // main.js はファイル入力が必要なので対象外
    window.eval(fs.readFileSync(path.join(ROOT, src), "utf8"));
  }

  return { window, document: window.document, calls };
}

const entryCache = new Map();

function sampleEntry(text, options) {
  const key = text + "|" + JSON.stringify(options || null);
  if (!entryCache.has(key)) {
    const qr = QRCode.create(text, options || { errorCorrectionLevel: "M" });
    const r = renderMatrixToGray(qr.modules, { scale: 6 });
    entryCache.set(key, {
      symbols: analyzeImageData(grayToRgba(r.gray, r.width, r.height), r.width, r.height),
      width: r.width,
      height: r.height,
    });
  }
  const cached = entryCache.get(key);
  return {
    fileName: "sample.png",
    dataUrl: "data:image/png;base64,",
    image: {},
    width: cached.width,
    height: cached.height,
    symbols: cached.symbols,
    error: null,
  };
}

test("結果テーブルを描き、URLはリンクとして出す", () => {
  const { window, document } = openPage();
  const tbody = document.getElementById("result-body");

  window.QRA.renderTable(tbody, [sampleEntry("https://example.com/table")], () => {});

  const rows = tbody.querySelectorAll("tr");
  assert.strictEqual(rows.length, 1);
  const link = rows[0].querySelector("a");
  assert.strictEqual(link.getAttribute("href"), "https://example.com/table");
  assert.strictEqual(link.textContent, "https://example.com/table");
  assert.strictEqual(link.getAttribute("rel"), "noreferrer noopener");
});

test("URLでない中身はリンクにしない", () => {
  const { window, document } = openPage();
  const tbody = document.getElementById("result-body");

  window.QRA.renderTable(tbody, [sampleEntry("javascript:alert(1)")], () => {});

  assert.strictEqual(tbody.querySelector("a"), null);
  assert.match(tbody.textContent, /javascript:alert\(1\)/);
});

test("QRの中身はHTMLとして解釈させない", () => {
  const { window, document } = openPage();
  const tbody = document.getElementById("result-body");

  window.QRA.renderTable(tbody, [sampleEntry("<img src=x onerror=alert(1)>")], () => {});

  assert.strictEqual(tbody.querySelector("img.thumb") !== null, true, "サムネイルは自前のもの");
  assert.strictEqual(tbody.querySelectorAll("img").length, 1, "中身から要素が作られていない");
  assert.match(tbody.textContent, /<img src=x onerror=alert\(1\)>/);
});

test("検出できなかった画像は、その旨の行を出す", () => {
  const { window, document } = openPage();
  const tbody = document.getElementById("result-body");
  const entry = { fileName: "blank.png", dataUrl: "", image: {}, width: 10, height: 10, symbols: [], error: null };

  window.QRA.renderTable(tbody, [entry], () => {});

  assert.match(tbody.textContent, /QRコードを検出できませんでした/);
});

test("読み込みに失敗した画像は、理由を添えて出す", () => {
  const { window, document } = openPage();
  const tbody = document.getElementById("result-body");
  const entry = { fileName: "broken.png", dataUrl: "", image: null, width: 0, height: 0, symbols: [], error: "画像として開けませんでした" };

  window.QRA.renderTable(tbody, [entry], () => {});

  assert.match(tbody.textContent, /画像として開けませんでした/);
});

test("行をクリックすると選択が通知される", () => {
  const { window, document } = openPage();
  const tbody = document.getElementById("result-body");
  const selections = [];

  window.QRA.renderTable(tbody, [sampleEntry("https://example.com/click")], (e, s) => selections.push([e, s]));
  tbody.querySelector("tr").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

  assert.deepStrictEqual(selections, [[0, 0]]);
});

test("詳細パネルにパラメータと凡例を描く", () => {
  const { window, document } = openPage();
  const entry = sampleEntry("https://example.com/detail", { errorCorrectionLevel: "Q" });
  const detail = document.getElementById("detail");

  window.QRA.renderDetail(detail, entry, 0, document.getElementById("tooltip"));

  assert.strictEqual(detail.hidden, false);
  assert.match(detail.textContent, /誤り訂正レベル/);
  assert.match(detail.textContent, /マスクパターン/);
  assert.match(detail.textContent, /コードワード/);
  assert.match(detail.textContent, /ファインダパターン/); // 凡例
  assert.strictEqual(detail.querySelectorAll("canvas").length, 2);
});

test("詳細パネルの描画で実際にキャンバスへ描いている", () => {
  const { window, document, calls } = openPage();
  const entry = sampleEntry("https://example.com/canvas");

  window.QRA.renderDetail(document.getElementById("detail"), entry, 0, document.getElementById("tooltip"));

  assert.ok(calls.includes("fillRect"), "モジュールを塗っている");
  assert.ok(calls.includes("stroke"), "検出枠を描いている");
});

test("表示の切り替えを操作しても例外にならない", () => {
  const { window, document } = openPage();
  const entry = sampleEntry("https://example.com/toggle");
  const detail = document.getElementById("detail");

  window.QRA.renderDetail(detail, entry, 0, document.getElementById("tooltip"));

  const boxes = detail.querySelectorAll('input[type="checkbox"]');
  assert.strictEqual(boxes.length, 3);
  boxes.forEach((box) => {
    box.checked = !box.checked;
    box.dispatchEvent(new window.Event("change"));
  });
});

test("モジュールにポインタを重ねると、その位置の説明が出る", () => {
  const { window, document } = openPage();
  const entry = sampleEntry("https://example.com/hover");
  const detail = document.getElementById("detail");
  const tooltip = document.getElementById("tooltip");

  window.QRA.renderDetail(detail, entry, 0, tooltip);

  const canvas = detail.querySelector("canvas.module-canvas");
  const cell = Number(canvas.dataset.cell);
  const margin = Number(canvas.dataset.margin);
  // 左上のファインダパターン (0,0) の真ん中あたりを指す
  canvas.dispatchEvent(
    new window.MouseEvent("mousemove", {
      bubbles: true,
      clientX: (margin + 0.5) * cell,
      clientY: (margin + 0.5) * cell,
    })
  );

  assert.strictEqual(tooltip.hidden, false);
  assert.match(tooltip.textContent, /ファインダパターン/);
});

test("シンボルの外へポインタが出るとツールチップを隠す", () => {
  const { window, document } = openPage();
  const entry = sampleEntry("https://example.com/leave");
  const detail = document.getElementById("detail");
  const tooltip = document.getElementById("tooltip");

  window.QRA.renderDetail(detail, entry, 0, tooltip);
  const canvas = detail.querySelector("canvas.module-canvas");
  canvas.dispatchEvent(new window.MouseEvent("mousemove", { bubbles: true, clientX: 0, clientY: 0 }));

  assert.strictEqual(tooltip.hidden, true);
});

test("選択中の行に印を付ける", () => {
  const { window, document } = openPage();
  const tbody = document.getElementById("result-body");
  window.QRA.renderTable(tbody, [sampleEntry("https://example.com/mark")], () => {});

  window.QRA.markSelected(tbody, 0, 0);

  assert.ok(tbody.querySelector("tr").classList.contains("is-selected"));
});
