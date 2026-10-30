/* 경매 엑기스 화면 — 앱(exe)과 공유 웹페이지가 같은 파일을 쓴다.
   데이터: data/runs.json (리서치 목록), data/run-<n>.json (n번째 리서치 결과)
   앱 모드에서만: 실행·설정·진행 로그·Claude Code 상태 (/api/*) */
(() => {
'use strict';
const MODE = window.AUCTION_MODE || 'share';
const APP = MODE === 'app';
const PY = 3.305785;       // 1평 = 3.305785㎡
const PAGE = 60;

// ── 표시 형식 ────────────────────────────────────────────
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const won = v => {
  if (v == null || !isFinite(v)) return '-';
  const neg = v < 0; v = Math.abs(Math.round(v));
  const eok = Math.floor(v / 1e8), man = Math.round((v % 1e8) / 1e4);
  const s = eok ? `${eok}억` + (man ? ` ${man.toLocaleString()}만` : '') : `${man.toLocaleString()}만`;
  return (neg ? '−' : '') + s + (eok || man ? '' : '');
};
const wonS = v => {   // 짧게: 3.2억, 9,800만
  if (v == null || !isFinite(v)) return '-';
  const a = Math.abs(v), neg = v < 0 ? '−' : '';
  if (a >= 1e8) return neg + (a / 1e8).toFixed(a >= 1e10 ? 0 : 1).replace(/\.0$/, '') + '억';
  return neg + Math.round(a / 1e4).toLocaleString() + '만';
};
const pct = (v, d = 1) => v == null || !isFinite(v) ? '-' : `${(v * 100).toFixed(d)}%`;
const pyeong = m2 => m2 == null ? '-' : `${(m2 / PY).toFixed(1)}평`;
const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
const ymd = s => s ? `${+s.slice(4, 6)}월 ${+s.slice(6, 8)}일` : '-';
const ymdW = s => { if (!s) return '-'; const d = new Date(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8)); return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEK[d.getDay()]})`; };
const ddayN = s => { if (!s) return null; const d = new Date(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8)); const t = new Date(); t.setHours(0, 0, 0, 0); return Math.round((d - t) / 864e5); };
const dday = s => { const n = ddayN(s); return n == null ? '' : n < 0 ? '종료' : n === 0 ? 'D-DAY' : `D-${n}`; };
const when = iso => { if (!iso) return '-'; const d = new Date(iso.replace(' ', 'T')); return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEK[d.getDay()]}) ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const KIND_RUN = { run: '수집·분석', recalc: '다시 계산', import: '이전 분석 결과' };
const GRADE = { SAFE: '권리 안전', CHECK: '권리 확인 필요', DROP: '제외' };
const LEVEL = { list: '목록 정보만', detail: '상세 확인', spec: '명세서 확인' };
const SHORT = { A: '수리 후 매각', B: '3년 보유 후 매각', C: '장기 월세' };
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 저장 불가 환경 */ } },
};

// ── 상태 ─────────────────────────────────────────────────
const TABS = ['top', 'redev', 'offi', 'all', 'runs', 'settings', 'log'];
const S = {
  runs: [], run: null, n: null, latest: null,
  // 주소 끝 #redev 처럼 탭을 지정하면 그 탭으로 연다 (링크 공유용). 없으면 마지막에 보던 탭.
  tab: TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : store.get('tab', 'top'),
  f: { group: 'all', kinds: [], sido: '', sigungu: '', q: '', ...store.get('filters', {}) },
  rf: { verdict: 'all', sido: '', sigungu: '', detail: false, q: '', ...store.get('rfilters', {}) },
  of: { view: 'dong', size: '', sido: '', sigungu: '', q: '', ...store.get('ofilters', {}) },
  shown: PAGE, rshown: PAGE, oshown: PAGE,
  P: null, Q: null, OV: store.get('redevOv', {}),
  status: null, settings: null, courts: {}, defaults: null,
};

async function getJSON(url, opt) {
  const r = await fetch(url, { cache: 'no-store', ...opt });
  if (!r.ok) {
    let msg = `${r.status}`;
    try { const j = await r.json(); msg = j.detail || msg; } catch (e) { /* 본문 없음 */ }
    throw new Error(msg);
  }
  return r.json();
}
const api = (path, method = 'GET', body) => getJSON(path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });

async function loadRuns() {
  S.runs = await getJSON('data/runs.json');
  S.latest = S.runs.length ? S.runs[0].n : null;
}
async function openRun(n) {
  S.run = await getJSON(`data/run-${n}.json`);
  S.n = n;
  // 사용자가 고친 재건축 가정값은 리서치를 바꿔도 유지한다 (이 기기에 저장)
  const base = structuredCloneSafe(S.run.redev.params);
  const saved = store.get('redevParams', null);
  S.P = saved && saved._edited
    ? { ...base, ...saved, far_table: { ...base.far_table, ...(saved.far_table || {}) }, _base: n }
    : { ...base, _base: n };
  // 오피스텔 수익률 가정값도 같은 방식 (예전 리서치에는 오피스텔 자료가 없음)
  const obase = S.run.offi?.params, osaved = store.get('offiParams', null);
  S.Q = obase && { ...obase, ...(osaved && osaved._edited ? osaved : {}) };
  S.shown = PAGE; S.rshown = PAGE; S.oshown = PAGE;
  rdCache.clear();
}
const structuredCloneSafe = o => JSON.parse(JSON.stringify(o));

// ── 공통 조각 ────────────────────────────────────────────
function ladder(it, big) {
  const vals = [it.min_price, it.bid, it.market_price, it.appraisal].filter(v => v > 0);
  if (!vals.length) return '';
  const lo = Math.min(...vals) * 0.9, hi = Math.max(...vals) * 1.04;
  const x = v => `${((v - lo) / (hi - lo) * 100).toFixed(2)}%`;
  const gain = it.bid && it.market_price > it.bid
    ? `<span class="gain" style="left:${x(it.bid)};width:${((it.market_price - it.bid) / (hi - lo) * 100).toFixed(2)}%"></span>` : '';
  return `<div class="ladder${big ? ' big' : ''}" aria-label="최저가 ${won(it.min_price)}, 권장 입찰가 ${won(it.bid)}, 시세 ${won(it.market_price)}">
    <div class="track"><span class="rail"></span>${gain}
      ${it.appraisal ? `<span class="tick app" style="left:${x(it.appraisal)}" title="감정가 ${won(it.appraisal)}"></span>` : ''}
      ${it.market_price ? `<span class="tick mkt" style="left:${x(it.market_price)}" title="시세 ${won(it.market_price)}"></span>` : ''}
      <span class="mk min" style="left:${x(it.min_price)}" title="최저가 ${won(it.min_price)}"></span>
      ${it.bid ? `<span class="mk bid" style="left:${x(it.bid)}" title="권장 입찰가 ${won(it.bid)}"></span>` : ''}
    </div>
    <div class="labels"><span>최저 <b>${wonS(it.min_price)}</b></span><span class="b">권장 <b class="b">${wonS(it.bid)}</b></span><span>시세 <b>${wonS(it.market_price)}</b></span></div>
  </div>`;
}
const legend = () => `<div class="legend"><span><i class="min"></i>최저가</span><span><i class="bid"></i>권장 입찰가</span><span><i class="mkt"></i>시세</span><span>막대: 권장 입찰가와 시세의 차이</span></div>`;
function ddayBlock(s) { const n = ddayN(s); return `<div class="dday${n != null && n <= 7 ? ' soon' : ''}"><b>${dday(s)}</b><span>${ymd(s)}</span></div>`; }

function itemRow(it) {
  const b = it.best || {};
  const kind = (S.run.kinds || {})[it.kind] || it.usage;
  return `<button class="row" data-act="item" data-id="${esc(it.id)}">
    ${ddayBlock(it.sale_date)}
    <div class="who">
      <div class="case">${esc(it.case_no)}${it.item_no > 1 ? ` <span class="faint">물건 ${it.item_no}</span>` : ''}</div>
      <div class="tags">${it.g === 'rec' ? '<span class="tag star">추천</span>' : ''}<span class="tag ${it.grade}">${GRADE[it.grade] || it.grade}</span><span class="tag">${esc(kind)}</span>${it.area ? `<span class="tag">${pyeong(it.area)}</span>` : ''}<span class="tag">${LEVEL[it.level] || ''}</span></div>
      <div class="addr" title="${esc(it.address)}">${esc(it.address)}</div>
    </div>
    ${ladder(it)}
    <div class="metric"><span class="k">연수익률<span class="hide-m"> · ${SHORT[b.key] || '최선 전략'}</span></span><span class="v ${b.annual_roi >= 0 ? 'pos' : 'neg'}">${pct(b.annual_roi)}</span></div>
    <div class="metric m2"><span class="k">필요 현금</span><span class="v">${wonS(b.cash_needed)}</span></div>
    ${it.summary && it.g === 'rec' ? `<div class="summary-line">${esc(it.summary)}</div>` : ''}
  </button>`;
}
function emptyBox(title, body, action = '') { return `<div class="empty"><b>${title}</b><span>${body}</span>${action}</div>`; }

// ── 상단 ─────────────────────────────────────────────────
function renderTop() {
  const r = S.run?.research || {};
  const old = S.n && S.latest && S.n !== S.latest;
  const st = S.status;
  const cl = st?.claude;
  const claudePill = APP ? `<button class="claude ${cl?.ok === true ? 'ok' : cl?.ok === false ? 'bad' : ''}" data-act="claude" title="${esc(cl?.message || '')}">
      <i></i><span>${cl?.ok === true ? 'Claude Code 연결됨' : esc(cl?.message || 'Claude Code 확인 중')}</span></button>` : '';
  const running = !!st?.running;
  const actions = APP ? `<div class="actions">${claudePill}
      <button class="btn" data-act="recalc" ${running ? 'disabled' : ''} title="수집 없이 지금 설정으로 다시 계산해 새 리서치로 남깁니다">다시 계산</button>
      <button class="btn" data-act="share" ${running ? 'disabled' : ''}>공유 페이지 올리기</button>
      ${running ? `<button class="btn" data-act="stop">중지</button>` : ''}
      <button class="btn primary" data-act="run" ${running ? 'disabled' : ''}>${running ? `실행 중 · ${esc(st.stage)}` : '수집·분석 실행'}</button></div>` : '';
  $('#topbar').innerHTML = `<div class="wrap">
    <a class="brand" href="#" data-act="tab" data-tab="top"><span class="brand-mark">엑</span><span><span class="brand-name">경매 엑기스</span><br><span class="brand-sub">수도권 법원경매 리서치</span></span></a>
    ${S.n ? `<button class="run-picker${old ? ' old' : ''}" data-act="tab" data-tab="runs"><span class="dot"></span><b>${S.n}번째 리서치</b><span>${when(r.finished_at)}</span></button>` : ''}
    <span class="spacer"></span>${actions}</div>`;
}

function renderMasthead() {
  if (!S.run) { $('#masthead').innerHTML = ''; return; }
  const r = S.run.research || {}, c = S.run.counts || {}, st = S.run.settings || {};
  const old = S.n !== S.latest;
  $('#masthead').innerHTML = `<div class="wrap masthead">
    ${old ? `<div class="old-banner"><span>지난 리서치를 보고 있습니다. 최신은 ${S.latest}번째 리서치입니다.</span><button class="btn small" data-act="open-run" data-n="${S.latest}">최신 리서치 보기</button></div>` : ''}
    <div class="masthead-top">
      <div><h1>${when(r.finished_at).replace(/ \d\d:\d\d$/, '')} 리서치</h1>
        <div class="when">${S.n}번째 리서치 · ${when(r.finished_at).slice(-5)} 완료 · ${KIND_RUN[r.kind] || ''}</div></div>
      <div class="basis"><span>자본금 ${won(st.capital)}</span><span>보유 주택 ${st.homes_owned}채</span><span>목표 연수익률 ${pct(st.target_annual_roi, 0)}</span></div>
    </div>
    <div class="stats">
      <div class="stat hi"><div class="k">추천</div><div class="v">${c.rec ?? 0}<small>건</small></div></div>
      <div class="stat"><div class="k">차선</div><div class="v">${c.near ?? 0}<small>건</small></div></div>
      <div class="stat"><div class="k">재건축 후보</div><div class="v">${c.redev ?? 0}<small>건</small></div></div>
      <div class="stat"><div class="k">상세 대기</div><div class="v">${(c.pending ?? 0).toLocaleString()}<small>건</small></div></div>
      <div class="stat"><div class="k">분석한 물건</div><div class="v">${(c.all ?? 0).toLocaleString()}<small>건</small></div></div>
    </div></div>`;
}

function renderTabs() {
  const c = S.run?.counts || {};
  const tabs = [['top', '추천', c.rec], ['redev', '재건축 사업성', c.redev], ['offi', '오피스텔 수익률'], ['all', '전체 물건', c.all], ['runs', '리서치 기록', S.runs.length]];
  if (APP) tabs.push(['settings', '설정'], ['log', '진행 로그']);
  $('#tabs').innerHTML = `<div class="wrap" role="tablist">${tabs.map(([k, l, n]) =>
    `<button class="tab" role="tab" id="tab-${k}" aria-selected="${S.tab === k}" data-act="tab" data-tab="${k}">${l}${n != null ? `<span class="n">${Number(n).toLocaleString()}</span>` : ''}</button>`).join('')}</div>`;
}

// ── 추천 탭 ──────────────────────────────────────────────
function viewTop() {
  const items = S.run.items;
  const rec = items.filter(x => x.g === 'rec');
  const near = items.filter(x => x.g === 'near');
  const target = pct(S.run.settings.target_annual_roi, 0);
  return `<section class="section">
      <div class="section-head"><h2>목표 수익률을 넘는 물건</h2><p>임차인·인수 권리를 서류로 확인했고, 자본금 안에서 연 ${target} 이상이 나오는 물건입니다. 권장 입찰가는 이 수익률을 지키는 가장 높은 입찰가입니다.</p></div>
      ${rec.length ? legend() + `<div class="list">${rec.map(itemRow).join('')}</div>`
        : emptyBox('이번 리서치에는 목표를 넘는 물건이 없습니다', `기일이 가까운 물건 대부분에 보증금을 떠안아야 하는 임차인이 있었습니다. 아래 차선이나 재건축 사업성 탭을 확인해 보세요.`)}
    </section>
    <section class="section">
      <div class="section-head"><h2>차선</h2><p>서류는 확인했지만 목표 수익률에 못 미치는 물건입니다. 입찰가를 낮게 쓰면 들어갈 만한지 상세에서 입찰가별 수익을 보세요.</p></div>
      ${near.length ? `<div class="list">${near.slice(0, 15).map(itemRow).join('')}</div>${near.length > 15 ? `<button class="btn more" data-act="all-near">차선 ${near.length}건 모두 보기</button>` : ''}`
        : emptyBox('차선 물건이 없습니다', '상세를 확인한 물건이 아직 적습니다. 실행할 때마다 기일이 가까운 물건부터 상세를 엽니다.')}
    </section>`;
}

// ── 전체 물건 탭 ─────────────────────────────────────────
function regionOptions(items, f) {
  const sidos = [...new Set(items.map(x => x.sido))].filter(s => s && s !== '기타').sort();
  const gus = [...new Set(items.filter(x => x.sido === f.sido).map(x => x.sigungu))].filter(Boolean).sort();
  return `<select id="f-sido" data-chg="sido" aria-label="시도"><option value="">전체 시도</option>${sidos.map(s => `<option ${s === f.sido ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>
    <select id="f-sigungu" data-chg="sigungu" aria-label="시군구" ${f.sido ? '' : 'disabled'}><option value="">전체 시군구</option>${gus.map(g => `<option ${g === f.sigungu ? 'selected' : ''}>${esc(g)}</option>`).join('')}</select>`;
}
function filteredItems() {
  const f = S.f, q = f.q.replace(/\s/g, '');
  return S.run.items.filter(x => (f.group === 'all' || x.g === f.group) && (!f.kinds.length || f.kinds.includes(x.kind))
    && (!f.sido || x.sido === f.sido) && (!f.sigungu || x.sigungu === f.sigungu)
    && (!q || (x.case_no + x.address).replace(/\s/g, '').includes(q)));
}
function viewAll() {
  const f = S.f, rows = filteredItems();
  const groups = [['all', '전체'], ['rec', '추천'], ['near', '차선'], ['pending', '상세 대기']];
  const kinds = Object.entries(S.run.kinds || {});
  return `<section class="section">
    <div class="section-head"><h2>전체 물건</h2><p>점수 순입니다. '상세 대기'는 목록 정보로만 계산한 물건이라, 임차인을 확인하기 전까지 숫자를 믿지 마세요.</p></div>
    <div class="filters">
      <div class="seg">${groups.map(([k, l]) => `<button aria-pressed="${f.group === k}" data-act="f-group" data-v="${k}">${l}</button>`).join('')}</div>
      <div class="seg"><button aria-pressed="${!f.kinds.length}" data-act="f-kind" data-v="">전체 유형</button>${kinds.map(([k, l]) => `<button aria-pressed="${f.kinds.includes(k)}" data-act="f-kind" data-v="${k}">${esc(l)}</button>`).join('')}</div>
      ${regionOptions(S.run.items, f)}
      <input type="search" id="f-q" data-chg="q" placeholder="사건번호·주소 검색" value="${esc(f.q)}" aria-label="사건번호·주소 검색">
      <span class="count">${rows.length.toLocaleString()}건</span>
    </div>
    ${rows.length ? legend() + `<div class="list">${rows.slice(0, S.shown).map(itemRow).join('')}</div>
      ${rows.length > S.shown ? `<button class="btn more" data-act="more">더 보기 (${(rows.length - S.shown).toLocaleString()}건 남음)</button>` : ''}`
      : emptyBox('조건에 맞는 물건이 없습니다', '유형이나 지역 조건을 넓혀 보세요.', `<button class="btn" data-act="f-reset">필터 초기화</button>`)}
    ${S.run.trimmed ? `<p class="faint">지난 리서치라 상세 대기 물건은 점수 상위만 남겨 두었습니다.</p>` : ''}
  </section>`;
}

// ── 재건축 사업성 ────────────────────────────────────────
const RP = [
  ['규모·설계', [['min_age', '노후 기준 (더 새 건물은 위험 확인)', '년'], ['far_realize', '용적률 실현율', '%'], ['extra_area_ratio', '용적률 외 면적 (주차·계단)', '%'], ['net_ratio', '분양 전용률', '%'], ['avg_unit_m2', '세대당 평균 전용', '㎡']]],
  ['공사비', [['build_cost_py', '평당 건축비', '만원'], ['design_rate', '설계·감리 (공사비 대비)', '%'], ['demolish_py', '철거비 (기존 건물 평당)', '만원'], ['contingency_rate', '예비비 (공사비 대비)', '%']]],
  ['인허가·세금', [['permit_fixed', '인허가 고정비', '만원'], ['permit_py', '인허가·부담금 (연면적 평당)', '만원'], ['land_acq_tax', '토지 취득세', '%'], ['legal_rate', '법무·등기', '%'], ['eviction', '명도비 (건물 전체)', '만원'], ['preserve_tax', '보존등기 취득세 (공사비 대비)', '%'], ['corp_tax', '사업이익 세금 (법인세 등)', '%']]],
  ['금융 (PF)', [['pf_ltc', 'PF 대출 비율 (LTC)', '%'], ['pf_rate', 'PF 금리 (연)', '%'], ['pf_fee', 'PF 수수료', '%'], ['pf_draw', '기간 평균 인출 비율', '%'], ['months_permit', '인허가 기간', '개월'], ['months_build', '공사 기간', '개월'], ['months_sale', '분양 기간', '개월']]],
  ['분양·목표', [['sale_price_py', '분양가 직접 입력 (전용 평당, 0=실거래)', '만원'], ['sale_adjust', '주변 신축 실거래 대비 분양가', '%'], ['agent_rate', '분양 대행·중개 수수료', '%'], ['ad_rate', '광고·홍보비', '%'], ['target_margin', '목표 매출이익률 (세전)', '%'], ['min_land_m2', '최소 대지면적', '㎡']]],
];
const toView = (v, u) => u === '%' ? +(v * 100).toFixed(3) : u === '만원' ? +(v / 1e4).toFixed(2) : v;
const fromView = (v, u) => u === '%' ? v / 100 : u === '만원' ? v * 1e4 : v;

function assumedAt(r, bid) {
  if (!r) return 0;
  let pool = bid * 0.98, extra = 0;
  for (const dep of [...(r.assumed_conditional || [])].sort((a, b) => a - b)) {
    const paid = Math.min(dep, Math.max(pool, 0)); pool -= paid; extra += dep - paid;
  }
  return (r.assumed_fixed || 0) + extra;
}

function rdCalc(it, P, bid) {
  const ov = S.OV[it.id] || {};
  const land = +ov.land_m2 || it.land_m2;
  const zone = ov.zone || it.zone || P.default_zone;
  const zoneAssumed = !ov.zone && !it.zone;
  const pair = P.far_table[zone] || P.far_table[P.default_zone] || [200, 250];
  const far = pair[it.sido === '서울' ? 0 : 1] / 100;
  const gfaFar = land * far * P.far_realize;
  const gfaAll = gfaFar * (1 + P.extra_area_ratio);
  const net = gfaFar * P.net_ratio;
  const units = Math.max(1, Math.floor(net / P.avg_unit_m2));
  let pm2 = null, priceSrc = '';
  if (+ov.price_py) { pm2 = +ov.price_py / PY; priceSrc = '이 물건에 직접 입력'; }
  else if (P.sale_price_py > 0) { pm2 = P.sale_price_py / PY; priceSrc = '가정값에 직접 입력'; }
  else if (it.newbuild) { pm2 = it.newbuild.price_m2 * P.sale_adjust; priceSrc = `주변 신축 실거래 ${it.newbuild.n}건 (${it.newbuild.scope})`; }
  const base = { land, zone, zoneAssumed, far, gfaFar, gfaAll, net, units, pm2, priceSrc };
  if (!pm2) return { ...base, missing: true };
  const revenue = net * pm2;
  const assumed = assumedAt(it.rights, bid);
  const acq = bid * (P.land_acq_tax + P.legal_rate);
  const landCost = bid + assumed + acq + P.eviction;
  const gfaPy = gfaAll / PY;
  const build = gfaPy * P.build_cost_py;
  const design = build * P.design_rate;
  const demolish = ((it.bldg_m2 || land * 0.6) / PY) * P.demolish_py;
  const contingency = build * P.contingency_rate;
  const preserve = build * P.preserve_tax;
  const permit = P.permit_fixed + gfaPy * P.permit_py;
  const costBase = landCost + build + design + demolish + contingency + preserve + permit;
  const months = P.months_permit + P.months_build + P.months_sale;
  const loan = costBase * P.pf_ltc;
  const interest = loan * P.pf_rate * months / 12 * P.pf_draw;
  const fee = loan * P.pf_fee;
  const selling = revenue * (P.agent_rate + P.ad_rate);
  const total = costBase + interest + fee + selling;
  const pre = revenue - total;
  const tax = Math.max(pre, 0) * P.corp_tax;
  const post = pre - tax;
  const equity = costBase - loan;
  const roe = equity > 0 ? post / equity : 0;
  const annual = roe > -1 ? Math.pow(1 + roe, 12 / months) - 1 : -1;
  return { ...base, bid, revenue, assumed, acq, landCost, build, design, demolish, contingency, preserve, permit,
    costBase, months, loan, interest, fee, selling, total, pre, margin: pre / revenue, tax, post, equity, roe, annual };
}
function rdMaxBid(it, P) {
  const top = rdCalc(it, P, 0);
  if (top.missing || top.margin < P.target_margin) return null;
  let lo = 0, hi = top.revenue;
  for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (rdCalc(it, P, mid).margin >= P.target_margin) lo = mid; else hi = mid; }
  return Math.floor(lo / 1e5) * 1e5;
}
const rdCache = new Map();
function rdEval(it) {
  const key = it.id;
  if (rdCache.has(key)) return rdCache.get(key);
  const P = S.P;
  const at = rdCalc(it, P, it.min_price || 0);
  const maxBid = at.missing ? null : rdMaxBid(it, P);
  // 숫자가 좋아도 확인할 게 남았으면 '사업성 있음 · 확인 필요'로 둔다
  const why = [];
  if (!it.has_detail) why.push('법원 상세(대지권·권리·감정평가서)를 아직 못 봄 — 지분·토지만 매각일 수 있음');
  if (it.bldg?.age != null && it.bldg.age < S.P.min_age) why.push(`${it.bldg.age}년 된 비교적 새 건물`);
  const sev = (it.risks || []).filter(w => SEVERE.includes(w));
  if (sev.length) why.push(`${sev.join('·')} 관련 문구가 있음`);
  const verdict = at.missing ? 'none' : maxBid != null && maxBid >= it.min_price ? (why.length ? 'risk' : 'go') : at.margin >= 0.05 ? 'maybe' : 'no';
  const res = { at, maxBid, verdict, why };
  rdCache.set(key, res);
  return res;
}
const VERDICT = { go: ['go', '사업성 있음'], risk: ['maybe', '사업성 있음 · 확인 필요'], maybe: ['maybe', '검토 필요'], no: ['no', '사업성 부족'], none: ['', '분양가 정보 없음'] };
const SEVERE = ['법정지상권', '유치권', '분묘', '맹지', '지분', '토지별도등기', '가처분', '가등기'];

