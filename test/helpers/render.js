/**
 * テスト用: QRのモジュール行列を、実際の画像に近いピクセル配列へ描き出す。
 * 解析側のテストで「答えが分かっている画像」を用意するために使う。
 */

/**
 * @param {{size: number, data: Uint8Array}} matrix qrcodeパッケージが返すモジュール行列（1が黒）
 * @param {{scale?: number, quiet?: number, dark?: number, light?: number}} [opts]
 * @returns {{gray: Uint8ClampedArray, width: number, height: number, quad: object}}
 */
function renderMatrixToGray(matrix, opts) {
  const options = opts || {};
  const scale = options.scale || 4;
  const quiet = options.quiet === undefined ? 4 : options.quiet;
  const dark = options.dark === undefined ? 0 : options.dark;
  const light = options.light === undefined ? 255 : options.light;

  const size = matrix.size;
  const width = (size + quiet * 2) * scale;
  const height = width;
  const gray = new Uint8ClampedArray(width * height).fill(light);

  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (!matrix.data[row * size + col]) continue;
      const y0 = (row + quiet) * scale;
      const x0 = (col + quiet) * scale;
      for (let y = y0; y < y0 + scale; y++) {
        for (let x = x0; x < x0 + scale; x++) gray[y * width + x] = dark;
      }
    }
  }

  const lo = quiet * scale;
  const hi = (quiet + size) * scale;
  const quad = {
    topLeft: { x: lo, y: lo },
    topRight: { x: hi, y: lo },
    bottomRight: { x: hi, y: hi },
    bottomLeft: { x: lo, y: hi },
  };

  return { gray, width, height, quad };
}

/** グレースケール配列を、jsQRが受け取るRGBA配列へ変換する。 */
function grayToRgba(gray, width, height) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = gray[i];
    rgba[i * 4 + 1] = gray[i];
    rgba[i * 4 + 2] = gray[i];
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}

/** 複数のQR画像を1枚のグレースケール画像へ横に並べる（隙間は白）。 */
function tileGray(tiles, gap) {
  const space = gap === undefined ? 16 : gap;
  const width = tiles.reduce((sum, t) => sum + t.width, 0) + space * (tiles.length + 1);
  const height = Math.max(...tiles.map((t) => t.height)) + space * 2;
  const gray = new Uint8ClampedArray(width * height).fill(255);

  let offsetX = space;
  for (const tile of tiles) {
    for (let y = 0; y < tile.height; y++) {
      for (let x = 0; x < tile.width; x++) {
        gray[(y + space) * width + (x + offsetX)] = tile.gray[y * tile.width + x];
      }
    }
    offsetX += tile.width + space;
  }

  return { gray, width, height };
}

module.exports = { renderMatrixToGray, grayToRgba, tileGray };
