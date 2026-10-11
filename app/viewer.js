// Khung xem ảnh kiểu InteractiveViewer của app Android: 2 ngón = phóng to/thu nhỏ quanh tâm ngón,
// 1 ngón = kéo ảnh (hoặc vẽ: khoanh vùng / quét xoá khi bật `drawMode`), chạm nhẹ = onTap.
// Toạ độ trả về chuẩn hoá 0..1 theo ảnh.
export class Viewer {
  constructor(stage, content, { onTap, onDrawStart, onDraw, onDrawEnd, onZoom } = {}) {
    this.stage = stage; this.content = content;
    this.cb = { onTap, onDrawStart, onDraw, onDrawEnd, onZoom };
    this.s = 1; this.tx = 0; this.ty = 0; this.drawMode = false;
    this.pointers = new Map(); this.gesture = null;
    stage.style.touchAction = "none";
    stage.addEventListener("pointerdown", (e) => this.down(e));
    stage.addEventListener("pointermove", (e) => this.move(e));
    for (const t of ["pointerup", "pointercancel", "pointerleave"]) stage.addEventListener(t, (e) => this.up(e));
    stage.addEventListener("wheel", (e) => { e.preventDefault(); this.zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.15 : 1 / 1.15); }, { passive: false });
    new ResizeObserver(() => this.fit()).observe(stage);
  }

  /** Đặt kích thước ảnh gốc (px) và khớp vào khung. */
  setImage(w, h) { this.w = w; this.h = h; this.reset(); }

  reset() { this.s = 1; this.tx = 0; this.ty = 0; this.fit(); }

  fit() {
    if (!this.w) return;
    const r = this.stage.getBoundingClientRect();
    this.base = Math.min(r.width / this.w, r.height / this.h);
    this.content.style.width = this.w * this.base + "px";
    this.content.style.height = this.h * this.base + "px";
    this.clamp(); this.apply();
  }

  /** Số px màn hình cho 1 px ảnh (để chấm giữ cỡ cố định khi phóng). */
  get pxPerImagePx() { return (this.base || 1) * this.s; }

  apply() {
    const r = this.stage.getBoundingClientRect();
    const cw = this.w * this.base, ch = this.h * this.base;
    const ox = (r.width - cw * this.s) / 2 + this.tx, oy = (r.height - ch * this.s) / 2 + this.ty;
    this.content.style.transform = `translate(${ox}px, ${oy}px) scale(${this.s})`;
    this.cb.onZoom?.(this.s);
  }

  clamp() {
    const r = this.stage.getBoundingClientRect();
    const cw = this.w * this.base * this.s, ch = this.h * this.base * this.s;
    const mx = Math.max(0, (cw - r.width) / 2), my = Math.max(0, (ch - r.height) / 2);
    this.tx = Math.min(mx, Math.max(-mx, this.tx)); this.ty = Math.min(my, Math.max(-my, this.ty));
  }

  zoomAt(cx, cy, f) {
    const r = this.stage.getBoundingClientRect();
    const ns = Math.min(8, Math.max(1, this.s * f)), k = ns / this.s;
    const px = cx - r.left - r.width / 2, py = cy - r.top - r.height / 2;
    this.tx = px - (px - this.tx) * k; this.ty = py - (py - this.ty) * k;
    this.s = ns; this.clamp(); this.apply();
  }

  norm(cx, cy) {
    const r = this.content.getBoundingClientRect();
    return { x: (cx - r.left) / r.width, y: (cy - r.top) / r.height };
  }

  down(e) {
    this.stage.setPointerCapture?.(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 1) {
      this.gesture = { kind: "maybeTap", x0: e.clientX, y0: e.clientY, t0: performance.now(), lx: e.clientX, ly: e.clientY };
    } else if (this.pointers.size === 2) {
      if (this.gesture?.kind === "draw") this.cb.onDrawEnd?.(true); // 2 ngón: huỷ nét đang vẽ
      const [a, b] = [...this.pointers.values()];
      this.gesture = { kind: "pinch", d0: Math.hypot(a.x - b.x, a.y - b.y), s0: this.s, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
    }
  }

  move(e) {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = this.gesture;
    if (!g) return;
    if (g.kind === "pinch" && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      this.tx += mx - g.mx; this.ty += my - g.my; g.mx = mx; g.my = my;
      this.zoomAt(mx, my, (g.s0 * Math.hypot(a.x - b.x, a.y - b.y) / g.d0) / this.s);
      return;
    }
    if (g.kind === "maybeTap" && Math.hypot(e.clientX - g.x0, e.clientY - g.y0) > 8) {
      if (this.drawMode) { g.kind = "draw"; this.cb.onDrawStart?.(this.norm(g.x0, g.y0)); }
      else g.kind = "pan";
    }
    if (g.kind === "draw") this.cb.onDraw?.(this.norm(e.clientX, e.clientY));
    else if (g.kind === "pan") {
      this.tx += e.clientX - g.lx; this.ty += e.clientY - g.ly; this.clamp(); this.apply();
    }
    g.lx = e.clientX; g.ly = e.clientY;
  }

  up(e) {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.delete(e.pointerId);
    const g = this.gesture;
    if (this.pointers.size > 0) { if (g?.kind === "pinch") this.gesture = { kind: "done" }; return; }
    if (g?.kind === "maybeTap" && performance.now() - g.t0 < 600) this.cb.onTap?.(this.norm(g.x0, g.y0));
    else if (g?.kind === "draw") this.cb.onDrawEnd?.(false);
    this.gesture = null;
  }
}