function rdItems() {
  // 판정 필터 전 목록 (판정별 건수를 세려고) — 판정 필터는 viewRedev에서 건다
  const P = S.P, f = S.rf, q = f.q.replace(/\s/g, '');
  const order = { go: 0, risk: 1, maybe: 2, no: 3, none: 4 };
  return S.run.redev.items
    .filter(x => (S.OV[x.id]?.land_m2 || x.land_m2) >= P.min_land_m2)
    .filter(x => (!f.sido || x.sido === f.sido) && (!f.sigungu || x.sigungu === f.sigungu) && (!f.detail || x.has_detail)
      && (!q || (x.case_no + x.address).replace(/\s/g, '').includes(q)))
    .map(x => ({ x, e: rdEval(x) }))
    .sort((a, b) => order[a.e.verdict] - order[b.e.verdict] || (b.e.at.margin ?? -9) - (a.e.at.margin ?? -9));
}
function ageTag(x) {
  const b = x.bldg;
  if (!b?.year) return '';
  return `<span class="tag ${b.age < S.P.min_age ? 'CHECK' : ''}">준공 ${b.year} · ${b.age}년</span>`;
}
function rdRow({ x, e }) {
  const a = e.at, [vc, vl] = VERDICT[e.verdict];
  return `<button class="row rd" data-act="redev" data-id="${esc(x.id)}">
    ${ddayBlock(x.sale_date)}
    <div class="who">
      <div class="case">${esc(x.case_no)}${x.item_no > 1 ? ` <span class="faint">물건 ${x.item_no}</span>` : ''}</div>
      <div class="tags"><span class="tag ${vc}">${vl}</span><span class="tag">${esc(a.zone)}${a.zoneAssumed ? ' (가정)' : ''}</span><span class="tag">대지 ${pyeong(a.land)}</span>${ageTag(x)}<span class="tag">${x.has_detail ? '상세 확인' : '목록 정보만'}</span>${x.risks.length ? `<span class="tag DROP">${esc(x.risks.join('·'))}</span>` : ''}</div>
      <div class="addr" title="${esc(x.address)}">${esc(x.address)}</div>
      <div class="faint" style="font-size:12.5px">${a.missing ? '주변 신축 실거래가 없어 분양가를 직접 넣어야 계산됩니다' : `예상 ${a.units}세대 · 분양 전용 ${pyeong(a.net)} · 전용 평당 ${wonS(a.pm2 * PY)}`}</div>
    </div>
    <div class="metric m1"><span class="k">최저가</span><span class="v">${wonS(x.min_price)}</span></div>
    <div class="metric m2"><span class="k">권장 최고 낙찰가</span><span class="v ${e.maxBid != null && e.maxBid >= x.min_price ? 'pos' : ''}">${e.maxBid != null ? wonS(e.maxBid) : '-'}</span></div>
    <div class="metric m3"><span class="k">세전 이익 (최저가 낙찰)</span><span class="v ${a.pre >= 0 ? 'pos' : 'neg'}">${a.missing ? '-' : wonS(a.pre)}</span></div>
    <div class="metric m4"><span class="k">매출이익률</span><span class="v ${a.margin >= S.P.target_margin ? 'pos' : a.margin < 0 ? 'neg' : ''}">${a.missing ? '-' : pct(a.margin)}</span></div>
  </button>`;
}

