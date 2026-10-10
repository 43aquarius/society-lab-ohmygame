/**
 * Panels — 模态框（事件卡/编年史/观察者/存档/帮助/社会形态）与右侧详情面板
 */
import {
  type WorldState, type ChronicleEntry, type EventRecord, type Settlement, STAGE_NAMES, FORM_NAMES, type SocietyForm,
} from '../types';
import { BUILDINGS, STAGE_THRESHOLDS } from '../config';
import { icon, EVENT_ICON } from './icons';
import { macroEconomy } from '../sim/economy';
import { classifySociety, formLabel } from '../sim/society';
import { techSummary } from '../sim/technology';
import { housingCapacity } from '../sim/population';
import { castPurify, castCivPower, GOD_POWERS, canAfford } from '../powers';
import { worldEra, civEntityName } from '../names';
import { listSlots, saveToSlot, loadFromSlot, exportToFile, importFromFile, pinSnapshot, branchFromSnapshot, deserialize, type SlotInfo } from '../saves';

const FORM_NAMES_FALLBACK = (f: string): string => FORM_NAMES[f as SocietyForm] ?? f;

let modalOpen = false;
export function isModalOpen() { return modalOpen; }

export interface PanelActions {
  focusSettlement: (s: Settlement) => void;
  castBlessingAt: (s: Settlement) => void;
  purify: (settlementId: number) => boolean;
  refreshHud: () => void;
  loadWorld: (w: WorldState, name: string) => void;
  toast: (t: string, k?: 'good' | 'bad' | 'neutral', i?: string) => void;
  playSfx: (name: string, severity?: number) => void;
}

export function closeModal() {
  const root = document.getElementById('modal-root')!;
  root.innerHTML = '';
  modalOpen = false;
}

function openModal(html: string, wide = false) {
  const root = document.getElementById('modal-root')!;
  root.innerHTML = `
    <div class="modal-backdrop"></div>
    <div class="modal ${wide ? 'wide' : ''}">${html}</div>`;
  modalOpen = true;
  root.querySelector('.modal-backdrop')!.addEventListener('click', closeModal);
  const closeBtn = root.querySelector('.modal-close');
  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  return root.querySelector('.modal') as HTMLElement;
}

// ---------- 事件卡 ----------

export function openEventCard(ev: EventRecord, w: WorldState, actions: PanelActions) {
  const meta = EVENT_ICON[ev.category] ?? EVENT_ICON.harvest;
  const settlement = ev.settlementId !== undefined ? w.settlements.find(s => s.id === ev.settlementId) : undefined;
  let actionsHtml = '';
  if (ev.category === 'famine' && settlement) {
    actionsHtml = `<button class="btn gold" data-act="bless">${icon('blessing', 15)} 赐下丰产祝福（12⚡）</button>`;
  }
  if (ev.category === 'plague' && settlement && w.activeEvents.some(a => a.id === 'plague-outbreak' && a.data.settlementId === settlement.id)) {
    actionsHtml = `<button class="btn gold" data-act="purify">${icon('sparkle', 15)} 净化疫病（12⚡）</button>`;
  }
  if (ev.category === 'ideas' || ev.category === 'institution') {
    actionsHtml = `<button class="btn" data-act="ideas">${icon('ideas', 15)} 传播组织与平等思想（14⚡）</button>`;
  }
  const modal = openModal(`
    <div class="modal-head">
      <span class="mh-ic" style="background:${meta.color}">${icon(meta.icon, 18)}</span>
      <h2>${ev.title}</h2>
      <button class="modal-close">${icon('close', 16)}</button>
    </div>
    <div class="modal-body">
      <div class="event-card-text">${ev.text}</div>
      <div class="ce-section">
        <h5>${icon('chart', 13)} 事件起因（真实模拟变量）</h5>
        <ul>${ev.causes.map(c => `<li>${c}</li>`).join('')}</ul>
      </div>
      <div class="ce-section effects">
        <h5>${icon('sparkle', 13)} 实际结果</h5>
        <ul>${ev.effects.map(e => `<li>${e}</li>`).join('')}</ul>
      </div>
      <div class="ce-section">
        <h5>${icon('clock', 13)} 时间地点</h5>
        <ul><li>第 ${ev.year} 年${settlement ? ` · ${settlement.name}` : ' · 全域'}</li>
        <li>${ev.intervened ? '神（玩家）介入了此事' : '神选择旁观'}</li></ul>
      </div>
      ${actionsHtml ? `<div class="ce-actions">${actionsHtml}<button class="btn" data-act="close">静观其变</button></div>` : ''}
    </div>`);
  modal.querySelector('[data-act="close"]')?.addEventListener('click', closeModal);
  modal.querySelector('[data-act="bless"]')?.addEventListener('click', () => {
    if (settlement) actions.castBlessingAt(settlement);
    closeModal();
  });
  modal.querySelector('[data-act="purify"]')?.addEventListener('click', () => {
    if (settlement) actions.purify(settlement.id);
    closeModal();
  });
  modal.querySelector('[data-act="ideas"]')?.addEventListener('click', () => {
    const def = GOD_POWERS.find(p => p.id === 'ideas')!;
    if (!canAfford(w, def.cost)) { actions.toast('神力不足', 'bad', 'alert'); return; }
    castCivPower(w, 'ideas');
    w.chronicle.push({
      id: `ev-${w.nextEventId++}`, year: w.year, title: '神力：思想传播',
      category: 'ideas', text: '平等与组织的观念随神启传遍大地。', causes: ['神（玩家）传播思想'],
      effects: ['政治参与上升', '平民组织能力上升'], intervened: true, severity: 0.2,
    });
    actions.toast('思想已传播', 'good', 'ideas');
    actions.playSfx('power');
    actions.refreshHud();
    closeModal();
  });
}

