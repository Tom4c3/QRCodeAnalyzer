/**
 * tools/gen-samples.js — 動作確認用のサンプル画像を samples/ に書き出す。
 *
 * 実行: node tools/gen-samples.js
 */
const fs = require("node:fs");
const path = require("node:path");
const QRCode = require("qrcode");
const { PNG } = require("pngjs");
const { renderMatrixToGray, tileGray } = require("../test/helpers/render.js");

const OUT_DIR = path.join(__dirname, "..", "samples");
fs.mkdirSync(OUT_DIR, { recursive: true });

function writeGrayPng(name, gray, width, height) {
  const png = new PNG({ width, height });
  for (let i = 0; i < width * height; i++) {
    png.data[i * 4] = gray[i];
    png.data[i * 4 + 1] = gray[i];
    png.data[i * 4 + 2] = gray[i];
    png.data[i * 4 + 3] = 255;
  }
  const file = path.join(OUT_DIR, name);
  fs.writeFileSync(file, PNG.sync.write(png));
  console.log("書き出し:", path.relative(process.cwd(), file), `${width}x${height}`);
}

function single(name, text, options) {
  const qr = QRCode.create(text, options);
  const r = renderMatrixToGray(qr.modules, { scale: options.scale || 8 });
  writeGrayPng(name, r.gray, r.width, r.height);
}

single("01-url.png", "https://example.com/products/12345?ref=qr", { errorCorrectionLevel: "M" });
single("02-url-high-ec.png", "https://example.com/", { errorCorrectionLevel: "H" });
single("03-wifi.png", "WIFI:T:WPA;S:Office-2F;P:s3cret-pass;;", { errorCorrectionLevel: "Q" });
single("04-vcard.png", "BEGIN:VCARD\r\nVERSION:3.0\r\nFN:山田太郎\r\nORG:株式会社サンプル\r\nTEL:03-1234-5678\r\nEMAIL:taro@example.com\r\nEND:VCARD", { errorCorrectionLevel: "M" });
single("05-tel.png", "tel:+81-3-1234-5678", { errorCorrectionLevel: "L" });
single("06-text-japanese.png", "会議室Aの予約はこちら", { errorCorrectionLevel: "M" });
single("07-large-version.png", "https://example.com/" + "path/".repeat(60), { errorCorrectionLevel: "M", scale: 5 });
single("08-numeric.png", "0123456789".repeat(4), { errorCorrectionLevel: "L" });

// 1枚に3つ並べたシート（複数検出の確認用）
const sheetTexts = [
  "https://example.com/a",
  "https://example.com/b",
  "https://example.com/c",
];
const tiles = sheetTexts.map((text) =>
  renderMatrixToGray(QRCode.create(text, { errorCorrectionLevel: "M" }).modules, { scale: 6 })
);
const sheet = tileGray(tiles, 32);
writeGrayPng("09-three-in-one.png", sheet.gray, sheet.width, sheet.height);

// 白黒反転（反転QRの確認用）
const inverted = QRCode.create("https://example.com/inverted", { errorCorrectionLevel: "M" });
const invertedImage = renderMatrixToGray(inverted.modules, { scale: 8, dark: 255, light: 0 });
writeGrayPng("10-inverted.png", invertedImage.gray, invertedImage.width, invertedImage.height);
