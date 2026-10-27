export const TEST_PROTOCOL = 'eureka-test-v1';

export function parseTestTarget(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Nhập URL môi trường test hoặc chọn bản mô phỏng mẫu.');
  if (value.trim() === 'demo://local') return { kind: 'demo', label: 'Mô phỏng cục bộ', url: 'demo://local' };
  let url;
  try { url = new URL(value.trim()); } catch { throw new Error('URL môi trường test không hợp lệ.'); }
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (host === 'binhchon.khoahoctre.com.vn' || host === 'accounts.google.com' || host === 'google.com' || host.endsWith('.google.com')) throw new Error('Đây không phải địa chỉ môi trường test riêng.');
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(host);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) throw new Error('Môi trường test cần HTTPS; HTTP chỉ dùng cho localhost.');
  if (url.username || url.password || url.search || url.hash) throw new Error('Nhập URL gốc của website test, không kèm tài khoản, token hoặc tham số.');
  return { kind: 'remote', label: url.origin, url: url.href, endpoint: new URL('/api/test-harness', url.origin).href };
}

export function validateTestManifest(value) {
  if (!value || value.protocol !== 'eureka-test-v1' || value.environment !== 'test' || value.isolated !== true || value.simulatedAccounts !== true) throw new Error('Website chưa cung cấp giao thức kiểm thử mô phỏng được hỗ trợ. Chưa gửi thao tác tạo người dùng hoặc phiếu.');
  if (!Array.isArray(value.entries) || value.entries.length < 1 || value.entries.length > 500) throw new Error('Môi trường test chưa có danh sách đề tài hợp lệ.');
  const seen = new Set();
  const entries = value.entries.map(entry => {
    if (!entry || typeof entry.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(entry.id) || seen.has(entry.id) || typeof entry.title !== 'string' || !entry.title.trim()) throw new Error('Danh sách đề tài test không hợp lệ hoặc bị trùng mã.');
    seen.add(entry.id);
    return { id: entry.id, code: String(entry.code || entry.id).slice(0,100), title: entry.title.slice(0,500) };
  });
  const limits = value.limits;
  if (!limits || !Number.isInteger(limits.maxUsers) || limits.maxUsers < 1 || limits.maxUsers > 500 || !Number.isInteger(limits.maxVotes) || limits.maxVotes < 1 || limits.maxVotes > 500 || !Number.isFinite(limits.requestsPerSecond) || limits.requestsPerSecond < 1 || limits.requestsPerSecond > 5) throw new Error('Giới hạn của môi trường test không hợp lệ.');
  return { protocol: 'eureka-test-v1', environment: 'test', isolated: true, simulatedAccounts: true, name: String(value.name || 'Môi trường test').slice(0,100), entries, limits: { ...limits } };
}

export function validateTestScenario(manifest, config) {
  const checked = validateTestManifest(manifest);
  const users = Number(config.users);
  const votes = Number(config.votes);
  if (!Number.isInteger(users) || users < 1 || users > checked.limits.maxUsers) throw new Error('Số người dùng cần từ 1 đến ' + checked.limits.maxUsers + '.');
  if (!Number.isInteger(votes) || votes < 0 || votes > checked.limits.maxVotes || votes > users) throw new Error('Số phiếu cần từ 0 đến ' + Math.min(users, checked.limits.maxVotes) + '; mỗi người dùng test gửi tối đa một phiếu.');
  if (!checked.entries.some(entry => entry.id === config.entryId)) throw new Error('Chọn một đề tài thuộc môi trường test đã kết nối.');
  return { users, votes, entryId: config.entryId, operations: users * 2 + votes, intervalMs: Math.ceil(1000 / checked.limits.requestsPerSecond) };
}

