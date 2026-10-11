// Thông tin dùng chung cho mọi trang. Sửa ở đây là đủ.
// Khối RELEASE do mobile/tool/build_release.ps1 tự cập nhật mỗi lần build.
const SITE = {
  // Địa chỉ gốc của trang web (GitHub Pages hoặc tên miền). App mở
  // <siteUrl>/phien-ban.html?v=<bản đang cài> để kiểm tra bản mới; build_release.ps1
  // đưa giá trị này vào app. Trống = app ẩn nút "Kiểm tra bản mới".
  siteUrl: "https://hoangthanhht.github.io/kysubotui",
  // Link mời vào nhóm Zalo hỗ trợ (dạng https://zalo.me/g/xxxxxx). Không đưa số
  // điện thoại cá nhân lên web. Trống = mọi nút/link Zalo tạm chuyển sang email.
  zaloUrl: "https://zalo.me/g/hwgwcamhymfcccxavg0t",
  email: "hoangthanh.gxd@gmail.com",
  youtubeId: "fvOBHanH2Ow",      // video Shorts "Cách tải app" (v3, 11/10/2026); trống = ẩn khung video
  // Mã site GoatCounter (đếm lượt xem web, không cookie): <mã>.goatcounter.com. Trống = tắt.
  // Link từ các kênh gắn ?ref=<kênh>, vd ?ref=tiktok, ?ref=yt, ?ref=fb-qaqc, ?ref=gxd-zalo.
  goatcounter: "kysubotui",
  // Link tải cố định, luôn trỏ bản mới nhất (GitHub Releases, xem doc/PHAT_HANH_APK.md)
  apkUrl: "https://github.com/hoangthanhht/kysubotui/releases/latest/download/KySuBoTui.apk",
  apkOldUrl: "https://github.com/hoangthanhht/kysubotui/releases/latest/download/KySuBoTui-may-cu.apk",
  // RELEASE-BEGIN
  version: "1.0.2",
  releaseDate: "11/10/2026",
  apkSizeMb: "96.7",
  apkSha256: "71615710B907C8E59B21282953AF24A9F3C3EC1A524D6889DA0EB1D2B1B36254",
  certSha256: "A9:CD:15:09:5B:18:A3:EE:0A:EE:63:65:7B:68:3A:CA:AF:B2:1C:7B:0A:0B:B0:37:F5:7B:11:6C:41:4D:BD:F8",
  // RELEASE-END
  // Thêm 1 mục ở ĐẦU danh sách mỗi lần phát hành (hiện ở phien-ban.html).
  changelog: [
    {
      version: "1.0.2",
      date: "11/10/2026",
      items: [
        "Nút \"Nhóm Zalo hỗ trợ\" ngay trong app: hỏi khi cài hay đếm bị lỗi, nhận tin bản mới.",
        "Nhắc gửi dữ liệu góp ý riêng cho người phụ trách (gói có ảnh phiếu giao), không gửi vào nhóm chung.",
      ],
    },
    {
      version: "1.0.1",
      date: "07/10/2026",
      items: [
        "Nút \"Kiểm tra bản mới\" ở màn hình chính; app tự nhắc khi bản đang dùng đã cũ.",
      ],
    },
    {
      version: "1.0.0",
      date: "06/10/2026",
      items: [
        "Đếm sắt bằng ảnh, chạy ngay trên điện thoại, không cần mạng.",
        "Nhận thép theo phiếu giao: đếm từng bó, đối chiếu, xác nhận.",
        "Gửi biên bản nhận thép PDF có ảnh bằng chứng qua Zalo.",
      ],
    },
  ],
};

