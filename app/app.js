// Bản web "Kỹ Sư Bỏ Túi" cho iPhone — sát luồng ĐẾM THÉP của app Android:
// Trang chủ → Chụp đầu bó (chạm chọn bó / kéo tay khoanh / không chạm = bó giữa ảnh) → Kiểm tra kết quả
// (chạm thêm/xoá, QUÉT XÓA, HOÀN TÁC, VỀ KẾT QUẢ AI, 2 ngón phóng to) → Đã lưu kết quả (số đếm tay, chi tiết,
// gửi ảnh) → Lịch sử → Gửi dữ liệu góp ý (zip cùng định dạng Android). AI chạy trong trình duyệt (infer.js).
import { Counter, decodeFile, inPolygon } from "./infer.js";
import { Viewer } from "./viewer.js";
import * as store from "./store.js";

export const WEB_VERSION = "web-1.0.1";
const ORT_BASE = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/";
const SITE_CFG = typeof SITE !== "undefined" ? SITE : {}; // ../site.js (link Zalo, thống kê)

const $ = (id) => document.getElementById(id);
const SCREENS = ["home", "capture", "review", "result", "history"];
function show(name) { for (const s of SCREENS) $(s).hidden = s !== name; window.scrollTo(0, 0); }
let toastTimer = 0;
function toast(msg, ms = 3500) { const t = $("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), ms); }
function busy(text, sub = "", progress = null) {
  $("busy").hidden = false; $("busy-text").textContent = text; $("busy-sub").textContent = sub;
  $("busy-bar").hidden = progress == null;
  if (progress != null) $("busy-bar").firstElementChild.style.width = Math.round(progress * 100) + "%";
}
const idle = () => ($("busy").hidden = true);
function track(event) { try { window.goatcounter?.count?.({ path: "app-" + event, event: true }); } catch { /* bỏ qua */ } }
const uid = () => Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 9);
const r4 = (v) => Math.round(v * 10000) / 10000;

function sheet(html, bind) {
  $("sheet-body").innerHTML = html; $("sheet").hidden = false;
  return new Promise((resolve) => {
    const close = (v) => { $("sheet").hidden = true; resolve(v); };
    $("sheet").onclick = (e) => { if (e.target === $("sheet")) close(null); };
    bind?.(close);
  });
}
const ask = (title, text, no, yes) => sheet(`<h3>${title}</h3><p>${text}</p><div class="row"><button class="big" id="sh-no">${no}</button><button class="big primary" id="sh-yes">${yes}</button></div>`,
  (close) => { $("sh-no").onclick = () => close(false); $("sh-yes").onclick = () => close(true); });

// ---------- Bộ AI: nạp sẵn từ trang chủ ----------
let aiReady = false;
const loading = { "Model chọn bó": 0, "Model đếm": 0 };
const counter = new Counter(ORT_BASE, "models/", (label, p) => {
  loading[label] = p;
  const total = (loading["Model chọn bó"] * 11.6 + loading["Model đếm"] * 45.7) / 57.3;
  const st = $("ai-status");
  const span = st.querySelector("span");
  if (!aiReady && span) { span.textContent = `Đang tải bộ AI lần đầu… ${Math.round(total * 100)}% (khoảng 60 MB, nên dùng Wi-Fi)`; st.querySelector("i").style.width = total * 100 + "%"; }
  if (!$("busy").hidden) busy("Đang tải bộ AI (chỉ lần đầu)…", "Lần sau mở app là dùng ngay, kể cả khi mất mạng.", total);
});
async function preload() {
  const st = $("ai-status");
  try {
    await Promise.all([counter.ensureSelector(), counter.ensureCounter()]);
    aiReady = true; st.className = "status ok";
    st.innerHTML = `✅ Bộ AI sẵn sàng trên máy (${counter.provider === "webgpu" ? "tăng tốc GPU" : "chạy bằng CPU"})`;
    setTimeout(() => (st.hidden = true), 4000);
  } catch (e) {
    st.className = "status err";
    st.innerHTML = `⚠️ Chưa tải được bộ AI: ${e.message || e}. Kiểm tra mạng rồi <a href="#" id="ai-retry">thử lại</a>.`;
    $("ai-retry").onclick = (ev) => { ev.preventDefault(); st.className = "status"; st.innerHTML = '<div class="spinner sm"></div><span>Đang thử lại…</span><div class="pbar"><i></i></div>'; preload(); };
  }
}

// ---------- Chụp đầu bó: chọn ảnh, chạm/khoanh ----------
const C = { file: null, url: "", full: null, tap: null, outline: null, drawing: null, fromCamera: false };
const capViewer = new Viewer($("cap-stage"), $("cap-wrap"), {
  onTap: (p) => { if (inside01(p)) { C.tap = p; C.outline = null; drawCapture(); } },
  onDrawStart: (p) => { C.drawing = [p]; drawCapture(); },
  onDraw: (p) => { C.drawing?.push(clamp01(p)); drawCapture(); },
  onDrawEnd: (cancel) => {
    const pts = C.drawing; C.drawing = null;
    if (cancel || !pts) { drawCapture(); return; }
    const poly = simplify(pts, 80);
    if (polyArea(poly) * C.full.width * C.full.height < (0.02 * Math.min(C.full.width, C.full.height)) ** 2 || poly.length < 3) {
      toast("Vòng khoanh quá nhỏ. Kéo ngón tay vòng quanh cả bó."); drawCapture(); return;
    }
    C.outline = poly; C.tap = null; drawCapture();
  },
  onZoom: () => drawCapture(),
});
capViewer.drawMode = true;
const inside01 = (p) => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;
const clamp01 = (p) => ({ x: Math.min(1, Math.max(0, p.x)), y: Math.min(1, Math.max(0, p.y)) });
function polyArea(p) { let a = 0; for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += (p[j].x + p[i].x) * (p[j].y - p[i].y); return Math.abs(a / 2); }
function simplify(pts, max) { if (pts.length <= max) return pts; const k = pts.length / max; return Array.from({ length: max }, (_, i) => pts[Math.floor(i * k)]); }

function startCapture() { show("capture"); $("cap-pick").hidden = false; $("cap-preview").hidden = true; }

async function openFile(file, fromCamera) {
  if (!file) return;
  busy("Đang mở ảnh…");
  try {
    if (C.url) URL.revokeObjectURL(C.url);
    Object.assign(C, { file, fromCamera, url: URL.createObjectURL(file), tap: null, outline: null, drawing: null });
    $("cap-img").src = C.url; await $("cap-img").decode();
    C.full = await decodeFile(file);
    $("cap-pick").hidden = true; $("cap-preview").hidden = false;
    $("cap-again").textContent = fromCamera ? "↻ CHỤP LẠI" : "↻ CHỌN LẠI";
    capViewer.setImage(C.full.width, C.full.height); drawCapture();
  } catch (e) { toast("Không mở được ảnh: " + (e.message || e)); }
  finally { idle(); }
}

function drawCapture() {
  if (!C.full) return;
  const W = C.full.width, H = C.full.height, k = 1 / capViewer.pxPerImagePx, svg = $("cap-svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`); svg.setAttribute("preserveAspectRatio", "none");
  let h = "";
  const line = (pts, closed) => `<path d="M${pts.map((p) => `${p.x * W} ${p.y * H}`).join(" L")}${closed ? "Z" : ""}" fill="${closed ? "rgba(255,179,0,.12)" : "none"}" stroke="#ffb300" stroke-width="${3.5 * k}" stroke-linejoin="round"/>`;
  if (C.outline) h += line(C.outline, true);
  if (C.drawing?.length > 1) h += line(C.drawing, false);
  if (C.tap) h += `<circle cx="${C.tap.x * W}" cy="${C.tap.y * H}" r="${16 * k}" fill="rgba(255,179,0,.35)" stroke="#ffb300" stroke-width="${4 * k}"/><circle cx="${C.tap.x * W}" cy="${C.tap.y * H}" r="${4 * k}" fill="#ffb300"/>`;
  svg.innerHTML = h;
  $("cap-clear").hidden = !(C.tap || C.outline);
  $("cap-hint").innerHTML = C.outline ? "Chỉ đếm trong vùng khoanh.<br>Khoanh lại để thay đổi." : C.tap ? "👆 Đã chọn bó. Bấm <b>ĐẾM</b>, hoặc chạm chỗ khác để đổi." : "👆 Chạm vào bó cần đếm (khó thì kéo tay khoanh).<br>Không chạm = đếm bó ở giữa ảnh.";
}

async function count() {
  const t0 = performance.now();
  try {
    busy("AI đang đếm…", counter.provider === "wasm" ? "Máy không có tăng tốc GPU: có thể mất 20–60 giây." : "");
    let region = C.outline, mode = "outline";
    if (!region) {
      mode = C.tap ? "tap" : "center";
      region = await counter.selectBundle(C.full, C.tap || { x: 0.5, y: 0.5 });
      if (!region) throw new Error("Không tìm thấy bó thép tại điểm chạm. Chạm vào giữa một đầu bó hoặc kéo tay khoanh quanh bó.");
    }
    busy("AI đang đếm…", counter.provider === "wasm" ? "Máy không có tăng tốc GPU: có thể mất 20–60 giây." : "");
    const det = await counter.countIn(C.full, region);
    startReview(det, region, mode, performance.now() - t0);
    track("dem");
  } catch (e) {
    console.error(e); toast("Không đếm được ảnh này: " + (e.message || e), 6500);
  } finally { idle(); }
}

// ---------- Kiểm tra kết quả ----------
const R = { id: "", ai: [], removed: new Set(), added: [], undo: [], region: null, mode: "", ms: 0, sweep: false, sweepHit: null };
const revViewer = new Viewer($("rev-stage"), $("rev-wrap"), {
  onTap: (p) => reviewTap(p),
  onDrawStart: (p) => { R.sweepHit = []; sweepAt(p); },
  onDraw: (p) => sweepAt(p),
  onDrawEnd: () => { if (R.sweepHit?.length) R.undo.push({ op: "unremoveMany", ids: R.sweepHit }); R.sweepHit = null; drawReview(); },
  onZoom: () => drawReview(),
});

function startReview(det, region, mode, ms) {
  Object.assign(R, { id: uid(), region, mode, ms, removed: new Set(), added: [], undo: [], sweep: false });
  R.ai = det.map((d, i) => ({ id: `${R.id}-ai${i}`, x: d.x, y: d.y, score: d.score, inside: inPolygon(d, region) }));
  $("rev-img").src = C.url; setSweep(false);
  show("review"); revViewer.setImage(C.full.width, C.full.height); drawReview();
}
const visibleAi = () => R.ai.filter((d) => d.inside && !R.removed.has(d.id));
const confirmedCount = () => visibleAi().length + R.added.length;
const aiCount = () => R.ai.filter((d) => d.inside).length;

function drawReview() {
  if (!C.full) return;
  const W = C.full.width, H = C.full.height, k = 1 / revViewer.pxPerImagePx, svg = $("rev-svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`); svg.setAttribute("preserveAspectRatio", "none");
  const pts = R.region.map((p) => `${p.x * W} ${p.y * H}`).join(" L");
  let h = `<path d="M-${W} -${H}H${2 * W}V${2 * H}H-${W}Z M${pts}Z" fill="rgba(0,0,0,.5)" fill-rule="evenodd"/>`;
  h += `<path d="M${pts}Z" fill="none" stroke="#ffb300" stroke-width="${3 * k}"/>`;
  const r = 6 * k, sw = 2.2 * k; // cỡ chấm cố định trên màn hình như app Android
  for (const d of visibleAi()) h += `<circle cx="${d.x * W}" cy="${d.y * H}" r="${r}" fill="rgba(34,197,94,.25)" stroke="${d.score < 0.5 ? "#facc15" : "#22c55e"}" stroke-width="${sw}"/>`;
  for (const p of R.added) h += `<rect x="${p.x * W - r}" y="${p.y * H - r}" width="${2 * r}" height="${2 * r}" fill="rgba(59,130,246,.25)" stroke="#3b82f6" stroke-width="${sw}"/>`;
  svg.innerHTML = h;
  $("rev-ai").textContent = aiCount(); $("rev-ok").textContent = confirmedCount();
  $("rev-confirm").textContent = `✔ XÁC NHẬN ${confirmedCount()} CÂY`;
  $("rev-undo").disabled = !R.undo.length;
  $("rev-reset").disabled = !(R.removed.size || R.added.length);
}

function nearest(p, maxScreenPx) {
  const W = C.full.width, H = C.full.height, lim = maxScreenPx / revViewer.pxPerImagePx;
  let best = null, bd = Infinity;
  for (const d of visibleAi()) { const dd = Math.hypot((d.x - p.x) * W, (d.y - p.y) * H); if (dd < bd) { bd = dd; best = { kind: "ai", id: d.id }; } }
  R.added.forEach((a, i) => { const dd = Math.hypot((a.x - p.x) * W, (a.y - p.y) * H); if (dd < bd) { bd = dd; best = { kind: "add", i }; } });
  return bd <= lim ? best : null;
}

function reviewTap(p) {
  if (R.sweep) return;
  const hit = nearest(p, 18);
  if (hit?.kind === "ai") { R.removed.add(hit.id); R.undo.push({ op: "unremove", id: hit.id }); }
  else if (hit?.kind === "add") { const [a] = R.added.splice(hit.i, 1); R.undo.push({ op: "readd", a }); }
  else if (inPolygon(p, R.region)) { R.added.push({ ...p, id: uid(), at: new Date().toISOString() }); R.undo.push({ op: "unadd" }); }
  else { toast("Chỉ đếm trong vùng khoanh vàng."); return; }
  drawReview();
}

function sweepAt(p) {
  const W = C.full.width, H = C.full.height, lim = 22 / revViewer.pxPerImagePx;
  for (const d of visibleAi()) if (Math.hypot((d.x - p.x) * W, (d.y - p.y) * H) <= lim) { R.removed.add(d.id); R.sweepHit.push(d.id); }
  for (let i = R.added.length - 1; i >= 0; i--) {
    const a = R.added[i];
    if (Math.hypot((a.x - p.x) * W, (a.y - p.y) * H) <= lim) { R.added.splice(i, 1); R.undo.push({ op: "readd", a }); }
  }
  drawReview();
}

function undo() {
  const u = R.undo.pop(); if (!u) return;
  if (u.op === "unremove") R.removed.delete(u.id);
  else if (u.op === "unremoveMany") u.ids.forEach((id) => R.removed.delete(id));
  else if (u.op === "readd") R.added.push(u.a);
  else if (u.op === "unadd") R.added.pop();
  else if (u.op === "unreset") { R.removed = u.removed; R.added = u.added; }
  drawReview();
}
function resetToAi() { R.undo.push({ op: "unreset", removed: new Set(R.removed), added: [...R.added] }); R.removed = new Set(); R.added = []; drawReview(); }
function setSweep(on) {
  R.sweep = on; revViewer.drawMode = on;
  $("rev-sweep").classList.toggle("on", on); $("rev-sweep").textContent = on ? "✋ ĐANG QUÉT" : "🧹 QUÉT XÓA";
  $("rev-hint").innerHTML = on ? "Kéo ngón tay qua các điểm để xóa hàng loạt<br>2 ngón: phóng to / kéo ảnh" : "Chạm chỗ trống: thêm cây · Chạm điểm: xóa · 2 ngón: phóng to<br>Chỉ đếm trong vùng khoanh vàng";
}

// ---------- Lưu (cùng cấu trúc app Android) ----------
async function jpegOfFull() {
  const c = document.createElement("canvas"); c.width = C.full.width; c.height = C.full.height;
  c.getContext("2d").putImageData(new ImageData(C.full.data, C.full.width, C.full.height), 0, 0);
  const b = await new Promise((res) => c.toBlob(res, "image/jpeg", 0.9)); c.width = c.height = 1; return b;
}

async function confirmCount() {
  busy("Đang lưu…");
  try {
    const now = new Date().toISOString();
    const session = {
      id: R.id, created_at: now, image_width: C.full.width, image_height: C.full.height,
      model_version: counter.modelVersion + "@web", ai_count: aiCount(), confirmed_count: confirmedCount(), manual_count: null,
      region: R.region.map((p) => [r4(p.x), r4(p.y)]), delivery_item_id: null,
      detections: [
        ...R.ai.map((d) => ({ id: d.id, x: d.x, y: d.y, confidence: d.score, source: "AI" })),
        ...R.added.map((a) => ({ id: a.id, x: r4(a.x), y: r4(a.y), confidence: 1, source: "USER_ADDED" })),
      ],
      corrections: [
        ...[...R.removed].map((id) => ({ type: "REMOVE", target: id, x: null, y: null, at: now })),
        ...R.added.map((a) => ({ type: "ADD", target: null, x: r4(a.x), y: r4(a.y), at: a.at })),
      ],
      region_mode: R.mode, elapsed_ms: Math.round(R.ms), exported_at: null,
    };
    await store.saveSession(session, await jpegOfFull());
    store.persist();
    track("xac-nhan");
    await openResult(session, true);
  } catch (e) { toast("Không lưu được kết quả: " + (e.message || e), 6000); }
  finally { idle(); }
}

// ---------- Kết quả / chi tiết ----------
let current = null, currentBlob = null;
async function renderEvidence(s) {
  const imgBlob = await store.getImage(s.id); if (!imgBlob) return null;
  const bmp = await createImageBitmap(imgBlob);
  const s1 = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * s1), h = Math.round(bmp.height * s1), band = Math.round(Math.max(64, w * 0.09));
  const c = document.createElement("canvas"); c.width = w; c.height = h + band;
  const g = c.getContext("2d"); g.drawImage(bmp, 0, 0, w, h);
  if (s.region?.length) {
    g.lineWidth = Math.max(2, w * 0.004); g.strokeStyle = "#ffb300"; g.beginPath();
    s.region.forEach(([x, y], i) => (i ? g.lineTo(x * w, y * h) : g.moveTo(x * w, y * h))); g.closePath(); g.stroke();
  }
  const removed = new Set(s.corrections.filter((c2) => c2.type === "REMOVE").map((c2) => c2.target));
  const poly = (s.region || []).map(([x, y]) => ({ x, y }));
  const pts = s.detections.filter((d) => !removed.has(d.id) && (d.source !== "AI" || !poly.length || inPolygon(d, poly)));
  const r = Math.max(4, w * 0.008); g.lineWidth = Math.max(1.5, r * 0.35);
  for (const d of pts) {
    g.strokeStyle = d.source === "AI" ? "#22c55e" : "#3b82f6"; g.beginPath();
    if (d.source === "AI") g.arc(d.x * w, d.y * h, r, 0, Math.PI * 2); else g.rect(d.x * w - r, d.y * h - r, 2 * r, 2 * r);
    g.stroke();
  }
  g.fillStyle = "#0f172a"; g.fillRect(0, h, w, band); g.textBaseline = "middle";
  g.fillStyle = "#ffb300"; g.font = `800 ${Math.round(band * 0.42)}px "Be Vietnam Pro", sans-serif`; g.fillText(`${s.confirmed_count} cây`, band * 0.3, h + band / 2);
  g.fillStyle = "#e2e8f0"; g.font = `600 ${Math.round(band * 0.24)}px "Be Vietnam Pro", sans-serif`;
  const txt = `Kỹ Sư Bỏ Túi · ${fmtTime(s.created_at)}`; g.fillText(txt, w - g.measureText(txt).width - band * 0.3, h + band / 2);
  return new Promise((res) => c.toBlob(res, "image/jpeg", 0.86));
}
const fmtTime = (iso) => new Date(iso).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", year: "numeric" });

async function openResult(s, fresh) {
  current = s;
  $("res-title").textContent = fresh ? "Đã lưu kết quả" : "Chi tiết lần đếm";
  $("res-count").textContent = s.confirmed_count;
  $("res-again").hidden = $("res-home").hidden = !fresh;
  const added = s.corrections.filter((c) => c.type === "ADD").length, removed = s.corrections.filter((c) => c.type === "REMOVE").length;
  const mode = { tap: "Theo bó (chạm)", center: "Theo bó (giữa ảnh)", outline: "Vùng khoanh tay" }[s.region_mode] || "Theo bó";
  $("res-detail").innerHTML = [["AI đếm ban đầu", s.ai_count], ["Người dùng thêm", added], ["Người dùng xóa", removed], ["Vùng đếm", mode],
    ["Thời gian", fmtTime(s.created_at)], ["AI xử lý", s.elapsed_ms ? (s.elapsed_ms / 1000).toFixed(1) + " giây" : "–"], ["Model", s.model_version]]
    .map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join("");
  showManual(s);
  show("result");
  currentBlob = await renderEvidence(s);
  if (currentBlob) $("res-img").src = URL.createObjectURL(currentBlob);
}

function showManual(s) {
  const m = s.manual_count;
  $("man-ask").hidden = m != null; $("man-done").hidden = m == null; $("man-input").value = m ?? "";
  if (m != null) {
    $("man-text").textContent = `Đếm tay: ${m} cây`;
    const d = s.confirmed_count - m;
    $("man-diff").textContent = d === 0 ? "Trùng số đã xác nhận ✓" : `Số xác nhận lệch ${d > 0 ? "+" : ""}${d} so với đếm tay`;
  }
}
async function saveManual() {
  const v = $("man-input").value.trim();
  if (v !== "" && !/^\d+$/.test(v)) { toast("Nhập số cây là số nguyên."); return; }
  current.manual_count = v === "" ? null : +v; current.exported_at = null; // sửa thì gửi lại
  await store.updateSession(current); showManual(current);
  if (v !== "") toast("Đã lưu số đếm tay. Cảm ơn anh/chị — dữ liệu này giúp app đếm chính xác hơn.");
}

async function shareBlob(blob, name, text) {
  const file = new File([blob], name, { type: blob.type });
  try { if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], text }); return true; } }
  catch (e) { if (e.name === "AbortError") return false; }
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click(); return true;
}

