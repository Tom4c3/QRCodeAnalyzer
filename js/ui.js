/**
 * ui.js — 解析結果を画面に描く。
 *
 * QRの中身は他人が作った文字列なので、DOMは textContent と createElement だけで
 * 組み立てる（innerHTML には決して渡さない）。リンクにするのは payload.js が
 * http/https と判定したものだけ。
 */
(function (global) {
  "use strict";

  var QRA = global.QRA;

  // 誤り訂正レベルごとの、おおよその復元能力（規格の目安値）。
  var EC_RECOVERY = { L: "約7%", M: "約15%", Q: "約25%", H: "約30%" };

  var LEGEND = [
    { key: "finder", label: "ファインダパターン", css: "--role-finder" },
    { key: "separator", label: "分離パターン", css: "--role-separator" },
    { key: "timing", label: "タイミングパターン", css: "--role-timing" },
    { key: "alignment", label: "位置合わせパターン", css: "--role-alignment" },
    { key: "format", label: "フォーマット情報", css: "--role-format" },
    { key: "version", label: "バージョン情報", css: "--role-version" },
    { key: "dark", label: "固定の暗モジュール", css: "--role-dark" },
    { key: "data", label: "データコードワード", css: "--role-data" },
    { key: "ec", label: "誤り訂正コードワード", css: "--role-ec" },
    { key: "remainder", label: "残余ビット", css: "--role-remainder" },
  ];

  /** 色の定義はCSSに一本化してあるので、描画時に読み出して使う。 */
  function cssColor(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#888888";
  }

  function colorTable() {
    var colors = {};
    LEGEND.forEach(function (item) {
      colors[item.key] = cssColor(item.css);
    });
    return colors;
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function cell(text, className) {
    return el("td", className, text);
  }

  /* ---------- 一覧表 ---------- */

  function contentCell(symbol) {
    var td = el("td", "content-cell");
    if (symbol.payload.url) {
      var link = el("a", null, symbol.text);
      link.href = symbol.payload.url;
      link.target = "_blank";
      link.rel = "noreferrer noopener";
      td.appendChild(link);
    } else {
      td.textContent = symbol.text;
    }
    return td;
  }

  function thumbCell(entry) {
    var td = el("td");
    var img = el("img", "thumb");
    img.src = entry.dataUrl;
    img.alt = "";
    td.appendChild(img);
    return td;
  }

  function segmentsText(symbol) {
    if (!symbol.segments || symbol.segments.length === 0) return "—";
    return symbol.segments
      .map(function (s) {
        return QRA.modeLabel(s.mode) + " " + s.length;
      })
      .join(" + ");
  }

  /**
   * 結果テーブルを描き直す。
   * @param {HTMLElement} tbody
   * @param {object[]} entries main.js が持っている画像ごとの解析結果
   * @param {(entryIndex: number, symbolIndex: number) => void} onSelect
   */
  function renderTable(tbody, entries, onSelect) {
    tbody.textContent = "";

    entries.forEach(function (entry, entryIndex) {
      if (entry.error) {
        var errorRow = el("tr", "is-empty");
        errorRow.appendChild(thumbCell(entry));
        errorRow.appendChild(cell(entry.fileName, "filename"));
        var errorCell = cell("読み込みに失敗しました：" + entry.error, "warn");
        errorCell.colSpan = 6;
        errorRow.appendChild(errorCell);
        tbody.appendChild(errorRow);
        return;
      }

      if (entry.symbols.length === 0) {
        var emptyRow = el("tr", "is-empty");
        emptyRow.appendChild(thumbCell(entry));
        emptyRow.appendChild(cell(entry.fileName, "filename"));
        var emptyCell = cell("QRコードを検出できませんでした");
        emptyCell.colSpan = 6;
        emptyRow.appendChild(emptyCell);
        tbody.appendChild(emptyRow);
        return;
      }

      entry.symbols.forEach(function (symbol, symbolIndex) {
        var row = el("tr");
        row.dataset.entry = String(entryIndex);
        row.dataset.symbol = String(symbolIndex);

        row.appendChild(symbolIndex === 0 ? thumbCell(entry) : el("td"));

        var nameText = entry.fileName;
        if (entry.symbols.length > 1) nameText += "（" + (symbolIndex + 1) + "/" + entry.symbols.length + "）";
        row.appendChild(cell(nameText, "filename"));

        var typeCell = el("td");
        typeCell.appendChild(el("span", "badge", QRA.payloadLabel(symbol.payload.type)));
        row.appendChild(typeCell);

        row.appendChild(contentCell(symbol));
        row.appendChild(cell(symbol.version, "mono"));
        row.appendChild(cell(symbol.ecLevel || "—", "mono"));
        row.appendChild(cell(symbol.maskPattern === null ? "—" : symbol.maskPattern, "mono"));
        row.appendChild(cell(segmentsText(symbol)));

        row.addEventListener("click", function () {
          onSelect(entryIndex, symbolIndex);
        });
        tbody.appendChild(row);
      });
    });
  }

  function markSelected(tbody, entryIndex, symbolIndex) {
    Array.prototype.forEach.call(tbody.querySelectorAll("tr"), function (row) {
      var isSelected =
        row.dataset.entry === String(entryIndex) && row.dataset.symbol === String(symbolIndex);
      row.classList.toggle("is-selected", isSelected);
    });
  }

  /* ---------- 元画像と検出位置 ---------- */

  function drawPreview(canvas, entry, selectedIndex) {
    var maxWidth = 380;
    var scale = Math.min(1, maxWidth / entry.width);
    canvas.width = Math.round(entry.width * scale);
    canvas.height = Math.round(entry.height * scale);

    var ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(entry.image, 0, 0, canvas.width, canvas.height);

    entry.symbols.forEach(function (symbol, index) {
      var q = symbol.quad;
      ctx.beginPath();
      ctx.moveTo(q.topLeft.x * scale, q.topLeft.y * scale);
      ctx.lineTo(q.topRight.x * scale, q.topRight.y * scale);
      ctx.lineTo(q.bottomRight.x * scale, q.bottomRight.y * scale);
      ctx.lineTo(q.bottomLeft.x * scale, q.bottomLeft.y * scale);
      ctx.closePath();

      var isSelected = index === selectedIndex;
      ctx.lineWidth = isSelected ? 3 : 1.5;
      ctx.strokeStyle = isSelected ? cssColor("--accent") : "rgba(120, 130, 145, 0.85)";
      ctx.stroke();

      if (entry.symbols.length > 1) {
        ctx.fillStyle = ctx.strokeStyle;
        ctx.font = "bold 13px sans-serif";
        ctx.fillText(String(index + 1), q.topLeft.x * scale + 4, q.topLeft.y * scale - 4);
      }
    });
  }

  /* ---------- モジュール格子 ---------- */

  /** そのモジュールを塗る色を決める。データ領域はコードワードの種類で分ける。 */
  function moduleColor(symbol, colors, row, col, lookup) {
    var role = symbol.roles ? symbol.roles[row][col] : "data";
    if (role !== "data") return colors[role] || colors.data;
    var entry = lookup[row * symbol.size + col];
    if (!entry) return colors.data;
    if (entry.kind === "ec") return colors.ec;
    if (entry.kind === "remainder") return colors.remainder;
    return colors.data;
  }

  function dataLookup(symbol) {
    var lookup = {};
    if (symbol.dataModules) {
      symbol.dataModules.forEach(function (m) {
        lookup[m.row * symbol.size + m.col] = m;
      });
    }
    return lookup;
  }

  /** 黒モジュールは色そのまま、白モジュールは同じ色を薄く敷いて領域を示す。 */
  function fade(color, alpha) {
    var ctxColor = color.trim();
    if (ctxColor[0] === "#" && ctxColor.length === 7) {
      var r = parseInt(ctxColor.slice(1, 3), 16);
      var g = parseInt(ctxColor.slice(3, 5), 16);
      var b = parseInt(ctxColor.slice(5, 7), 16);
      return "rgba(" + r + ", " + g + ", " + b + ", " + alpha + ")";
    }
    return ctxColor;
  }

  function moduleValue(symbol, row, col, unmask) {
    var value = symbol.modules[row * symbol.size + col];
    if (!unmask) return value;
    if (symbol.maskPattern === null || symbol.maskPattern === undefined) return value;
    if (!symbol.roles || symbol.roles[row][col] !== "data") return value;
    return QRA.maskBit(symbol.maskPattern, row, col) ? 1 - value : value;
  }

  function drawModules(canvas, symbol, options) {
    var margin = 2; // クワイエットゾーンぶんの余白（モジュール単位）
    var cellSize = Math.max(3, Math.min(18, Math.floor(560 / (symbol.size + margin * 2))));
    var side = (symbol.size + margin * 2) * cellSize;

    canvas.width = side;
    canvas.height = side;
    canvas.style.width = side + "px";
    canvas.dataset.cell = String(cellSize);
    canvas.dataset.margin = String(margin);

    var ctx = canvas.getContext("2d");
    var colors = colorTable();
    var lookup = dataLookup(symbol);

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, side, side);

    for (var row = 0; row < symbol.size; row++) {
      for (var col = 0; col < symbol.size; col++) {
        var isDark = moduleValue(symbol, row, col, options.unmask);
        var color = options.colorize ? moduleColor(symbol, colors, row, col, lookup) : "#111111";
        ctx.fillStyle = isDark ? color : fade(color, 0.13);
        ctx.fillRect((col + margin) * cellSize, (row + margin) * cellSize, cellSize, cellSize);
      }
    }

    if (options.showGrid && cellSize >= 5) {
      ctx.strokeStyle = "rgba(128, 138, 150, 0.35)";
      ctx.lineWidth = 1;
      for (var i = 0; i <= symbol.size; i++) {
        var p = (i + margin) * cellSize + 0.5;
        ctx.beginPath();
        ctx.moveTo(p, margin * cellSize);
        ctx.lineTo(p, (symbol.size + margin) * cellSize);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(margin * cellSize, p);
        ctx.lineTo((symbol.size + margin) * cellSize, p);
        ctx.stroke();
      }
    }
  }

  function buildLegend() {
    var wrap = el("div", "legend");
    var colors = colorTable();
    LEGEND.forEach(function (item) {
      var entry = el("span", "legend-item");
      var swatch = el("span", "legend-swatch");
      swatch.style.background = colors[item.key];
      entry.appendChild(swatch);
      entry.appendChild(el("span", null, item.label));
      wrap.appendChild(entry);
    });
    return wrap;
  }

  /* ---------- パラメータ表 ---------- */

  function paramRow(table, label, value) {
    var tr = el("tr");
    tr.appendChild(el("th", null, label));
    tr.appendChild(value instanceof Node ? wrapCell(value) : el("td", null, value));
    table.appendChild(tr);
  }

  function wrapCell(node) {
    var td = el("td");
    td.appendChild(node);
    return td;
  }

  function formatSourceText(symbol) {
    if (!symbol.formatSource) return "読み取れなかった";
    var which = symbol.formatSource === "primary" ? "1組目" : "2組目";
    var errors = symbol.formatBitErrors === 0 ? "誤りなし" : symbol.formatBitErrors + "ビットを訂正";
    return which + "から取得（" + errors + "）";
  }

  function versionInfoText(symbol) {
    if (symbol.version < 7) return "バージョン7未満のため無し";
    if (!symbol.versionInfo) return "読み取れなかった";
    return (
      "バージョン " +
      symbol.versionInfo.version +
      "（寸法と" +
      (symbol.versionInfo.matchesSize ? "一致" : "不一致") +
      "）"
    );
  }

  function codewordText(symbol) {
    if (!symbol.counts) return "—";
    var c = symbol.counts;
    return (
      "全 " + c.total + "（データ " + c.data + " / 誤り訂正 " + c.ec + "）" +
      "・" + c.blocks + "ブロック・残余ビット " + c.remainderBits
    );
  }

  function buildParams(symbol) {
    var table = el("table", "param-table");

    paramRow(table, "種別", QRA.payloadLabel(symbol.payload.type));

    if (symbol.payload.url) {
      var link = el("a", null, symbol.text);
      link.href = symbol.payload.url;
      link.target = "_blank";
      link.rel = "noreferrer noopener";
      paramRow(table, "中身", link);
    } else {
      paramRow(table, "中身", symbol.text);
    }

    Object.keys(symbol.payload.fields).forEach(function (key) {
      paramRow(table, "└ " + key, String(symbol.payload.fields[key]));
    });

    paramRow(table, "バージョン", symbol.version + "（" + symbol.size + "×" + symbol.size + " モジュール）");
    paramRow(
      table,
      "誤り訂正レベル",
      symbol.ecLevel ? symbol.ecLevel + "（" + EC_RECOVERY[symbol.ecLevel] + "まで復元可能）" : "—"
    );
    paramRow(table, "マスクパターン", symbol.maskPattern === null ? "—" : String(symbol.maskPattern));
    paramRow(table, "フォーマット情報", formatSourceText(symbol));
    paramRow(table, "バージョン情報", versionInfoText(symbol));
    paramRow(table, "コードワード", codewordText(symbol));
    paramRow(table, "エンコードモード", segmentsText(symbol));
    paramRow(table, "二値化しきい値", symbol.threshold + "（0〜255の輝度）");
    if (symbol.inverted) paramRow(table, "白黒", "黒地に白（反転して解析）");

    if (symbol.analysisError) paramRow(table, "解析の警告", symbol.analysisError);
    if (!symbol.versionAgrees) paramRow(table, "解析の警告", "バージョン情報が読み取り結果と食い違っています");

    return table;
  }

  /* ---------- 詳細パネル ---------- */

  function renderDetail(container, entry, symbolIndex, tooltip) {
    var symbol = entry.symbols[symbolIndex];
    container.textContent = "";
    container.hidden = false;

    container.appendChild(el("p", "detail-title", entry.fileName));
    container.appendChild(
      el(
        "p",
        "detail-subtitle",
        "バージョン " + symbol.version + "・誤り訂正レベル " + (symbol.ecLevel || "不明") +
          "・マスクパターン " + (symbol.maskPattern === null ? "不明" : symbol.maskPattern)
      )
    );

    var grid = el("div", "detail-grid");

    var left = el("div");
    left.appendChild(el("h3", null, "元画像と検出位置"));
    var preview = el("canvas", "preview-canvas");
    left.appendChild(preview);
    left.appendChild(el("h3", null, "パラメータ"));
    left.appendChild(buildParams(symbol));

    var right = el("div");
    right.appendChild(el("h3", null, "モジュールの領域"));

    var toggles = el("div", "toggles");
    var options = { colorize: true, unmask: false, showGrid: false };
    var moduleCanvas = el("canvas", "module-canvas");

    [
      { key: "colorize", label: "領域を色分け" },
      { key: "unmask", label: "マスクを解除して表示" },
      { key: "showGrid", label: "格子線" },
    ].forEach(function (toggle) {
      var label = el("label");
      var input = document.createElement("input");
      input.type = "checkbox";
      input.checked = options[toggle.key];
      input.addEventListener("change", function () {
        options[toggle.key] = input.checked;
        drawModules(moduleCanvas, symbol, options);
      });
      label.appendChild(input);
      label.appendChild(el("span", null, toggle.label));
      toggles.appendChild(label);
    });
    right.appendChild(toggles);

    var wrap = el("div", "canvas-wrap");
    wrap.appendChild(moduleCanvas);
    right.appendChild(wrap);
    right.appendChild(buildLegend());
    right.appendChild(
      el("p", "hint", "マスにポインタを重ねると、その位置に何が書かれているかを表示します。")
    );

    grid.appendChild(left);
    grid.appendChild(right);
    container.appendChild(grid);

    drawPreview(preview, entry, symbolIndex);
    drawModules(moduleCanvas, symbol, options);
    attachTooltip(moduleCanvas, symbol, tooltip);
  }

  function attachTooltip(canvas, symbol, tooltip) {
    canvas.addEventListener("mousemove", function (event) {
      var rect = canvas.getBoundingClientRect();
      var cellSize = Number(canvas.dataset.cell);
      var margin = Number(canvas.dataset.margin);
      var col = Math.floor((event.clientX - rect.left) / cellSize) - margin;
      var row = Math.floor((event.clientY - rect.top) / cellSize) - margin;

      if (row < 0 || col < 0 || row >= symbol.size || col >= symbol.size) {
        tooltip.hidden = true;
        return;
      }

      tooltip.textContent = QRA.describeModule(symbol, row, col);
      tooltip.style.whiteSpace = "pre-line";
      tooltip.hidden = false;
      var x = Math.min(event.clientX + 14, window.innerWidth - tooltip.offsetWidth - 12);
      var y = Math.min(event.clientY + 16, window.innerHeight - tooltip.offsetHeight - 12);
      tooltip.style.left = x + "px";
      tooltip.style.top = y + "px";
    });

    canvas.addEventListener("mouseleave", function () {
      tooltip.hidden = true;
    });
  }

  global.QRA = Object.assign(global.QRA || {}, {
    renderTable: renderTable,
    renderDetail: renderDetail,
    markSelected: markSelected,
  });
})(typeof self !== "undefined" ? self : this);