// ---------- 编年史 ----------

export function openChronicle(w: WorldState, actions: PanelActions) {
  let filter = 'all';
  const render = () => {
    const entries = [...w.chronicle].reverse().filter(e => {
      if (filter === 'all') return true;
      if (filter === 'major') return e.severity >= 0.5;
      if (filter === 'god') return e.intervened;
      if (filter === 'institution') return e.category === 'institution' || e.category === 'politics';
      if (filter.startsWith('civ')) return e.civId === Number(filter.slice(3));
      return true;
    });
    // 时代分组：按形态变迁分段
    const eras: { label: string; items: ChronicleEntry[] }[] = [];
    let curForm = (w.civs[w.observedCiv] ?? w.civs[0]).form;
    let bucket: ChronicleEntry[] = [];
    const formNames: Record<string, string> = {
      primitive: '原始社会', slave: '奴隶制社会', feudal: '封建社会',
      capitalist: '资本主义社会', socialist: '社会主义社会', collapsed: '文明废墟',
    };
    const ordered = [...entries].reverse();
    for (const e of ordered) {
      bucket.push(e);
    }
    // 简化：直接按年份倒序 + 时代头（用 formSince 推断）
    eras.push({ label: '全部记录', items: bucket.reverse() });
    const modal = openModal(`
      <div class="modal-head">
        <span class="mh-ic" style="background:#2f7e76">${icon('book', 18)}</span>
        <h2>历史编年史 · ${w.chronicle.length} 条</h2>
        <button class="modal-close">${icon('close', 16)}</button>
      </div>
      <div class="modal-body">
        <div class="chron-toolbar">
          <button data-f="all" class="${filter === 'all' ? 'active' : ''}">全部</button>
          <button data-f="major" class="${filter === 'major' ? 'active' : ''}">重大</button>
          <button data-f="institution" class="${filter === 'institution' ? 'active' : ''}">制度变迁</button>
          <button data-f="god" class="${filter === 'god' ? 'active' : ''}">神迹</button>
          ${w.civs.filter(c => !c.dead).map(c => `<button data-f="civ${c.id}" class="${filter === 'civ' + c.id ? 'active' : ''}" title="${c.name}"><span class="civ-dot" style="background:${c.color}"></span>${c.name.slice(0, 4)}</button>`).join('')}
        </div>
        ${entries.length === 0 ? '<div class="chron-empty">历史尚未开始书写。<br>推进时间，或施加你的第一个神迹。</div>' : ''}
        ${entries.map(e => {
          const meta = EVENT_ICON[e.category] ?? EVENT_ICON.harvest;
          return `<div class="chron-item" data-eid="${e.id}">
            <div class="c-year">${e.year}</div>
            <div class="c-ic" style="background:${meta.color}">${icon(meta.icon, 15)}</div>
            <div class="c-main">
              <div class="c-title">${e.title}${e.intervened ? '<span class="intervened">神迹</span>' : ''}</div>
              <div class="c-text">${e.text.length > 66 ? e.text.slice(0, 66) + '…' : e.text}</div>
            </div>
          </div>`;
        }).join('')}
      </div>`, true);
    modal.querySelectorAll('.chron-toolbar button').forEach(b => {
      b.addEventListener('click', () => {
        filter = (b as HTMLElement).dataset.f!;
        render();
      });
    });
    modal.querySelectorAll('.chron-item').forEach(el => {
      el.addEventListener('click', () => {
        const e = w.chronicle.find(x => x.id === (el as HTMLElement).dataset.eid);
        if (e) openEventCard(e, w, actions);
      });
    });
  };
  render();
}

// ---------- 观察者 ----------

