// Đếm thép ngay trong trình duyệt (bản web cho iPhone). Port 1:1 của app Android
// (mobile/lib/features/rebar_count/data/on_device/*.dart), vốn mô phỏng backend Python
// (backend/app/rebar/onnx_counter.py, selector.py): chạm -> model chọn bó -> vùng;
// cắt + che ngoài vùng -> model đếm 2 lượt theo cỡ đầu thép. Ảnh không rời máy.
/* global ort */

export const MAX_DECODE_LONG_SIDE = 3264; // app Android 4032; Safari iOS giới hạn bộ nhớ canvas

// ---------- Ảnh RGBA ----------
export class RgbaImage {
  constructor(width, height, data) {
    this.width = width; this.height = height;
    this.data = data || new Uint8ClampedArray(width * height * 4);
  }
}

/** Giải mã file ảnh (đã xoay theo EXIF như trình duyệt hiển thị), cạnh dài <= maxLong. */
export async function decodeFile(file, maxLong = MAX_DECODE_LONG_SIDE) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    const w0 = img.naturalWidth, h0 = img.naturalHeight;
    const s = Math.min(1, maxLong / Math.max(w0, h0));
    const w = Math.max(1, Math.round(w0 * s)), h = Math.max(1, Math.round(h0 * s));
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const g = c.getContext("2d", { willReadFrequently: true });
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
    g.drawImage(img, 0, 0, w, h);
    const data = g.getImageData(0, 0, w, h).data;
    c.width = c.height = 1; // trả bộ nhớ canvas sớm (Safari)
    return new RgbaImage(w, h, data);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function crop(src, x1, y1, x2, y2) {
  const w = x2 - x1, h = y2 - y1;
  const out = new RgbaImage(w, h);
  for (let y = 0; y < h; y++) {
    const from = ((y1 + y) * src.width + x1) * 4;
    out.data.set(src.data.subarray(from, from + w * 4), y * w * 4);
  }
  return out;
}

/** RGB = 0 ngoài đa giác (quy tắc chẵn-lẻ, tâm điểm ảnh). */
export function maskOutside(img, poly) {
  const n = poly.length;
  for (let y = 0; y < img.height; y++) {
    const cy = y + 0.5;
    const xs = [];
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const [ax, ay] = poly[i], [bx, by] = poly[j];
      if ((ay > cy) !== (by > cy)) xs.push(ax + (cy - ay) * (bx - ax) / (by - ay));
    }
    xs.sort((a, b) => a - b);
    let inside = false, k = 0;
    for (let x = 0; x < img.width; x++) {
      const cx = x + 0.5;
      while (k < xs.length && xs[k] <= cx) { inside = !inside; k++; }
      if (!inside) {
        const o = (y * img.width + x) * 4;
        img.data[o] = 0; img.data[o + 1] = 0; img.data[o + 2] = 0;
      }
    }
  }
}

/** Thu nhỏ/phóng kiểu PIL BILINEAR (tam giác, giãn khi thu nhỏ), tách 2 trục. */
export function resize(src, w, h) {
  if (w === src.width && h === src.height) return src;
  const tmp = resizeAxis(src.data, src.width, src.height, w, true);
  return new RgbaImage(w, h, resizeAxis(tmp, w, src.height, h, false));
}

function resizeAxis(data, srcW, srcH, dst, horizontal) {
  const srcLen = horizontal ? srcW : srcH;
  const scale = srcLen / dst;
  const support = Math.max(1, scale);
  const outW = horizontal ? dst : srcW, outH = horizontal ? srcH : dst;
  const out = new Uint8ClampedArray(outW * outH * 4);
  const starts = new Int32Array(dst), weights = new Array(dst);
  for (let i = 0; i < dst; i++) {
    const center = (i + 0.5) * scale;
    const lo = Math.max(0, Math.floor(center - support));
    const hi = Math.min(srcLen, Math.ceil(center + support));
    const ws = new Float64Array(hi - lo);
    let sum = 0;
    for (let s = lo; s < hi; s++) {
      const v = Math.max(0, 1 - Math.abs(s + 0.5 - center) / support);
      ws[s - lo] = v; sum += v;
    }
    if (sum > 0) for (let t = 0; t < ws.length; t++) ws[t] /= sum;
    starts[i] = lo; weights[i] = ws;
  }
  const lines = horizontal ? srcH : srcW;
  for (let line = 0; line < lines; line++) {
    for (let i = 0; i < dst; i++) {
      const ws = weights[i], lo = starts[i];
      let r = 0, g = 0, b = 0, a = 0;
      for (let t = 0; t < ws.length; t++) {
        const wt = ws[t];
        if (wt === 0) continue;
        const s = lo + t;
        const o = horizontal ? (line * srcW + s) * 4 : (s * srcW + line) * 4;
        r += data[o] * wt; g += data[o + 1] * wt; b += data[o + 2] * wt; a += data[o + 3] * wt;
      }
      const o = horizontal ? (line * outW + i) * 4 : (i * outW + line) * 4;
      out[o] = Math.round(r); out[o + 1] = Math.round(g); out[o + 2] = Math.round(b); out[o + 3] = Math.round(a);
    }
  }
  return out;
}

