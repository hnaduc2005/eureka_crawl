export const SOURCE = 'https://binhchon.khoahoctre.com.vn';
const snapshots = new Map();
const pending = new Map();
const COOLDOWN_MS = 10_000;

class SourceError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}

export async function sourceJSON(path, fetcher = fetch) {
  let response;
  try {
    response = await fetcher(SOURCE + '/api/' + path, {
      headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
      signal: AbortSignal.timeout(20_000), redirect: 'error',
    });
  } catch { throw new SourceError('Không kết nối được trang bình chọn. Kiểm tra mạng và thử lại.'); }
  if (response.status === 429) throw new SourceError('Trang nguồn đang giới hạn lượt truy cập. Vui lòng đợi một lúc rồi thử lại.', 429);
  if (!response.ok) throw new SourceError('Trang bình chọn trả về lỗi HTTP ' + response.status + '. Hãy thử lại sau.');
  try { return await response.json(); }
  catch { throw new SourceError('Trang nguồn không trả về dữ liệu JSON hợp lệ.'); }
}

export async function listCompetitions(fetcher = fetch) {
  const list = await sourceJSON('competitions?all=true', fetcher);
  if (!Array.isArray(list) || list.some(c => typeof c.id !== 'string' || typeof c.name !== 'string')) throw new SourceError('Định dạng danh sách cuộc thi đã thay đổi.');
  return list.map(({ id, name, isOpen }) => ({ id, name, isOpen: isOpen === true }));
}

function validatePage(data, expectedPage) {
  if (!data || !Array.isArray(data.items) || data.page !== expectedPage || !Number.isSafeInteger(data.pageSize) || data.pageSize < 1 || data.pageSize > 100 || !Number.isSafeInteger(data.totalCount) || data.totalCount < 0 || data.totalCount > 50_000) throw new SourceError('Cấu trúc phân trang của trang nguồn đã thay đổi. Chưa cập nhật dữ liệu.');
  if (data.items.length > data.pageSize) throw new SourceError('Số đề tài trong trang không khớp phân trang.');
  return data;
}

export async function crawlCompetition(id, fetcher = fetch) {
  const started = Date.now();
  const prefix = 'c/' + encodeURIComponent(id);
  const [competition, categories, rawFirst] = await Promise.all([
    sourceJSON('competitions/' + encodeURIComponent(id), fetcher),
    sourceJSON(prefix + '/categories', fetcher),
    sourceJSON(prefix + '/entries?page=1&pageSize=100', fetcher),
  ]);
  if (!competition || competition.id !== id || typeof competition.name !== 'string' || !Array.isArray(categories) || categories.some(c => !Number.isSafeInteger(c.id) || typeof c.name !== 'string' || typeof c.code !== 'string')) throw new SourceError('Định dạng thông tin cuộc thi hoặc lĩnh vực đã thay đổi.');
  const first = validatePage(rawFirst, 1);
  const pageCount = Math.max(1, Math.ceil(first.totalCount / first.pageSize));
  const pages = [first];
  // Fetch small batches to keep traffic to the source modest.
  for (let start = 2; start <= pageCount; start += 3) {
    const batch = Array.from({ length: Math.min(3, pageCount - start + 1) }, (_, i) => start + i);
    const results = await Promise.all(batch.map(async page => {
      const data = validatePage(await sourceJSON(prefix + '/entries?page=' + page + '&pageSize=' + first.pageSize, fetcher), page);
      if (data.totalCount !== first.totalCount || data.pageSize !== first.pageSize) throw new SourceError('Danh sách đề tài vừa thay đổi trong lúc tải. Vui lòng cập nhật lại.');
      return data;
    }));
    pages.push(...results);
  }
  const categoryMap = new Map(categories.map(c => [c.id, c]));
  const seen = new Set();
  const entries = pages.flatMap(p => p.items).map(e => {
    if (!Number.isSafeInteger(e.id) || seen.has(e.id) || typeof e.code !== 'string' || typeof e.title !== 'string' || !categoryMap.has(e.categoryId)) throw new SourceError('Có đề tài trùng lặp hoặc thiếu thông tin. Chưa cập nhật dữ liệu.');
    seen.add(e.id);
    const category = categoryMap.get(e.categoryId);
    const voteCount = e.voteCount == null ? null : e.voteCount;
    if (voteCount !== null && (!Number.isSafeInteger(voteCount) || voteCount < 0)) throw new SourceError('Số bình chọn không hợp lệ trong dữ liệu nguồn.');
    return { id: e.id, code: e.code, title: e.title, author: typeof e.author === 'string' ? e.author : '', categoryId: e.categoryId, categoryName: category.name, voteCount, url: SOURCE + '/c/' + encodeURIComponent(id) + '/' + encodeURIComponent(category.code) + '/' + e.id };
  });
  if (entries.length !== first.totalCount) throw new SourceError('Chưa tải đủ toàn bộ đề tài. Vui lòng cập nhật lại.');
  return { competition: { id, name: competition.name, showLiveCounts: competition.showLiveCounts === true }, categories, entries, totalCount: entries.length, source: SOURCE, startedAt: new Date(started).toISOString(), fetchedAt: new Date().toISOString(), durationMs: Date.now() - started, pages: pageCount };
}