function assumePanel() {
  const P = S.P, base = S.run.redev.params;
  const field = ([k, label, u]) => {
    const changed = Math.abs((P[k] ?? 0) - (base[k] ?? 0)) > 1e-9;
    return `<div class="field${changed ? ' changed' : ''}"><label for="rp-${k}">${label}</label>
      <span class="in"><input id="rp-${k}" type="number" step="any" inputmode="decimal" data-rp="${k}" data-u="${u}" value="${toView(P[k], u)}"><em>${u}</em></span></div>`;
  };
  const zones = Object.keys(P.far_table);
  return `<aside class="assume" aria-label="사업성 가정">
    <div class="assume-head"><h3>사업성 가정</h3><p>값을 바꾸면 오른쪽 목록이 바로 다시 계산됩니다.${APP ? ' [앱 기본값으로 저장]을 누르면 다음 리서치부터 기본값이 됩니다.' : ' 고친 값은 이 기기에만 저장됩니다.'}</p></div>
    ${RP.map(([g, fs], i) => `<details ${i < 2 && matchMedia('(min-width: 1081px)').matches ? 'open' : ''}><summary>${g}</summary><div class="fields">
      ${i === 0 ? `<div class="field"><label for="rp-zone">용도지역 모를 때 가정</label><select id="rp-zone" data-rp="default_zone">${zones.map(z => `<option ${z === P.default_zone ? 'selected' : ''}>${esc(z)}</option>`).join('')}</select></div>` : ''}
      ${fs.map(field).join('')}</div></details>`).join('')}
    <details><summary>용도지역별 용적률</summary><div class="fields">
      <table class="fartable"><thead><tr><th>용도지역</th><th>서울</th><th>그 외</th></tr></thead><tbody>
      ${zones.map(z => `<tr><td>${esc(z)}</td>${[0, 1].map(i => `<td><input type="number" step="10" data-far="${esc(z)}" data-i="${i}" value="${P.far_table[z][i]}" aria-label="${esc(z)} ${i ? '그 외' : '서울'} 용적률">%</td>`).join('')}</tr>`).join('')}
      </tbody></table><p class="faint" style="font-size:12px;margin:0">서울시·경기 일반 조례 기준입니다. 지구단위계획·지자체 조례에 따라 다르니 꼭 확인하세요.</p></div></details>
    <div class="assume-foot">${APP ? '<button class="btn primary small" data-act="rp-save">앱 기본값으로 저장</button>' : ''}<button class="btn small" data-act="rp-reset">리서치 기준값으로 되돌리기</button></div>
  </aside>`;
}

function viewRedev() {
  const all = rdItems(), f = S.rf;
  const counts = { all: all.length };
  all.forEach(({ e }) => { counts[e.verdict] = (counts[e.verdict] || 0) + 1; });
  const rows = f.verdict === 'all' ? all : all.filter(({ e }) => e.verdict === f.verdict);
  const seg = [['all', '전체'], ['go', '사업성 있음'], ['risk', '있음 · 확인 필요'], ['maybe', '검토 필요'], ['no', '사업성 부족']];
  return `<div class="redev">${assumePanel()}
    <section class="section">
      <div class="section-head"><h2>재건축 사업성</h2><p>구옥(단독·다가구·대지·근린주택·일괄매각)을 낙찰받아 철거하고 신축해 분양하는 경우입니다. 최저가에 낙찰받는다고 보고 계산했고, 권장 최고 낙찰가는 목표 매출이익률 ${pct(S.P.target_margin, 0)}을 지키는 가장 높은 낙찰가입니다.</p></div>
      <div class="filters">
        <div class="seg">${seg.map(([k, l]) => `<button aria-pressed="${f.verdict === k}" data-act="rf-verdict" data-v="${k}">${l} <span class="faint num">${counts[k] || 0}</span></button>`).join('')}</div>
        ${regionOptions(S.run.redev.items, f).replaceAll('data-chg="sido"', 'data-chg="r-sido"').replaceAll('data-chg="sigungu"', 'data-chg="r-sigungu"')}
        <label class="chip" style="display:inline-flex;gap:6px;align-items:center"><input type="checkbox" data-act="rf-detail" ${f.detail ? 'checked' : ''}>상세 확인한 물건만</label>
        <input type="search" data-chg="r-q" placeholder="사건번호·주소 검색" value="${esc(f.q)}" aria-label="재건축 후보 검색">
        <span class="count">${rows.length.toLocaleString()}건</span>
      </div>
      ${rows.length ? `<div class="list">${rows.slice(0, S.rshown).map(rdRow).join('')}</div>
        ${rows.length > S.rshown ? `<button class="btn more" data-act="rmore">더 보기 (${(rows.length - S.rshown).toLocaleString()}건 남음)</button>` : ''}`
        : emptyBox('조건에 맞는 재건축 후보가 없습니다', '사업성 필터나 지역 조건을 넓히거나, 최소 대지면적을 낮춰 보세요.')}
      <p class="faint" style="font-size:12.5px">용도지역에 '(가정)'이 붙은 물건은 아직 감정평가서를 못 봐서 가정값으로 계산했습니다. 실행할 때마다 기일이 가까운 후보부터 상세를 엽니다.</p>
    </section></div>`;
}