export function createDemoTestEnvironment() {
  const users = new Map();
  const sessions = new Map();
  const ballots = new Map();
  const entries = [
    { id: 'demo-01', code: 'DEMO-001', title: 'Đề tài thử nghiệm A' },
    { id: 'demo-02', code: 'DEMO-002', title: 'Đề tài thử nghiệm B' },
    { id: 'demo-03', code: 'DEMO-003', title: 'Đề tài thử nghiệm C' },
  ];
  return {
    manifest: { protocol: 'eureka-test-v1', environment: 'test', isolated: true, simulatedAccounts: true, name: 'Mô phỏng cục bộ', entries, limits: { maxUsers: 500, maxVotes: 500, requestsPerSecond: 5 } },
    async createUser({ runId, index }) {
      if (users.size >= 5000) throw new Error('Bản mẫu đã đạt giới hạn phiên; kết nối lại bản mẫu để bắt đầu mới.');
      const id = runId + '-' + index;
      if (users.has(id)) return users.get(id);
      const user = { id, password: crypto.randomUUID(), email: 'test' + String(index).padStart(3,'0') + '@example.invalid' };
      users.set(id, user);
      return { ...user };
    },
    async login({ userId, password }) {
      const user = users.get(userId);
      if (!user || user.password !== password) throw new Error('Thông tin đăng nhập test không hợp lệ.');
      const token = crypto.randomUUID();
      sessions.set(token, userId);
      return { token };
    },
    async vote({ token, entryId }) {
      const userId = sessions.get(token);
      if (!userId) throw new Error('Phiên test không hợp lệ.');
      if (!entries.some(entry => entry.id === entryId)) throw new Error('Đề tài test không tồn tại.');
      const key = userId + ':' + entryId;
      if (ballots.has(key)) return { accepted: false, duplicate: true };
      ballots.set(key, { userId, entryId });
      return { accepted: true, total: [...ballots.values()].filter(ballot => ballot.entryId === entryId).length };
    },
  };
}

export async function connectTestEnvironment(target, fetcher = fetch, signal) {
  target = parseTestTarget(target.url);
  if (target.kind === 'demo') return createDemoTestEnvironment();
  // Browser-to-test-server requests only. No backend proxy or production ballot routes.
  async function request(operation, payload, operationSignal) {
    const url = new URL(target.endpoint);
    url.searchParams.set('op', operation);
    let response;
    try {
      response = await fetcher(url.href, {
        method: payload ? 'POST' : 'GET', mode: 'cors', credentials: 'omit', redirect: 'error', cache: 'no-store',
        headers: payload ? { 'Content-Type': 'application/json', Accept: 'application/json' } : { Accept: 'application/json' },
        body: payload ? JSON.stringify(payload) : undefined,
        signal: AbortSignal.any([signal, operationSignal, AbortSignal.timeout(15000)].filter(Boolean)),
      });
    } catch (error) {
      if (signal?.aborted || operationSignal?.aborted) throw signal?.reason || operationSignal?.reason || error;
      throw new Error('Chưa kết nối được API test. Website cần cung cấp /api/test-harness và cho phép kết nối CORS từ dashboard.');
    }
    if (!response.ok) throw new Error('API test trả HTTP ' + response.status + ' ở bước ' + operation + '.');
    try { return await response.json(); } catch { throw new Error('API test chưa trả dữ liệu JSON đúng giao thức.'); }
  }
  const manifest = validateTestManifest(await request('manifest'));
  return {
    manifest,
    createUser: (payload, operationSignal) => request('create-user', payload, operationSignal),
    login: (payload, operationSignal) => request('login', payload, operationSignal),
    vote: (payload, operationSignal) => request('vote', payload, operationSignal),
  };
}

