/**
 * main.js — 画面の入り口。ファイルを受け取って解析にかけ、結果を描かせる。
 *
 * 画像はすべてブラウザの中だけで扱う。FileReader でデータURLにしてから
 * canvas に描き、画素を取り出す（データURLなら file:// で開いても
 * canvas が汚染されず getImageData が使える）。
 */
(function () {
  "use strict";

  // 巨大な写真をそのまま走査すると遅いので、長辺をここまでに縮めてから解析する。
  // 画面のスクリーンショット程度なら等倍のまま通る大きさ。
  var MAX_ANALYSIS_SIDE = 2400;

  var dropzone = document.getElementById("dropzone");
  var fileInput = document.getElementById("file-input");
  var statusLine = document.getElementById("status");
  var results = document.getElementById("results");
  var tbody = document.getElementById("result-body");
  var detail = document.getElementById("detail");
  var tooltip = document.getElementById("tooltip");
  var clearButton = document.getElementById("clear-button");

  var entries = [];
  var selected = null;

  function setStatus(text, isError) {
    statusLine.textContent = text;
    statusLine.classList.toggle("is-error", Boolean(isError));
  }

  function readAsDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        resolve(reader.result);
      };
      reader.onerror = function () {
        reject(new Error("ファイルを読めませんでした"));
      };
      reader.readAsDataURL(file);
    });
  }

  function loadImage(dataUrl) {
    return new Promise(function (resolve, reject) {
      var image = new Image();
      image.onload = function () {
        resolve(image);
      };
      image.onerror = function () {
        reject(new Error("画像として開けませんでした"));
      };
      image.src = dataUrl;
    });
  }

  /** 解析用の画素を取り出す。大きすぎる画像は長辺を基準に縮める。 */
  function toImageData(image) {
    var scale = Math.min(1, MAX_ANALYSIS_SIDE / Math.max(image.naturalWidth, image.naturalHeight));
    var width = Math.max(1, Math.round(image.naturalWidth * scale));
    var height = Math.max(1, Math.round(image.naturalHeight * scale));

    var canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    var ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height); // 透過PNGの背景を白として扱う
    ctx.drawImage(image, 0, 0, width, height);

    return ctx.getImageData(0, 0, width, height);
  }

  function analyzeFile(file) {
    return readAsDataUrl(file)
      .then(loadImage)
      .then(function (image) {
        var imageData = toImageData(image);
        var symbols = window.QRA.analyzeImageData(imageData.data, imageData.width, imageData.height);
        return {
          fileName: file.name,
          dataUrl: image.src,
          image: image,
          width: imageData.width,
          height: imageData.height,
          symbols: symbols,
          error: null,
        };
      })
      .catch(function (error) {
        return {
          fileName: file.name,
          dataUrl: "",
          image: null,
          width: 0,
          height: 0,
          symbols: [],
          error: error.message,
        };
      });
  }

  function select(entryIndex, symbolIndex) {
    selected = { entryIndex: entryIndex, symbolIndex: symbolIndex };
    window.QRA.markSelected(tbody, entryIndex, symbolIndex);
    window.QRA.renderDetail(detail, entries[entryIndex], symbolIndex, tooltip);
    detail.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function refresh() {
    results.hidden = entries.length === 0;
    window.QRA.renderTable(tbody, entries, select);
    if (selected) window.QRA.markSelected(tbody, selected.entryIndex, selected.symbolIndex);
  }

  function summarize() {
    var symbolCount = entries.reduce(function (sum, entry) {
      return sum + entry.symbols.length;
    }, 0);
    var missing = entries.filter(function (entry) {
      return !entry.error && entry.symbols.length === 0;
    }).length;

    var text = "画像 " + entries.length + " 枚 / QRコード " + symbolCount + " 個";
    if (missing > 0) text += "（うち " + missing + " 枚は検出できず）";
    setStatus(text);
  }

  async function handleFiles(fileList) {
    var files = Array.prototype.filter.call(fileList, function (file) {
      return file.type.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp)$/i.test(file.name);
    });

    if (files.length === 0) {
      setStatus("画像ファイルが見つかりませんでした", true);
      return;
    }

    for (var i = 0; i < files.length; i++) {
      setStatus("解析中… " + (i + 1) + " / " + files.length + "：" + files[i].name);
      // 1枚ずつ処理して、途中経過が画面に出るようにする。
      entries.push(await analyzeFile(files[i]));
      refresh();
    }

    summarize();
  }

  /* ---------- イベント ---------- */

  dropzone.addEventListener("click", function (event) {
    // fileInput.click() が発火するクリックもここへ上がってくる。
    // そのまま処理すると自分自身を呼び続けてしまうので、入力欄由来なら何もしない。
    if (event.target === fileInput) return;
    fileInput.click();
  });

  dropzone.addEventListener("keydown", function (event) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      fileInput.click();
    }
  });

  fileInput.addEventListener("change", function () {
    handleFiles(fileInput.files);
    fileInput.value = ""; // 同じファイルをもう一度選べるようにする
  });

  ["dragenter", "dragover"].forEach(function (name) {
    dropzone.addEventListener(name, function (event) {
      event.preventDefault();
      dropzone.classList.add("is-dragging");
    });
  });

  ["dragleave", "drop"].forEach(function (name) {
    dropzone.addEventListener(name, function (event) {
      event.preventDefault();
      dropzone.classList.remove("is-dragging");
    });
  });

  dropzone.addEventListener("drop", function (event) {
    if (event.dataTransfer && event.dataTransfer.files.length) handleFiles(event.dataTransfer.files);
  });

  // ページのどこにドロップしても、ブラウザが画像を開いてしまわないようにする。
  ["dragover", "drop"].forEach(function (name) {
    window.addEventListener(name, function (event) {
      if (event.target !== dropzone && !dropzone.contains(event.target)) event.preventDefault();
    });
  });

  clearButton.addEventListener("click", function () {
    entries = [];
    selected = null;
    detail.hidden = true;
    detail.textContent = "";
    refresh();
    setStatus("");
  });
})();