document.addEventListener("DOMContentLoaded", () => {
  const set = (sel, fn) => document.querySelectorAll(sel).forEach(fn);
  set("[data-apk]", (a) => (a.href = SITE.apkUrl));
  set("[data-apk-old]", (a) => (a.href = SITE.apkOldUrl));
  // data-zalo="" (trong câu) | "title" (chân trang) | "button" (nút lớn).
  const zaloText = {
    "": ["nhóm Zalo hỗ trợ", SITE.email],
    title: ["Nhóm Zalo hỗ trợ", SITE.email],
    button: ["Vào nhóm Zalo hỗ trợ", "Hỏi qua email"],
  };
  const contactUrl = SITE.zaloUrl || "mailto:" + SITE.email;
  set("[data-zalo]", (a) => {
    a.href = contactUrl;
    if (SITE.zaloUrl) { a.target = "_blank"; a.rel = "noopener"; }
    const t = zaloText[a.dataset.zalo] || zaloText[""];
    a.textContent = SITE.zaloUrl ? t[0] : t[1];
  });
  // Chưa có nhóm Zalo: ẩn chỗ đã có sẵn link email bên cạnh (tránh lặp email).
  set("[data-zalo-wrap]", (el) => (el.hidden = !SITE.zaloUrl));
  set("[data-email]", (a) => {
    a.href = "mailto:" + SITE.email;
    if (!a.textContent.trim()) a.textContent = SITE.email;
  });
  for (const key of ["version", "releaseDate", "apkSizeMb", "apkSha256", "certSha256", "email"]) {
    set(`[data-text="${key}"]`, (el) => (el.textContent = SITE[key]));
  }
  set("[data-video]", (box) => {
    if (!SITE.youtubeId) { box.hidden = true; return; }
    const f = document.createElement("iframe");
    f.src = `https://www.youtube-nocookie.com/embed/${SITE.youtubeId}`;
    f.title = "Video hướng dẫn";
    f.allow = "encrypted-media; picture-in-picture";
    f.allowFullscreen = true;
    box.querySelector(".video").appendChild(f);
  });
  // iPhone: chưa có bản, đổi nút tải thành thông báo.
  if (/iPhone|iPad|iPod/.test(navigator.userAgent)) {
    set("[data-apk]", (a) => {
      a.removeAttribute("href");
      a.textContent = SITE.zaloUrl
        ? "Bản iPhone sắp có — vào nhóm Zalo để nhận tin"
        : "Bản iPhone sắp có — email để nhận tin";
      a.href = contactUrl;
    });
  }
  const y = document.querySelector("[data-year]");
  if (y) y.textContent = new Date().getFullYear();
  startStats();
});

// Đếm lượt xem bằng GoatCounter. Nguồn (?ref= / ?src= / ?utm_source=) được nhớ trong
// phiên để lượt bấm tải ở trang khác (vd cai-dat.html) vẫn biết người đến từ kênh nào.
function startStats() {
  if (!SITE.goatcounter) return;
  const q = new URLSearchParams(location.search);
  let src = q.get("ref") || q.get("src") || q.get("utm_source") || "";
  try {
    if (src) sessionStorage.setItem("ksbt-src", src);
    else src = sessionStorage.getItem("ksbt-src") || "";
  } catch (e) { /* trình duyệt chặn lưu trữ: chỉ mất nguồn ở trang sau */ }

  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  document.querySelectorAll("[data-apk], [data-apk-old]").forEach((a) => {
    a.dataset.goatcounterClick = ios ? "iphone-hoi-zalo" : a.hasAttribute("data-apk-old") ? "tai-apk-may-cu" : "tai-apk";
    a.dataset.goatcounterTitle = "Tải APK " + SITE.version;
    if (src) a.dataset.goatcounterReferrer = src;
  });

  window.goatcounter = {
    // Bỏ query khỏi đường dẫn (gộp ?ref= vào cùng 1 trang); riêng phien-ban.html giữ ?v=
    // để biết người dùng đang cài bản nào khi bấm "Kiểm tra bản mới" trong app.
    path: () => location.pathname + (q.get("v") ? "?v=" + q.get("v") : ""),
    referrer: (r) => src || r,
  };
  const s = document.createElement("script");
  s.async = true;
  s.src = "https://gc.zgo.at/count.js";
  s.dataset.goatcounter = `https://${SITE.goatcounter}.goatcounter.com/count`;
  document.head.appendChild(s);
}