function drawLineChart(canvas: HTMLCanvasElement, data: { year: number; v: number }[], color: string, min?: number, max?: number, ref1?: number) {
  const ctx = canvas.getContext('2d')!;
  const W = canvas.width = canvas.clientWidth * 2 || 600;
  const H = canvas.height = 220;
  ctx.scale(1, 1);
  ctx.clearRect(0, 0, W, H);
  if (data.length < 2) {
    ctx.fillStyle = 'rgba(107,97,84,0.5)';
    ctx.font = '22px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('数据不足（推进时间以采集）', W / 2, H / 2);
    return;
  }
  const vs = data.map(d => d.v);
  const lo = min ?? Math.min(...vs) * 0.95;
  const hi = max ?? Math.max(...vs) * 1.05;
  const x0 = 40, x1 = W - 14, y0 = 18, y1 = H - 26;
  const px = (i: number) => x0 + (i / (data.length - 1)) * (x1 - x0);
  const py = (v: number) => y1 - ((v - lo) / Math.max(0.0001, hi - lo)) * (y1 - y0);
  // 网格
  ctx.strokeStyle = 'rgba(59,49,40,0.09)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 3; i++) {
    const y = y0 + (i / 3) * (y1 - y0);
    ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
  }
  if (ref1 !== undefined) {
    ctx.strokeStyle = 'rgba(180,85,45,0.5)';
    ctx.setLineDash([5, 5]);
    ctx.beginPath(); ctx.moveTo(x0, py(ref1)); ctx.lineTo(x1, py(ref1)); ctx.stroke();
    ctx.setLineDash([]);
  }
  // 面积
  ctx.beginPath();
  ctx.moveTo(px(0), py(vs[0]));
  vs.forEach((v, i) => ctx.lineTo(px(i), py(v)));
  ctx.lineTo(px(vs.length - 1), y1);
  ctx.lineTo(px(0), y1);
  ctx.closePath();
  ctx.fillStyle = color.replace(')', ',0.13)').replace('rgb', 'rgba');
  ctx.fill();
  // 线
  ctx.beginPath();
  vs.forEach((v, i) => i === 0 ? ctx.moveTo(px(0), py(v)) : ctx.lineTo(px(i), py(v)));
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.stroke();
  // 首尾年份
  ctx.fillStyle = 'rgba(107,97,84,0.85)';
  ctx.font = '20px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(`${data[0].year}`, x0, H - 6);
  ctx.textAlign = 'right';
  ctx.fillText(`${data[data.length - 1].year}`, x1, H - 6);
  ctx.fillText(`${vs[vs.length - 1]}`, x1, y0 + 6);
}

function drawStackChart(canvas: HTMLCanvasElement, data: { year: number; elite: number }[]) {
  const ctx = canvas.getContext('2d')!;
  const W = canvas.width = canvas.clientWidth * 2 || 600;
  const H = canvas.height = 220;
  ctx.clearRect(0, 0, W, H);
  if (data.length < 2) {
    ctx.fillStyle = 'rgba(107,97,84,0.5)';
    ctx.font = '22px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('数据不足', W / 2, H / 2);
    return;
  }
  const x0 = 40, x1 = W - 14, y0 = 18, y1 = H - 26;
  const px = (i: number) => x0 + (i / (data.length - 1)) * (x1 - x0);
  const barW = Math.max(4, (x1 - x0) / data.length * 0.8);
  for (let i = 0; i < data.length; i++) {
    const e = data[i].elite;
    const mid = Math.max(0.05, 1 - e - 0.35);
    const common = Math.max(0, 1 - e - mid);
    const ye = y1 - e * (y1 - y0);
    const ym = ye - mid * (y1 - y0);
    ctx.fillStyle = '#c9a227';
    ctx.fillRect(px(i) - barW / 2, ye, barW, y1 - ye);
    ctx.fillStyle = '#7a8a9a';
    ctx.fillRect(px(i) - barW / 2, ym, barW, ye - ym);
    ctx.fillStyle = '#5d8a6a';
    ctx.fillRect(px(i) - barW / 2, ym - common * (y1 - y0), barW, common * (y1 - y0));
  }
  ctx.fillStyle = 'rgba(107,97,84,0.85)';
  ctx.font = '20px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('财富分配：金=精英 灰=中间 绿=平民', x0, y0 + 4);
}