// ── 오피스텔 수익률 ──────────────────────────────────────
// 서버는 건물·평형대별 매매가·보증금·월세 중앙값만 준다. 대출·금리·세금 계산은 여기서 한다.
const OP = [['loan_ratio', '대출 비율 (매매가 대비)', '%'], ['interest_rate', '대출 금리 (연)', '%'], ['acq_tax', '취득세', '%'],
  ['fee_rate', '매수 중개·법무비', '%'], ['hold_rate', '재산세 등 (매매가 대비, 연)', '%'], ['vacancy', '공실·수선 충당 (월세 대비)', '%'],
  ['min_buildings', '동네 순위에 넣을 최소 건물 수', '개']];
const OSIZES = ['~20㎡', '20~30㎡', '30~45㎡', '45㎡~'];
const MIN_CASH = 3e6;  // 실투자금이 이보다 적으면 수익률이 무한대로 튀므로 '거의 무피'로 따로 표시
const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

function ofCalc(b, Q = S.Q) {
  const loan = b.price * Q.loan_ratio, buy = b.price * (Q.acq_tax + Q.fee_rate);
  const cash = b.price - loan - b.deposit + buy;
  const income = b.rent * 12 * (1 - Q.vacancy), interest = loan * Q.interest_rate, hold = b.price * Q.hold_rate;
  const net = income - interest - hold;
  return { loan, buy, cash, income, interest, hold, net, roi: cash >= MIN_CASH ? net / cash : null };
}
function ofBuildings() {
  const f = S.of, q = f.q.replace(/\s/g, '');
  return S.run.offi.buildings.map((b, i) => ({ ...b, i, c: ofCalc(b) }))
    .filter(b => (!f.size || b.size === f.size) && (!f.sido || b.sido === f.sido) && (!f.sigungu || b.sigungu === f.sigungu)
      && (!q || `${b.sigungu}${b.dong}${b.name || ''}`.replace(/\s/g, '').includes(q)));
}
function ofDongs(bs) {
  const g = new Map();
  for (const b of bs) { const k = `${b.sido}|${b.sigungu}|${b.dong}`; if (!g.has(k)) g.set(k, []); g.get(k).push(b); }
  const out = [];
  for (const [k, list] of g) {
    const rois = list.map(b => b.c.roi).filter(v => v != null);
    if (list.length < S.Q.min_buildings || !rois.length) continue;
    const m = f => median(list.map(f));
    out.push({ k, sido: list[0].sido, sigungu: list[0].sigungu, dong: list[0].dong, list, roi: median(rois),
      price: m(b => b.price), deposit: m(b => b.deposit), rent: m(b => b.rent), cash: m(b => b.c.cash), net: m(b => b.c.net),
      deals: list.reduce((s, b) => s + b.n_trade + b.n_rent, 0), year: median(list.map(b => b.year).filter(Boolean)),
      sizes: OSIZES.filter(s => list.some(b => b.size === s)) });
  }
  return out.sort((a, b) => b.roi - a.roi);
}
const rentTxt = b => `${wonS(b.deposit)} / ${Math.round(b.rent / 1e4)}만`;
function rankBlock(i) { return `<div class="dday"><b>${i}</b><span>위</span></div>`; }
function ofDongRow(d, i) {
  return `<button class="row rd" data-act="offi-dong" data-k="${esc(d.k)}">
    ${rankBlock(i + 1)}
    <div class="who">
      <div class="case">${esc(d.sigungu)} ${esc(d.dong)} <span class="faint">${esc(d.sido)}</span></div>
      <div class="tags"><span class="tag">건물 ${d.list.length}곳</span><span class="tag">거래 ${d.deals.toLocaleString()}건</span>${d.year ? `<span class="tag">준공 ${Math.round(d.year)}년 안팎</span>` : ''}<span class="tag">${d.sizes.join(' · ')}</span></div>
      <div class="faint" style="font-size:12.5px">매매 ${wonS(d.price)} · ${rentTxt(d)} · 연 세전 순익 ${wonS(d.net)}</div>
    </div>
    <div class="metric m1"><span class="k">매매가</span><span class="v">${wonS(d.price)}</span></div>
    <div class="metric m2"><span class="k">보증금 / 월세</span><span class="v">${rentTxt(d)}</span></div>
    <div class="metric m3"><span class="k">실투자금</span><span class="v">${wonS(d.cash)}</span></div>
    <div class="metric m4"><span class="k">세전 수익률</span><span class="v ${d.roi >= 0 ? 'pos' : 'neg'}">${pct(d.roi)}</span></div>
  </button>`;
}
function ofBldRow(b, i) {
  const c = b.c;
  return `<button class="row rd" data-act="offi-b" data-i="${b.i}">
    ${rankBlock(i + 1)}
    <div class="who">
      <div class="case">${esc(b.name || `${b.dong} ${b.jibun}`)}</div>
      <div class="tags"><span class="tag">${b.size}</span><span class="tag">전용 ${b.area}㎡</span>${b.year ? `<span class="tag">준공 ${b.year}</span>` : ''}<span class="tag">매매 ${b.n_trade} · 월세 ${b.n_rent}건</span>${c.roi == null ? '<span class="tag CHECK">실투자 300만 미만</span>' : ''}</div>
      <div class="addr">${esc(b.sido)} ${esc(b.sigungu)} ${esc(b.dong)} ${esc(b.jibun || '')} · 매매 ${wonS(b.price)} · ${rentTxt(b)}</div>
    </div>
    <div class="metric m1"><span class="k">매매가</span><span class="v">${wonS(b.price)}</span></div>
    <div class="metric m2"><span class="k">보증금 / 월세</span><span class="v">${rentTxt(b)}</span></div>
    <div class="metric m3"><span class="k">연 세전 순익</span><span class="v ${c.net >= 0 ? 'pos' : 'neg'}">${wonS(c.net)}</span></div>
    <div class="metric m4"><span class="k">세전 수익률</span><span class="v ${c.roi == null ? '' : c.roi >= 0 ? 'pos' : 'neg'}">${c.roi == null ? '무피' : pct(c.roi)}</span></div>
  </button>`;
}
function offiPanel() {
  const Q = S.Q, base = S.run.offi.params;
  const field = ([k, label, u]) => `<div class="field${Math.abs(Q[k] - base[k]) > 1e-9 ? ' changed' : ''}"><label for="op-${k}">${label}</label>
    <span class="in"><input id="op-${k}" type="number" step="any" inputmode="decimal" data-op="${k}" data-u="${u}" value="${toView(Q[k], u)}"><em>${u}</em></span></div>`;
  return `<aside class="assume" aria-label="오피스텔 수익률 가정">
    <div class="assume-head"><h3>수익률 가정</h3><p>값을 바꾸면 오른쪽 순위가 바로 다시 계산됩니다.${APP ? ' [앱 기본값으로 저장]을 누르면 다음 리서치부터 기본값이 됩니다.' : ' 고친 값은 이 기기에만 저장됩니다.'}</p></div>
    <div class="fields" style="padding-top:12px">${OP.map(field).join('')}</div>
    <div class="assume-foot">${APP ? '<button class="btn primary small" data-act="op-save">앱 기본값으로 저장</button>' : ''}<button class="btn small" data-act="op-reset">리서치 기준값으로 되돌리기</button></div>
  </aside>`;
}
function viewOffi() {
  if (!S.run.offi) return emptyBox('이 리서치에는 오피스텔 자료가 없습니다', '오피스텔 수익률은 2026년 11월 1일 이후 리서치부터 들어 있습니다. 리서치 기록에서 최신 리서치를 열어 보세요.');
  const f = S.of, bs = ofBuildings();
  const dongs = f.view === 'dong' ? ofDongs(bs) : null;
  const rows = dongs || bs.sort((a, b) => (b.c.roi ?? -9) - (a.c.roi ?? -9));
  const [y0, y1] = S.run.offi.period;
  const sizes = [['', '전체 평형'], ...OSIZES.map(s => [s, s])];
  return `<div class="redev">${offiPanel()}
    <section class="section">
      <div class="section-head"><h2>오피스텔 수익률</h2><p>수도권 오피스텔을 사서 월세를 놓을 때 실투자금 대비 1년 세전 순익입니다. ${+y0.slice(4)}월 ${y0.slice(0, 4)}년 ~ ${+y1.slice(4)}월 ${y1.slice(0, 4)}년 실거래에서 <b>같은 건물·같은 평형대</b>의 매매가와 월세(보증금이 매매가의 30% 이하인 계약)를 짝지었습니다. 동네 순위는 그 동 건물들의 중앙값입니다.</p></div>
      <div class="filters">
        <div class="seg"><button aria-pressed="${f.view === 'dong'}" data-act="of-view" data-v="dong">동네 순위</button><button aria-pressed="${f.view === 'bld'}" data-act="of-view" data-v="bld">건물 순위</button></div>
        <div class="seg">${sizes.map(([k, l]) => `<button aria-pressed="${f.size === k}" data-act="of-size" data-v="${k}">${l}</button>`).join('')}</div>
        ${regionOptions(S.run.offi.buildings, f).replaceAll('data-chg="sido"', 'data-chg="o-sido"').replaceAll('data-chg="sigungu"', 'data-chg="o-sigungu"')}
        <input type="search" data-chg="o-q" placeholder="동네·건물 이름 검색" value="${esc(f.q)}" aria-label="동네·건물 검색">
        <span class="count">${rows.length.toLocaleString()}${dongs ? '개 동' : '곳'}</span>
      </div>
      ${rows.length ? `<div class="list">${rows.slice(0, S.oshown).map(dongs ? ofDongRow : ofBldRow).join('')}</div>
        ${rows.length > S.oshown ? `<button class="btn more" data-act="omore">더 보기 (${(rows.length - S.oshown).toLocaleString()}${dongs ? '개 동' : '곳'} 남음)</button>` : ''}`
        : emptyBox('조건에 맞는 곳이 없습니다', dongs ? '평형·지역 조건을 넓히거나 최소 건물 수를 낮춰 보세요.' : '평형·지역 조건을 넓혀 보세요.')}
      <p class="faint" style="font-size:12.5px">세전 순익 = 월세 × 12 × (1 − 공실) − 대출이자 − 재산세. 실투자금 = 매매가 − 대출 − 보증금 + 취득세·중개비. 양도세·종합소득세와 관리비 미납 등은 빠져 있습니다. '무피'는 보증금으로 실투자금이 거의 다 회수되는 경우입니다.</p>
    </section></div>`;
}
function ofLedger(b, c) {
  const Q = S.Q, row = (k, v, cls = '') => `<tr class="${cls}"><td>${k}</td><td class="r">${won(v)}</td></tr>`;
  return `<div class="tbl ledger"><table><tbody>
    ${row('실투자금', c.cash, 'total')}
    ${row('매매가', b.price, 'sub')}${row(`대출 (${pct(Q.loan_ratio, 0)})`, -c.loan, 'sub')}${row('보증금', -b.deposit, 'sub')}${row(`취득세·중개·법무 (${pct(Q.acq_tax + Q.fee_rate)})`, c.buy, 'sub')}
    ${row('연 월세 수입', c.income, 'total')}
    <tr class="sub"><td>월 ${won(b.rent)} × 12 × (1 − 공실 ${pct(Q.vacancy, 0)})</td><td></td></tr>
    ${row(`대출이자 (연 ${pct(Q.interest_rate)})`, -c.interest, 'sub')}${row('재산세 등', -c.hold, 'sub')}
    <tr class="best"><td>연 세전 순익</td><td class="r ${c.net >= 0 ? 'pos' : 'neg'}">${won(c.net)}</td></tr>
    <tr class="best"><td>실투자금 대비 세전 수익률</td><td class="r">${c.roi == null ? '무피 (실투자 300만 미만)' : pct(c.roi)}</td></tr>
  </tbody></table></div>`;
}
function offiDongSheet(k) {
  // 지금 평형 필터 기준으로 보여 준다 (필터를 바꿨으면 그 동의 전체 건물로)
  const d = ofDongs(ofBuildings()).find(x => x.k === k)
    || ofDongs(S.run.offi.buildings.map((b, i) => ({ ...b, i, c: ofCalc(b) }))).find(x => x.k === k);
  if (!d) return;
  const rep = { price: d.price, deposit: d.deposit, rent: d.rent };
  const list = [...d.list].sort((a, b) => (b.c.roi ?? -9) - (a.c.roi ?? -9));
  openSheet(`<div class="sheet-head"><div><h2>${esc(d.sigungu)} ${esc(d.dong)}</h2><div class="addr">${esc(d.sido)} · 건물 ${d.list.length}곳 · 실거래 ${d.deals.toLocaleString()}건</div></div>
      <button class="btn small" data-act="close">닫기</button></div><div class="sheet-body">
    <div class="facts">
      <div><span class="k">세전 수익률</span><span class="v ${d.roi >= 0 ? 'pos' : 'neg'}">${pct(d.roi)}</span><span class="s">건물별 수익률의 중앙값</span></div>
      <div><span class="k">매매가</span><span class="v">${won(d.price)}</span><span class="s">건물별 중앙값</span></div>
      <div><span class="k">보증금 / 월세</span><span class="v">${rentTxt(d)}</span><span class="s">건물별 중앙값</span></div>
    </div>
    <div class="block"><h3>대표값으로 계산하면 <span class="faint">매매 ${wonS(d.price)} · ${rentTxt(d)}</span></h3>${ofLedger(rep, ofCalc(rep))}</div>
    <div class="block"><h3>건물별 <span class="faint">수익률 순 · 최근 12개월 실거래 중앙값</span></h3>
      <div class="tbl"><table><thead><tr><th>건물</th><th>평형</th><th>준공</th><th class="r">매매가</th><th class="r">보증금 / 월세</th><th class="r">실투자</th><th class="r">수익률</th><th class="r">거래</th></tr></thead><tbody>${
      list.map(b => `<tr><td>${esc(b.name || b.jibun)}</td><td>${b.area}㎡</td><td>${b.year || '-'}</td><td class="r">${wonS(b.price)}</td><td class="r">${rentTxt(b)}</td><td class="r">${wonS(b.c.cash)}</td><td class="r ${b.c.roi == null ? '' : b.c.roi >= 0 ? 'pos' : 'neg'}">${b.c.roi == null ? '무피' : pct(b.c.roi)}</td><td class="r faint">${b.n_trade}·${b.n_rent}</td></tr>`).join('')}</tbody></table></div>
      <p class="faint" style="font-size:12.5px;margin:6px 0 0">거래: 매매 건수·월세 건수. 건수가 적은 건물은 한두 건 거래에 값이 크게 흔들립니다.</p></div>
  </div>`);
}
function offiBldSheet(i) {
  const b = S.run.offi.buildings[i]; if (!b) return;
  const c = ofCalc(b);
  openSheet(`<div class="sheet-head"><div><h2>${esc(b.name || `${b.dong} ${b.jibun}`)}</h2><div class="addr">${esc(b.sido)} ${esc(b.sigungu)} ${esc(b.dong)} ${esc(b.jibun || '')}</div>
      <div class="tags" style="margin-top:8px"><span class="tag">${b.size}</span><span class="tag">전용 ${b.area}㎡ (${pyeong(b.area)})</span>${b.year ? `<span class="tag">준공 ${b.year}</span>` : ''}</div></div>
      <button class="btn small" data-act="close">닫기</button></div><div class="sheet-body">
    <div class="facts">
      <div><span class="k">세전 수익률</span><span class="v ${c.roi == null ? '' : c.roi >= 0 ? 'pos' : 'neg'}">${c.roi == null ? '무피' : pct(c.roi)}</span><span class="s">실투자 ${won(c.cash)}</span></div>
      <div><span class="k">매매가</span><span class="v">${won(b.price)}</span><span class="s">매매 ${b.n_trade}건 중앙값</span></div>
      <div><span class="k">보증금 / 월세</span><span class="v">${rentTxt(b)}</span><span class="s">월세 ${b.n_rent}건 중앙값</span></div>
    </div>
    <div class="block"><h3>수익 계산</h3>${ofLedger(b, c)}</div>
    <p class="faint" style="font-size:12.5px;margin:0">최근 12개월 국토교통부 실거래 기준입니다. 같은 건물이라도 층·향·상태에 따라 가격과 월세가 다르니 현장 시세를 꼭 확인하세요.</p>
  </div>`);
}
function renderOffiList() {
  if (S.tab !== 'offi') return;
  const sec = $('.redev > .section'); if (!sec) return;
  const tmp = document.createElement('div'); tmp.innerHTML = viewOffi();
  sec.replaceWith(tmp.querySelector('.redev > .section'));
}