/** Tensor NCHW: ảnh dán góc trên-trái nền đen padW x padH, chuẩn hoá mean/std, thêm kênh extra. */
export function toNchw(img, padW, padH, mean, std, extra = []) {
  const plane = padW * padH;
  const out = new Float32Array(plane * (3 + extra.length));
  for (let c = 0; c < 3; c++) out.fill((0 - mean[c]) / std[c], c * plane, (c + 1) * plane);
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const o = (y * img.width + x) * 4, p = y * padW + x;
      for (let c = 0; c < 3; c++) out[c * plane + p] = (img.data[o + c] / 255 - mean[c]) / std[c];
    }
  }
  extra.forEach((ch, e) => out.set(ch, (3 + e) * plane));
  return out;
}

// ---------- Hậu xử lý ----------
export function decodePeaks(heat, w, h, threshold, stride) {
  const out = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = heat[y * w + x];
      if (v < threshold) continue;
      let isMax = true;
      for (let dy = -1; dy <= 1 && isMax; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const ny = y + dy, nx = x + dx;
          if (ny < 0 || ny >= h || nx < 0 || nx >= w) continue;
          if (heat[ny * w + nx] > v) { isMax = false; break; }
        }
      }
      if (!isMax) continue;
      let sum = 0, sx = 0, sy = 0;
      for (let ny = Math.max(0, y - 1); ny < Math.min(h, y + 2); ny++) {
        for (let nx = Math.max(0, x - 1); nx < Math.min(w, x + 2); nx++) {
          const p = heat[ny * w + nx];
          sum += p; sx += p * nx; sy += p * ny;
        }
      }
      const gx = sum > 0 ? sx / sum : x, gy = sum > 0 ? sy / sum : y;
      out.push({ x: gx * stride + 1.5, y: gy * stride + 1.5, score: v });
    }
  }
  return out;
}

export function medianNnDistance(pts, minPoints) {
  if (pts.length < minPoints) return null;
  const nn = new Float64Array(pts.length);
  for (let i = 0; i < pts.length; i++) {
    let best = Infinity;
    for (let j = 0; j < pts.length; j++) {
      if (i === j) continue;
      const dx = pts[i].x - pts[j].x, dy = pts[i].y - pts[j].y;
      const d2 = dx * dx + dy * dy;
      if (d2 < best) best = d2;
    }
    nn[i] = Math.sqrt(best);
  }
  const s = Array.from(nn).sort((a, b) => a - b), m = s.length;
  return m % 2 ? s[(m - 1) / 2] : (s[m / 2 - 1] + s[m / 2]) / 2;
}

export function promptChannel(h, w, x, y, sigma) {
  const out = new Float32Array(h * w), inv = 1 / (2 * sigma * sigma);
  for (let yy = 0; yy < h; yy++) {
    const dy2 = (yy - y) * (yy - y);
    for (let xx = 0; xx < w; xx++) out[yy * w + xx] = Math.exp(-((xx - x) * (xx - x) + dy2) * inv);
  }
  return out;
}

export function convexHull(pts) {
  if (pts.length < 3) return null;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  const hull = [...lower.slice(0, -1), ...upper.slice(0, -1)];
  return hull.length >= 3 ? hull : null;
}

/** Bao lồi (px đầu vào) của vùng mask chứa (hoặc gần nhất) điểm chạm. */
export function maskToPolygon(prob, w, h, tap, threshold, stride) {
  const on = (x, y) => prob[y * w + x] >= threshold;
  let tx = Math.min(w - 1, Math.max(0, Math.trunc(tap[0] / stride)));
  let ty = Math.min(h - 1, Math.max(0, Math.trunc(tap[1] / stride)));
  if (!on(tx, ty)) {
    let best = -1, bestD = Infinity;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!on(x, y)) continue;
      const d = (x - tx) * (x - tx) + (y - ty) * (y - ty);
      if (d < bestD) { bestD = d; best = y * w + x; }
    }
    if (best < 0) return null;
    tx = best % w; ty = Math.trunc(best / w);
  }
  const seen = new Uint8Array(w * h); seen[ty * w + tx] = 1;
  const queue = [ty * w + tx]; let qi = 0;
  const corners = new Map();
  while (qi < queue.length) {
    const c = queue[qi++], x = c % w, y = Math.trunc(c / w);
    for (const dx of [0, 1]) for (const dy of [0, 1]) {
      const px = (x + dx) * stride, py = (y + dy) * stride;
      corners.set(px + "," + py, [px, py]);
    }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
      const k = ny * w + nx;
      if (!seen[k] && on(nx, ny)) { seen[k] = 1; queue.push(k); }
    }
  }
  const pts = [...corners.values()].sort((a, b) => a[0] !== b[0] ? a[0] - b[0] : a[1] - b[1]);
  return convexHull(pts);
}