export function openObserver(w: WorldState, civId?: number) {
  const civ = w.civs[civId ?? w.observedCiv] ?? w.civs[0];
  const v = civ.vars;
  const macro = macroEconomy(w, civ);
  const cls = classifySociety(w, civ);
  const varRows: [string, number, string][] = [
    ['粮食保障率', macro.foodRatio, '#5d8a6a'],
    ['存粮（人·年）', macro.foodStock / Math.max(1, macro.population), '#8aa05d'],
    ['城市化率', macro.urbanization, '#7a8a9a'],
    ['住房覆盖', macro.housingRatio, '#a0862d'],
    ['共有制', v.ownCommon, '#5d8a6a'],
    ['私有制', v.ownPrivate, '#c9a227'],
    ['公有制', v.ownPublic, '#2f7e76'],
    ['强制劳动', v.laborForced, '#b4552d'],
    ['依附劳动', v.laborBonded, '#a0762d'],
    ['雇佣劳动', v.laborWage, '#7a8a9a'],
    ['合作劳动', v.laborCoop, '#2f7e76'],
    ['土地集中', v.landConcentration, '#b4552d'],
    ['市场发育', v.market, '#c9a227'],
    ['国家能力', v.stateCapacity, '#5a6a8a'],
    ['公共服务', v.publicServices, '#2f7e76'],
    ['教育水平', v.education, '#4a7a9a'],
    ['分工度', v.specialization, '#7a6a4a'],
    ['政治参与', v.participation, '#4a7a9a'],
    ['制度信任', v.trust, '#5d8a6a'],
    ['冲突风险', v.unrest, '#b4552d'],
    ['环境质量', v.environment, '#5d8a6a'],
    ['资源压力', v.resourcePressure, '#b4552d'],
    ['精英组织力', v.orgElite, '#c9a227'],
    ['平民组织力', v.orgCommon, '#5d8a6a'],
  ];
  const formScores = (Object.entries(cls.scores) as [string, number][]).filter(([k]) => k !== 'collapsed');
  const maxScore = Math.max(0.001, ...formScores.map(([, x]) => x));

  const modal = openModal(`
    <div class="modal-head">
      <span class="mh-ic" style="background:#2f7e76">${icon('chart', 18)}</span>
      <h2>观察者 · ${civ.name}（${FORM_NAMES_FALLBACK(civ.form)}）</h2>
      <button class="modal-close">${icon('close', 16)}</button>
    </div>
    <div class="modal-body">
      <div class="obs-grid">
        <div class="obs-chart"><h5>人口</h5><canvas id="obs-pop"></canvas></div>
        <div class="obs-chart"><h5>粮食保障率（红线=100%）</h5><canvas id="obs-food"></canvas></div>
        <div class="obs-chart"><h5>冲突风险</h5><canvas id="obs-unrest"></canvas></div>
        <div class="obs-chart"><h5>财富分配结构</h5><canvas id="obs-wealth"></canvas></div>
        <div class="obs-chart obs-vars">
          <h5>当前社会变量（第 ${w.year} 年）</h5>
          ${varRows.map(([n, val, c]) => `
            <div class="obs-var-row">
              <span class="n">${n}</span>
              <div class="track"><div class="fill" style="width:${Math.min(100, Math.max(2, (n.includes('保障') || n.includes('存粮')) ? val * 55 : val * 100))}%;background:${c}"></div></div>
              <span class="v">${n.includes('保障') ? Math.round(val * 100) + '%' : n.includes('存粮') ? val.toFixed(1) : Math.round(val * 100) + '%'}</span>
            </div>`).join('')}
        </div>
        <div class="obs-chart">
          <h5>社会形态评分（灰 = 前置未达）</h5>
          ${formScores.map(([k, sc]) => {
            const gated = sc < 0;
            const gate = cls.blocked.find(b => b.form === k);
            return `
            <div class="obs-var-row" title="${gated ? '缺少：' + gate!.missing.join('、') : ''}">
              <span class="n">${FORM_NAMES_FALLBACK(k)}</span>
              <div class="track"><div class="fill" style="width:${gated ? 4 : Math.max(3, sc / maxScore * 100)}%;background:${k === cls.form ? '#c9a227' : gated ? '#9a9284' : '#8a8070'}"></div></div>
              <span class="v">${gated ? '未达' : sc.toFixed(2)}</span>
            </div>`;
          }).join('')}
          <div style="font-size:11.5px;color:var(--ink-soft);margin-top:8px">判定：${formLabel(cls)}（自第 ${civ.formSince} 年起）</div>
        </div>
        <div class="obs-chart">
          <h5>技术水平（${civ.name}）</h5>
          <div style="font-size:12.5px;line-height:2">${techSummary(civ)}</div>
          <div style="font-size:11.5px;color:var(--ink-soft)">知识点累计 ${Math.round(civ.tech.points)} · 启蒙思潮 ${(civ.enlightenment * 100).toFixed(0)}%</div>
        </div>
        <div class="obs-chart">
          <h5>万邦（点击切换观察文明）</h5>
          ${w.civs.map(c => `<button class="civ-pick ${c.dead ? 'dead' : ''} ${c.id === civ.id ? 'active' : ''}" data-civ="${c.id}"><span class="civ-dot" style="background:${c.color}"></span>${c.name} · ${FORM_NAMES_FALLBACK(c.form)} · ${c.vars.population}人</button>`).join('')}
        </div>
      </div>
    </div>`, true);

  modal.querySelectorAll('.civ-pick').forEach(b => b.addEventListener('click', () => {
    closeModal();
    openObserver(w, Number((b as HTMLElement).dataset.civ));
  }));
  const hist = civ.history;
  if (hist.length) {
    drawLineChart(modal.querySelector('#obs-pop')!, hist.map(h => ({ year: h.year, v: h.pop })), 'rgb(93,138,106)', 0);
    drawLineChart(modal.querySelector('#obs-food')!, hist.map(h => ({ year: h.year, v: h.food })), 'rgb(192,162,39)', 0, 2, 1);
    drawLineChart(modal.querySelector('#obs-unrest')!, hist.map(h => ({ year: h.year, v: h.unrest })), 'rgb(180,85,45)', 0, 1, 0.52);
    drawStackChart(modal.querySelector('#obs-wealth')!, hist.map(h => ({ year: h.year, elite: h.elite })));
  } else {
    for (const id of ['obs-pop', 'obs-food', 'obs-unrest', 'obs-wealth']) {
      const cv = modal.querySelector(`#${id}`) as HTMLCanvasElement;
      const ctx = cv.getContext('2d')!;
      cv.width = 600; cv.height = 220;
      ctx.fillStyle = 'rgba(107,97,84,0.5)';
      ctx.font = '22px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('数据不足（推进时间以采集）', 300, 110);
    }
  }
}

// ---------- 社会形态卡 ----------