// ── 리서치 기록 ──────────────────────────────────────────
function viewRuns() {
  if (!S.runs.length) return emptyBox('아직 리서치 기록이 없습니다', APP ? '[수집·분석 실행]을 누르면 첫 리서치가 남습니다.' : '');
  return `<section class="section">
    <div class="section-head"><h2>리서치 기록</h2><p>수집·분석이나 다시 계산을 할 때마다 그때의 결과 전체를 남깁니다. 누르면 그 리서치를 그대로 다시 볼 수 있습니다.</p></div>
    <div class="runs">${S.runs.map(r => `<button class="run${r.n === S.n ? ' cur' : ''}" data-act="open-run" data-n="${r.n}">
      <span class="no">${r.n}</span>
      <span><span class="t">${when(r.finished_at)}에 조회한 ${r.n}번째 리서치</span><br><span class="s">${KIND_RUN[r.kind] || ''}${r.n === S.latest ? ' · 최신' : ''}${r.n === S.n ? ' · 지금 보는 중' : ''}</span></span>
      <span class="c"><span>추천 <b>${r.rec ?? 0}</b></span><span>차선 <b>${r.near ?? 0}</b></span><span>재건축 <b>${r.redev ?? 0}</b></span><span>분석 <b>${(r.all ?? 0).toLocaleString()}</b></span></span>
    </button>`).join('')}</div></section>`;
}

// ── 설정 (앱) ────────────────────────────────────────────
const SETTING_GROUPS = [
  ['자금·세금', [['capital', '자본금', '만원'], ['homes_owned', '보유 주택 수', '채'], ['loan_ratio_bid', '경락잔금대출 (낙찰가 대비)', '%'], ['loan_ratio_value', '경락잔금대출 (시세 대비)', '%'], ['interest_rate', '대출 금리 (연)', '%']]],
  ['비용', [['renovation_per_m2', '수리비 (전용 ㎡당)', '만원'], ['eviction_cost', '명도비', '만원'], ['legal_fee_rate', '법무·등기 비용률', '%'], ['brokerage_rate', '중개수수료율', '%'], ['holding_tax_rate', '보유세율 (연, 시세 대비)', '%'], ['vacancy_rate', '공실·수선 충당률', '%']]],
  ['시장 가정·목표', [['renovation_premium', '수리 후 시세 상승분', '%'], ['annual_growth', '연 시세 상승률', '%'], ['flip_months', '단기매각까지 기간', '개월'], ['target_annual_roi', '목표 연수익률', '%'], ['top_n', '추천 개수', '건']]],
  ['수집량', [['detail_limit', '1회 상세 조회 상한 (일반)', '건'], ['redev_detail_limit', '1회 상세 조회 상한 (재건축 후보)', '건']]],
];
function viewSettings() {
  if (!S.settings) return emptyBox('설정을 불러오는 중입니다', '');
  const s = S.settings;
  const field = ([k, label, u]) => `<div class="field"><label for="st-${k}">${label}</label><span class="in"><input id="st-${k}" type="number" step="any" data-st="${k}" data-u="${u}" value="${toView(s[k], u)}"><em>${u}</em></span></div>`;
  return `<section class="section">
    <div class="section-head"><h2>설정</h2><p>저장한 뒤 [다시 계산]을 누르면 새 리서치로 반영됩니다. 세율은 2026년 일반 규정을 단순화한 참고용입니다.</p></div>
    ${SETTING_GROUPS.map(([g, fs]) => `<div class="panel"><h3>${g}</h3><div class="grid2">${fs.map(field).join('')}</div></div>`).join('')}
    <div class="panel"><h3>수집할 법원</h3><p class="faint" style="margin:0;font-size:13px">많을수록 오래 걸리고 법원 사이트 차단 위험이 커집니다.</p>
      <div class="courts">${Object.entries(S.courts).map(([c, n]) => `<button class="chip" aria-pressed="${s.courts.includes(c)}" data-act="court" data-v="${c}">${esc(n.replace('지방법원', '').replace('지원', ''))}</button>`).join('')}</div></div>
    <div class="panel"><h3>대상·제외</h3>
      <label class="wide-in">대상 용도 (쉼표로 구분)<input type="text" id="st-usages" value="${esc(s.usages.join(', '))}"></label>
      <label class="wide-in">제외 키워드 (쉼표로 구분)<input type="text" id="st-exclude" value="${esc(s.exclude_keywords.join(', '))}"></label></div>
    <div class="panel"><h3>외부 서비스·공유</h3>
      <label class="wide-in">실거래가 서비스키 (data.go.kr)<input type="text" id="st-molit" value="${esc(s.molit_key)}" placeholder="비우면 감정가를 시세 대신 사용"></label>
      <label class="wide-in">공유 저장소 (GitHub 사용자/저장소)<input type="text" id="st-repo" value="${esc(s.share_repo)}" placeholder="예: DcoyA/auction-share"></label>
      <label style="display:flex;gap:8px;align-items:center;font-size:14px"><input type="checkbox" id="st-auto" ${s.auto_share ? 'checked' : ''}>수집·분석이 끝나면 공유 페이지를 자동으로 올림</label>
      <p class="faint" style="margin:0;font-size:13px">AI 분석은 이 PC에 로그인된 Claude Code로만 돌립니다. 위쪽 상태 표시를 누르면 다시 확인합니다.</p></div>
    <div><button class="btn primary" data-act="st-save">설정 저장</button></div>
  </section>`;
}
function viewLog() {
  const lines = S.status?.log || [];
  return `<section class="section"><div class="section-head"><h2>진행 로그</h2><p>앱을 닫아도 data\\run.log 파일에 남습니다.</p></div>
    <pre class="log" id="log">${esc(lines.join('\n') || '아직 실행 기록이 없습니다.')}</pre></section>`;
}

