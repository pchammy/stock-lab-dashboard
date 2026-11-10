'use strict';

const $ = (id) => document.getElementById(id);
const number = (v, digits = 0) => Number.isFinite(v) ? v.toLocaleString('zh-CN', {minimumFractionDigits: digits, maximumFractionDigits: digits}) : '—';
const money = (v) => Number.isFinite(v) ? `¥${number(v, 2)}` : '—';
const percent = (v) => Number.isFinite(v) ? `${number(v * 100, 2)}%` : '—';
const safe = (v) => String(v ?? '—').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const timestamp = (s) => Number.isFinite(Date.parse(s)) ? new Intl.DateTimeFormat('zh-CN', {timeZone:'Asia/Shanghai', month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(s)) : '—';
const STATUS = {running:'运行中', completed:'已完成', failed:'训练失败', idle:'未开始', stale:'更新中断'};
const STEPS = [['starting','准备数据'],['training','训练与账户验证'],['evaluating','整合与回测'],['complete','生成结果']];
const SERIES = [['ensemble','集成策略','#1d5fbf'],['momentum_20d','20 日动量','#262a30'],['cash','持有现金','#858c97']];
const tradeSide = {buy:'买入',sell:'卖出',delist_writeoff:'退市核销',delist_recovery:'退市回收'};
const owner = location.hostname.endsWith('.github.io') ? location.hostname.slice(0, -10) : '';
const repo = location.pathname.split('/').filter(Boolean)[0];
const remote = owner && /^[\w.-]+$/.test(repo || '') ? `https://raw.githubusercontent.com/${owner}/${repo}/live/state.json` : '';
let snapshot, source = '', fetchFailed = false, busy = false, range = 'all', pageSize = 8;
let chartRows = [], chartPointer = -1, chartGeometry;

if (remote) {
  $('repo').href = `https://github.com/${owner}/${repo}`;
  $('repo').hidden = false;
}

const text = (id, value) => { $(id).textContent = value; };
function pair(label, value) { return `<div><dt>${safe(label)}</dt><dd>${safe(value)}</dd></div>`; }
function setNotice(message) { text('notice', message); $('notice').hidden = !message; }

async function request(url) {
  const parsed = new URL(url, location.href);
  parsed.searchParams.set('t', Date.now());
  const response = await fetch(parsed, {cache:'no-store', signal:AbortSignal.timeout(6000)});
  if (!response.ok) throw new Error(String(response.status));
  const data = await response.json();
  if (data.schema !== 1 || !data.run || !Array.isArray(data.equity) || !Array.isArray(data.agents)) throw new Error('Invalid state');
  return data;
}

async function refresh() {
  if (busy) return;
  busy = true;
  $('refresh').disabled = true;
  try {
    let incoming, path = remote ? 'remote' : 'local';
    if (remote) {
      try { incoming = await request(remote); } catch { fetchFailed = true; }
    }
    if (!incoming && (!snapshot || !remote)) {
      incoming = await request('./state.json');
      path = remote ? 'archive' : 'local';
    }
    if (incoming) {
      fetchFailed = path === 'archive';
      const changed = !snapshot || snapshot.updated_at !== incoming.updated_at || snapshot.run.id !== incoming.run.id;
      snapshot = incoming;
      source = path;
      if (changed) renderResults();
    }
  } catch { fetchFailed = true; }
  finally {
    busy = false;
    $('refresh').disabled = false;
    renderRun();
  }
}

function renderRun() {
  if (!snapshot) {
    setNotice(fetchFailed ? '暂时无法读取训练数据，请刷新重试。' : '');
    text('connection', fetchFailed ? '连接失败' : '正在连接');
    return;
  }
  const {run, report} = snapshot;
  const stale = run.status === 'running' && Date.now() - Date.parse(run.updated_at || snapshot.updated_at) > 90000;
  const status = stale ? 'stale' : run.status;
  text('status', STATUS[status] || '状态未知'); $('status').dataset.status = status;
  text('completed', number(run.completed_agents)); text('total', `/ ${number(run.total_agents)}`);
  const progress = $('progress'); progress.max = Math.max(1, run.total_agents || 0); progress.value = run.completed_agents || 0;
  const step = STEPS.findIndex(([id]) => id === run.stage);
  text('stage', stale ? '等待本机同步' : STEPS[step]?.[1] || STATUS[run.status] || '—');
  text('initial', money(report?.execution?.initial_cash));
  text('updated', timestamp(run.updated_at || snapshot.updated_at));
  text('connection', fetchFailed ? '显示上次可用数据' : source === 'remote' ? 'GitHub 状态 · 每 20 秒检查' : '本机状态 · 每 20 秒检查');
  setNotice(stale ? '本机超过 90 秒没有更新。这里保留了最后收到的进度。' : fetchFailed ? '实时状态暂时无法读取，页面正在显示上次可用的数据。' : run.status === 'failed' ? '本次训练已停止，回测区保留最近完成的结果。' : '');
  $('stages').innerHTML = STEPS.map(([, label], i) => {
    const done = run.status === 'completed' || (step >= 0 && i < step);
    const active = !done && i === step && run.status === 'running';
    return `<li class="${done ? 'done' : active ? 'active' : ''}"><span class="stage-mark">${done ? '✓' : i + 1}</span>${safe(label)}<span class="stage-state">${done ? '完成' : active ? (stale ? '等待同步' : '进行中') : '待运行'}</span></li>`;
  }).join('');
  const result = report?.test?.results?.ensemble;
  text('finding', run.status === 'running' ? '训练进度随本机同步，回测区显示最近完成的结果。' : result ? `最近完成的历史测试中，集成策略从 ${money(report.execution.initial_cash)} 变为 ${money(result.ending_equity)}。` : '等待第一次模拟训练完成。');
}

function renderResults() {
  const {report, sensitivity, coverage = []} = snapshot;
  const test = report?.test, result = test?.results?.ensemble;
  text('test-window', test ? `${test.start} 至 ${test.end}` : '等待可用回测');
  text('ending', money(result?.ending_equity)); $('ending').classList.toggle('negative', (result?.total_return ?? 0) < 0);
  text('drawdown', percent(result?.max_drawdown));
  text('auc', number(test?.auc, 3));
  $('comparison').innerHTML = SERIES.map(([key, label]) => `<span>${safe(label)} <b>${safe(money(test?.results?.[key]?.ending_equity))}</b></span>`).join('');
  $('checks').innerHTML = pair('独立测试收益率', percent(result?.total_return)) + pair('集成策略成交', number(result?.trade_count)) + pair('方向样本数', number(test?.predictions)) + pair('按最后收盘价回收 · 期末', money(sensitivity?.hypothetical_immediate_cash_at_last_listed_close?.ending_equity));
  const data = report?.data;
  $('data-meta').innerHTML = pair('实际覆盖股票', data ? `${number(data.symbols)} / ${number(data.requested_symbols)} 只` : '—') + pair('其中后来退市', number(data?.delisted_symbols)) + pair('日线记录', number(data?.rows)) + pair('覆盖区间', data ? `${data.start} 至 ${data.end}` : '—');
  const peak = Math.max(1, ...coverage.map((row) => row.symbols_with_bars));
  $('coverage-chart').innerHTML = coverage.map((row) => `<i style="--bar-height:${Math.max(1, row.symbols_with_bars / peak * 82)}px" title="${safe(row.year)} 年 · ${safe(row.symbols_with_bars)} 只"></i>`).join('');
  document.querySelector('.coverage-labels')?.remove();
  if (coverage.length) $('coverage-chart').insertAdjacentHTML('afterend', `<div class="coverage-labels"><span>${safe(coverage[0].year)}</span><span>${safe(coverage.at(-1).year)}</span></div>`);
  renderAgents(); renderTrades(); drawChart();
}

function renderAgents() {
  const agents = [...(snapshot?.agents || [])];
  const capital = snapshot?.report?.execution?.initial_cash || 100000;
  const bins = [['< 25%',0],['25–50%',0],['50–75%',0],['75–100%',0],['≥ 100%',0]];
  for (const row of agents) bins[Math.max(0,Math.min(4,Math.floor(4 * row.ending_equity / capital)))][1]++;
  const peak = Math.max(1, ...bins.map(([, count]) => count));
  $('distribution').innerHTML = bins.map(([label,count]) => `<div class="bin"><b>${number(count)}</b><i style="--bin-height:${Math.max(1, 32 * count / peak)}px"></i>${safe(label)}</div>`).join('');
  text('agent-summary', agents.length ? `${number(agents.length)} 个账户 · ${number(agents.filter((row) => row.ending_equity > capital).length)} 个超过起始资金` : '等待账户明细');
  const sort = $('agent-sort').value;
  agents.sort((a,b) => sort === 'seed' ? a.seed - b.seed : sort === 'low' ? a.ending_equity - b.ending_equity : b.ending_equity - a.ending_equity);
  $('agent-table').innerHTML = agents.slice(0,pageSize).map((a) => `<tr><td class="mono">#${safe(String(a.seed).padStart(4,'0'))}</td><td>${money(a.ending_equity)}</td><td class="${a.total_return < 0 ? 'negative' : ''}">${percent(a.total_return)}</td><td>${number(a.trade_count)}</td></tr>`).join('');
  $('more-agents').hidden = agents.length <= pageSize;
}

function renderTrades() {
  const filter = $('trade-strategy').value;
  const trades = [...(snapshot?.trades || [])].reverse().filter((row) => filter === 'all' || row.strategy === filter);
  $('trade-table').innerHTML = trades.slice(0,8).map((row) => `<tr><td><span class="mono">${safe(row.symbol)}</span><span class="table-sub">${safe(row.date)} · ${safe(SERIES.find(([key]) => key === row.strategy)?.[1])}</span></td><td>${safe(tradeSide[row.side] || row.side)}</td><td>${number(row.shares)}</td><td>${money(row.price)}</td></tr>`).join('') || '<tr><td colspan="4">当前筛选暂无成交记录。</td></tr>';
}

function drawChart() {
  const box = $('chart');
  const rows = snapshot?.equity || [];
  const cutoff = new Date(`${rows.at(-1)?.date}T00:00:00Z`);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 1);
  chartRows = range === '1y' ? rows.filter((row) => Date.parse(row.date) >= +cutoff) : rows;
  $('chart-empty').hidden = Boolean(chartRows.length);
  $('tooltip').hidden = true;
  chartPointer = -1;
  const width = box.clientWidth, height = box.clientHeight;
  const svg = $('plot'); svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  if (!chartRows.length || width < 100) { svg.replaceChildren(); return; }
  const left = width < 500 ? 41 : 54, top = 12, bottom = height - 23, right = width - 14;
  const max = Math.max(1, ...chartRows.flatMap((row) => SERIES.map(([key]) => row[key] || 0)));
  const scale = 10 ** Math.floor(Math.log10(max / 4));
  const step = Math.ceil(max / 4 / scale) * scale;
  const xx = (i) => left + (right - left) * i / Math.max(1, chartRows.length - 1);
  const yy = (v) => bottom - (bottom - top) * v / (4 * step);
  chartGeometry = {left,right,xx};
  const grid = Array.from({length:5}, (_,i) => `<line x1="${left}" x2="${right}" y1="${yy(i*step)}" y2="${yy(i*step)}" stroke="#e9edf2"/><text x="${left-7}" y="${yy(i*step)+4}" text-anchor="end">${number(i*step/1000)}k</text>`).join('');
  const ticks = Math.min(chartRows.length, width < 500 ? 3 : 5);
  const dates = Array.from({length:ticks}, (_,i) => Math.round(i*(chartRows.length-1)/Math.max(1,ticks-1))).map((i) => `<text x="${xx(i)}" y="${height-4}" text-anchor="${i===0 ? 'start' : i===chartRows.length-1 ? 'end' : 'middle'}">${safe(chartRows[i].date.slice(0,7))}</text>`).join('');
  const lines = [...SERIES].reverse().map(([key,,color]) => `<polyline points="${chartRows.map((row,i) => `${xx(i).toFixed(1)},${yy(row[key]).toFixed(1)}`).join(' ')}" fill="none" stroke="${color}" stroke-width="${key==='ensemble' ? 2.1 : 1.4}" ${key==='cash' ? 'stroke-dasharray="5 4"' : ''}/>`).join('');
  svg.innerHTML = `${grid}${dates}${lines}<line id="cursor" y1="${top}" y2="${bottom}" stroke="#9aa6b6" visibility="hidden"/>`;
}