export function openFormCard(w: WorldState, civId?: number) {
  const civ = w.civs[civId ?? w.observedCiv] ?? w.civs[0];
  const cls = classifySociety(w, civ);
  const v = civ.vars;
  const desc: Record<string, string> = {
    primitive: '人们以亲缘结成小共同体，共同劳动、平均分享。土地与工具属于所有成员。剩余产品稀少，社会规模受生态直接约束。',
    slave: '一部分人被强制为他人劳动。社会已能生产剩余，权力机构开始系统地服务于有产者。强制劳动带来产出，也埋下反抗的种子。',
    feudal: '土地是财富的根本。耕种者以人身依附换取生存，等级与义务构成社会的骨架。城镇与商业在缝隙中生长。',
    capitalist: '市场与雇佣重塑了生产。资本积累、技术创新与周期波动并存；财富在竞争中集中，也在冲突中被重新分配。',
    socialist: '生产资料转入公共与合作之手。分配规则、公共服务与社会参与被重新设计；治理效率与创新激励是持久的考验。',
    collapsed: '聚落人口清零，文明归于寂静。但它留下的废墟仍在讲述往事。',
  };
  const blockedRows = cls.blocked.length ? `
      <div class="ce-section"><h5>其它形态的欠缺条件（历史不会跳级）</h5>
        <ul>${cls.blocked.map(b => `<li><b>${FORM_NAMES_FALLBACK(b.form)}</b>：${b.missing.join('、')}</li>`).join('')}</ul>
      </div>` : '';
  openModal(`
    <div class="modal-head">
      <span class="mh-ic" style="background:#c9a227">${icon('branch', 18)}</span>
      <h2>社会形态 · ${civ.name} · ${formLabel(cls)}</h2>
      <button class="modal-close">${icon('close', 16)}</button>
    </div>
    <div class="modal-body">
      <div class="event-card-text">${desc[cls.form]}</div>
      <div class="ce-section"><h5>判定书（历史唯物主义四要素）</h5>
        <ul>
          <li><b>生产资料所有制</b>：${cls.basis.ownership}</li>
          <li><b>阶级关系</b>：${cls.basis.classes}</li>
          <li><b>分配关系</b>：${cls.basis.distribution}</li>
          <li><b>上层建筑</b>：${cls.basis.superstructure}</li>
        </ul>
      </div>
      <div class="ce-section"><h5>判定依据</h5><ul>${cls.causes.map(c => `<li>${c}</li>`).join('')}</ul></div>
      ${blockedRows}
      <div class="ce-section effects"><h5>制度结构</h5>
        <ul>
          <li>所有制：共有 ${Math.round(v.ownCommon * 100)}% · 私有 ${Math.round(v.ownPrivate * 100)}% · 公有 ${Math.round(v.ownPublic * 100)}%</li>
          <li>劳动关系：强制 ${Math.round(v.laborForced * 100)}% · 依附 ${Math.round(v.laborBonded * 100)}% · 雇佣 ${Math.round(v.laborWage * 100)}% · 合作 ${Math.round(v.laborCoop * 100)}%</li>
          <li>自第 ${civ.formSince} 年进入此形态${civ.prevForm ? `（此前：${FORM_NAMES_FALLBACK(civ.prevForm)}）` : ''}</li>
        </ul>
      </div>
    </div>`);
}

// ---------- 万邦面板（v4.0：世界诸文明列表 + 马义判定书） ----------

export function openCivsPanel(w: WorldState, actions: PanelActions & { observeCiv: (id: number) => void }) {
  const era = worldEra(w);
  const cards = w.civs.map(civ => {
    if (civ.dead) {
      return `<div class="civ-card dead" data-civ="${civ.id}">
        <div class="cc-head"><span class="civ-dot" style="background:${civ.color}"></span><b>${civ.name}</b><span class="cc-form">已消亡</span></div>
        <div class="cc-sub">存在 ${w.year - civ.founded} 年后湮灭</div>
      </div>`;
    }
    const cls = classifySociety(w, civ);
    const macro = macroEconomy(w, civ);
    const mySettlements = w.settlements.filter(s => !s.dead && s.civId === civ.id);
    const largest = [...mySettlements].sort((a, b) => b.population - a.population)[0];
    const entity = civEntityName(civ.form, largest?.stage ?? 'camp', mySettlements.length);
    const t = civ.tech.levels;
    return `<div class="civ-card ${civ.id === w.observedCiv ? 'observed' : ''}" data-civ="${civ.id}">
      <div class="cc-head">
        <span class="civ-dot" style="background:${civ.color}"></span>
        <b>${civ.name}</b>
        <span class="cc-form">${formLabel(cls)}</span>
        <span class="cc-entity">${entity}</span>
      </div>
      <div class="cc-sub">${macro.population} 人 · ${mySettlements.length} 处聚落 · 存续 ${w.year - civ.founded} 年${civ.met.length ? ` · 已知 ${civ.met.length} 个异邦` : ''}</div>
      <div class="cc-basis">
        <div><b>所有制</b> ${cls.basis.ownership}</div>
        <div><b>阶级</b> ${cls.basis.classes}</div>
        <div><b>分配</b> ${cls.basis.distribution}</div>
        <div><b>上层建筑</b> ${cls.basis.superstructure}</div>
      </div>
      <div class="cc-tech">农耕${t.agriculture ?? 1} · 工具${t.crafting ?? 1} · 营造${t.building ?? 1} · 商贸${t.commerce ?? 1} · 治理${t.governance ?? 1} · 工业${t.industry ?? 1}</div>
    </div>`;
  }).join('');

  openModal(`
    <div class="modal-head">
      <span class="mh-ic" style="background:#5f7fd8">${icon('people', 18)}</span>
      <h2>万邦 · ${w.civs.filter(c => !c.dead).length} 个文明并立 · ${era.name}</h2>
      <button class="modal-close">${icon('close', 16)}</button>
    </div>
    <div class="modal-body">
      <div class="civ-hint">世界纪元：${era.name}——${era.desc}。每个文明依其生产关系独立判定社会形态；点击卡片将该文明设为观察对象。</div>
      <div class="civ-list">${cards}</div>
    </div>`, true);

  const modalEl = document.querySelector('#modal-root .modal')!;
  modalEl.querySelectorAll('.civ-card').forEach(card => card.addEventListener('click', () => {
    const id = Number((card as HTMLElement).dataset.civ);
    const civ = w.civs[id];
    if (!civ || civ.dead) return;
    actions.observeCiv(id);
    // 镜头飞往该文明最大聚落
    const best = w.settlements.filter(s => !s.dead && s.civId === id).sort((a, b) => b.population - a.population)[0];
    if (best) actions.focusSettlement(best);
    closeModal();
  }));
}