// ── 상세 서류 ────────────────────────────────────────────
function openSheet(html) {
  $('#sheet').innerHTML = html;
  $('#sheet').classList.add('on'); $('#scrim').classList.add('on');
  $('#sheet').scrollTop = 0;
  $('#sheet [data-act="close"]')?.focus();
}
function closeSheet() { $('#sheet').classList.remove('on'); $('#scrim').classList.remove('on'); }
const kv = rows => `<dl class="kv">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;

function itemSheet(id) {
  const it = S.run.items.find(x => x.id === id); if (!it) return;
  const d = S.run.details[id];
  const b = it.best || {};
  let h = `<div class="sheet-head"><div><h2>${esc(it.case_no)}${it.item_no > 1 ? ` · 물건 ${it.item_no}` : ''}</h2><div class="addr">${esc(it.court)} · ${esc(it.address)}</div>
      <div class="tags" style="margin-top:8px">${it.g === 'rec' ? '<span class="tag star">추천</span>' : ''}<span class="tag ${it.grade}">${GRADE[it.grade]}</span><span class="tag">${esc(it.usage)}</span><span class="tag">${LEVEL[it.level]}</span></div></div>
      <button class="btn small" data-act="close">닫기</button></div>
    <div class="sheet-body">
    <div class="block">${ladder(it, true)}${legend()}</div>
    <div class="facts">
      <div><span class="k">매각기일</span><span class="v">${ymdW(it.sale_date)}</span><span class="s">${dday(it.sale_date)}</span></div>
      <div><span class="k">감정가</span><span class="v">${won(it.appraisal)}</span><span class="s">유찰 ${it.fail_count}회</span></div>
      <div><span class="k">최저가</span><span class="v">${won(it.min_price)}</span><span class="s">감정가의 ${pct(it.min_price / it.appraisal, 0)}</span></div>
      <div><span class="k">권장 입찰가</span><span class="v" style="color:var(--accent)">${won(it.bid)}</span><span class="s">손익분기 ${won(it.breakeven)}</span></div>
      <div><span class="k">시세</span><span class="v">${won(it.market_price)}</span><span class="s">신뢰도 ${esc(it.market_conf)}</span></div>
      <div><span class="k">${esc(b.name || '최선 전략')}</span><span class="v ${b.annual_roi >= 0 ? 'pos' : 'neg'}">연 ${pct(b.annual_roi)}</span><span class="s">필요 현금 ${won(b.cash_needed)}</span></div>
    </div>`;
  if (it.summary) h += `<div class="note brass">${esc(it.summary)}</div>`;
  if (APP && d) h += `<div class="block" id="photos"></div>`;
  if (!d) {
    h += `<div class="note warn">아직 상세(임차인·인수 권리)를 확인하지 못한 물건입니다. 목록 정보만으로 계산한 숫자라 실제와 크게 다를 수 있습니다. 기일이 가까워지면 실행할 때 상세를 엽니다.</div>`;
    h += kv([['비고', esc(it.remarks) || '-'], ['면적', it.area ? `${it.area}㎡ (${pyeong(it.area)})` : '-']]);
  } else {
    const r = d.rights, m = d.market, p = d.plan || {}, ai = d.ai;
    const bd = (p.scenarios || []).find(s => s.key === p.best)?.detail || {};
    h += `<div class="block"><h3>권리 <span class="tag ${r.grade}">${GRADE[r.grade]}</span><span class="faint">${LEVEL[r.level]} 기준</span></h3>${kv([
      ['말소기준권리', esc(r.base_right) || '-'],
      ['인수되는 권리', esc(d.burden) || '없음'],
      ['권장가에서 떠안는 돈', `<b>${won(bd.assumed)}</b>`],
      ['점유', r.occupied == null ? '모름' : r.occupied ? '점유자 있음 (명도 필요)' : '없음'],
      ['주의', (r.flags || []).map(esc).join(', ') || '없음'],
      ['비고', esc(it.remarks) || '-'],
    ])}`;
    if ((r.tenants || []).length) h += `<div class="tbl"><table><thead><tr><th class="r">보증금</th><th>전입</th><th>확정일자</th><th>배당요구</th><th>대항력</th></tr></thead><tbody>${
      r.tenants.map(t => `<tr><td class="r">${won(t.deposit)}</td><td>${t.move_in || '-'}</td><td>${t.fixed || '-'}</td><td>${t.claimed ? '함' : '안 함'}</td><td>${t.senior == null ? '판단 불가' : t.senior ? '<b class="neg">있음</b>' : '없음'}</td></tr>`).join('')}</tbody></table></div>`;
    h += `</div>`;
    if (ai) h += `<div class="block"><h3>AI 권리 검토 <span class="tag ${ai.grade}">${GRADE[ai.grade]}</span><span class="faint">Claude Code</span></h3>${kv([
      ['명도 난이도', esc(ai.eviction)], ['떠안을 돈 추정', won(ai.assumed_amount)],
      ['위험', (ai.risks || []).map(esc).join('<br>') || '-'],
      ['근거', (ai.quotes || []).map(q => `“${esc(q)}”`).join('<br>') || '-'],
    ])}</div>`;
    h += `<div class="block"><h3>시세 <span class="faint">${esc(m.source)} · 신뢰도 ${esc(m.confidence)} · 표본 ${m.sale_n ?? 0}건</span></h3>${kv([
      ['매매 시세', `<b>${won(m.sale_price)}</b>${m.raw_sale_price ? ` <span class="faint">(실거래 중앙값 ${won(m.raw_sale_price)}을 감정가로 낮춤)</span>` : ''}`],
      ['전세', won(m.jeonse)],
      ['월세', m.rent_monthly ? `보증금 ${won(m.rent_deposit)} / 월 ${won(m.rent_monthly)}` : '실거래 없음 (추정치 사용)'],
    ])}`;
    if ((m.recent || []).length) h += `<div class="tbl"><table><thead><tr><th>계약일</th><th>이름</th><th class="r">면적</th><th>층</th><th class="r">금액</th></tr></thead><tbody>${
      m.recent.map(t => `<tr><td>${ymd(t.date)}</td><td>${esc(t.name || '-')}</td><td class="r">${t.area}㎡</td><td>${esc(t.floor || '-')}</td><td class="r">${won(t.price)}</td></tr>`).join('')}</tbody></table></div>`;
    h += `</div>`;
    if (p.scenarios) {
      h += `<div class="block"><h3>엑싯 전략 <span class="faint">입찰가 ${won(p.bid)} 기준${p.recommended ? '' : ' · 목표 수익률 미달'}</span></h3>
        <div class="tbl"><table><thead><tr><th>전략</th><th class="r">필요 현금</th><th class="r">순이익</th><th class="r">수익률</th><th class="r">연환산</th></tr></thead><tbody>${
        p.scenarios.map(s => `<tr class="${s.key === p.best ? 'best' : ''}"><td>${esc(s.name)}</td><td class="r">${won(s.cash_needed)}</td><td class="r ${s.net_profit >= 0 ? 'pos' : 'neg'}">${won(s.net_profit)}${s.key === 'C' ? ' /년' : ''}</td><td class="r">${pct(s.roi)}</td><td class="r">${pct(s.annual_roi)}</td></tr>`).join('')}</tbody></table></div>
        <p class="faint" style="margin:0;font-size:12.5px">대출 ${won(bd.loan)} · 취득세 ${won(bd.acq_tax)} · 법무 ${won(bd.legal)} · 명도 ${won(bd.eviction)} · 수리 ${won(bd.renovation)}</p></div>`;
    }
    if (d.spec_text) h += `<details class="block"><summary style="cursor:pointer;font-weight:700">매각물건명세서 원문</summary><pre class="spec">${esc(d.spec_text)}</pre></details>`;
  }
  h += `<p class="faint" style="font-size:12.5px;margin:0">모든 숫자는 참고용입니다. 입찰 전에 등기부·현장·세금을 따로 확인하세요.</p></div>`;
  openSheet(h);
  if (APP && d) loadPhotos(id);
}
async function loadPhotos(id) {
  try {
    const ps = await getJSON(`/api/photos?id=${encodeURIComponent(id)}`);
    const el = $('#photos');
    if (el && ps.length) el.innerHTML = `<h3>현장 사진 <span class="faint">${ps.length}장</span></h3><div class="photos">${ps.map(p => `<img src="data:image/jpeg;base64,${p}" alt="현장 사진" loading="lazy">`).join('')}</div>`;
  } catch (e) { /* 사진 없음 */ }
}

function redevSheet(id) {
  const it = S.run.redev.items.find(x => x.id === id); if (!it) return;
  const P = S.P, ov = S.OV[id] || {};
  const e = rdEval(it), a = e.at, [vc, vl] = VERDICT[e.verdict];
  const zones = Object.keys(P.far_table);
  let h = `<div class="sheet-head"><div><h2>${esc(it.case_no)}${it.item_no > 1 ? ` · 물건 ${it.item_no}` : ''}</h2><div class="addr">${esc(it.court)} · ${esc(it.address)}</div>
      <div class="tags" style="margin-top:8px"><span class="tag ${vc}">${vl}</span><span class="tag">${esc(it.usage)}</span><span class="tag">${it.has_detail ? '상세 확인' : '목록 정보만'}</span></div></div>
      <button class="btn small" data-act="close">닫기</button></div><div class="sheet-body">
    <div class="facts">
      <div><span class="k">대지</span><span class="v">${pyeong(a.land)}</span><span class="s">${a.land?.toFixed(1)}㎡ · ${esc(it.land_src)}</span></div>
      <div><span class="k">용도지역</span><span class="v">${esc(a.zone)}</span><span class="s">${ov.zone ? '직접 입력' : a.zoneAssumed ? '가정값' : esc(it.zone_src || '감정평가서')} · 용적률 ${(a.far * 100).toFixed(0)}%</span></div>
      <div><span class="k">예상 규모</span><span class="v">${a.units}세대</span><span class="s">연면적 ${pyeong(a.gfaAll)} · 분양 전용 ${pyeong(a.net)}</span></div>
      <div><span class="k">최저가</span><span class="v">${won(it.min_price)}</span><span class="s">감정가 ${won(it.appraisal)} · 유찰 ${it.fail_count}회</span></div>
      <div><span class="k">권장 최고 낙찰가</span><span class="v ${e.maxBid != null && e.maxBid >= it.min_price ? 'pos' : ''}">${e.maxBid != null ? won(e.maxBid) : '-'}</span><span class="s">목표 이익률 ${pct(P.target_margin, 0)}</span></div>
      <div><span class="k">매각기일</span><span class="v">${ymdW(it.sale_date)}</span><span class="s">${dday(it.sale_date)}</span></div>
    </div>
    ${e.why.length ? `<div class="note warn"><b>확인할 것</b><br>${e.why.map(esc).join('<br>')}</div>` : ''}
    <div class="block"><h3>이 물건만 바꿔 보기 <span class="faint">비우면 기본 계산</span></h3>
      <div class="ov">
        <label>용도지역<select data-ov="zone" data-id="${esc(id)}"><option value="">${esc(it.zone || P.default_zone)} (${it.zone ? '감정평가서' : '가정'})</option>${zones.map(z => `<option ${ov.zone === z ? 'selected' : ''}>${esc(z)}</option>`).join('')}</select></label>
        <label>대지면적 (㎡)<input type="number" step="any" data-ov="land_m2" data-id="${esc(id)}" value="${ov.land_m2 ?? ''}" placeholder="${it.land_m2}"></label>
        <label>분양가 (전용 평당 만원)<input type="number" step="any" data-ov="price_py" data-id="${esc(id)}" value="${ov.price_py ? ov.price_py / 1e4 : ''}" placeholder="${a.pm2 ? Math.round(a.pm2 * PY / 1e4) : '직접 입력'}"></label>
      </div></div>`;
  if (a.missing) {
    h += `<div class="note warn">이 지역에 최근 3년 안에 지어진 연립·다세대 거래가 없어 분양가를 알 수 없습니다. 위에 분양가(전용 평당)를 넣으면 계산됩니다.</div>`;
  } else {
    const row = (k, v, cls = '') => `<tr class="${cls}"><td>${k}</td><td class="r">${won(v)}</td></tr>`;
    h += `<div class="block"><h3>사업 수지 <span class="faint">최저가 ${won(it.min_price)}에 낙찰 · 사업기간 ${a.months}개월</span></h3>
      <div class="tbl ledger"><table><tbody>
        ${row('분양 매출', a.revenue, 'total')}
        <tr class="sub"><td>분양 전용 ${pyeong(a.net)} × 전용 평당 ${won(a.pm2 * PY)}</td><td class="r faint">${esc(a.priceSrc)}</td></tr>
        ${row('토지비', a.landCost, 'total')}
        ${row('낙찰가', a.bid, 'sub')}${row('인수 권리', a.assumed, 'sub')}${row('취득세·법무', a.acq, 'sub')}${row('명도비', P.eviction, 'sub')}
        ${row('공사비', a.build + a.design + a.demolish + a.contingency, 'total')}
        ${row(`건축비 (연면적 ${pyeong(a.gfaAll)} × ${won(P.build_cost_py)})`, a.build, 'sub')}${row('설계·감리', a.design, 'sub')}${row('철거', a.demolish, 'sub')}${row('예비비', a.contingency, 'sub')}
        ${row('인허가·세금', a.permit + a.preserve, 'total')}
        ${row('인허가·부담금', a.permit, 'sub')}${row('보존등기 취득세', a.preserve, 'sub')}
        ${row('금융비 (PF)', a.interest + a.fee, 'total')}
        ${row(`이자 (대출 ${won(a.loan)}, 연 ${pct(P.pf_rate)})`, a.interest, 'sub')}${row('수수료', a.fee, 'sub')}
        ${row('분양 대행·홍보', a.selling, 'total')}
        ${row('총사업비', a.total, 'total')}
        <tr class="best"><td>세전 이익 · 매출이익률 ${pct(a.margin)}</td><td class="r ${a.pre >= 0 ? 'pos' : 'neg'}">${won(a.pre)}</td></tr>
        ${row('세금 (법인세 등)', a.tax, 'sub')}
        <tr class="best"><td>세후 이익</td><td class="r ${a.post >= 0 ? 'pos' : 'neg'}">${won(a.post)}</td></tr>
      </tbody></table></div>
      ${kv([['자기자본', `${won(a.equity)} <span class="faint">(토지비+공사비의 ${pct(1 - P.pf_ltc, 0)})</span>`], ['자기자본 수익률', `${pct(a.roe)} · 연환산 ${pct(a.annual)}`]])}</div>`;
  }
  if (it.newbuild?.recent?.length) h += `<div class="block"><h3>주변 신축 거래 <span class="faint">준공 3년 이내 연립·다세대 · ${esc(it.newbuild.scope)} ${it.newbuild.n}건</span></h3>
    <div class="tbl"><table><thead><tr><th>계약일</th><th>이름</th><th>동</th><th>준공</th><th class="r">전용</th><th class="r">금액</th><th class="r">전용 평당</th></tr></thead><tbody>${
    it.newbuild.recent.map(t => `<tr><td>${ymd(t.date)}</td><td>${esc(t.name || '-')}</td><td>${esc(t.dong || '')}</td><td>${esc(t.year)}</td><td class="r">${t.area}㎡</td><td class="r">${won(t.price)}</td><td class="r">${won(t.price / t.area * PY)}</td></tr>`).join('')}</tbody></table></div></div>`;
  const bd = it.bldg;
  if (bd) h += `<div class="block"><h3>건축물대장 <span class="faint">국토교통부 건축HUB</span></h3>${kv([
    ['사용승인', bd.use_apr_day ? `${bd.use_apr_day.slice(0, 4)}.${bd.use_apr_day.slice(4, 6)}.${bd.use_apr_day.slice(6, 8)} <b class="${bd.age < P.min_age ? 'warn-t' : ''}">(${bd.age}년 된 건물)</b>` : '-'],
    ['구조·용도', [bd.structure, bd.purpose].filter(Boolean).map(esc).join(' · ') || '-'],
    ['규모', `지상 ${bd.floors ?? '-'}층${bd.basement ? ` · 지하 ${bd.basement}층` : ''}${bd.units ? ` · ${bd.units}세대(가구)` : ''}${bd.buildings > 1 ? ` · 건물 ${bd.buildings}동` : ''}`],
    ['대장 대지면적', bd.plat_area ? `${bd.plat_area}㎡ (${pyeong(bd.plat_area)})` : '대장에 없음'],
    ['연면적', bd.tot_area ? `${bd.tot_area}㎡ (${pyeong(bd.tot_area)})` : '-'],
    ['현재 건폐율·용적률', `${bd.bc_rat ? bd.bc_rat + '%' : '-'} · ${bd.vl_rat ? bd.vl_rat + '%' : '-'}`],
    ['용도지역 (대장)', esc(bd.zone_raw) || '-'],
  ])}${bd.age < P.min_age ? `<div class="note warn">${bd.age}년 된 비교적 새 건물입니다. 철거하면 남은 건물 가치를 버리게 되어, 노후 기준(${P.min_age}년) 미만은 '사업성 있음 · 확인 필요'로 분류했습니다.</div>` : ''}</div>`;
  else if (it.jimok && !it.bldg_m2) h += `<div class="note">건축물대장에 건물이 없습니다 (나대지이거나 대장 미등재).</div>`;
  h += `<div class="block"><h3>땅·권리 <span class="faint">${it.has_detail ? '감정평가서·매각물건명세서' : '목록 정보'}</span></h3>${kv([
    ['토지이용계획', esc(it.zone_text) || '아직 확인 못 함 (상세 대기)'],
    ['도로', esc(it.road) || '-'], ['형상·이용', esc(it.shape) || '-'],
    ['기존 건물', it.bldg_m2 ? `${it.bldg_m2}㎡ (${pyeong(it.bldg_m2)})` : '-'],
    ['대지 메모', esc(it.land_note) || '-'],
    ['권리', `${GRADE[it.rights.grade] || '-'} · ${esc(it.rights.base_right) || '말소기준 미확인'}`],
    ['비고', esc(it.remarks) || '-'],
  ])}${it.risks.length ? `<div class="note warn">확인할 위험: ${esc(it.risks.join(', '))}</div>` : ''}</div>
  <p class="faint" style="font-size:12.5px;margin:0">용적률·주차·일조 사선·건축선 후퇴 때문에 실제 규모는 설계를 해 봐야 압니다. 사업 결정 전에 건축사 가설계와 인허가 가능 여부를 꼭 확인하세요.</p></div>`;
  openSheet(h);
}

// ── 그리기 ───────────────────────────────────────────────
function renderMain() {
  const main = $('#main');
  if (!S.run && !['settings', 'log'].includes(S.tab)) {
    main.innerHTML = `<div class="wrap">${emptyBox('아직 리서치 결과가 없습니다', APP ? '[수집·분석 실행]을 누르면 법원 경매 물건을 모아 분석하고, 첫 번째 리서치로 남깁니다.' : '곧 첫 리서치가 올라옵니다.')}</div>`;
    return;
  }
  const v = { top: viewTop, redev: viewRedev, offi: viewOffi, all: viewAll, runs: viewRuns, settings: viewSettings, log: viewLog }[S.tab] || viewTop;
  main.innerHTML = `<div class="wrap" style="display:grid;gap:28px">${v()}</div>`;
  if (S.tab === 'log') { const l = $('#log'); if (l) l.scrollTop = l.scrollHeight; }
}
function render() {
  if (!APP && ['settings', 'log'].includes(S.tab)) S.tab = 'top';
  // 주소에 지금 탭을 남긴다 → 주소창을 복사하면 이 탭이 바로 열리는 링크가 된다
  if (location.hash.slice(1) !== S.tab) history.replaceState(null, '', `#${S.tab}`);
  renderTop(); renderMasthead(); renderTabs(); renderMain();
  $('#foot').innerHTML = `<div class="wrap">자료: 대법원 법원경매정보, 국토교통부 실거래가. 시세를 못 구한 물건은 감정가의 90%로 대신 계산했습니다. 권리분석·세금·사업성 숫자는 참고용이니 입찰과 사업 결정 전에 전문가와 서류로 확인하세요.${APP ? '' : ' 개인적으로 공유한 자료이니 다른 곳에 옮기지 말아 주세요.'}</div>`;
}
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 4200);
}