// ---------- Lịch sử ----------
async function openHistory() {
  const list = await store.listSessions();
  $("hist-empty").hidden = list.length > 0;
  $("hist-list").innerHTML = "";
  for (const s of list) {
    const edits = s.corrections.length;
    const b = document.createElement("button"); b.className = "hitem";
    b.innerHTML = `<img alt=""><div><b>${s.confirmed_count} cây</b><div class="fine">${fmtTime(s.created_at)}<br>AI ${s.ai_count} · ${edits ? `người sửa ${edits} điểm` : "không sửa"}${s.manual_count != null ? ` · đếm tay ${s.manual_count}` : ""}</div></div><span class="chev">›</span>`;
    b.onclick = () => openResult(s, false);
    $("hist-list").appendChild(b);
    store.getImage(s.id).then((blob) => { if (blob) b.querySelector("img").src = URL.createObjectURL(blob); });
  }
  show("history");
}

// ---------- Gửi dữ liệu góp ý ----------
async function openExport() {
  const all = await store.listSessions(), fresh = all.filter((s) => !s.exported_at).length;
  const pick = await sheet(`<h3>Gửi dữ liệu góp ý</h3>
    <p>Gói ảnh và kết quả đếm (kể cả số đếm tay) thành một file để gửi qua Zalo, Drive hoặc Gmail. Dữ liệu giúp app đếm chính xác hơn.
    Gửi riêng cho người phụ trách, không gửi vào nhóm chung.</p>
    <button class="big primary" id="ex-new" ${fresh ? "" : "disabled"}>${fresh ? `📤 GỬI ${fresh} BÓ MỚI` : "Không có bó mới"}</button>
    <button class="big" id="ex-all" ${all.length ? "" : "disabled"}>GỬI LẠI TẤT CẢ (${all.length} BÓ)</button>`,
  (close) => { $("ex-new").onclick = () => close("new"); $("ex-all").onclick = () => close("all"); });
  if (!pick) return;
  busy("Đang đóng gói dữ liệu…");
  try {
    const ex = await store.buildExport({ onlyNew: pick === "new", appVersion: WEB_VERSION });
    idle();
    if (!ex) { toast("Không có bó nào để gửi."); return; }
    const mb = (ex.blob.size / 1048576).toFixed(1);
    if (await shareBlob(ex.blob, ex.name, `Dữ liệu góp ý Kỹ Sư Bỏ Túi (iPhone): ${ex.ids.length} bó, ${ex.images} ảnh (${mb} MB).`)) {
      await store.markExported(ex.ids); track("gop-y");
    }
  } catch (e) { toast("Không tạo được gói dữ liệu: " + (e.message || e)); } finally { idle(); }
}