export function waitTestInterval(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason || new Error('Đã dừng kiểm thử.'));
    const abort = () => { clearTimeout(timer); reject(signal.reason || new Error('Đã dừng kiểm thử.')); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

export async function runTestScenario(adapter, config, options = {}) {
  const plan = validateTestScenario(adapter.manifest, config);
  const { signal, onProgress = () => {}, pause = waitTestInterval } = options;
  const result = { runId: 'run-' + crypto.randomUUID(), status: 'running', environment: adapter.manifest.name, simulatedAccounts: true, entryId: plan.entryId, requestedUsers: plan.users, requestedVotes: plan.votes, created: 0, loggedIn: 0, accepted: 0, rejected: 0, operations: 0, totalOperations: plan.operations, startedAt: new Date().toISOString(), error: null };
  let phase = 'create-user';
  const report = () => onProgress({ ...result, phase });
  async function step(action) {
    signal?.throwIfAborted();
    if (result.operations) await pause(plan.intervalMs, signal);
    signal?.throwIfAborted();
    const value = await action();
    result.operations++;
    return value;
  }
  try {
    report();
    for (let index = 1; index <= plan.users; index++) {
      phase = 'create-user';
      const user = await step(() => adapter.createUser({ runId: result.runId, index }, signal));
      if (!user || typeof user.id !== 'string' || typeof user.password !== 'string') throw new Error('API tạo người dùng test trả kết quả không hợp lệ.');
      result.created++; report();
      phase = 'login';
      const session = await step(() => adapter.login({ runId: result.runId, userId: user.id, password: user.password }, signal));
      if (!session || typeof session.token !== 'string' || !session.token) throw new Error('API đăng nhập test chưa trả phiên hợp lệ.');
      result.loggedIn++; report();
      if (index <= plan.votes) {
        phase = 'vote';
        const vote = await step(() => adapter.vote({ runId: result.runId, token: session.token, entryId: plan.entryId, requestId: result.runId + '-vote-' + index }, signal));
        if (!vote || typeof vote.accepted !== 'boolean') throw new Error('API phiếu test trả kết quả không hợp lệ.');
        if (vote.accepted) result.accepted++; else result.rejected++;
        report();
      }
    }
    result.status = 'completed';
  } catch (error) {
    result.status = signal?.aborted ? 'cancelled' : 'failed';
    result.error = signal?.aborted ? 'Đã dừng theo yêu cầu.' : 'Lỗi ở bước ' + phase + ': ' + String(error.message || 'Lỗi kết nối').slice(0,250);
  }
  result.finishedAt = new Date().toISOString();
  report();
  return result;
}

export const TEST_HTML = String.raw`<!doctype html>
<html lang="vi"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Euréka | Phòng kiểm thử</title><link rel="icon" href="/favicon.svg"><meta name="description" content="Thiết lập và chạy kiểm thử mô phỏng trên môi trường test riêng.">
<style>
:root{font-family:Inter,"Segoe UI",Arial,sans-serif;color:#193a30;background:#f5f7f6;font-synthesis:none}*{box-sizing:border-box}body{margin:0}button,input,select{font:inherit}a{color:inherit;text-decoration:none}button{cursor:pointer}button:disabled{opacity:.5;cursor:default}a:focus-visible,button:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid #76bda7;outline-offset:3px}.shell{max-width:1180px;margin:auto;padding:0 32px}header{height:80px;border-bottom:1px solid #dfe8e2;display:flex;align-items:center;justify-content:space-between}.brand{font-size:24px;font-weight:750;letter-spacing:-.8px;display:flex;align-items:center;gap:11px}.mark{background:#0e7663;color:white;border-radius:11px;padding:7px 12px;font-size:21px;letter-spacing:-2px}.back{font-size:12px;color:#6b8074}.intro{padding:34px 0 25px}.eyebrow{font-size:10px;letter-spacing:1.6px;font-weight:750;color:#0e7663;margin-bottom:10px}h1{font-size:30px;letter-spacing:-.9px;margin:0}h2{font-size:16px;margin:0 0 20px;font-weight:650}p{font-size:13px;color:#718578;line-height:1.8;margin:10px 0 0}.grid{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(0,1fr);gap:20px;align-items:start}.card{padding:25px;background:white;border:1px solid #e0e8e1;border-radius:12px;margin-bottom:20px}.step{display:inline-grid;place-items:center;width:24px;height:24px;border-radius:7px;font-size:11px;color:#0e7663;background:#eaf4ee;margin-right:9px}label{display:block;font-size:11px;font-weight:600;color:#607a69;margin:15px 0 7px}.field{width:100%;border:1px solid #d9e4dc;background:white;border-radius:7px;height:41px;padding:0 11px;font-size:12px;color:#244f3d}select.field{padding-right:25px}input::placeholder{color:#9baa9e}.row{display:flex;gap:10px;flex-wrap:wrap;margin-top:13px}.btn{display:inline-flex;align-items:center;justify-content:center;border-radius:7px;padding:11px 14px;border:1px solid #dce6df;background:white;font-size:11px;font-weight:600;color:#405f4d;min-height:38px}.btn:hover{background:#f1f7f3}.btn.primary{background:#0e7663;border-color:#0e7663;color:white}.btn.stop{color:#a15642;border-color:#e7d9d0;background:#fffaf6}.meta{margin-top:16px;font-size:11px;line-height:1.8;color:#7a8d7f;padding:12px 14px;background:#f5f8f5;border-radius:7px;border:1px solid #e5ece6}.status{font-weight:600;color:#426f56}.status.ok{color:#0e7663}.status.error{color:#b26347}.cols{display:grid;grid-template-columns:1fr 1fr;gap:14px}.help{font-size:10px;line-height:1.7;color:#92a094;margin-top:6px}.plan{margin-top:17px;padding-top:16px;border-top:1px solid #edf0ed;font-size:12px;line-height:1.85;color:#708572;min-height:44px}.result-head{display:flex;align-items:center;justify-content:space-between;gap:12px}.badge{display:inline-block;font-size:10px;background:#eaf5ef;border:1px solid #d8e9df;color:#0e7663;border-radius:5px;padding:5px 7px}.metrics{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:20px}.metric{padding:17px 15px;border:1px solid #e5ebe5;border-radius:8px}.metric.green{background:#eef7f1;border-color:#deece1}.metric span{display:block;font-size:10px;color:#7f9281}.metric strong{display:block;font-size:28px;margin-top:9px;font-weight:650;font-variant-numeric:tabular-nums}.metric.green strong{color:#0e7663}progress{width:100%;height:8px;margin-top:24px;border:0;border-radius:6px;overflow:hidden;accent-color:#0e7663}progress::-webkit-progress-bar{background:#edf3ed}progress::-webkit-progress-value{background:#0e7663}.progress-label{font-size:11px;color:#7b8e7e;line-height:1.8;margin-top:7px;font-variant-numeric:tabular-nums}.log{background:#f6f8f5;border:1px solid #e6ece5;border-radius:7px;white-space:pre-wrap;overflow:auto;max-height:185px;padding:12px;font:10px/1.9 Consolas,monospace;color:#69816b;margin-top:15px;min-height:85px;overflow-wrap:anywhere}.notice{margin-top:15px;font-size:11px;line-height:1.8;color:#8a7042;background:#fbf5e9;border:1px solid #ece0c5;padding:12px 13px;border-radius:7px}.notice[hidden]{display:none}details{font-size:11px;color:#718373;margin-top:17px}summary{cursor:pointer}details pre{font:10px/1.7 Consolas,monospace;white-space:pre-wrap;overflow-wrap:anywhere;max-height:250px;overflow:auto}.note{padding:0 2px 15px;font-size:11px;color:#8c9a8f;line-height:1.9}.note a{color:#47785c;text-decoration:underline}footer{font-size:10px;color:#a0ada3;padding:10px 0 30px;line-height:1.8}@media(max-width:850px){.grid{grid-template-columns:1fr}.shell{max-width:700px;padding:0 22px}.card{padding:22px}.intro{padding-top:28px}h1{font-size:27px}}@media(max-width:430px){.shell{padding:0 15px}.card{padding:18px}.cols{gap:10px}.btn{font-size:10px}.brand{font-size:21px}header{height:68px}h1{font-size:26px}.intro p{font-size:12px}.metric{padding:15px 12px}}
</style></head><body><div class="shell">
<header><a href="/" class="brand"><span class="mark">▥</span>euréka</a><a href="/" class="back">← Về dashboard</a></header>
<section class="intro"><div class="eyebrow">CÔNG CỤ KIỂM THỬ · MÔI TRƯỜNG RIÊNG</div><h1>Phòng kiểm thử</h1><p>Chọn môi trường, đề tài và số lượng để kiểm tra luồng người dùng → đăng nhập test → phiếu mô phỏng.</p></section>
<div class="grid"><div>
<section class="card"><h2><span class="step">1</span>Kết nối môi trường</h2><label for="test-url">URL website test</label><input id="test-url" class="field" type="url" value="demo://local" placeholder="https://staging.example.com" autocomplete="off" spellcheck="false"><div class="help">Có thể nhập URL test sau khi ban tổ chức công bố.</div><div class="row"><button id="test-connect" class="btn primary">Kiểm tra kết nối</button><button id="test-demo" class="btn">Dùng mô phỏng mẫu</button></div><div class="meta"><div id="test-connection" class="status" role="status">Chưa kết nối</div><div id="test-limits">Kết nối để lấy danh sách đề tài và giới hạn kiểm thử.</div></div></section>
<section class="card"><h2><span class="step">2</span>Thiết lập lượt test</h2><label for="test-entry">Đề tài thử nghiệm</label><select id="test-entry" class="field" disabled><option>Chưa kết nối</option></select><div class="cols"><div><label for="test-users">Số người dùng mô phỏng</label><input id="test-users" class="field" type="number" value="10" min="1" max="500" step="1"></div><div><label for="test-votes">Số phiếu test</label><input id="test-votes" class="field" type="number" value="10" min="0" max="500" step="1"></div></div><div class="help">Mỗi người dùng test gửi tối đa một phiếu cho đề tài đã chọn.</div><div id="test-plan" class="plan">Chưa có kế hoạch.</div><div class="row"><button id="test-run" class="btn primary" disabled>Bắt đầu kiểm thử</button><button id="test-stop" class="btn stop" disabled>Dừng</button></div><div id="test-error" class="notice" role="alert" hidden></div></section>
</div><div>
<section class="card"><div class="result-head"><h2 style="margin:0">Kết quả lượt test</h2><span id="test-state" class="badge" role="status">Chưa chạy</span></div><div id="test-result-target" class="help">Chưa có lượt chạy.</div><div class="metrics"><div class="metric"><span>Người dùng đã tạo</span><strong id="test-created">0</strong></div><div class="metric"><span>Đăng nhập test thành công</span><strong id="test-logins">0</strong></div><div class="metric green"><span>Phiếu test được nhận</span><strong id="test-accepted">0</strong></div><div class="metric"><span>Phiếu bị từ chối / trùng</span><strong id="test-rejected">0</strong></div></div><progress id="test-progress" value="0" max="1" aria-label="Tiến độ kiểm thử"></progress><div id="test-progress-label" class="progress-label">0 / 0 thao tác</div><pre id="test-log" class="log">Nhật ký sẽ xuất hiện khi bắt đầu.</pre><details><summary>Xem báo cáo JSON</summary><pre id="test-report">Chưa có báo cáo.</pre></details></section>
<div class="note">Bản mẫu hoạt động ngay trong trình duyệt, dùng tài khoản mô phỏng <strong>@example.invalid</strong>. Website test bên ngoài cần hỗ trợ giao thức <strong>eureka-test-v1</strong> tại <strong>/api/test-harness</strong>. Trang chỉ có giao diện web có thể cần adapter riêng khi được công bố.</div>
</div></div><footer>Dữ liệu kiểm thử được xử lý riêng. Dashboard thống kê bình chọn vẫn ở trang chính.</footer>
</div><script>
${parseTestTarget.toString()}
${validateTestManifest.toString()}
${validateTestScenario.toString()}
${createDemoTestEnvironment.toString()}
${connectTestEnvironment.toString()}
${waitTestInterval.toString()}
${runTestScenario.toString()}
(function(){
'use strict';
var $=function(id){return document.getElementById(id)},adapter=null,target=null,controller=null,working=false,lastLogged=-1,lines=[];
function showError(message){$('test-error').textContent=message;$('test-error').hidden=!message}
function setWorking(value){working=value;['test-url','test-connect','test-demo','test-users','test-votes','test-entry'].forEach(function(id){$(id).disabled=value||(id==='test-entry'&&!adapter)});$('test-stop').disabled=!value;planPreview()}
function configuration(){return {entryId:$('test-entry').value,users:$('test-users').value,votes:$('test-votes').value}}
function planPreview(){if(!adapter){$('test-plan').textContent='Kết nối môi trường để lập kế hoạch.';$('test-run').disabled=true;return}try{var plan=validateTestScenario(adapter.manifest,configuration());$('test-plan').textContent=plan.users+' người dùng test · '+plan.votes+' phiếu · '+plan.operations+' thao tác. Giãn cách tối thiểu '+plan.intervalMs+' ms giữa các thao tác.';$('test-run').disabled=working}catch(error){$('test-plan').textContent=error.message;$('test-run').disabled=true}}
function update(progress){$('test-created').textContent=progress.created;$('test-logins').textContent=progress.loggedIn;$('test-accepted').textContent=progress.accepted;$('test-rejected').textContent=progress.rejected;$('test-progress').max=progress.totalOperations||1;$('test-progress').value=progress.operations;$('test-progress-label').textContent=progress.operations+' / '+progress.totalOperations+' thao tác';var states={running:'Đang chạy',completed:'Đã hoàn thành',cancelled:'Đã dừng',failed:'Gặp lỗi'};$('test-state').textContent=states[progress.status]||progress.status;if(progress.operations!==lastLogged){lastLogged=progress.operations;var names={'create-user':'Tạo người dùng test',login:'Đăng nhập test',vote:'Phiếu test'};lines.push(new Date().toLocaleTimeString('vi-VN')+' · '+(names[progress.phase]||progress.phase)+' · '+progress.operations+'/'+progress.totalOperations);if(lines.length>60)lines.shift();$('test-log').textContent=lines.join('\n');$('test-log').scrollTop=$('test-log').scrollHeight}$('test-report').textContent=JSON.stringify(progress,null,2)}
async function connect(){if(working)return;showError('');adapter=null;target=null;controller=new AbortController();setWorking(true);$('test-connection').className='status';$('test-connection').textContent='Đang kiểm tra kết nối…';try{target=parseTestTarget($('test-url').value);adapter=await connectTestEnvironment(target,fetch,controller.signal);adapter.manifest=validateTestManifest(adapter.manifest);$('test-entry').replaceChildren();adapter.manifest.entries.forEach(function(entry){$('test-entry').add(new Option(entry.code+' · '+entry.title,entry.id))});$('test-users').max=adapter.manifest.limits.maxUsers;$('test-votes').max=adapter.manifest.limits.maxVotes;$('test-connection').className='status ok';$('test-connection').textContent='Đã kết nối · '+adapter.manifest.name;$('test-limits').textContent=target.label+' · tối đa '+adapter.manifest.limits.maxUsers+' người dùng / '+adapter.manifest.limits.maxVotes+' phiếu test';}catch(error){adapter=null;target=null;$('test-connection').className='status error';$('test-connection').textContent='Chưa kết nối được';$('test-limits').textContent='Chưa chạy thao tác tạo người dùng hoặc phiếu.';showError(error.message)}finally{setWorking(false)}}
async function run(){if(working||!adapter)return;showError('');var config=configuration();try{validateTestScenario(adapter.manifest,config)}catch(error){showError(error.message);return}controller=new AbortController();setWorking(true);lines=[];lastLogged=-1;$('test-state').textContent='Đang chuẩn bị';$('test-result-target').textContent=target.label+' · '+$('test-entry').selectedOptions[0].textContent;try{var active=await connectTestEnvironment(target,fetch,controller.signal);var result=await runTestScenario(active,config,{signal:controller.signal,onProgress:update});if(result.error)showError(result.error);else if(result.rejected)showError('Lượt test hoàn tất, có '+result.rejected+' phiếu bị môi trường test từ chối.');}catch(error){$('test-state').textContent=controller.signal.aborted?'Đã dừng':'Gặp lỗi';showError(controller.signal.aborted?'Đã dừng theo yêu cầu.':error.message)}finally{setWorking(false)}}
$('test-connect').addEventListener('click',connect);$('test-demo').addEventListener('click',function(){$('test-url').value='demo://local';connect()});$('test-run').addEventListener('click',run);$('test-stop').addEventListener('click',function(){controller?.abort(new Error('Đã dừng theo yêu cầu.'))});['test-users','test-votes','test-entry'].forEach(function(id){$(id).addEventListener('input',planPreview);$(id).addEventListener('change',planPreview)});$('test-url').addEventListener('input',function(){adapter=null;target=null;$('test-entry').disabled=true;$('test-connection').className='status';$('test-connection').textContent='URL đã thay đổi · cần kiểm tra kết nối';$('test-limits').textContent='Chưa kết nối địa chỉ mới.';planPreview()});connect();
})();
</script></body></html>`;