// ── 이벤트 ───────────────────────────────────────────────
document.addEventListener('click', async ev => {
  const el = ev.target.closest('[data-act]'); if (!el) return;
  const act = el.dataset.act;
  if (el.tagName === 'A') ev.preventDefault();
  const saveF = () => { store.set('filters', { ...S.f, q: '' }); S.shown = PAGE; renderMain(); };
  const saveOF = () => { store.set('ofilters', { ...S.of, q: '' }); S.oshown = PAGE; renderMain(); };
  const saveRF = () => { store.set('rfilters', { ...S.rf, q: '' }); S.rshown = PAGE; renderMain(); };
  switch (act) {
    case 'tab':
      S.tab = el.dataset.tab; store.set('tab', S.tab); render(); window.scrollTo({ top: 0 }); break;
    case 'item': itemSheet(el.dataset.id); break;
    case 'redev': redevSheet(el.dataset.id); break;
    case 'close': closeSheet(); break;
    case 'open-run': await openRun(+el.dataset.n); S.tab = S.tab === 'runs' ? 'top' : S.tab; render(); window.scrollTo({ top: 0 }); break;
    case 'more': S.shown += PAGE; renderMain(); break;
    case 'rmore': S.rshown += PAGE; renderMain(); break;
    case 'all-near': S.f.group = 'near'; S.tab = 'all'; render(); break;
    case 'f-group': S.f.group = el.dataset.v; saveF(); break;
    case 'f-kind': { const k = el.dataset.v; S.f.kinds = !k ? [] : S.f.kinds.includes(k) ? S.f.kinds.filter(x => x !== k) : [...S.f.kinds, k]; saveF(); break; }
    case 'f-reset': S.f = { group: 'all', kinds: [], sido: '', sigungu: '', q: '' }; saveF(); break;
    case 'offi-dong': offiDongSheet(el.dataset.k); break;
    case 'offi-b': offiBldSheet(+el.dataset.i); break;
    case 'omore': S.oshown += PAGE; renderMain(); break;
    case 'of-view': S.of.view = el.dataset.v; saveOF(); break;
    case 'of-size': S.of.size = el.dataset.v; saveOF(); break;
    case 'op-reset': S.Q = { ...S.run.offi.params }; store.set('offiParams', null); renderMain(); toast('리서치 기준값으로 되돌렸습니다'); break;
    case 'op-save': {
      const { _edited, ...q } = S.Q;
      try { await api('/api/settings', 'PUT', { offi: q }); toast('오피스텔 가정값을 앱 기본값으로 저장했습니다. 다음 리서치부터 적용됩니다.'); }
      catch (e) { toast(`저장하지 못했습니다: ${e.message}`); }
      break;
    }
    case 'rf-verdict': S.rf.verdict = el.dataset.v; saveRF(); break;
    case 'rf-detail': S.rf.detail = el.checked; saveRF(); break;
    case 'rp-reset': S.P = { ...structuredCloneSafe(S.run.redev.params), _base: S.n }; store.set('redevParams', null); rdCache.clear(); renderMain(); toast('리서치 기준값으로 되돌렸습니다'); break;
    case 'rp-save': {
      const { _base, _edited, ...p } = S.P;
      try { await api('/api/settings', 'PUT', { redev: p }); toast('재건축 가정값을 앱 기본값으로 저장했습니다. 다음 리서치부터 적용됩니다.'); }
      catch (e) { toast(`저장하지 못했습니다: ${e.message}`); }
      break;
    }
    case 'court': { const c = el.dataset.v; const cs = S.settings.courts; S.settings.courts = cs.includes(c) ? cs.filter(x => x !== c) : [...cs, c]; el.setAttribute('aria-pressed', S.settings.courts.includes(c)); break; }
    case 'st-save': await saveSettings(); break;
    case 'run': await runJob('/api/run', { collect: true, detail: true }, '수집·분석을 시작했습니다. 진행 로그 탭에서 볼 수 있습니다.'); break;
    case 'recalc': await runJob('/api/analyze', null, '지금 설정으로 다시 계산합니다.'); break;
    case 'stop': await api('/api/stop', 'POST'); toast('중지를 요청했습니다. 지금 하던 물건까지만 처리하고 멈춥니다.'); break;
    case 'share': {
      el.disabled = true;
      try { const r = await api('/api/share', 'POST'); toast(r.url ? `공유 페이지를 올렸습니다. 1~2분 뒤 ${r.url} 에 반영됩니다.` : `공유 파일을 만들었습니다: ${r.path} (공유 저장소를 설정하면 자동으로 올립니다)`); }
      catch (e) { toast(`올리지 못했습니다: ${e.message}`); }
      el.disabled = false; break;
    }
    case 'claude': await api('/api/claude', 'POST'); toast('Claude Code 상태를 다시 확인합니다.'); break;
  }
});
document.addEventListener('input', ev => {
  const el = ev.target;
  if (el.dataset.rp) {
    const k = el.dataset.rp;
    const v = el.tagName === 'SELECT' ? el.value : fromView(parseFloat(el.value), el.dataset.u);
    if (el.tagName !== 'SELECT' && !isFinite(v)) return;
    S.P[k] = v; S.P._edited = true; store.set('redevParams', S.P); rdCache.clear();
    el.closest('.field')?.classList.toggle('changed', Math.abs((v || 0) - (S.run.redev.params[k] || 0)) > 1e-9 || typeof v === 'string');
    renderRedevList();
  } else if (el.dataset.op) {
    const k = el.dataset.op, v = fromView(parseFloat(el.value), el.dataset.u);
    if (!isFinite(v)) return;
    S.Q[k] = v; S.Q._edited = true; store.set('offiParams', S.Q);
    el.closest('.field')?.classList.toggle('changed', Math.abs(v - S.run.offi.params[k]) > 1e-9);
    clearTimeout(document.opT); document.opT = setTimeout(renderOffiList, 150);
  } else if (el.dataset.far) {
    const v = parseFloat(el.value); if (!isFinite(v)) return;
    S.P.far_table = { ...S.P.far_table, [el.dataset.far]: Object.assign([...S.P.far_table[el.dataset.far]], { [el.dataset.i]: v }) };
    S.P._edited = true; store.set('redevParams', S.P); rdCache.clear(); renderRedevList();
  } else if (el.dataset.ov) {
    const id = el.dataset.id, k = el.dataset.ov;
    const o = { ...(S.OV[id] || {}) };
    if (el.value === '') delete o[k]; else o[k] = k === 'zone' ? el.value : k === 'price_py' ? parseFloat(el.value) * 1e4 : parseFloat(el.value);
    S.OV[id] = o; store.set('redevOv', S.OV); rdCache.delete(id);
    clearTimeout(document.ovT); document.ovT = setTimeout(() => { const y = $('#sheet').scrollTop; redevSheet(id); $('#sheet').scrollTop = y; renderRedevList(); }, 350);
  } else if (['q', 'r-q', 'o-q'].includes(el.dataset.chg)) {
    const t = { q: S.f, 'r-q': S.rf, 'o-q': S.of }[el.dataset.chg];
    t.q = el.value; clearTimeout(document.qT);
    document.qT = setTimeout(() => { S.shown = PAGE; S.rshown = PAGE; S.oshown = PAGE; renderMain(); const box = $(`[data-chg="${el.dataset.chg}"]`); if (box) { box.focus(); box.setSelectionRange(box.value.length, box.value.length); } }, 250);
  }
});
document.addEventListener('change', ev => {
  const el = ev.target, c = el.dataset.chg;
  if (c === 'sido') { S.f.sido = el.value; S.f.sigungu = ''; store.set('filters', { ...S.f, q: '' }); S.shown = PAGE; renderMain(); }
  if (c === 'sigungu') { S.f.sigungu = el.value; store.set('filters', { ...S.f, q: '' }); S.shown = PAGE; renderMain(); }
  if (c === 'r-sido') { S.rf.sido = el.value; S.rf.sigungu = ''; store.set('rfilters', { ...S.rf, q: '' }); S.rshown = PAGE; renderMain(); }
  if (c === 'r-sigungu') { S.rf.sigungu = el.value; store.set('rfilters', { ...S.rf, q: '' }); S.rshown = PAGE; renderMain(); }
  if (c === 'o-sido') { S.of.sido = el.value; S.of.sigungu = ''; store.set('ofilters', { ...S.of, q: '' }); S.oshown = PAGE; renderMain(); }
  if (c === 'o-sigungu') { S.of.sigungu = el.value; store.set('ofilters', { ...S.of, q: '' }); S.oshown = PAGE; renderMain(); }
  if (el.dataset.rp && el.tagName === 'SELECT') { S.P[el.dataset.rp] = el.value; S.P._edited = true; store.set('redevParams', S.P); rdCache.clear(); renderRedevList(); }
});
function renderRedevList() {
  // 가정값 입력칸에 포커스가 있으니 목록만 다시 그린다
  if (S.tab !== 'redev') return;
  const sec = $('.redev > .section'); if (!sec) return;
  const tmp = document.createElement('div'); tmp.innerHTML = viewRedev();
  sec.replaceWith(tmp.querySelector('.redev > .section'));
}
document.addEventListener('keydown', ev => { if (ev.key === 'Escape') closeSheet(); });
$('#scrim')?.addEventListener('click', closeSheet);