export function toCSV(entries) {
  const cell = value => {
    let text = value == null ? '' : String(value);
    if (/^[\s]*[=+@-]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  const rows = [['Mã đề tài', 'Tên đề tài', 'Tác giả', 'Lĩnh vực', 'Số bình chọn', 'Liên kết'], ...entries.map(e => [e.code, e.title, e.author, e.categoryName, e.voteCount, e.url])];
  return '\uFEFF' + rows.map(row => row.map(cell).join(',')).join('\r\n');
}

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method !== 'GET') return json({ error: 'Chỉ hỗ trợ GET.' }, 405);
    try {
      if (url.pathname === '/api/competitions') return json(await listCompetitions());
      if (url.pathname === '/api/snapshot') {
        const id = url.searchParams.get('competition');
        if (!id || !/^[a-zA-Z0-9_-]{1,100}$/.test(id)) return json({ error: 'Mã cuộc thi không hợp lệ.' }, 400);
        const cached = snapshots.get(id);
        if (cached && (url.searchParams.get('refresh') !== '1' || Date.now() - Date.parse(cached.fetchedAt) < COOLDOWN_MS)) return json(cached);
        if (!pending.has(id)) {
          const task = (async () => {
            const available = await listCompetitions();
            if (!available.some(c => c.id === id)) throw new SourceError('Không tìm thấy cuộc thi.', 404);
            const data = await crawlCompetition(id);
            snapshots.set(id, data);
            return data;
          })();
          pending.set(id, task);
          task.finally(() => pending.delete(id)).catch(() => {});
        }
        return json(await pending.get(id));
      }
      if (url.pathname === '/favicon.svg') return new Response('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="#0e7663"/><path d="M16 42V30m16 12V18m16 24V25" stroke="#fff" stroke-width="7" stroke-linecap="round"/></svg>', { headers: { 'Content-Type': 'image/svg+xml' } });
      if (url.pathname !== '/') return json({ error: 'Không tìm thấy trang.' }, 404);
      return new Response(HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin' } });
    } catch (error) {
      return json({ error: error instanceof SourceError ? error.message : 'Không thể cập nhật dữ liệu lúc này. Vui lòng thử lại.' }, error instanceof SourceError ? error.status : 500);
    }
  },
};