// ---------- Sự kiện ----------
document.querySelectorAll("[data-back]").forEach((b) => (b.onclick = () => show(b.dataset.back)));
$("go-count").onclick = startCapture;
$("go-history").onclick = openHistory;
$("go-export").onclick = openExport;
$("go-receive").onclick = () => sheet(`<h3>Nhận thép theo phiếu</h3><p>Phần <b>Nhận thép theo phiếu giao + đối chiếu + biên bản PDF</b> hiện có trên <b>bản Android</b>; bản iPhone đang làm. Bấm “Vào nhóm Zalo” để được báo khi có. Trong lúc chờ, anh/chị dùng <b>ĐẾM THÉP</b> để đếm từng bó.</p>
  <div class="row"><button class="big" id="rc-close">ĐÓNG</button><a class="big primary" id="rc-zalo" target="_blank" rel="noopener">VÀO NHÓM ZALO</a></div>`,
  (close) => { $("rc-close").onclick = () => close(); const z = $("rc-zalo"); if (SITE_CFG.zaloUrl) z.href = SITE_CFG.zaloUrl; else z.hidden = true; z.onclick = () => close(); });
$("pick-camera").onchange = (e) => { openFile(e.target.files[0], true); e.target.value = ""; };
$("pick-file").onchange = (e) => { openFile(e.target.files[0], false); e.target.value = ""; };
$("cap-again").onclick = () => $(C.fromCamera ? "pick-camera" : "pick-file").click();
$("cap-clear").onclick = () => { C.tap = null; C.outline = null; drawCapture(); };
$("cap-count").onclick = count;
$("rev-sweep").onclick = () => setSweep(!R.sweep);
$("rev-undo").onclick = undo;
$("rev-reset").onclick = resetToAi;
$("rev-confirm").onclick = confirmCount;
$("rev-back").onclick = async () => {
  if ((R.removed.size || R.added.length) && !(await ask("Bỏ kết quả đếm?", "Các chỉnh sửa chưa được lưu sẽ mất.", "Ở LẠI", "BỎ"))) return;
  show("capture");
};
$("man-save").onclick = saveManual;
$("man-edit").onclick = () => { $("man-ask").hidden = false; $("man-done").hidden = true; $("man-input").focus(); };
$("res-share").onclick = () => currentBlob && shareBlob(currentBlob, `kysubotui-${current.confirmed_count}-cay.jpg`, `Bó thép: ${current.confirmed_count} cây (đếm bằng Kỹ Sư Bỏ Túi)`).then((ok) => ok && track("chia-se"));
$("res-again").onclick = startCapture;
$("res-home").onclick = () => show("home");
$("res-back").onclick = () => ($("res-title").textContent === "Chi tiết lần đếm" ? openHistory() : show("home"));

$("web-version").textContent = WEB_VERSION;
const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
if (ios && !navigator.standalone) $("install-tip").hidden = false;
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
preload();

// Cho trang kiểm tra tự động (tools) gọi lõi đếm.
globalThis.__ksbt = { counter, decodeFile, store, C, R, openFile, count };