// ── 앱 전용: 실행·설정·상태 ──────────────────────────────
async function runJob(path, body, msg) {
  try { await api(path, 'POST', body); toast(msg); S.tab = 'log'; await poll(); render(); }
  catch (e) { toast(`시작하지 못했습니다: ${e.message}`); }
}
async function saveSettings() {
  const s = { ...S.settings };
  document.querySelectorAll('[data-st]').forEach(el => { const v = parseFloat(el.value); if (isFinite(v)) s[el.dataset.st] = fromView(v, el.dataset.u); });
  s.usages = $('#st-usages').value.split(',').map(x => x.trim()).filter(Boolean);
  s.exclude_keywords = $('#st-exclude').value.split(',').map(x => x.trim()).filter(Boolean);
  s.molit_key = $('#st-molit').value.trim(); s.share_repo = $('#st-repo').value.trim(); s.auto_share = $('#st-auto').checked;
  for (const k of ['homes_owned', 'flip_months', 'top_n', 'detail_limit', 'redev_detail_limit']) s[k] = Math.round(s[k]);
  const { redev, ...rest } = s;
  try { S.settings = await api('/api/settings', 'PUT', rest); toast('설정을 저장했습니다. [다시 계산]을 누르면 새 리서치로 반영됩니다.'); }
  catch (e) { toast(`저장하지 못했습니다: ${e.message}`); }
}
async function poll() {
  try {
    const st = await getJSON('/api/status');
    const prev = S.status; S.status = st;
    if (st.latest && st.latest !== S.latest) {
      const wasLatest = S.n === S.latest;
      await loadRuns();
      if (wasLatest || !S.n) { await openRun(S.latest); toast(`${S.latest}번째 리서치를 저장했습니다.`); if (S.tab === 'log') S.tab = 'top'; }
      render(); return;
    }
    if (!prev || prev.running !== st.running || prev.stage !== st.stage || JSON.stringify(prev.claude) !== JSON.stringify(st.claude)) renderTop();
    if (S.tab === 'log') { const l = $('#log'); if (l) { const atEnd = l.scrollTop + l.clientHeight >= l.scrollHeight - 30; l.textContent = st.log.join('\n') || '아직 실행 기록이 없습니다.'; if (atEnd) l.scrollTop = l.scrollHeight; } }
  } catch (e) { /* 서버 재시작 중 */ }
}

// ── 시작 ─────────────────────────────────────────────────
(async () => {
  try {
    await loadRuns();
    if (S.latest) await openRun(S.latest);
    if (APP) {
      const r = await getJSON('/api/settings'); S.settings = r.settings; S.courts = r.courts; S.defaults = r.defaults;
      await poll(); setInterval(poll, 2500);
    }
  } catch (e) {
    $('#main').innerHTML = `<div class="wrap">${emptyBox('결과를 불러오지 못했습니다', esc(e.message) + ' — 잠시 뒤 새로고침해 보세요.')}</div>`;
    return;
  }
  render();
})();
})();