function showPoint(i) {
  const row = chartRows[i], cursor = $('cursor');
  if (!row || !cursor) return;
  chartPointer = i;
  const x = chartGeometry.xx(i);
  cursor.setAttribute('x1', x); cursor.setAttribute('x2', x); cursor.setAttribute('visibility','visible');
  const tooltip = $('tooltip'); tooltip.hidden = false;
  tooltip.style.left = `${Math.max(0, Math.min(x + 8, $('chart').clientWidth - 165))}px`;
  tooltip.innerHTML = `<b>${safe(row.date)}</b>${SERIES.map(([key,label]) => `<div>${safe(label)}<span>${money(row[key])}</span></div>`).join('')}`;
}

$('chart').addEventListener('pointermove', (event) => {
  if (!chartRows.length || !chartGeometry) return;
  const {left,right} = chartGeometry;
  const ratio = (event.clientX - $('chart').getBoundingClientRect().left - left) / (right-left);
  showPoint(Math.round(Math.max(0,Math.min(1,ratio)) * (chartRows.length-1)));
});
$('chart').addEventListener('pointerleave', () => { $('tooltip').hidden = true; $('cursor')?.setAttribute('visibility','hidden'); });
$('chart').addEventListener('keydown', (event) => {
  if (!['ArrowLeft','ArrowRight'].includes(event.key) || !chartRows.length) return;
  event.preventDefault();
  showPoint(Math.max(0, Math.min(chartRows.length-1, chartPointer + (event.key === 'ArrowRight' ? 1 : -1))));
});
$('refresh').addEventListener('click', refresh);
$('agent-sort').addEventListener('change', () => { pageSize = 8; renderAgents(); });
$('more-agents').addEventListener('click', () => { pageSize += 24; renderAgents(); });
$('trade-strategy').addEventListener('change', renderTrades);
for (const button of document.querySelectorAll('[data-range]')) button.addEventListener('click', () => {
  range = button.dataset.range;
  for (const item of document.querySelectorAll('[data-range]')) item.setAttribute('aria-pressed', String(item === button));
  drawChart();
});
for (const link of document.querySelectorAll('.rail a')) link.addEventListener('click', () => {
  document.querySelector('.rail .selected')?.classList.remove('selected');
  link.classList.add('selected');
});
new ResizeObserver(drawChart).observe($('chart'));
refresh();
setInterval(refresh, 20000);
setInterval(renderRun, 5000);