// ---------- 存档面板 ----------

export function openSaveMenu(w: WorldState, worldName: string, actions: PanelActions) {
  const render = () => {
    const slots = listSlots();
    const slotEls = [1, 2, 3, 4, 5, 6].map(i => {
      const s = slots.find(x => x.index === i);
      return `<div class="slot-item ${s ? 'filled' : ''}" data-slot="${i}">
        <span class="si-ic" style="color:${s ? 'var(--teal)' : 'var(--ink-soft)'}">${icon(s ? 'save' : 'load', 18)}</span>
        <div class="si-main">
          <div class="si-name">槽位 ${i}${s ? ` · ${s.worldName}` : ' · 空'}</div>
          <div class="si-meta">${s ? `第 ${s.year} 年 · ${FORM_NAMES_FALLBACK(s.form)} · ${new Date(s.savedAt).toLocaleString('zh-CN')}` : '点击存入当前世界'}</div>
        </div>
        ${s ? `<button class="btn small" data-load="${i}">读取</button>` : ''}
      </div>`;
    }).join('');
    const snaps = w.snapshots.map((s, i) => `
      <div class="snapshot-row">
        <span class="s-ic ${s.data ? 'has-data' : ''}">${icon(s.data ? 'pin' : 'clock', 15)}</span>
        <div class="s-main">${s.label}${s.data ? ' <span style="color:var(--gold);font-size:11px">◆ 可分支</span>' : ''}</div>
        ${s.data ? `<button class="btn small" data-branch="${i}">从此分支</button>` : ''}
      </div>`).join('');
    const modal = openModal(`
      <div class="modal-head">
        <span class="mh-ic" style="background:#5a6a8a">${icon('save', 18)}</span>
        <h2>保存 · 读取 · 分支</h2>
        <button class="modal-close">${icon('close', 16)}</button>
      </div>
      <div class="modal-body">
        <div style="display:flex;gap:10px;margin-bottom:14px;flex-wrap:wrap">
          <button class="btn primary" id="snap-pin">${icon('pin', 15)} 在此记录分支节点</button>
          <button class="btn" id="save-export">${icon('load', 15)} 导出为文件</button>
          <label class="btn" style="cursor:pointer">${icon('save', 15)} 导入存档文件
            <input type="file" id="save-import" accept=".json" style="display:none">
          </label>
          <button class="btn" id="save-autosave" ${localStorage.getItem('society-lab-save-v1-auto') ? '' : 'disabled'}>读取自动存档</button>
        </div>
        <div class="slot-list">${slotEls}</div>
        <h5 style="margin:18px 0 8px;font-size:12.5px;color:var(--ink-soft)">历史节点（每 25 年自动记录 · ◆ 可创建平行世界）</h5>
        ${snaps || '<div class="chron-empty">暂无快照</div>'}
      </div>`, true);
    modal.querySelectorAll('.slot-item').forEach(el => {
      el.addEventListener('click', () => {
        const i = Number((el as HTMLElement).dataset.slot);
        if (saveToSlot(w, worldName, i)) {
          actions.toast(`已存入槽位 ${i}`, 'good', 'save');
          actions.playSfx('click');
          render();
        } else actions.toast('存档失败（空间不足？）', 'bad', 'alert');
      });
    });
    modal.querySelectorAll('[data-load]').forEach(b => {
      b.addEventListener('click', e => {
        e.stopPropagation();
        const res = loadFromSlot(Number((b as HTMLElement).dataset.load));
        if (res && 'world' in res) {
          actions.loadWorld(res.world, res.worldName);
          closeModal();
          actions.toast('世界已读取', 'good', 'load');
        } else {
          actions.toast((res as any).error ?? '读取失败', 'bad', 'alert');
        }
      });
    });
    modal.querySelectorAll('[data-branch]').forEach(b => {
      b.addEventListener('click', () => {
        const res = branchFromSnapshot(w, Number((b as HTMLElement).dataset.branch));
        if (res && 'world' in res) {
          actions.loadWorld(res.world, res.worldName);
          closeModal();
          actions.toast('已创建平行历史分支', 'good', 'branch');
        } else {
          actions.toast((res as any).error ?? '无法分支', 'bad', 'alert');
        }
      });
    });
    modal.querySelector('#snap-pin')!.addEventListener('click', () => {
      pinSnapshot(w, `${w.year} 年 · 手动节点`);
      actions.toast('分支节点已记录', 'good', 'pin');
      render();
    });
    modal.querySelector('#save-export')!.addEventListener('click', () => {
      exportToFile(w, worldName);
      actions.toast('已导出存档文件', 'good', 'save');
    });
    modal.querySelector('#save-import')!.addEventListener('change', async e => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const res = await importFromFile(file);
      if ('world' in res) {
        actions.loadWorld(res.world, res.worldName);
        closeModal();
        actions.toast('存档已导入', 'good', 'load');
      } else actions.toast(res.error, 'bad', 'alert');
    });
    modal.querySelector('#save-autosave')!.addEventListener('click', () => {
      const raw = localStorage.getItem('society-lab-save-v1-auto');
      if (!raw) return;
      const d = deserialize(raw);
      if ('world' in d) {
        actions.loadWorld(d.world, d.worldName);
        closeModal();
        actions.toast('自动存档已读取', 'good', 'load');
      }
    });
  };
  render();
}

