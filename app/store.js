// Lưu lần đếm + ảnh gốc trong IndexedDB của trình duyệt (chỉ trên máy này), và đóng gói
// "Gửi dữ liệu góp ý" đúng định dạng app Android (mobile/lib/features/field_trial/data/trial_exporter.dart,
// format_version 1): data.json + images/ trong 1 file zip.
const DB = "ksbt", VER = 1;

function open() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, VER);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains("sessions")) db.createObjectStore("sessions", { keyPath: "id" });
      if (!db.objectStoreNames.contains("images")) db.createObjectStore("images");
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

async function tx(stores, mode, fn) {
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction(stores, mode);
    const out = fn(...stores.map((s) => t.objectStore(s)));
    t.oncomplete = () => res(out?.result ?? out);
    t.onerror = t.onabort = () => rej(t.error);
  });
}

export const saveSession = (s, imageBlob) => tx(["sessions", "images"], "readwrite", (ss, is) => {
  ss.put(s); if (imageBlob) is.put(imageBlob, s.id);
});
export const updateSession = (s) => tx(["sessions"], "readwrite", (ss) => { ss.put(s); });
export const getSession = (id) => tx(["sessions"], "readonly", (ss) => ss.get(id));
export const getImage = (id) => tx(["images"], "readonly", (is) => is.get(id));
export async function listSessions() {
  const all = await tx(["sessions"], "readonly", (ss) => ss.getAll());
  return (all || []).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

/** Xin trình duyệt giữ dữ liệu lâu dài (Safari xoá dữ liệu web không dùng sau ~7 ngày nếu không). */
export async function persist() { try { return await navigator.storage?.persist?.(); } catch { return false; } }

// ---------- ZIP (không nén, đủ cho ảnh JPEG + JSON) ----------
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

export function zip(files) {
  const enc = new TextEncoder(), parts = [], central = [];
  let offset = 0;
  for (const { name, data } of files) {
    const nb = enc.encode(name), crc = crc32(data), sz = data.length;
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); // UTF-8 tên file
    h.setUint32(14, crc, true); h.setUint32(18, sz, true); h.setUint32(22, sz, true); h.setUint16(26, nb.length, true);
    parts.push(new Uint8Array(h.buffer), nb, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
    c.setUint32(16, crc, true); c.setUint32(20, sz, true); c.setUint32(24, sz, true); c.setUint16(28, nb.length, true);
    c.setUint32(42, offset, true);
    central.push(new Uint8Array(c.buffer), nb);
    offset += 30 + nb.length + sz;
  }
  const cdSize = central.reduce((a, b) => a + b.length, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
  e.setUint32(12, cdSize, true); e.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(e.buffer)], { type: "application/zip" });
}

/** Gói dữ liệu góp ý: các lần đếm chưa gửi (onlyNew) hoặc tất cả. Null = không có gì. */
export async function buildExport({ onlyNew, appVersion }) {
  const sessions = (await listSessions()).filter((s) => !onlyNew || !s.exported_at);
  if (!sessions.length) return null;
  const files = [], out = [];
  for (const s of sessions) {
    const img = await getImage(s.id);
    let image = null;
    if (img) { image = `images/${s.id}.jpg`; files.push({ name: image, data: new Uint8Array(await img.arrayBuffer()) }); }
    const { exported_at: _e, elapsed_ms: _m, region_mode: _r, ...rest } = s;
    out.push({ ...rest, image });
  }
  const now = new Date();
  const data = { format_version: 1, exported_at: now.toISOString(), app_version: appVersion,
    device: navigator.userAgent, scope: onlyNew ? "new" : "all", sessions: out, deliveries: [] };
  files.push({ name: "data.json", data: new TextEncoder().encode(JSON.stringify(data, null, 1)) });
  const p = (v) => String(v).padStart(2, "0");
  const name = `afe_thu_nghiem_web_${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}_${p(now.getHours())}${p(now.getMinutes())}.zip`;
  return { blob: zip(files), name, ids: sessions.map((s) => s.id), images: files.length - 1 };
}

export async function markExported(ids) {
  const at = new Date().toISOString();
  for (const id of ids) { const s = await getSession(id); if (s) { s.exported_at = at; await updateSession(s); } }
}