// ---------- Model ----------
let ortReady = null;
/** Nạp onnxruntime-web: WebGPU nếu Safari có (nhanh), không thì WASM (CPU, 1 luồng). */
export function loadOrt(base) {
  if (ortReady) return ortReady;
  const webgpu = !!navigator.gpu;
  const file = webgpu ? "ort.webgpu.min.js" : "ort.wasm.min.js";
  ortReady = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = base + file;
    s.onload = () => {
      ort.env.wasm.wasmPaths = base;
      ort.env.wasm.numThreads = (self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1);
      resolve(webgpu ? ["webgpu", "wasm"] : ["wasm"]);
    };
    s.onerror = () => reject(new Error("Không tải được bộ chạy AI (onnxruntime-web)."));
    document.head.appendChild(s);
  });
  return ortReady;
}

export class Counter {
  /** models: thư mục chứa rebar_counter.onnx/.json, bundle_selector.onnx/.json. */
  constructor(ortBase, models, onProgress = () => {}) {
    this.ortBase = ortBase; this.models = models; this.onProgress = onProgress;
    this.counter = null; this.selector = null; this.provider = null;
  }

  async _fetchModel(name, label) {
    const res = await fetch(this.models + name);
    if (!res.ok) throw new Error(`Không tải được ${name} (${res.status})`);
    const total = +res.headers.get("content-length") || 0;
    if (!res.body || !total) return new Uint8Array(await res.arrayBuffer());
    const buf = new Uint8Array(total); let got = 0;
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf.set(value, got); got += value.length;
      this.onProgress(label, got / total);
    }
    return buf;
  }

  /** cpuOnly: model int8 (QDQ) — WebGPU EP của onnxruntime-web 1.22 lỗi DequantizeLinear int32 -> chạy CPU. */
  async _session(name, label, cpuOnly = false) {
    const available = await loadOrt(this.ortBase);
    const [bytes, cfg] = await Promise.all([
      this._fetchModel(name + ".onnx", label),
      fetch(this.models + name + ".json").then((r) => r.json()),
    ]);
    const providers = cpuOnly ? ["wasm"] : available;
    const model = { bytes, cfg, session: null, ep: null };
    // Tải song song nhưng KHỞI TẠO lần lượt: 2 phiên tạo cùng lúc làm onnxruntime-web khởi tạo wasm 2 lần
    // ("multiple calls to initWasm") -> phiên WebGPU hỏng, âm thầm rơi về CPU.
    this._chain = (this._chain || Promise.resolve()).catch(() => {}).then(() => Counter._create(model, providers));
    await this._chain;
    if (!cpuOnly) this.provider = model.ep;
    return model;
  }

  static async _create(model, providers) {
    let lastErr = null;
    for (const ep of providers) {
      try { model.session = await ort.InferenceSession.create(model.bytes, { executionProviders: [ep] }); model.ep = ep; return; }
      catch (e) { lastErr = e; }
    }
    throw lastErr || new Error("Không khởi tạo được model");
  }

  /** Chạy model; GPU lỗi lúc chạy (driver/trình duyệt) -> tự chuyển CPU và chạy lại 1 lần. */
  async _run(model, input, shape, inName, outName) {
    try { return await Counter.run(model.session, input, shape, inName, outName); }
    catch (e) {
      if (model.ep !== "webgpu") throw e;
      console.warn("WebGPU lỗi, chuyển sang CPU:", e);
      this._chain = (this._chain || Promise.resolve()).catch(() => {}).then(() => Counter._create(model, ["wasm"]));
      await this._chain;
      if (model === this.counter) this.provider = "wasm";
      return Counter.run(model.session, input, shape, inName, outName);
    }
  }

  // Nạp 1 lần dù nhiều nơi gọi cùng lúc (nạp sẵn ở trang chủ + bấm ĐẾM); lỗi thì cho thử lại.
  async ensureSelector() {
    this._selP ||= this._session("bundle_selector", "Model chọn bó", true).catch((e) => { this._selP = null; throw e; });
    this.selector = await this._selP;
  }
  async ensureCounter() {
    this._cntP ||= this._session("rebar_counter", "Model đếm").catch((e) => { this._cntP = null; throw e; });
    this.counter = await this._cntP;
  }

  static async run(session, input, shape, inName, outName) {
    const feeds = { [inName]: new ort.Tensor("float32", input, shape) };
    const out = await session.run(feeds);
    return out[outName].data;
  }

  /** Chạm (chuẩn hoá 0..1) -> đa giác bó (chuẩn hoá) hoặc null. */
  async selectBundle(full, tap) {
    await this.ensureSelector();
    const { cfg } = this.selector;
    const scale = cfg.size / Math.max(full.width, full.height);
    const rw = Math.max(1, Math.round(full.width * scale)), rh = Math.max(1, Math.round(full.height * scale));
    const tx = tap.x * rw, ty = tap.y * rh;
    const input = toNchw(resize(full, rw, rh), cfg.size, cfg.size, cfg.mean, cfg.std,
      [promptChannel(cfg.size, cfg.size, tx, ty, cfg.prompt_sigma)]);
    const q = cfg.size / cfg.stride;
    const prob = await this._run(this.selector, input, [1, 4, cfg.size, cfg.size], "image", "mask");
    const poly = maskToPolygon(prob, q, q, [tx, ty], cfg.mask_threshold, cfg.stride);
    if (!poly) return null;
    return poly.map(([x, y]) => ({ x: Math.min(1, Math.max(0, x / rw)), y: Math.min(1, Math.max(0, y / rh)) }));
  }

  /** Điểm đầu thép (chuẩn hoá theo ảnh full) trong vùng (null = cả ảnh). */
  async countIn(full, region) {
    await this.ensureCounter();
    const { cfg } = this.counter;
    const w = full.width, h = full.height;
    const poly = region ? region.map((v) => [v.x * w, v.y * h]) : [[0, 0], [w, 0], [w, h], [0, h]];
    const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const pad = cfg.crop_pad_fraction * Math.max(maxX - minX, maxY - minY);
    const x1 = Math.max(0, Math.trunc(minX - pad)), y1 = Math.max(0, Math.trunc(minY - pad));
    const x2 = Math.min(w, Math.ceil(maxX + pad)), y2 = Math.min(h, Math.ceil(maxY + pad));
    if (x2 - x1 < 2 || y2 - y1 < 2) throw new Error("Vùng đếm quá nhỏ");
    const c = crop(full, x1, y1, x2, y2);
    if (region) maskOutside(c, poly.map(([x, y]) => [x - x1, y - y1]));

    const prepare = (scale) => {
      const longest = Math.max(c.width, c.height);
      let s = scale ?? cfg.input_long_side / longest;
      s = Math.min(s, (cfg.max_long_side ?? 1600) / longest);
      const rw = Math.max(1, Math.round(c.width * s)), rh = Math.max(1, Math.round(c.height * s));
      const pm = cfg.pad_multiple;
      const pw = Math.ceil(rw / pm) * pm, ph = Math.ceil(rh / pm) * pm;
      return { tensor: toNchw(resize(c, rw, rh), pw, ph, cfg.mean, cfg.std), pw, ph, sx: rw / c.width, sy: rh / c.height, cw: rw, ch: rh };
    };
    const infer = async (scale) => {
      const p = prepare(scale);
      const heat = await this._run(this.counter, p.tensor, [1, 3, p.ph, p.pw], "image", "heat");
      return [heat, p];
    };
    let [heat, prep] = await infer(null);
    if ((cfg.scale_mode ?? "long_side") === "bar") {
      const pass1 = decodePeaks(heat, prep.pw / cfg.stride, prep.ph / cfg.stride, cfg.pass1_threshold ?? 0.35, cfg.stride);
      const nn = medianNnDistance(pass1, cfg.min_points_for_estimate ?? 8);
      if (nn != null) {
        const barInCrop = nn * (cfg.nn_to_size ?? 1) / prep.sx;
        [heat, prep] = await infer((cfg.target_bar_px ?? 32) / barInCrop);
      }
    }
    const peaks = decodePeaks(heat, prep.pw / cfg.stride, prep.ph / cfg.stride, cfg.threshold, cfg.stride);
    const r4 = (v) => Math.round(v * 10000) / 10000;
    return peaks.filter((p) => p.x < prep.cw && p.y < prep.ch).map((p) => ({
      x: r4(Math.min(1, Math.max(0, (p.x / prep.sx + x1) / w))),
      y: r4(Math.min(1, Math.max(0, (p.y / prep.sy + y1) / h))),
      score: r4(p.score),
    }));
  }

  get modelVersion() { return this.counter?.cfg.model_version ?? ""; }
}

/** Điểm (x,y) chuẩn hoá có nằm trong đa giác chuẩn hoá không (chẵn-lẻ). */
export function inPolygon(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > pt.y) !== (b.y > pt.y) && pt.x < a.x + (pt.y - a.y) * (b.x - a.x) / (b.y - a.y)) inside = !inside;
  }
  return inside;
}