// ---------- 帮助 ----------

export function openHelp() {
  openModal(`
    <div class="modal-head">
      <span class="mh-ic" style="background:#2f7e76">${icon('help', 18)}</span>
      <h2>操作指南</h2>
      <button class="modal-close">${icon('close', 16)}</button>
    </div>
    <div class="modal-body">
      <div class="help-cols">
        <div class="help-col">
          <h5>目标</h5>
          <p>你是这个世界的神。观察文明从部落生长为城市、从原始平等演化为各种社会形态，或在关键时刻施加神力——让历史走向不同的岔路。</p>
          <h5>摄像机</h5>
          <ul>
            <li>拖拽：移动视角 · 滚轮：缩放</li>
            <li><kbd>H</kbd>：全景（缩放到整张地图）· <kbd>F</kbd>：聚焦最大聚落</li>
            <li>右下角小地图：点击跳转</li>
          </ul>
          <h5>时间</h5>
          <ul>
            <li><kbd>空格</kbd> 暂停/继续 · <kbd>1</kbd><kbd>2</kbd><kbd>3</kbd><kbd>4</kbd> 调速（1×~8×）</li>
            <li>暂停时可单步推进一年（⏭ 按钮）</li>
          </ul>
          <h5>界面</h5>
          <ul>
            <li><kbd>Tab</kbd> 或左侧箭头：收起/展开神力栏</li>
            <li>右侧详情面板可收起（点击聚落后展开）</li>
            <li><kbd>C</kbd> 编年史 · <kbd>O</kbd> 观察者 · <kbd>S</kbd> 存档</li>
          </ul>
        </div>
        <div class="help-col">
          <h5>神力（17 种）</h5>
          <ul>
            <li>造物：森林 / 沃土 / 草原 / 涌泉 / 矿藏 / 造山</li>
            <li>天象：唤雨 / 降旱</li>
            <li>灾厄：陨星 / 风暴 / 野火 / 瘟疫</li>
            <li>启蒙：祝福 / 启蒙 / 思想 / 治愈 / 奠基新聚落</li>
            <li>笔刷大小：小/中/大 · <kbd>Esc</kbd> 或右键取消</li>
            <li>有限干预模式下消耗神力能量（每年恢复）</li>
          </ul>
          <h5>社会如何演化</h5>
          <ul>
            <li>聚落会长大：部落 → 村庄 → 城镇 → 城市，名字随之演进</li>
            <li>食物盈余 + 技术 → 分工、财富分化、时代建筑</li>
            <li>战争俘虏 → 强制劳动 → 奴隶制（需农业剩余与国家机器）</li>
            <li>土地集中 + 依附劳动 + 庄园 → 封建</li>
            <li>市场 + 工业 + 城市 → 雇佣劳动 → 资本主义</li>
            <li>组织 + 思想 + 公共性 → 社会主义</li>
            <li>历史不会跳级：形态判定有硬性前置（点顶栏徽章查看）</li>
          </ul>
          <h5>实验</h5>
          <ul>
            <li>存档面板可记录分支节点，从任一节点创建平行世界</li>
            <li>相同种子 + 相同干预 = 相同历史（可复现）</li>
          </ul>
        </div>
      </div>
    </div>`);
}

// ---------- 右侧详情面板 ----------