const HTML = String.raw`<!doctype html>
<html lang="vi"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Euréka | Theo dõi bình chọn</title><meta name="description" content="Theo dõi số bình chọn các đề tài Euréka. Tìm kiếm, lọc lĩnh vực, sắp xếp và cập nhật dữ liệu từ trang bình chọn Khoa học trẻ."><link rel="icon" href="/favicon.svg" type="image/svg+xml">
<style>
:root{--bg:#f5f7f6;--ink:#192d28;--muted:#71827c;--green:#0e7663;--line:#e3eae6;font-family:Inter,"Segoe UI",Arial,sans-serif;color:var(--ink);background:var(--bg);font-synthesis:none}
*{box-sizing:border-box}body{margin:0}button,input,select{font:inherit}button,a,select{cursor:pointer}button:disabled{cursor:wait;opacity:.65}button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid #63b9a3;outline-offset:3px}a{color:inherit;text-decoration:none}button{color:inherit}svg{width:19px;height:19px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round;flex-shrink:0}.shell{max-width:1480px;margin:auto;padding:0 48px}header{height:84px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line)}.brand{display:flex;align-items:center;gap:12px}.brand-icon{width:37px;height:37px;display:grid;place-items:center;background:var(--green);border-radius:11px;color:white}.brand-icon svg{width:24px;height:24px}.wordmark{font-size:22px;letter-spacing:-.8px;font-weight:750}.wordmark span{font-weight:400;color:#8c9a94;margin-left:8px;font-size:13px;letter-spacing:0}.source-link{display:flex;align-items:center;gap:9px;color:#5d7169;font-size:13px}.source-link svg{width:15px}.intro{display:flex;justify-content:space-between;align-items:flex-end;gap:24px;padding:37px 0 27px}.eyebrow{font-size:10px;letter-spacing:1.8px;color:var(--green);font-weight:750;margin-bottom:10px}.title-row{display:flex;gap:13px;align-items:center}h1{font-size:31px;letter-spacing:-1.1px;line-height:1.2;margin:0;font-weight:700}.badge{border:1px solid #cee4d9;padding:5px 9px;border-radius:6px;background:#edf6f0;color:var(--green);font-size:11px;white-space:nowrap}.dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:#279474;margin-right:6px}p.subtitle{color:var(--muted);font-size:13px;line-height:1.7;margin:11px 0 0}.update-actions{text-align:right}.btn{border:1px solid var(--line);background:white;border-radius:8px;padding:10px 15px;font-size:12px;display:inline-flex;align-items:center;gap:8px;font-weight:600;white-space:nowrap}.btn:hover{background:#f0f5f2}.btn.primary{background:var(--green);border-color:var(--green);color:#fff;padding:11px 17px;box-shadow:0 3px 5px #0e766310}.btn.primary:hover{background:#0a6253}.btn svg{width:16px;height:16px}.updated{color:var(--muted);font-size:11px;margin-top:9px;font-variant-numeric:tabular-nums}.stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:17px;margin-bottom:24px}.stat{background:white;border:1px solid var(--line);border-radius:12px;padding:21px 23px;min-height:126px}.stat-label{font-size:12px;color:#6b7f75;display:flex;align-items:center;gap:7px}.stat-label svg{width:15px;height:15px}.stat-value{font-size:32px;letter-spacing:-1px;font-weight:650;margin-top:12px;font-variant-numeric:tabular-nums;line-height:1}.stat-sub{font-size:11px;color:#87948e;margin-top:9px}.stat.accent{background:#eef6f0;border-color:#d8e9dc}.stat.accent .stat-value{color:var(--green)}.stat.accent .stat-sub{color:#5f8270}.content-grid{display:grid;grid-template-columns:minmax(0,1fr) 285px;gap:22px;align-items:start}.panel{background:white;border:1px solid var(--line);border-radius:12px;overflow:hidden}.panel-head{padding:22px 23px 18px;display:flex;align-items:center;justify-content:space-between;gap:12px}h2{font-size:15px;font-weight:650;margin:0;letter-spacing:-.15px}.count{font-size:10px;color:#77877f;background:#f2f5f3;border:1px solid var(--line);padding:3px 7px;border-radius:5px;margin-left:8px;white-space:nowrap}.tools{padding:0 23px 18px;display:grid;grid-template-columns:1fr 185px 170px;gap:9px}.input-wrap{position:relative}.input-wrap svg{position:absolute;top:11px;left:11px;width:16px;color:#93a098}.input-wrap input{width:100%;padding:11px 10px 11px 35px}.field{background:#fff;border:1px solid #dde5df;border-radius:7px;min-width:0;color:#4e6258;font-size:11px;height:39px}select.field{padding:0 24px 0 11px;max-width:100%}input::placeholder{color:#94a198}.table-scroll{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:12px}thead{background:#f7f9f7;color:#77867e;font-size:10px;letter-spacing:.4px}th{text-align:left;font-weight:600;border-top:1px solid var(--line);border-bottom:1px solid var(--line);padding:13px 10px}th:first-child,td:first-child{padding-left:23px;width:61px}th:last-child,td:last-child{padding-right:21px;text-align:center;width:43px}td{padding:16px 10px;border-bottom:1px solid #edf0ed;vertical-align:middle}tbody tr:hover{background:#fafcfb}tbody tr:last-child td{border-bottom:0}.rank{font-size:12px;color:#93a198;font-variant-numeric:tabular-nums}.rank.top{background:#edf5ef;color:var(--green);font-size:11px;font-weight:650;width:25px;height:25px;display:inline-grid;place-items:center;border-radius:7px}.entry-title{font-size:12px;line-height:1.6;font-weight:550;display:block;max-width:530px;overflow-wrap:anywhere}.entry-title:hover{color:var(--green)}.entry-meta{font-size:10px;color:#98a39d;margin-top:6px;line-height:1.5}.entry-code{color:#668173;font-weight:600;margin-right:8px}.category-tag{display:inline-block;line-height:1.4;font-size:10px;color:#758479;border-radius:5px;padding:5px 7px;background:#f3f6f3;max-width:145px}.votes{text-align:right;font-size:14px;font-weight:650;white-space:nowrap;font-variant-numeric:tabular-nums;color:#285e4a;min-width:100px}.vote-th{text-align:right}.sort-heading{font-size:10px;letter-spacing:.3px;border:0;background:none;color:var(--green);padding:0;display:inline-flex;gap:5px;align-items:center}.sort-heading svg{width:12px;height:12px}.visit{color:#a3afa6;padding:5px;display:inline-flex}.visit:hover{color:var(--green)}.visit svg{width:14px;height:14px}.pagination{display:flex;justify-content:space-between;gap:12px;align-items:center;border-top:1px solid var(--line);padding:16px 23px;font-size:10px;color:#8a978e}.page-buttons{display:flex;gap:5px;align-items:center}.page-btn{border:1px solid var(--line);border-radius:5px;background:#fff;min-width:28px;height:28px;font-size:10px}.page-btn:hover{background:#eef5ef}.page-btn.current{color:white;background:var(--green);border-color:var(--green)}.page-btn:disabled{opacity:.4;cursor:default}.ellipsis{padding:0 3px}.sidebar .panel{margin-bottom:17px}.sidebar .panel-head{padding:22px 21px 0}.panel-desc{font-size:11px;line-height:1.65;color:#8b978f;margin:8px 21px 21px}.top-list{padding:0 21px 7px}.top-item{margin-bottom:22px}.top-label{display:flex;justify-content:space-between;gap:12px;font-size:10px;margin-bottom:7px}.top-label a{font-weight:600;color:#53705f}.top-label span{font-weight:700;font-variant-numeric:tabular-nums}.bar-track{height:5px;background:#eff3ef;border-radius:3px;overflow:hidden}.bar{height:100%;background:var(--green);border-radius:3px}.top-item:nth-child(2) .bar{background:#4d9a80}.top-item:nth-child(3) .bar{background:#7bb59b}.top-item:nth-child(4) .bar{background:#a1c9b2}.top-item:nth-child(5) .bar{background:#c0d9c8}.top-caption{font-size:10px;color:#939e97;margin-top:7px;white-space:nowrap;text-overflow:ellipsis;overflow:hidden;line-height:1.6}.note{background:#f0f4ee;border:1px solid #e2e8dc;border-radius:11px;padding:19px 20px;font-size:11px;color:#7a8877;line-height:1.9}.note-title{font-size:12px;font-weight:650;color:#4b6753;margin-bottom:7px;display:flex;gap:8px;align-items:center}.note-title svg{width:16px}.note p{margin:0}.status-line{border-top:1px solid #dfe7da;padding-top:12px;margin-top:13px;font-size:10px;color:#6d826c}.competition-select{margin:0 21px 21px;width:calc(100% - 42px)}.notice{padding:13px 16px;border-radius:8px;font-size:12px;line-height:1.7;margin:0 0 18px;background:#fff5e4;border:1px solid #efdebc;color:#89672d}.notice[hidden]{display:none}.empty{padding:65px 25px;text-align:center;color:#809086;font-size:13px;line-height:1.9}.empty strong{display:block;color:#4d6758;margin-bottom:6px;font-weight:600}.loading svg{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}footer{display:flex;justify-content:space-between;gap:16px;color:#99a49c;font-size:10px;line-height:1.7;padding:27px 0 31px}footer a{text-decoration:underline;text-underline-offset:3px}.sr-only{position:absolute;width:1px;height:1px;padding:0;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap}.muted{color:#8f9c93}.updated.busy{color:var(--green)}
@media(max-width:1150px){.shell{padding:0 25px}.content-grid{grid-template-columns:minmax(0,1fr) 250px;gap:16px}.tools{grid-template-columns:1fr 1fr}.input-wrap{grid-column:1/-1}.wordmark span{display:none}.category-col{max-width:110px}.stat{padding:20px 17px}}@media(max-width:850px){.content-grid{grid-template-columns:1fr}.sidebar{display:grid;grid-template-columns:1fr 1fr;gap:17px}.sidebar .panel{margin:0}.sidebar .competition-panel{grid-column:1/-1}.competition-select{margin-top:16px}.stat-value{font-size:27px}.intro{align-items:flex-start}h1{font-size:27px}.badge{display:none}}@media(max-width:560px){.shell{padding:0 16px}header{height:68px}.wordmark{font-size:21px}.source-link{font-size:11px;gap:5px}.intro{display:block;padding:28px 0 20px}h1{font-size:28px}.eyebrow{font-size:9px}.update-actions{display:flex;justify-content:space-between;align-items:center;text-align:left;margin-top:18px;gap:12px}.updated{margin:0;max-width:150px;font-size:10px}.stats{grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px}.stat{padding:17px 16px;min-height:115px}.stat-label{font-size:10px}.stat-value{font-size:28px}.stat-sub{font-size:10px;line-height:1.5}.panel-head{padding:19px 15px 16px}.panel-head .btn{padding:8px 9px;font-size:10px}.count{margin-left:4px;font-size:9px}.tools{padding:0 15px 15px;gap:8px}.field{font-size:10px}th:first-child,td:first-child{padding-left:15px;width:43px}td{padding:15px 8px}.entry-title{min-width:175px;font-size:11px}.entry-meta{font-size:9px}.author{display:none}.category-col{display:none}.votes{font-size:13px;min-width:80px}.pagination{padding:14px 15px;align-items:flex-start;flex-direction:column}.sidebar{display:block}.sidebar .panel,.note{margin-top:15px}.top-list{display:grid;grid-template-columns:1fr 1fr;gap:0 20px}.competition-select{margin-top:0}footer{display:block;font-size:9px;padding:23px 0}footer span{display:block;margin-top:4px}}@media(prefers-reduced-motion:reduce){*{animation:none!important}}
</style></head><body>
<svg class="sr-only" xmlns="http://www.w3.org/2000/svg"><defs>
<symbol id="i-chart" viewBox="0 0 24 24"><path d="M5 19V12m7 7V5m7 14V9" stroke-width="2.6"/></symbol>
<symbol id="i-reload" viewBox="0 0 24 24"><path d="M20 11a8 8 0 1 0-2 6M20 4v7h-7"/></symbol>
<symbol id="i-link" viewBox="0 0 24 24"><path d="M14 4h6v6M20 4 10 14M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5"/></symbol>
<symbol id="i-search" viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></symbol>
<symbol id="i-download" viewBox="0 0 24 24"><path d="M12 3v12m-4-4 4 4 4-4M4 16v4h16v-4"/></symbol>
<symbol id="i-grid" viewBox="0 0 24 24"><rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/></symbol>
<symbol id="i-vote" viewBox="0 0 24 24"><path d="m7 10-3 3v7h16v-7l-3-3M9 16h6M8 5l5-3 5 7-5 4z"/></symbol>
<symbol id="i-cup" viewBox="0 0 24 24"><path d="M8 4h8v6a4 4 0 0 1-8 0V4ZM8 6H4v3a4 4 0 0 0 4 4m8-7h4v3a4 4 0 0 1-4 4m-4 1v6m-4 0h8"/></symbol>
<symbol id="i-info" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.1"/></symbol>
<symbol id="i-sort" viewBox="0 0 24 24"><path d="M12 4v16m-5-5 5 5 5-5"/></symbol>
</defs></svg><div class="shell">
<header><a href="/" class="brand" aria-label="Euréka dashboard"><span class="brand-icon"><svg><use href="#i-chart"/></svg></span><span class="wordmark">euréka<span>VOTE OBSERVER</span></span></a><a class="source-link" href="https://binhchon.khoahoctre.com.vn/" target="_blank" rel="noopener noreferrer"><span>Trang bình chọn chính thức</span><svg><use href="#i-link"/></svg></a></header>
<main><section class="intro"><div><div class="eyebrow">KHOA HỌC TRẺ · <span id="competition-label">EURÉKA</span></div><div class="title-row"><h1>Theo dõi bình chọn</h1><span class="badge"><span class="dot"></span>Dữ liệu công khai</span></div><p class="subtitle">Mỗi đề tài, một ý tưởng. Theo dõi những ý tưởng đang được quan tâm.</p></div><div class="update-actions"><button id="reload" class="btn primary" type="button"><svg><use href="#i-reload"/></svg><span>Cập nhật dữ liệu</span></button><div class="updated" id="updated" role="status" aria-live="polite">Chưa có lần cập nhật nào</div></div></section>
<div id="notice" class="notice" role="alert" hidden></div>
<section class="stats" aria-label="Thống kê toàn cuộc thi">
<div class="stat"><div class="stat-label"><svg><use href="#i-grid"/></svg>Tổng đề tài</div><div class="stat-value" id="stat-entries">—</div><div class="stat-sub">Trong toàn bộ cuộc thi</div></div>
<div class="stat accent"><div class="stat-label"><svg><use href="#i-vote"/></svg>Tổng lượt bình chọn</div><div class="stat-value" id="stat-votes">—</div><div class="stat-sub" id="votes-sub">Cộng từ các đề tài đã công khai số phiếu</div></div>
<div class="stat"><div class="stat-label"><svg><use href="#i-cup"/></svg>Bình chọn cao nhất</div><div class="stat-value" id="stat-highest">—</div><div class="stat-sub" id="highest-code">Đang chờ dữ liệu</div></div>
<div class="stat"><div class="stat-label"><svg><use href="#i-chart"/></svg>Lĩnh vực nghiên cứu</div><div class="stat-value" id="stat-categories">—</div><div class="stat-sub">Đa dạng ý tưởng, chung niềm đam mê</div></div></section>
<div class="content-grid"><section class="panel" aria-label="Danh sách đề tài"><div class="panel-head"><h2>Danh sách đề tài <span class="count" id="result-count">Đang tải</span></h2><button id="export" class="btn" type="button" disabled><svg><use href="#i-download"/></svg>Xuất CSV</button></div>
<div class="tools"><div class="input-wrap"><label class="sr-only" for="search">Tìm tên, mã đề tài hoặc tác giả</label><svg><use href="#i-search"/></svg><input class="field" id="search" type="search" placeholder="Tìm tên, mã đề tài hoặc tác giả…" autocomplete="off"></div><label class="sr-only" for="category">Lọc lĩnh vực</label><select class="field" id="category"><option value="">Tất cả lĩnh vực</option></select><label class="sr-only" for="sort">Sắp xếp đề tài</label><select class="field" id="sort"><option value="votes-desc">Bình chọn: cao → thấp</option><option value="votes-asc">Bình chọn: thấp → cao</option><option value="code-asc">Mã đề tài: A → Z</option><option value="title-asc">Tên đề tài: A → Z</option></select></div>
<div class="table-scroll"><table><thead><tr><th scope="col">HẠNG</th><th scope="col">ĐỀ TÀI NGHIÊN CỨU</th><th class="category-col" scope="col">LĨNH VỰC</th><th class="vote-th" id="vote-th" scope="col" aria-sort="descending"><button id="vote-sort" class="sort-heading" type="button">BÌNH CHỌN<svg><use href="#i-sort"/></svg></button></th><th scope="col"><span class="sr-only">Xem đề tài</span></th></tr></thead><tbody id="rows"><tr><td colspan="5"><div class="empty"><strong>Đang kết nối trang bình chọn…</strong>Đang lấy đầy đủ các trang dữ liệu.</div></td></tr></tbody></table></div><div class="pagination"><span id="range">Chưa có dữ liệu</span><nav class="page-buttons" id="pagination" aria-label="Phân trang"></nav></div></section>
<aside class="sidebar"><section class="panel"><div class="panel-head"><h2>5 đề tài dẫn đầu</h2><svg style="color:#a5b2a8;width:16px"><use href="#i-cup"/></svg></div><p class="panel-desc" id="top-desc">Theo số bình chọn toàn cuộc thi</p><div id="top-list" class="top-list"><p class="muted" style="font-size:11px">Đang chờ dữ liệu…</p></div></section>
<div class="note"><div class="note-title"><svg><use href="#i-info"/></svg>Về dữ liệu</div><p>Số phiếu được lấy từ trang bình chọn Khoa học trẻ khi bạn nhấn cập nhật. Bảng và thứ hạng được tính trên toàn bộ đề tài đã tải.</p><div class="status-line" id="crawl-status">Chưa có bản dữ liệu hoàn chỉnh</div></div>
<section class="panel competition-panel"><div class="panel-head"><h2>Cuộc thi đang xem</h2></div><p class="panel-desc">Chọn cuộc thi từ trang nguồn</p><label for="competition" class="sr-only">Cuộc thi</label><select class="field competition-select" id="competition" disabled><option>Đang kết nối…</option></select></section></aside></div></main>
<footer><span>Nguồn: <a href="https://binhchon.khoahoctre.com.vn/" target="_blank" rel="noopener noreferrer">binhchon.khoahoctre.com.vn</a> · Dashboard theo dõi độc lập</span><span>Số phiếu có thể thay đổi trong quá trình thu thập dữ liệu.</span></footer>
</div><script>
(function(){
'use strict';
var $=function(id){return document.getElementById(id)},nf=new Intl.NumberFormat('vi-VN'),PAGE_SIZE=25;
var snapshot=null,filtered=[],ranks=new Map(),page=1,busy=false,selectedId='',cooldownUntil=0;
var icon=function(name){var s=document.createElementNS('http://www.w3.org/2000/svg','svg'),u=document.createElementNS('http://www.w3.org/2000/svg','use');u.setAttribute('href','#i-'+name);s.append(u);return s};
var el=function(tag,cls,text){var n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n};
var normalize=function(s){return s.toLocaleLowerCase('vi').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d')};
var voteCompare=function(a,b){return (b.voteCount===null?-1:b.voteCount)-(a.voteCount===null?-1:a.voteCount)||a.code.localeCompare(b.code,'vi',{numeric:true})};
var fmt=function(n){return n===null?'Chưa công khai':nf.format(n)};
var time=function(value){return new Date(value).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh',hour:'2-digit',minute:'2-digit',second:'2-digit',day:'2-digit',month:'2-digit',year:'numeric'})};
function notify(message){$('notice').textContent=message;$('notice').hidden=!message}
function store(data){try{localStorage.setItem('eureka-snapshot-'+data.competition.id,JSON.stringify(data))}catch{}}
function cached(id){try{var data=JSON.parse(localStorage.getItem('eureka-snapshot-'+id));if(data&&data.competition.id===id&&Array.isArray(data.entries)&&Array.isArray(data.categories)&&data.fetchedAt)return data}catch{}return null}
async function api(path){var response=await fetch(path,{cache:'no-store',signal:AbortSignal.timeout(240000)}),data;try{data=await response.json()}catch{throw Error('Máy chủ không trả về dữ liệu hợp lệ.')}if(!response.ok)throw Error(data.error||'Không thể tải dữ liệu.');return data}
function apply(data,old){snapshot=data;$('competition-label').textContent=data.competition.name.toUpperCase();$('stat-entries').textContent=fmt(data.entries.length);var known=data.entries.filter(function(e){return e.voteCount!==null}),ordered=known.slice().sort(voteCompare);$('stat-votes').textContent=known.length?fmt(known.reduce(function(s,e){return s+e.voteCount},0)):'—';$('votes-sub').textContent=known.length===data.entries.length?'Cộng từ toàn bộ đề tài':fmt(known.length)+' / '+fmt(data.entries.length)+' đề tài đã công khai số phiếu';$('stat-highest').textContent=ordered.length?fmt(ordered[0].voteCount):'—';$('highest-code').textContent=ordered.length?ordered[0].code:'Chưa công khai số phiếu';$('stat-categories').textContent=fmt(data.categories.length);
 var prevVotes=null,rank=0;ranks=new Map();data.entries.slice().sort(voteCompare).forEach(function(e,i){if(e.voteCount!==null){if(e.voteCount!==prevVotes)rank=i+1;ranks.set(e.id,rank);prevVotes=e.voteCount}});
 var current=$('category').value;$('category').replaceChildren(new Option('Tất cả lĩnh vực',''));data.categories.forEach(function(c){$('category').add(new Option(c.name,String(c.id)))});$('category').value=data.categories.some(function(c){return String(c.id)===current})?current:'';
 $('updated').textContent=(old?'Bản đã lưu: ':'Cập nhật: ')+time(data.fetchedAt);$('crawl-status').textContent=fmt(data.entries.length)+' / '+fmt(data.totalCount)+' đề tài · '+data.pages+' trang · '+(data.durationMs/1000).toLocaleString('vi-VN',{maximumFractionDigits:1})+' giây';$('export').disabled=false;render();
}
function render(){if(!snapshot)return;var q=normalize($('search').value.trim()),cat=$('category').value,sort=$('sort').value;filtered=snapshot.entries.filter(function(e){return (!cat||String(e.categoryId)===cat)&&(!q||normalize(e.code+' '+e.title+' '+e.author).includes(q))});filtered.sort(function(a,b){if(sort==='votes-desc')return voteCompare(a,b);if(sort==='votes-asc'){if(a.voteCount===null||b.voteCount===null)return a.voteCount===null?(b.voteCount===null?0:1):-1;return a.voteCount-b.voteCount||a.code.localeCompare(b.code,'vi',{numeric:true})}return (sort==='code-asc'?a.code:a.title).localeCompare(sort==='code-asc'?b.code:b.title,'vi',{numeric:true})});
 $('vote-th').setAttribute('aria-sort',sort==='votes-desc'?'descending':sort==='votes-asc'?'ascending':'none');$('vote-sort').lastChild.style.transform=sort==='votes-asc'?'rotate(180deg)':'';$('result-count').textContent=fmt(filtered.length)+' đề tài';var maxPages=Math.max(1,Math.ceil(filtered.length/PAGE_SIZE));page=Math.min(page,maxPages);var rows=$('rows');rows.replaceChildren();
 filtered.slice((page-1)*PAGE_SIZE,page*PAGE_SIZE).forEach(function(e){var row=el('tr'),rank=ranks.get(e.id),rankCell=el('td'),rankLabel=el('span','rank'+(rank&&rank<=3?' top':''),rank?String(rank).padStart(2,'0'):'—');rankLabel.title='Thứ hạng toàn cuộc thi; các đề tài bằng phiếu có cùng hạng';rankCell.append(rankLabel);row.append(rankCell);var info=el('td'),link=el('a','entry-title',e.title);link.href=e.url;link.target='_blank';link.rel='noopener noreferrer';info.append(link);var meta=el('div','entry-meta');meta.append(el('span','entry-code',e.code),el('span','author',e.author));info.append(meta);row.append(info);var catCell=el('td','category-col');catCell.append(el('span','category-tag',e.categoryName));row.append(catCell,el('td','votes',fmt(e.voteCount)));var visitCell=el('td'),visit=el('a','visit');visit.href=e.url;visit.target='_blank';visit.rel='noopener noreferrer';visit.setAttribute('aria-label','Xem đề tài '+e.code);visit.append(icon('link'));visitCell.append(visit);row.append(visitCell);rows.append(row)});
 if(!filtered.length){var row=el('tr'),cell=el('td'),empty=el('div','empty');cell.colSpan=5;empty.append(el('strong','',snapshot.entries.length?'Không tìm thấy đề tài phù hợp':'Cuộc thi chưa có đề tài'));if(snapshot.entries.length)empty.append(document.createTextNode('Thử từ khóa khác hoặc chọn tất cả lĩnh vực.'));cell.append(empty);row.append(cell);rows.append(row)}
 $('range').textContent=filtered.length?'Hiển thị '+nf.format((page-1)*PAGE_SIZE+1)+'–'+nf.format(Math.min(page*PAGE_SIZE,filtered.length))+' / '+fmt(filtered.length)+' đề tài':'0 đề tài';renderPages(maxPages);renderTop();
}
function renderPages(max){var nav=$('pagination');nav.replaceChildren();function button(label,target,current){var b=el('button','page-btn'+(current?' current':''),label);b.type='button';b.disabled=target<1||target>max;b.setAttribute('aria-label','Trang '+target);if(current)b.setAttribute('aria-current','page');b.addEventListener('click',function(){page=target;render()});nav.append(b)}button('‹',page-1,false);var pages=Array.from(new Set([1,page-1,page,page+1,max])).filter(function(p){return p>=1&&p<=max}).sort(function(a,b){return a-b}),last=0;pages.forEach(function(p){if(last&&p-last>1)nav.append(el('span','ellipsis','…'));button(String(p),p,p===page);last=p});button('›',page+1,false)}
function renderTop(){var top=filtered.filter(function(e){return e.voteCount!==null}).slice().sort(voteCompare).slice(0,5),list=$('top-list');list.replaceChildren();$('top-desc').textContent=$('category').value||$('search').value?'Trong danh sách đang lọc':'Theo số bình chọn toàn cuộc thi';top.forEach(function(e){var item=el('div','top-item'),label=el('div','top-label'),link=el('a','',e.code);link.href=e.url;link.target='_blank';link.rel='noopener noreferrer';label.append(link,el('span','',fmt(e.voteCount)));var track=el('div','bar-track'),bar=el('div','bar');bar.style.width=(top[0].voteCount?e.voteCount/top[0].voteCount*100:0)+'%';track.append(bar);var caption=el('div','top-caption',e.title);caption.title=e.title;item.append(label,track,caption);list.append(item)});if(!top.length)list.append(el('p','muted','Chưa có số phiếu để xếp hạng.'))}
function setBusy(value){busy=value;$('reload').classList.toggle('loading',value);$('updated').classList.toggle('busy',value);$('competition').disabled=value;tick()}
function tick(){var seconds=Math.max(0,Math.ceil((cooldownUntil-Date.now())/1000));$('reload').disabled=busy||seconds>0;$('reload').lastElementChild.textContent=busy?'Đang lấy dữ liệu…':seconds>0?'Cập nhật lại sau '+seconds+'s':'Cập nhật dữ liệu'}
async function refresh(){if(busy)return;setBusy(true);notify('');try{if(!selectedId){var comps=await api('/api/competitions');if(!comps.length)throw Error('Trang nguồn chưa có cuộc thi nào.');$('competition').replaceChildren();comps.forEach(function(c){$('competition').add(new Option(c.name+(c.isOpen?'':' · Đã đóng'),c.id))});selectedId=comps[0].id;$('competition').value=selectedId;var saved=cached(selectedId);if(saved){apply(saved,true);notify('Đang hiển thị bản đã lưu trong khi lấy dữ liệu mới.')}}var data=await api('/api/snapshot?competition='+encodeURIComponent(selectedId)+'&refresh=1');apply(data,false);store(data);cooldownUntil=Date.parse(data.fetchedAt)+10000;var hidden=data.entries.filter(function(e){return e.voteCount===null}).length;notify(hidden?'Có '+fmt(hidden)+' đề tài chưa công khai số phiếu. Những đề tài này được hiển thị ở cuối khi sắp xếp theo bình chọn.':'')}catch(error){notify(error.message+(snapshot?' Đang giữ bản dữ liệu lúc '+time(snapshot.fetchedAt)+'.':''));if(!snapshot){$('rows').replaceChildren();var row=el('tr'),cell=el('td'),empty=el('div','empty');cell.colSpan=5;empty.append(el('strong','','Chưa tải được dữ liệu'),document.createTextNode('Nhấn “Cập nhật dữ liệu” để thử lại.'));cell.append(empty);row.append(cell);$('rows').append(row);$('result-count').textContent='Chưa có dữ liệu';$('updated').textContent='Chưa cập nhật thành công'}}finally{setBusy(false)}}
$('search').addEventListener('input',function(){page=1;render()});['category','sort'].forEach(function(id){$(id).addEventListener('change',function(){page=1;render()})});$('vote-sort').addEventListener('click',function(){$('sort').value=$('sort').value==='votes-desc'?'votes-asc':'votes-desc';page=1;render()});$('reload').addEventListener('click',refresh);
$('competition').addEventListener('change',function(){selectedId=this.value;snapshot=null;page=1;$('category').value='';$('search').value='';['stat-entries','stat-votes','stat-highest','stat-categories'].forEach(function(id){$(id).textContent='—'});$('export').disabled=true;$('top-list').replaceChildren();$('rows').replaceChildren();var saved=cached(selectedId);if(saved)apply(saved,true);cooldownUntil=0;refresh()});
$('export').addEventListener('click',function(){if(!snapshot)return;var cell=function(v){var s=v==null?'':String(v);if(/^[\s]*[=+@-]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"'},rows=[['Hạng toàn cuộc thi','Mã đề tài','Tên đề tài','Tác giả','Lĩnh vực','Số bình chọn','Liên kết','Cập nhật lúc'],...filtered.map(function(e){return [ranks.get(e.id)||'',e.code,e.title,e.author,e.categoryName,e.voteCount,e.url,snapshot.fetchedAt]})],csv='\uFEFF'+rows.map(function(row){return row.map(cell).join(',')}).join('\r\n'),url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8;'})),a=el('a');a.href=url;a.download=selectedId+'-'+new Date(snapshot.fetchedAt).toISOString().replace(/[:.]/g,'-')+'.csv';a.click();setTimeout(function(){URL.revokeObjectURL(url)},1000)});
setInterval(tick,1000);refresh();
})();
</script></body></html>`;