export function showSettlementPanel(sidepanel: HTMLElement, w: WorldState, s: Settlement, actions: PanelActions) {
  const housing = housingCapacity(s);
  const civ = w.civs[s.civId] ?? w.civs[0];
  const macro = macroEconomy(w, civ);
  const counts = new Map<string, number>();
  for (const b of s.buildings) counts.set(b.kind, (counts.get(b.kind) ?? 0) + 1);
  sidepanel.innerHTML = `
    <div class="sp-head">
      <h3>${icon('people', 17)} ${s.name}</h3>
      <button id="sp-collapse" title="收起面板">${icon('chevron-right', 14)}</button>
    </div>
    <div class="sp-inner">
      <div class="sub">${STAGE_NAMES[s.stage]} · 建立于第 ${s.founded} 年 · ${s.dead ? '已废弃' : '发展中'}</div>
      <div class="sub"><span class="civ-dot" style="background:${civ.color}"></span> 属于 <b>${civ.name}</b> · ${FORM_NAMES_FALLBACK(civ.form)} · ${civEntityName(civ.form, s.stage, w.settlements.filter(x => !x.dead && x.civId === civ.id).length)}</div>
      <div class="sp-section">
        <h5>人口与生存</h5>
        <div class="kv"><span class="k">人口</span><span class="v">${s.population}</span></div>
        <div class="kv"><span class="k">住房</span><span class="v">${housing} / ${s.population}${housing < s.population ? ' ⚠' : ''}</span></div>
        <div class="kv"><span class="k">粮储（人·年）</span><span class="v">${Math.round(s.food)}</span></div>
        <div class="kv"><span class="k">短缺年数</span><span class="v">${s.shortageYears}</span></div>
        <div class="kv"><span class="k">木材 / 石 / 金属</span><span class="v">${Math.round(s.wood)} / ${Math.round(s.stone)} / ${Math.round(s.metal)}</span></div>
      </div>
      <div class="sp-section">
        <h5>建筑（${s.buildings.length}）</h5>
        ${s.buildings.length === 0 ? '<div class="kv"><span class="k">暂无</span></div>' : ''}
        ${[...counts.entries()].map(([k, n]) => `<span class="building-chip">${BUILDINGS[k]?.name ?? k} ×${n}</span>`).join('')}
        ${s.construction.length ? `<div class="kv" style="margin-top:6px"><span class="k">在建</span><span class="v">${s.construction.map(b => BUILDINGS[b.kind]?.name ?? b.kind).join('、')}</span></div>` : ''}
      </div>
      <div class="sp-section">
        <h5>当前危机</h5>
        ${s.shortageYears > 0 ? '<div class="kv"><span class="k">⚠ 口粮短缺</span><span class="v">连续 ' + s.shortageYears + ' 年</span></div>' : ''}
        ${w.activeEvents.some(a => a.id === 'plague-outbreak' && a.data.settlementId === s.id) ? '<div class="kv"><span class="k">⚠ 疫病流行中</span><span class="v">可净化</span></div>' : ''}
        ${s.shortageYears === 0 && !w.activeEvents.some(a => a.id === 'plague-outbreak' && a.data.settlementId === s.id) ? '<div class="kv"><span class="k">（暂无）</span></div>' : ''}
      </div>
      <div class="sp-section">
        <h5>宏观对照</h5>
        <div class="kv"><span class="k">全域人口</span><span class="v">${macro.population}</span></div>
        <div class="kv"><span class="k">粮食保障</span><span class="v">${Math.round(macro.foodRatio * 100)}%</span></div>
      </div>
      <div class="sp-actions">
        <button class="btn small primary" id="sp-focus">${icon('focus', 13)} 聚焦</button>
        <button class="btn small gold" id="sp-bless" title="12⚡">${icon('blessing', 13)} 祝福</button>
        <button class="btn small" id="sp-close">${icon('close', 13)} 关闭</button>
      </div>
    </div>`;
  sidepanel.classList.remove('hidden');
  sidepanel.classList.remove('collapsed');
  document.getElementById('game')?.classList.add('sp-open');
  // 收起态点击面板任意处 → 重新展开（onclick 属性避免监听器堆叠）
  sidepanel.onclick = () => {
    if (sidepanel.classList.contains('collapsed')) {
      sidepanel.classList.remove('collapsed');
      document.getElementById('game')?.classList.add('sp-open');
    }
  };
  sidepanel.querySelector('#sp-focus')!.addEventListener('click', () => actions.focusSettlement(s));
  sidepanel.querySelector('#sp-bless')!.addEventListener('click', () => actions.castBlessingAt(s));
  sidepanel.querySelector('#sp-close')!.addEventListener('click', () => hideSettlementPanel(sidepanel));
  sidepanel.querySelector('#sp-collapse')!.addEventListener('click', () => collapseSettlementPanel(sidepanel));
}

export function collapseSettlementPanel(sidepanel: HTMLElement) {
  sidepanel.classList.add('collapsed');
  document.getElementById('game')?.classList.remove('sp-open');
}

export function hideSettlementPanel(sidepanel: HTMLElement) {
  sidepanel.classList.add('hidden');
  document.getElementById('game')?.classList.remove('sp-open');
}

export function updateEventFeed(feed: HTMLElement, w: WorldState, actions: PanelActions, lastSeen: number) {
  const recent = w.chronicle.slice(-6).reverse();
  feed.innerHTML = recent.map(e => {
    const meta = EVENT_ICON[e.category] ?? EVENT_ICON.harvest;
    return `<div class="feed-card" data-eid="${e.id}" style="${e.year < lastSeen ? 'opacity:0.6' : ''}">
      <div class="f-ic" style="background:${meta.color}22;color:${meta.color}">${icon(meta.icon, 15)}</div>
      <div class="f-body">
        <div class="f-title">${e.title}</div>
        <div class="f-meta">第 ${e.year} 年${e.intervened ? ' · 神迹' : ''}</div>
      </div>
    </div>`;
  }).join('');
  feed.querySelectorAll('.feed-card').forEach(el => {
    el.addEventListener('click', () => {
      const e = w.chronicle.find(x => x.id === (el as HTMLElement).dataset.eid);
      if (e) openEventCard(e, w, actions);
    });
  });
}
