/* Go9 Agent Arena · 前端原型
 * 纯静态，无依赖。数据在 data.js，路由用 hash。
 */

/* ---------------- 工具 ---------------- */
function $(sel, root) { return (root || document).querySelector(sel); }
function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function pct(v) { return Math.round(v * 100) + '%'; }
function eloBar(elo) {
  var p = Math.max(2, Math.min(100, (elo - 1000) / 450 * 100));
  return '<div class="elo-bar"><i style="width:' + p.toFixed(1) + '%"></i></div>';
}

function byId(id) { return ENGINES.filter(function (e) { return e.id === id; })[0]; }

function groupKey(g) {
  if (g <= 5) return 'g' + g;
  if (g <= 8) return 'g6';
  if (g <= 12) return 'g9';
  return 'g13';
}

function hiLabel(hi) { return hi === 0 ? '0' : String(hi); }

/* 效率指标 */
function EI(e)  { return (e.elo - 1000) / Math.max(1, e.g); }
function PI(e)  { return (e.elo - 1000) / (1 + e.hi); }
function ACS(e) { return (e.elo - 1000) / (Math.pow(e.g, 0.5) * (1 + e.hi / 20)); }

function trustBadge(t) {
  return t === 'verified'
    ? '<span class="badge verified">已验证</span>'
    : '<span class="badge declared">未验证</span>';
}

function hiBadge(hi) {
  if (hi === 0) return '<span class="badge zero">零干预</span>';
  if (hi >= 30) return '<span class="badge hot">重度依赖</span>';
  return '';
}

function budgetText(e) {
  if (!e.budget) return '—';
  var b = e.budget;
  var v = b.mode === 'depth' ? b.value + ' 层' : (b.mode === 'time' ? b.limit + 's' : b.value + ' 次');
  return v + ' · ' + b.avgTime + 's';
}

function sampleBadge(e) {
  return e.sample ? '<span class="badge sample">示例</span>' : '';
}

/* 口径偏差：AI 自测声称 vs 平台实测 */
function parseScore(v) {
  var m = String(v == null ? '' : v).split(':');
  if (m.length !== 2) return [0, 0];
  return [parseInt(m[0], 10) || 0, parseInt(m[1], 10) || 0];
}

function deviations(e) {
  var out = [];
  if (!e.claims || !e.actual) return out;
  var c = e.claims, a = e.actual;
  if (c.passLevel1 && !a.passLevel1) {
    out.push({ k: 'level1', label: '声称通过 GNU Go level 1', claim: '通过', real: '未通过', severe: true });
  }
  var c1 = parseScore(c.bo10), a1 = parseScore(a.bo10);
  if (Math.abs(c1[0] - a1[0]) >= 2) {
    out.push({ k: 'bo10', label: '对现任冠军 BO10', claim: c.bo10, real: a.bo10, severe: false });
  }
  var c2 = parseScore(c.gnugo1), a2 = parseScore(a.gnugo1);
  var hasL1 = out.some(function (x) { return x.k === 'level1'; });
  if (!hasL1 && Math.abs(c2[0] - a2[0]) >= 2) {
    out.push({ k: 'gnugo1', label: '对 GNU Go level 1 比分', claim: c.gnugo1, real: a.gnugo1, severe: false });
  }
  return out;
}

function devBadge(e) {
  var d = deviations(e);
  if (!d.length) return '<span class="badge verified">口径一致</span>';
  var severe = d.some(function (x) { return x.severe; });
  return '<span class="badge ' + (severe ? 'hot' : 'declared') + '">' + d.length + ' 项偏差</span>';
}

function lineageText(e) {
  if (!e.lineage) return '<span style="color:var(--ink-3)">血统未申报</span>';
  var L = e.lineage;
  var s = '<b>' + esc(L.primary.model) + '</b> <span>· ' + esc(L.framework.name) + '</span>';
  if (L.aux.length) s += ' <span>· +' + L.aux.length + ' 辅助</span>';
  return s;
}

/* ---------------- 九路棋盘与规则 ---------------- */
var GTP_COLS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J'];

function GoBoard(size) {
  this.size = size;
  this.cells = new Int8Array(size * size);
  this.history = {};
  this.history[this.key()] = true;
}

GoBoard.prototype.key = function () {
  var s = '';
  for (var i = 0; i < this.cells.length; i++) s += this.cells[i];
  return s;
};

GoBoard.prototype.idx = function (x, y) { return y * this.size + x; };

GoBoard.prototype.neighbors = function (x, y) {
  var out = [], n = this.size;
  if (x > 0) out.push([x - 1, y]);
  if (x < n - 1) out.push([x + 1, y]);
  if (y > 0) out.push([x, y - 1]);
  if (y < n - 1) out.push([x, y + 1]);
  return out;
};

GoBoard.prototype.group = function (x, y) {
  var color = this.cells[this.idx(x, y)];
  if (!color) return null;
  var seen = {}, stack = [[x, y]], stones = [], libs = {};
  seen[x + ',' + y] = true;
  while (stack.length) {
    var cur = stack.pop(), cx = cur[0], cy = cur[1];
    stones.push(cur);
    var ns = this.neighbors(cx, cy);
    for (var i = 0; i < ns.length; i++) {
      var nx = ns[i][0], ny = ns[i][1], v = this.cells[this.idx(nx, ny)];
      if (v === 0) libs[nx + ',' + ny] = true;
      else if (v === color && !seen[nx + ',' + ny]) {
        seen[nx + ',' + ny] = true;
        stack.push([nx, ny]);
      }
    }
  }
  return { color: color, stones: stones, libs: Object.keys(libs).length };
};

/* 落子，返回 { ok, captured, reason } */
GoBoard.prototype.place = function (x, y, color) {
  var n = this.size;
  if (x < 0 || y < 0 || x >= n || y >= n) return { ok: false, reason: '坐标越界' };
  if (this.cells[this.idx(x, y)]) return { ok: false, reason: '该点已有子' };

  var snapshot = this.cells.slice();
  this.cells[this.idx(x, y)] = color;
  var opp = color === 1 ? 2 : 1;
  var captured = [];

  var ns = this.neighbors(x, y);
  for (var i = 0; i < ns.length; i++) {
    var nx = ns[i][0], ny = ns[i][1];
    if (this.cells[this.idx(nx, ny)] === opp) {
      var g = this.group(nx, ny);
      if (g && g.libs === 0) {
        for (var j = 0; j < g.stones.length; j++) {
          var sx = g.stones[j][0], sy = g.stones[j][1];
          captured.push([sx, sy]);
          this.cells[this.idx(sx, sy)] = 0;
        }
      }
    }
  }

  var self = this.group(x, y);
  if (self && self.libs === 0) {
    this.cells = snapshot;
    return { ok: false, reason: '禁止自杀' };
  }

  var k = this.key();
  if (this.history[k]) {
    this.cells = snapshot;
    return { ok: false, reason: '违反位置超级劫' };
  }
  this.history[k] = true;

  return { ok: true, captured: captured };
};

/* 解析 GTP 坐标 */
function parseGtp(s, size) {
  if (!s || s.toLowerCase() === 'pass' || s.toLowerCase() === 'resign') return null;
  var col = s.charAt(0).toUpperCase(), row = parseInt(s.slice(1), 10);
  var x = GTP_COLS.indexOf(col);
  if (x < 0 || !row || row < 1 || row > size) return null;
  return { x: x, y: size - row };
}

/* ---------------- 画棋盘 ---------------- */
function drawBoard(canvas, board, opts) {
  opts = opts || {};
  var size = board ? board.size : 9;
  var dpr = window.devicePixelRatio || 1;
  var CSS = canvas.clientWidth || 640;
  canvas.width = CSS * dpr;
  canvas.height = CSS * dpr;
  canvas.style.height = CSS + 'px';

  var ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  var pad = CSS * 0.062;
  var cell = (CSS - pad * 2) / (size - 1);
  var r = cell * 0.46;

  /* 木纹底 */
  var grd = ctx.createLinearGradient(0, 0, CSS, CSS);
  grd.addColorStop(0, '#e8cda6');
  grd.addColorStop(0.5, '#e2c296');
  grd.addColorStop(1, '#d8b384');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, CSS, CSS);

  /* 细木纹 */
  ctx.save();
  ctx.globalAlpha = 0.055;
  ctx.strokeStyle = '#6b4a26';
  for (var i = 0; i < 26; i++) {
    ctx.beginPath();
    var yy = (i / 26) * CSS + Math.sin(i * 2.3) * 6;
    ctx.moveTo(0, yy);
    ctx.bezierCurveTo(CSS * 0.3, yy + 5, CSS * 0.6, yy - 5, CSS, yy + 2);
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.restore();

  /* 网格 */
  ctx.strokeStyle = '#3d2f20';
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.75;
  for (var k = 0; k < size; k++) {
    var p = pad + k * cell;
    ctx.beginPath(); ctx.moveTo(pad, p); ctx.lineTo(CSS - pad, p); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(p, pad); ctx.lineTo(p, CSS - pad); ctx.stroke();
  }
  ctx.globalAlpha = 1;

  /* 外框略粗 */
  ctx.lineWidth = 1.8;
  ctx.strokeRect(pad, pad, CSS - pad * 2, CSS - pad * 2);

  /* 星位 */
  var stars = size === 9 ? [[2, 2], [6, 2], [2, 6], [6, 6], [4, 4]] : [[3, 3], [size - 4, 3], [3, size - 4], [size - 4, size - 4], [4, 4]];
  ctx.fillStyle = '#3d2f20';
  for (var s = 0; s < stars.length; s++) {
    ctx.beginPath();
    ctx.arc(pad + stars[s][0] * cell, pad + stars[s][1] * cell, cell * 0.07, 0, Math.PI * 2);
    ctx.fill();
  }

  /* 坐标 */
  ctx.fillStyle = 'rgba(61,47,32,.62)';
  ctx.font = (cell * 0.28).toFixed(1) + 'px ' + 'system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (var c = 0; c < size; c++) {
    ctx.fillText(GTP_COLS[c], pad + c * cell, pad * 0.45);
    ctx.fillText(GTP_COLS[c], pad + c * cell, CSS - pad * 0.45);
  }
  ctx.textAlign = 'right';
  for (var rr = 0; rr < size; rr++) {
    var num = size - rr;
    ctx.fillText(String(num), pad * 0.55, pad + rr * cell);
    ctx.fillText(String(num), CSS - pad * 0.4, pad + rr * cell);
  }

  if (!board) return { cell: cell, pad: pad };

  /* 棋子 */
  for (var y = 0; y < size; y++) {
    for (var x = 0; x < size; x++) {
      var v = board.cells[y * size + x];
      if (!v) continue;
      var cx = pad + x * cell, cy = pad + y * cell;
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy + cell * 0.045, r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(50,33,15,.22)';
      ctx.fill();
      ctx.restore();

      var g2 = ctx.createRadialGradient(cx - r * 0.34, cy - r * 0.38, r * 0.12, cx, cy, r);
      if (v === 1) {
        g2.addColorStop(0, '#6b6b6b');
        g2.addColorStop(0.42, '#232323');
        g2.addColorStop(1, '#050505');
      } else {
        g2.addColorStop(0, '#ffffff');
        g2.addColorStop(0.62, '#f4f1ea');
        g2.addColorStop(1, '#cfc8ba');
      }
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = g2;
      ctx.fill();
      ctx.strokeStyle = v === 1 ? 'rgba(0,0,0,.55)' : 'rgba(150,140,120,.55)';
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }
  }

  /* 最后一手标记 */
  if (opts.last) {
    var lx = pad + opts.last[0] * cell, ly = pad + opts.last[1] * cell;
    ctx.beginPath();
    ctx.arc(lx, ly, cell * 0.13, 0, Math.PI * 2);
    ctx.fillStyle = '#c0392b';
    ctx.fill();
  }

  return { cell: cell, pad: pad };
}

/* ---------------- 页面：总览 ---------------- */
function renderHome() {
  var top = ENGINES.slice().sort(function (a, b) { return b.elo - a.elo; });
  var eff = ENGINES.slice().sort(function (a, b) { return ACS(b) - ACS(a); });

  return '' +
  '<div class="hero">' +
    '<div class="kicker">Agent 评测 · 九路围棋</div>' +
    '<h1>不看谁写得强，看谁<em>用最少的代价</em>写得强</h1>' +
    '<p class="lede">同一个任务书发给不同的 AI，让它们各自从零写出一个九路围棋引擎。' +
    '平台要求如实申报自我迭代代数与人类干预次数，并把同代数的作品放在一起对战。' +
    '这样比出来的才是模型和 Agent 框架的真实能力，而不是谁更有耐心。</p>' +
    '<div class="hero-actions">' +
      '<a class="btn primary" href="#/ladder">看榜单</a>' +
      '<a class="btn" href="#/rules">读规则</a>' +
      '<a class="btn ghost" href="#/prompt">下载提示词包</a>' +
    '</div>' +
  '</div>' +

  '<div class="stat-row">' +
    '<div class="stat"><b>' + SUMMARY.engines + '</b><span>已收录引擎</span></div>' +
    '<div class="stat"><b>' + SUMMARY.matchesPlayed + '</b><span>已完成对局</span></div>' +
    '<div class="stat"><b>' + SUMMARY.totalGenerations + '</b><span>累计迭代代数</span></div>' +
    '<div class="stat"><b>' + RULES.komi + '</b><span>黑贴目 · 9 路</span></div>' +
  '</div>' +

  '<div class="grid-2 section">' +
    '<div>' +
      '<div class="section-head"><h2>总榜</h2><span class="sub">按 Elo 排序，代数和干预并列展示</span></div>' +
      '<div class="ladder"><table><thead><tr><th>#</th><th>引擎</th><th>Elo</th><th>G</th><th>HI</th></tr></thead><tbody>' +
        top.map(function (e, i) {
          return '<tr class="clickable" onclick="location.hash=\'#/engine/' + e.id + '\'">' +
            '<td class="rk' + (i === 0 ? ' top' : '') + '">' + (i + 1) + '</td>' +
            '<td><div class="eng-name">' + esc(e.name) + '</div><div class="eng-sub">' + (e.lineage ? esc(e.lineage.framework.name) : '血统未申报') + '</div></td>' +
            '<td><span class="elo-num">' + e.elo + '</span>' + eloBar(e.elo) + '</td>' +
            '<td class="num-g">' + e.g + '</td>' +
            '<td class="num-hi' + (e.hi === 0 ? ' zero' : e.hi >= 30 ? ' warn' : '') + '">' + hiLabel(e.hi) + '</td>' +
          '</tr>';
        }).join('') +
      '</tbody></table></div>' +
    '</div>' +
    '<div>' +
      '<div class="section-head"><h2>效率榜</h2><span class="sub">单位迭代与干预换来的强度</span></div>' +
      '<div class="ladder"><table><thead><tr><th>#</th><th>引擎</th><th>ACS</th><th>G</th><th>HI</th></tr></thead><tbody>' +
        eff.map(function (e, i) {
          return '<tr class="clickable" onclick="location.hash=\'#/engine/' + e.id + '\'">' +
            '<td class="rk' + (i === 0 ? ' top' : '') + '">' + (i + 1) + '</td>' +
            '<td><div class="eng-name">' + esc(e.name) + '</div><div class="eng-sub">' + (e.lineage ? esc(e.lineage.primary.model) : '血统未申报') + '</div></td>' +
            '<td><span class="elo-num">' + ACS(e).toFixed(1) + '</span></td>' +
            '<td class="num-g">' + e.g + '</td>' +
            '<td class="num-hi' + (e.hi === 0 ? ' zero' : '') + '">' + hiLabel(e.hi) + '</td>' +
          '</tr>';
        }).join('') +
      '</tbody></table></div>' +
    '</div>' +
  '</div>' +

  '<div class="section">' +
    '<div class="section-head"><h2>参赛流程</h2><span class="sub">从下载任务书到上榜，共四步</span></div>' +
    '<div class="grid-3">' +
      '<div class="card"><h3>一 · 下载任务书</h3><p style="font-size:12.5px;color:var(--ink-2)">把提示词包原样发给你的 AI，不要自己加料。规则参数已锁定，改一个字对局就作废。</p></div>' +
      '<div class="card"><h3>二 · 让它自己迭代</h3><p style="font-size:12.5px;color:var(--ink-2)">每产出一个可运行版本就算一代。中途人只要开口，就按五级记一次干预，事后必须如实申报。</p></div>' +
      '<div class="card"><h3>三 · 打包提交</h3><p style="font-size:12.5px;color:var(--ink-2)">引擎、规则库、裁判、测试、全部棋谱，一份不能少。平台会先跑静态扫描与沙箱验证。</p></div>' +
    '</div>' +
  '</div>' +

  '<div class="section">' +
    '<div class="section-head"><h2>最近战报</h2><span class="sub">点开任意一局看回放</span></div>' +
    '<div class="ladder"><table><thead><tr><th>时间</th><th>黑</th><th>白</th><th>结果</th><th>手数</th><th></th></tr></thead><tbody>' +
      [
        { at: '10-23 15:02', b: 'minmaxgo9', w: 'ZGo_final', r: 'B+1.5', m: 30 },
        { at: '10-22 16:30', b: 'minmaxgo9', w: 'go9x9', r: 'B+3.5', m: 112 },
        { at: '10-22 10:12', b: 'ZGo_final', w: 'go9x9', r: 'B+2.5', m: 120 }
      ].map(function (x) {
        return '<tr class="clickable" onclick="location.hash=\'#/replay\'">' +
          '<td class="mono" style="font-size:12px;color:var(--ink-3)">' + x.at + '</td>' +
          '<td>' + esc(x.b) + '</td><td>' + esc(x.w) + '</td>' +
          '<td><b>' + x.r + '</b></td><td class="mono">' + x.m + '</td>' +
          '<td style="color:var(--accent);font-size:12px">回放 →</td></tr>';
      }).join('') +
    '</tbody></table></div>' +
  '</div>';
}

/* ---------------- 页面：榜单 ---------------- */
var ladderTab = 'group';

function renderLadder() {
  var tabs = [
    { k: 'group', t: '分组榜' },
    { k: 'overall', t: '总榜' },
    { k: 'eff', t: '效率榜' },
    { k: 'dev', t: '口径榜' },
    { k: 'lineage', t: '血统榜' }
  ];

  var body = '';
  if (ladderTab === 'group') body = renderGroupLadder();
  else if (ladderTab === 'overall') body = renderOverallLadder();
  else if (ladderTab === 'eff') body = renderEffLadder();
  else if (ladderTab === 'dev') body = renderDevLadder();
  else body = renderLineageLadder();

  return '' +
  '<div class="hero" style="padding-bottom:22px">' +
    '<div class="kicker">排行榜</div>' +
    '<h1 style="font-size:31px">五个榜，五种问法</h1>' +
    '<p class="lede" style="font-size:13.5px">分组榜问「同样的迭代次数下谁最强」，总榜问「绝对强度」，' +
    '效率榜问「谁的性价比最高」，口径榜问「谁对自己水平的判断最准」，血统榜问「哪个模型配哪个框架最划算」。</p>' +
  '</div>' +
  '<div class="notice-bar"><span class="nb-tag">示例</span><span>' +
    '<b>榜上这三个是示例引擎，不代表任何可信度。</b>它们只用来演示界面、对局与排名流程，' +
    '不参与正式排名，也不会与真实提交的作品对战。真实引擎上传后，这一区会自动分开。' +
  '</span></div>' +
  '<div class="tabs">' + tabs.map(function (x) {
    return '<button class="' + (ladderTab === x.k ? 'on' : '') + '" onclick="setLadderTab(\'' + x.k + '\')">' + x.t + '</button>';
  }).join('') + '</div>' +
  body;
}

function setLadderTab(k) { ladderTab = k; route(); }

function renderGroupLadder() {
  var cards = TRACKS.map(function (t) {
    var list = ENGINES.filter(function (e) { return groupKey(e.g) === t.key; })
      .sort(function (a, b) { return b.elo - a.elo; });
    var on = list.length >= 3;
    return '<div class="group-card' + (list.length ? '' : ' empty') + '">' +
      '<h4><span>' + t.label + '</span>' +
        '<span class="badge ' + (on ? 'g' : 'declared') + '">' + (list.length ? list.length + ' 个' : '空') + '</span>' +
      '</h4>' +
      '<div class="gdesc">' + esc(t.desc) + '</div>' +
      (list.length
        ? list.map(function (e, i) {
            return '<div class="grow"><span class="gn">' + (i + 1) + '. ' + esc(e.name) + '</span><span class="ge">' + e.elo + '</span></div>';
          }).join('') + (list.length < 3 ? '<div class="gempty">不足 3 个，仅展示不排名</div>' : '')
        : '<div class="gempty">等待提交</div>') +
    '</div>';
  }).join('');

  return '<div class="group-grid">' + cards + '</div>' +
  '<p class="hint" style="margin-top:16px">同组才互相对战。某组不足三个引擎时只展示、不计组内 Elo。跨组的对局仅作表演赛，不进任何榜。</p>';
}

function renderOverallLadder() {
  var list = ENGINES.slice().sort(function (a, b) { return b.elo - a.elo; });
  return '<div class="ladder"><table><thead><tr>' +
    '<th>#</th><th>引擎</th><th>Elo</th><th>G</th><th>HI</th><th>血统</th><th>可信</th><th>口径</th><th>对局</th>' +
    '</tr></thead><tbody>' +
    list.map(function (e, i) {
      return '<tr class="clickable" onclick="location.hash=\'#/engine/' + e.id + '\'">' +
        '<td class="rk' + (i < 3 ? ' top' : '') + '">' + (i + 1) + '</td>' +
        '<td><div class="eng-name">' + esc(e.name) + ' ' + sampleBadge(e) + '</div><div class="eng-sub">v' + esc(e.version) + '</div></td>' +
        '<td><span class="elo-num">' + e.elo + '</span>' + eloBar(e.elo) + '</td>' +
        '<td class="num-g">' + e.g + '</td>' +
        '<td><span class="num-hi' + (e.hi === 0 ? ' zero' : e.hi >= 30 ? ' warn' : '') + '">' + hiLabel(e.hi) + '</span> ' + hiBadge(e.hi) + '</td>' +
        '<td class="lineage-cell">' + lineageText(e) + '</td>' +
        '<td>' + trustBadge(e.trust) + '</td>' +
        '<td>' + devBadge(e) + '</td>' +
        '<td class="mono" style="font-size:12.5px">' + e.games + '</td>' +
      '</tr>';
    }).join('') +
  '</tbody></table></div>' +
  '<p class="hint" style="margin-top:14px">总榜不限制代数，但 Elo 旁边必须同时给出 G 与 HI。只有这两个数字都在，分数才有解释力。</p>';
}

function renderEffLadder() {
  var list = ENGINES.slice().sort(function (a, b) { return ACS(b) - ACS(a); });
  return '<div class="ladder"><table><thead><tr>' +
    '<th>#</th><th>引擎</th><th>ACS</th><th>EI</th><th>PI</th><th>G</th><th>HI</th><th>预算</th>' +
    '</tr></thead><tbody>' +
    list.map(function (e, i) {
      return '<tr class="clickable" onclick="location.hash=\'#/engine/' + e.id + '\'">' +
        '<td class="rk' + (i < 3 ? ' top' : '') + '">' + (i + 1) + '</td>' +
        '<td><div class="eng-name">' + esc(e.name) + '</div><div class="eng-sub">' + (e.lineage ? esc(e.lineage.primary.model) : '血统未申报') + '</div></td>' +
        '<td><span class="elo-num">' + ACS(e).toFixed(1) + '</span></td>' +
        '<td class="mono">' + EI(e).toFixed(1) + '</td>' +
        '<td class="mono">' + PI(e).toFixed(1) + '</td>' +
        '<td class="num-g">' + e.g + '</td>' +
        '<td class="num-hi' + (e.hi === 0 ? ' zero' : '') + '">' + hiLabel(e.hi) + '</td>' +
        '<td class="mono" style="font-size:12px">' + budgetText(e) + '</td>' +
      '</tr>';
    }).join('') +
  '</tbody></table></div>' +
  '<div class="grid-3" style="margin-top:16px">' +
    '<div class="card"><h4>ACS · 综合能力分</h4><p style="font-size:12px;color:var(--ink-2)">(Elo − 1000) ÷ (G<sup>0.5</sup> × (1 + HI ÷ 20))。代数的边际收益递减，所以开根号。</p></div>' +
    '<div class="card"><h4>EI · 效率指数</h4><p style="font-size:12px;color:var(--ink-2)">(Elo − 1000) ÷ G。每多迭代一代，换来多少分。</p></div>' +
    '<div class="card"><h4>PI · 纯净指数</h4><p style="font-size:12px;color:var(--ink-2)">(Elo − 1000) ÷ (1 + HI)。人类每插一次手，摊薄多少。</p></div>' +
  '</div>';
}

function renderDevLadder() {
  var list = ENGINES.slice().sort(function (a, b) { return deviations(a).length - deviations(b).length; });

  var rows = list.map(function (e, i) {
    var d = deviations(e);
    var c = e.claims || {}, a = e.actual || {};
    var l1 = (c.passLevel1 && !a.passLevel1)
      ? '<span style="color:var(--accent)">声称过，实测没过</span>'
      : (a.passLevel1 ? '<span style="color:var(--jade)">声称过，实测也过</span>' : '<span style="color:var(--ink-3)">—</span>');
    return '<tr>' +
      '<td class="rk' + (i === 0 && !d.length ? ' top' : '') + '">' + (i + 1) + '</td>' +
      '<td><div class="eng-name">' + esc(e.name) + '</div>' +
        '<div class="eng-sub">' + (e.lineage ? esc(e.lineage.primary.model) : '血统未申报') + '</div></td>' +
      '<td>' + (c.bo10 || '—') + '</td>' +
      '<td>' + (a.bo10 || '—') + '</td>' +
      '<td>' + (c.gnugo1 || '—') + '</td>' +
      '<td>' + (a.gnugo1 || '—') + '</td>' +
      '<td>' + l1 + '</td>' +
      '<td>' + devBadge(e) + '</td>' +
    '</tr>';
  }).join('');

  var clean = list.filter(function (e) { return !deviations(e).length; }).length;

  return '<div class="ladder"><table><thead><tr>' +
    '<th>#</th><th>引擎</th><th>声称 BO10</th><th>实测 BO10</th><th>声称 L1</th><th>实测 L1</th><th>level 1 结论</th><th>偏差</th>' +
    '</tr></thead><tbody>' + rows + '</tbody></table></div>' +
    '<div class="grid-3" style="margin-top:16px">' +
      '<div class="card"><h4>这个榜在测什么</h4><p style="font-size:12px;color:var(--ink-2)">测的不是棋力，是 AI 对自己水平的判断准不准。声称通过而实测没过，引擎照常进榜打 Elo，但这条会被记下来。</p></div>' +
      '<div class="card"><h4>偏差怎么算</h4><p style="font-size:12px;color:var(--ink-2)">三处比对：level 1 是否真过、BO10 比分差是否达到 2 胜、对 level 1 的比分差是否达到 2 胜。触发任意一条计一项。</p></div>' +
      '<div class="card"><h4>当前状况</h4><p style="font-size:12px;color:var(--ink-2)">' +
        list.length + ' 个引擎里 ' + clean + ' 个口径一致，' + (list.length - clean) + ' 个有偏差。写"没打过"的偏差为零，夸大才扣。</p></div>' +
    '</div>' +
    '<p class="hint" style="margin-top:14px">这一栏是自测结论与平台实测的对照，不构成处罚。它的价值在于：同一批任务、同一套规则下，哪个模型更容易把自己吹过头，一目了然。</p>';
}

function renderLineageLadder() {
  var withLin = ENGINES.filter(function (e) { return e.lineage; });
  if (!withLin.length) {
    return '<div class="card"><div class="empty-state" style="padding:52px 24px">' +
      '<div style="font-size:14px;color:var(--ink);margin-bottom:9px">暂时没有可聚合的血统数据</div>' +
      '<div style="font-size:12.5px;line-height:1.9;max-width:460px;margin:0 auto">当前三个示例引擎都没有申报血统。等正式提交里填了主模型、渠道和 Agent 框架，这里会按厂商与框架聚合出中位 Elo 和中位 ACS。</div>' +
      '</div></div>';
  }
  var map = {};
  withLin.forEach(function (e) {
    var k = e.lineage.framework.name + '|' + e.lineage.primary.vendor;
    if (!map[k]) map[k] = { fw: e.lineage.framework.name, vendor: e.lineage.primary.vendor, list: [] };
    map[k].list.push(e);
  });
  var rows = Object.keys(map).map(function (k) {
    var m = map[k];
    var elos = m.list.map(function (e) { return e.elo; }).sort(function (a, b) { return a - b; });
    var acs = m.list.map(function (e) { return ACS(e); }).sort(function (a, b) { return a - b; });
    var med = function (arr) { return arr[Math.floor(arr.length / 2)]; };
    return {
      fw: m.fw, vendor: m.vendor, n: m.list.length,
      elo: med(elos).toFixed(0),
      acs: med(acs).toFixed(1),
      best: m.list.slice().sort(function (a, b) { return b.elo - a.elo; })[0].name
    };
  }).sort(function (a, b) { return parseFloat(b.acs) - parseFloat(a.acs); });

  return '<div class="ladder"><table><thead><tr>' +
    '<th>#</th><th>框架</th><th>主模型厂商</th><th>作品数</th><th>中位 Elo</th><th>中位 ACS</th><th>代表作</th>' +
    '</tr></thead><tbody>' +
    rows.map(function (r, i) {
      return '<tr>' +
        '<td class="rk' + (i < 3 ? ' top' : '') + '">' + (i + 1) + '</td>' +
        '<td><b>' + esc(r.fw) + '</b></td>' +
        '<td>' + esc(r.vendor) + '</td>' +
        '<td class="mono">' + r.n + '</td>' +
        '<td class="mono">' + r.elo + '</td>' +
        '<td class="mono">' + r.acs + '</td>' +
        '<td>' + esc(r.best) + '</td>' +
      '</tr>';
    }).join('') +
  '</tbody></table></div>' +
  '<p class="hint" style="margin-top:14px">同一血统取中位数，避免单个极端作品拉偏。辅助模型不计入归属，只在详情页展示。</p>';
}

/* ---------------- 思考预算块 ---------------- */
function budgetBlock(e) {
  if (!e.budget) return '';
  var b = e.budget;
  var mode = BUDGET_MODES[b.mode] || b.mode;
  var used = Math.min(100, Math.round(b.avgTime / b.limit * 100));

  return '<div class="section">' +
    '<div class="section-head"><h2>思考预算</h2><span class="sub">同预算才可直比</span></div>' +
    '<div class="card">' +
      '<div class="gen-wrap" style="align-items:flex-start">' +
        '<div style="flex:1">' +
          '<div class="gs-row"><span>控制方式</span><b>' + esc(mode) + '</b></div>' +
          '<div class="gs-row"><span>每手预算</span><b>' + (b.mode === 'depth' ? b.value + ' 层' : b.value + ' 次') + '</b></div>' +
          '<div class="gs-row"><span>实测均耗时</span><b>' + b.avgTime + ' 秒</b></div>' +
          '<div class="gs-row"><span>规则上限</span><b>' + b.limit + ' 秒</b></div>' +
          '<div class="gs-row"><span>预算利用率</span><b>' + used + '%</b></div>' +
        '</div>' +
        '<div style="flex:1.1;border-left:1px solid var(--line-soft);padding-left:26px">' +
          '<div style="font-size:12.5px;color:var(--ink-2);line-height:1.9">' + esc(b.note) + '</div>' +
          '<div class="elo-bar" style="width:100%;margin-top:14px;height:5px"><i style="width:' + used + '%"></i></div>' +
          '<div class="hint" style="margin-top:8px">预算利用率＝实测均耗时 ÷ 5 秒上限</div>' +
        '</div>' +
      '</div>' +
      '<div class="gen-note">思考预算是独立维度，和代数、干预一样必须单列。同样是 Elo 1300，' +
        '一个每手跑满 5 秒、一个只用 0.4 秒，这两个分数的含义完全不同。' +
        '规则只限时间，不限模拟次数与搜索深度，利用率低的引擎等于把 5 秒扔掉了一半。</div>' +
    '</div>' +
  '</div>';
}

/* ---------------- 声称与实测对照块 ---------------- */
function devBlock(e) {
  if (!e.claims || !e.actual) return '';
  var d = deviations(e);
  var c = e.claims, a = e.actual;

  function diffCell(claim, real) {
    var d = Math.abs(parseScore(claim)[0] - parseScore(real)[0]);
    if (d === 0) return '<span style="color:var(--jade)">相同</span>';
    if (d >= 2) return '<span style="color:var(--accent);font-weight:600">差 ' + d + ' 胜</span>';
    return '<span style="color:var(--ink-3)">差 ' + d + ' 胜</span>';
  }

  function row(label, claim, real, bad) {
    var mark = bad
      ? '<span style="color:var(--accent);font-weight:600">有偏差</span>'
      : '<span style="color:var(--jade)">一致</span>';
    return '<tr><td>' + esc(label) + '</td><td class="mono">' + esc(claim) + '</td>' +
      '<td class="mono">' + esc(real) + '</td><td>' + mark + '</td></tr>';
  }

  return '<div class="section">' +
    '<div class="section-head"><h2>自测结论与平台实测</h2><span class="sub">' +
      (d.length ? d.length + ' 项不符' : '口径一致') + '</span></div>' +
    '<div class="card">' +
      '<table class="mini-table">' +
        '<thead><tr><th>项目</th><th>它声称的</th><th>平台实测</th><th>差距</th></tr></thead>' +
        '<tbody>' +
          '<tr><td>对现任冠军 BO10</td><td class="mono">' + esc(c.bo10) + '</td><td class="mono">' + esc(a.bo10) + '</td><td>' + diffCell(c.bo10, a.bo10) + '</td></tr>' +
          '<tr><td>对 GNU Go level 1（10 局）</td><td class="mono">' + esc(c.gnugo1) + '</td><td class="mono">' + esc(a.gnugo1) + '</td><td>' + diffCell(c.gnugo1, a.gnugo1) + '</td></tr>' +
          '<tr><td>对 GNU Go level 5（10 局）</td><td class="mono">' + esc(c.gnugo5) + '</td><td class="mono">' + esc(a.gnugo5) + '</td><td>' + diffCell(c.gnugo5, a.gnugo5) + '</td></tr>' +
          row('规则单元测试 12 条', c.rulesPassed ? '全过' : '未全过', a.rulesPassed ? '全过' : '未全过', c.rulesPassed !== a.rulesPassed) +
          '<tr><td>level 1 是否通过</td><td class="mono">' + (c.passLevel1 ? '通过' : '未通过') + '</td>' +
            '<td class="mono">' + (a.passLevel1 ? '通过' : '未通过') + '</td>' +
            '<td>' + (c.passLevel1 && !a.passLevel1
              ? '<span style="color:var(--accent);font-weight:600">有偏差</span>'
              : '<span style="color:var(--jade)">一致</span>') + '</td></tr>' +
        '</tbody>' +
      '</table>' +
    '</div>' +
    (d.length
      ? '<div class="note accent" style="margin-top:12px">这个引擎有 ' + d.length + ' 项自测结论与实测不符。' +
        '资格不受影响，Elo 照常计算，但这条记录会公开保留。偏差越大，说明它在自评时越容易把话说满。</div>'
      : '<div class="note" style="margin-top:12px">自测结论与平台实测完全一致。这种情况比高分更少见。</div>') +
  '</div>';
}

/* ---------------- 页面：引擎详情 ---------------- */
function renderEngine(id) {
  var e = byId(id);
  if (!e) return '<div class="empty-state">找不到这个引擎</div>';
  var L = e.lineage;

  var genBars = e.gens.map(function (g) {
    return '<div class="gen-col" title="' + esc(g.summary) + '">' +
      '<div class="bar"><i style="height:' + (g.vsBaseline * 100) + '%"></i></div>' +
      '<span class="lbl">G' + g.g + ' <b>' + pct(g.vsBaseline) + '</b></span>' +
    '</div>';
  }).join('');

  var timeline = e.interventions.length
    ? e.interventions.map(function (x) {
        var lv = LEVELS[x.level];
        return '<div class="tl-item ' + x.level.toLowerCase() + '">' +
          '<div class="tl-top">' +
            '<span class="badge ' + (x.level === 'H5' || x.level === 'H4' ? 'hot' : 'g') + '">' + x.level + ' · ' + lv.name + '</span>' +
            '<span class="badge g">权重 ' + lv.weight + '</span>' +
            '<span class="tl-time">' + esc(x.at) + '</span>' +
          '</div>' +
          '<div class="tl-trigger"><b>触发：</b>' + esc(x.trigger) + '</div>' +
          '<div class="tl-input">' + esc(x.input) + '</div>' +
          '<div class="tl-reason">判定理由：' + esc(x.reason) + '</div>' +
        '</div>';
      }).join('')
    : '<div class="empty-state" style="padding:26px 0">全程零干预。这是最难的一种情况。</div>';

  var matches = e.matches.length
    ? '<div class="ladder"><table><thead><tr><th>时间</th><th>黑</th><th>白</th><th>结果</th><th>手数</th><th></th></tr></thead><tbody>' +
      e.matches.map(function (m) {
        return '<tr class="clickable" onclick="location.hash=\'#/replay\'">' +
          '<td class="mono" style="font-size:12px;color:var(--ink-3)">' + esc(m.at) + '</td>' +
          '<td>' + esc(m.black) + '</td><td>' + esc(m.white) + '</td>' +
          '<td><b>' + esc(m.result) + '</b></td><td class="mono">' + m.moves + '</td>' +
          '<td style="color:var(--accent);font-size:12px">回放 →</td></tr>';
      }).join('') + '</tbody></table></div>'
    : '<div class="empty-state">还没有正式对局记录</div>';

  return '' +
  '<div class="breadcrumb"><a href="#/ladder">榜单</a> / ' + esc(e.name) + '</div>' +
  '<div class="detail-head">' +
    '<div>' +
      '<h1>' + esc(e.name) + '</h1>' +
      '<div class="sub">' + esc(e.tagline) + ' · v' + esc(e.version) + ' · ' + esc(e.fullName) + '</div>' +
      '<div class="tag-line" style="margin-top:11px">' +
        '<span class="badge g">G' + e.g + ' · ' + TRACKS.filter(function (t) { return t.key === groupKey(e.g); })[0].label + '</span>' +
        '<span class="badge g">HI ' + e.hi + '</span>' +
        trustBadge(e.trust) + hiBadge(e.hi) +
      '</div>' +
    '</div>' +
    '<div class="detail-stats">' +
      '<div class="ds"><b class="hl">' + e.elo + '</b><span>ELO</span></div>' +
      '<div class="ds"><b>' + e.g + '</b><span>迭代代数 G</span></div>' +
      '<div class="ds"><b>' + e.hi + '</b><span>干预指数 HI</span></div>' +
      '<div class="ds"><b>' + e.wins + '/' + e.games + '</b><span>胜/总</span></div>' +
      '<div class="ds"><b>' + ACS(e).toFixed(1) + '</b><span>ACS</span></div>' +
    '</div>' +
  '</div>' +

  '<div class="section">' +
    '<div class="section-head"><h2>代际进步</h2><span class="sub">每代对固定基线的胜率</span></div>' +
    '<div class="card">' +
      '<div class="gen-wrap">' +
        '<div class="gen-bars">' + genBars + '</div>' +
        '<div class="gen-side">' +
          '<div class="gs-row"><span>首代胜率</span><b>' + pct(e.gens[0].vsBaseline) + '</b></div>' +
          '<div class="gs-row"><span>末代胜率</span><b>' + pct(e.gens[e.gens.length - 1].vsBaseline) + '</b></div>' +
          '<div class="gs-row"><span>净提升</span><b>+' + Math.round((e.gens[e.gens.length - 1].vsBaseline - e.gens[0].vsBaseline) * 100) + ' pt</b></div>' +
          '<div class="gs-row"><span>平均每代</span><b>' + (e.g > 1 ? '+' + ((e.gens[e.gens.length - 1].vsBaseline - e.gens[0].vsBaseline) * 100 / (e.g - 1)).toFixed(1) + ' pt' : '—') + '</b></div>' +
        '</div>' +
      '</div>' +
      '<div class="gen-note">共 ' + e.g + ' 代，累计改动 ' + esc(e.gens[0].delta) + ' 起。判定代数的依据是独立快照目录加该代自测对局，会话日志中的文件写入次数会做交叉验证。</div>' +
    '</div>' +
  '</div>' +

  budgetBlock(e) +

  '<div class="grid-2 section">' +
    '<div>' +
      '<div class="section-head"><h2>人类干预</h2><span class="sub">HI = ' + e.hi + '</span></div>' +
      '<div class="card"><div class="timeline">' + timeline + '</div></div>' +
      '<div class="note" style="margin-top:12px">H1 任务书恒定一次，不计分。H2 记 1，H3 记 3，H4 记 8，H5 记 20。无法提供证据的干预一律按 H4 计。</div>' +
    '</div>' +
    '<div>' +
      '<div class="section-head"><h2>血统</h2><span class="sub">' + (L ? esc(CHANNELS[L.primary.channel]) : '未申报') + '</span></div>' +
      (!L
        ? '<div class="card"><div class="empty-state" style="padding:40px 22px">' +
            '<div style="font-size:13.5px;color:var(--ink);margin-bottom:9px">这个引擎还没有申报血统</div>' +
            '<div style="font-size:12.5px;color:var(--ink-3);line-height:1.9">正式提交需要填写主模型与其版本标识、渠道类型（官方 / 云厂商代理 / 中转 / 本地），以及使用的 Agent 框架和工具链。缺这些信息只能进未验证榜。</div>' +
          '</div></div>'
        : '<div class="card">' +
        '<div class="lin-row"><div class="lin-role">主生成</div><div class="lin-body">' +
          '<b>' + esc(L.primary.model) + '</b> <span class="meta">' + esc(L.primary.tag) + '</span>' +
          '<span class="channel ' + L.primary.channel + '">' + esc(CHANNELS[L.primary.channel]) + '</span>' +
          '<div class="meta">' + esc(L.primary.vendor) + ' · ' + esc(L.primary.channelName) + '</div>' +
        '</div></div>' +
        L.aux.map(function (a) {
          return '<div class="lin-row"><div class="lin-role">' + esc(a.role) + '</div><div class="lin-body">' +
            '<b>' + esc(a.model) + '</b> <span class="meta">' + esc(a.tag) + '</span>' +
            '<span class="channel ' + a.channel + '">' + esc(CHANNELS[a.channel]) + '</span>' +
            '<div class="meta">' + esc(a.vendor) + ' · ' + esc(a.channelName) + '</div>' +
          '</div></div>';
        }).join('') +
        '<div class="lin-row"><div class="lin-role">框架</div><div class="lin-body">' +
          '<b>' + esc(L.framework.name) + '</b> <span class="meta">v' + esc(L.framework.version) + ' · ' + esc(L.framework.mode) + ' 模式</span>' +
          '<div class="tools">' + L.framework.tools.map(function (t) { return '<span class="tool">' + esc(t) + '</span>'; }).join('') + '</div>' +
        '</div></div>' +
        '<div class="lin-row"><div class="lin-role">备注</div><div class="lin-body" style="color:var(--ink-2)">' + esc(L.note) + '</div></div>' +
        '</div>') +
    '</div>' +
  '</div>' +

  '<div class="section">' +
    '<div class="section-head"><h2>对局记录</h2><span class="sub">' + e.matches.length + ' 局</span></div>' +
    matches +
  '</div>' +
  devBlock(e);
}

/* ---------------- 页面：回放 ---------------- */
var replayState = { step: 0, board: null, last: null };

function renderReplay() {
  return '' +
  '<div class="breadcrumb"><a href="#/ladder">榜单</a> / 对局回放</div>' +
  '<div class="detail-head" style="padding-bottom:18px">' +
    '<div><h1 style="font-size:26px">' + esc(SAMPLE_GAME.black) + ' <span style="color:var(--ink-3);font-size:20px">执黑</span>' +
    ' vs ' + esc(SAMPLE_GAME.white) + '</h1>' +
    '<div class="sub">' + esc(SAMPLE_GAME.date) + ' · 9 路 · 贴目 ' + SAMPLE_GAME.komi + ' · 结果 ' + SAMPLE_GAME.result +
    ' · <span style="color:var(--ink-3)">' + esc(SAMPLE_GAME.note) + '</span></div></div>' +
  '</div>' +
  '<div class="board-wrap">' +
    '<div class="board-card">' +
      '<canvas class="board" id="replayBoard"></canvas>' +
      '<div class="board-ctrl">' +
        '<button class="btn sm" onclick="replayTo(0)">⏮ 开局</button>' +
        '<button class="btn sm" onclick="replayStep(-1)">上一手</button>' +
        '<button class="btn sm" onclick="replayStep(1)">下一手</button>' +
        '<button class="btn sm" onclick="replayTo(' + SAMPLE_GAME.moves.length + ')">末手 ⏭</button>' +
        '<div class="spacer"></div>' +
        '<span class="step" id="replayStep">0 / ' + SAMPLE_GAME.moves.length + '</span>' +
      '</div>' +
    '</div>' +
    '<div class="board-card">' +
      '<h3 style="margin-bottom:10px">手顺</h3>' +
      '<div class="move-list" id="moveList"></div>' +
    '</div>' +
  '</div>';
}

function replayInit() {
  var b = new GoBoard(9);
  replayState = { step: 0, board: b, snapshots: [b.cells.slice()], lasts: [null] };
  for (var i = 0; i < SAMPLE_GAME.moves.length; i++) {
    var p = parseGtp(SAMPLE_GAME.moves[i], 9);
    if (!p) continue;
    var color = (i % 2 === 0) ? 1 : 2;
    var r = b.place(p.x, p.y, color);
    if (r.ok) {
      replayState.snapshots.push(b.cells.slice());
      replayState.lasts.push([p.x, p.y]);
    } else {
      replayState.snapshots.push(b.cells.slice());
      replayState.lasts.push(null);
    }
  }
  replayState.step = SAMPLE_GAME.moves.length;
  renderMoveList();
}

function replayPaint() {
  var cv = $('#replayBoard');
  if (!cv) return;
  var tmp = new GoBoard(9);
  tmp.cells = replayState.snapshots[replayState.step].slice();
  drawBoard(cv, tmp, { last: replayState.lasts[replayState.step] });
  var el = $('#replayStep');
  if (el) el.textContent = replayState.step + ' / ' + SAMPLE_GAME.moves.length;
  $$('#moveList .mv').forEach(function (n, i) {
    n.classList.toggle('on', i === replayState.step - 1);
  });
  var on = $('#moveList .mv.on');
  if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest' });
}

function renderMoveList() {
  var box = $('#moveList');
  if (!box) return;
  box.innerHTML = SAMPLE_GAME.moves.map(function (m, i) {
    var c = i % 2 === 0 ? '●' : '○';
    return '<div class="mv" onclick="replayTo(' + (i + 1) + ')"><span>' + (i + 1) + '</span>' + c + ' ' + m + '</div>';
  }).join('');
  replayPaint();
}

function replayStep(d) { replayTo(replayState.step + d); }
function replayTo(n) {
  n = Math.max(0, Math.min(SAMPLE_GAME.moves.length, n));
  replayState.step = n;
  replayPaint();
}

/* ---------------- 页面：规则 ---------------- */
function renderRules() {
  var params = [
    ['棋盘', '<b>9 × 9</b>，81 个交叉点，黑先，无让子'],
    ['坐标', 'GTP 表示法，列 <b>A–H 与 J</b>（跳过 I），行 1–9，天元 E5'],
    ['贴目', '黑贴 <b>7.5 目</b>，白方加 7.5，不存在和棋'],
    ['计分', '中国规则数子法，提子数不另计，单官与公气不计'],
    ['劫', '<b>位置超级劫 PSK</b>，禁止全局同形再现'],
    ['自杀', '禁止，单子与多子自杀一律非法'],
    ['终局', '连续两次弃权，或一方无合法着法只能弃权'],
    ['手数上限', '<b>500 手</b>，超限该局无效并重赛'],
    ['每手限时', '<b>5 秒</b>，从裁判发出 genmove 起算，超时判负。只限时间，不限模拟次数与搜索深度'],
    ['死子裁决', 'GNU Go 3.8，参数 <span class="mono">--chinese-rules --komi 7.5 --positional-superko</span>，只取其死活标记'],
    ['随机种子', '轮次 × 1000 + 局号，同轮内不得更换'],
    ['GTP 接口', 'protocol_version / name / version / boardsize 9 / clear_board / komi 7.5 / play / genmove / quit']
  ];

  var tests = [
    ['A1', '提子：白 E5，黑 D5、F5、E4，黑下 E6，白 E5 应被提去'],
    ['A2', '禁自杀：白 C4、E4、D3、D5，黑下 D4，应判非法'],
    ['A3', '提子优先：落子后表面无气但确实提子，应判合法'],
    ['A4', '简单劫：黑提劫后白立即提回应判非法，他处落子后提回合法'],
    ['A5', '位置超级劫：三劫循环第三次提回导致全局同形，应判非法'],
    ['A6', '弃权：单次 pass 对局继续，连续两次 pass 进入终局'],
    ['A7', '坐标：I4、K4、A0、J10 均应判非法'],
    ['A8', '数子：黑分加围空，白分加围空再加 7.5，提子不计'],
    ['A9', '贴目：白加 7.5，不得和棋，半目胜负须正确'],
    ['A10', '终局死子：死子移除后空点归对方，双活公气不计'],
    ['A11', '非法着法、超时、崩溃判负且不得重赛，裁判故障除外'],
    ['A12', '差分测试：不少于 10000 个随机局面，合法着手集合完全一致']
  ];

  return '' +
  '<div class="hero" style="padding-bottom:22px">' +
    '<div class="kicker">规则 · 已锁定</div>' +
    '<h1 style="font-size:31px">参数改一个字，全部成绩作废</h1>' +
    '<p class="lede" style="font-size:13.5px">下面每一项都来自任务书，不接受任何形式的调整。' +
    '引擎、裁判与平台必须共用同一份规则库，不允许各写一套近似实现。</p>' +
  '</div>' +

  '<div class="grid-2 section">' +
    '<div class="card"><h3>锁定参数</h3><table class="rule-table">' +
      params.map(function (p) { return '<tr><td>' + p[0] + '</td><td>' + p[1] + '</td></tr>'; }).join('') +
    '</table></div>' +
    '<div>' +
      '<div class="card"><h3>迭代赛制</h3>' +
        '<ol class="steps">' +
          '<li><b>第一轮</b>：独立实现 A、B 两套候选，决策代码须有实质差异。A 与 B 打 10 局，先后手各 5 局，胜者成为现任冠军，5:5 则加赛。</li>' +
          '<li><b>第二轮起</b>：依次设计 C、D、E，与现任冠军打 <b>BO10</b>。挑战者须取得 <b>不少于 9 胜</b>，即 9:1 或 10:0 才晋级。</li>' +
          '<li><b>失败处理</b>：保留全部棋谱与日志，分析后设计下一代。不得改规则、贴目、时限或局数。</li>' +
          '<li><b>迭代次数定义</b>：除 A、B 以外，实际参加 BO10 的候选程序数量。C、D、E 都算，<b>无论胜负均计一次</b>。</li>' +
        '</ol>' +
      '</div>' +
      '<div class="card"><h3>提交条件</h3>' +
        '<ul class="check-list">' +
          '<li>最新候选对现任冠军 BO10 取得不少于 9 胜</li>' +
          '<li>rules/ 规则单元测试全部通过</li>' +
          '<li>与 GNU Go 3.8（level 1，10 局）对战并留存记录，<b>击败 level 1 作为晋级依据</b></li>' +
          '<li>提交包可离线复现，一条命令完成 BO10 且结果一致</li>' +
        '</ul>' +
      '</div>' +
    '</div>' +
  '</div>' +

  '<div class="section">' +
    '<div class="section-head"><h2>规则单元测试清单</h2><span class="sub">12 条，全过才能开赛</span></div>' +
    '<div class="test-list">' + tests.map(function (t) {
      return '<li><span class="tid">' + t[0] + '</span><span class="ttxt">' + esc(t[1]) + '</span></li>';
    }).join('') + '</div>' +
  '</div>' +

  '<div class="grid-2 section">' +
    '<div class="card"><h3>提交包结构</h3><div class="mono-block">submission/\n' +
      '  engine/     可执行 GTP 引擎及启动脚本\n' +
      '  rules/      唯一规则库\n' +
      '  referee/    裁判程序及 BO10 运行器\n' +
      '  tests/      规则单元测试，须含全部 12 条用例\n' +
      '  matches/    全部 SGF、GTP 日志及结果 JSON\n' +
      '  REPORT.md   迭代次数、代数表、每轮比分、\n' +
      '              规则合规清单、基准战绩、已知弱点、\n' +
      '              复现命令</div></div>' +
    '<div class="card"><h3>明令禁止</h3><ul class="check-list">' +
      '<li>直接调用 GNU Go、KataGo、Leela 等现成 AI 落子</li>' +
      '<li>在引擎内部另写一套近似规则</li>' +
      '<li>直接采用引擎返回的 final_score 作为结果</li>' +
      '<li>伪造对局结果、伪造 Elo、手改 rating 文件</li>' +
      '<li>通过拖延、制造崩溃重赛、利用裁判缺陷获利</li>' +
      '<li>未备份就覆盖配置与数据</li>' +
    '</ul></div>' +
  '</div>' +

  '<div class="note accent">冲突处理原则：凡涉及围棋规则、测试用例、赛制与提交条件，一律以任务书为准；平台实现服从任务书。两者不一致时，任务书优先。</div>';
}

/* ---------------- 页面：提交 ---------------- */
var submitState = {
  model: 'DeepSeek-V4.1-Flash',
  version: '2026-10-17',
  channel: 'official',
  framework: 'WorkBuddy',
  fwVersion: '5.9.2',
  gens: 3,
  hi: 3
};

function renderSubmit() {
  return '' +
  '<div class="hero" style="padding-bottom:22px">' +
    '<div class="kicker">提交</div>' +
    '<h1 style="font-size:31px">先把元数据填对，再谈棋力</h1>' +
    '<p class="lede" style="font-size:13.5px">这个页面把 manifest.yaml 的填写过程做成表单，边填边生成。' +
    '正式提交走上传，这里只是原型演示，不落盘。</p>' +
  '</div>' +

  '<div class="grid-2">' +
    '<div>' +
      '<div class="card">' +
        '<h3>一 · 引擎与血统</h3>' +
        '<div class="form-grid" style="margin-top:14px">' +
          '<label class="req">引擎名</label><div><input class="inp" id="fName" value="StoneFox" placeholder="4 到 24 字符"></div>' +
          '<label class="req">版本</label><div><input class="inp" id="fVer" value="1.0.0"></div>' +
          '<label class="req">主模型</label><div><input class="inp" id="fModel" value="DeepSeek-V4.1-Flash" oninput="submitState.model=this.value;refreshYaml()"></div>' +
          '<label>版本标识</label><div><input class="inp" id="fMTag" value="2026-10-17" oninput="submitState.version=this.value;refreshYaml()"></div>' +
          '<label class="req">渠道</label><div>' +
            '<div class="seg" id="segChannel">' +
              ['official', 'partner', 'relay', 'local'].map(function (c) {
                return '<button class="' + (submitState.channel === c ? 'on' : '') + '" onclick="setChannel(\'' + c + '\')">' + CHANNELS[c] + '</button>';
              }).join('') +
            '</div>' +
            '<div class="hint">中转渠道需要额外提供响应体里的原始模型标识截图，否则只能进未验证榜。</div>' +
          '</div>' +
          '<label class="req">Agent 框架</label><div><input class="inp" id="fFw" value="WorkBuddy" oninput="submitState.framework=this.value;refreshYaml()"></div>' +
          '<label>框架版本</label><div><input class="inp" id="fFwVer" value="5.9.2" oninput="submitState.fwVersion=this.value;refreshYaml()"></div>' +
        '</div>' +
      '</div>' +

      '<div class="card">' +
        '<h3>二 · 迭代与干预</h3>' +
        '<div class="form-grid" style="margin-top:14px">' +
          '<label class="req">迭代代数 G</label><div>' +
            '<input class="inp" id="fGens" type="number" min="1" max="60" value="3" oninput="submitState.gens=Math.max(1,parseInt(this.value)||1);refreshYaml()">' +
            '<div class="hint">必须等于 gens/ 目录数量，且每代可独立构建运行。</div>' +
          '</div>' +
          '<label>干预明细</label><div>' +
            '<div class="mini-table-wrap"><table class="mini-table" id="hitTable">' +
              '<thead><tr><th>级别</th><th>次数</th><th>权重</th><th class="num">小计</th></tr></thead>' +
              '<tbody id="hitBody"></tbody>' +
            '</table></div>' +
            '<div class="calc-box" style="margin-top:10px"><span>干预指数 HI</span><b id="hiOut">3</b></div>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>' +

    '<div>' +
      '<div class="card" style="padding:0;overflow:hidden">' +
        '<div style="padding:18px 22px 14px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center">' +
          '<h3 style="margin:0">manifest.yaml</h3>' +
          '<button class="btn sm" onclick="copyYaml()">复制</button>' +
        '</div>' +
        '<pre class="yaml-preview" id="yamlOut" style="border-radius:0"></pre>' +
      '</div>' +
      '<div class="note" style="margin-top:14px">表单里的代数与干预只影响 yaml 文本，真正的判定看证据：每代的独立快照、自测对局、以及会话日志里的文件写入次数。</div>' +
    '</div>' +
  '</div>' +

  '<div class="section" style="margin-top:36px">' +
    '<div class="section-head"><h2>上传与校验</h2><span class="sub">原型不落盘，仅演示交互</span></div>' +
    '<div class="grid-2">' +
      '<div class="card">' +
        '<h3>提交包</h3>' +
        '<p style="font-size:12.5px;color:var(--ink-2);margin-bottom:12px">拖入 zip，或点下面的按钮选择。上线后这里会先跑九项自动校验。</p>' +
        '<input type="file" id="pkgFile" accept=".zip" style="font-size:12.5px">' +
        '<div id="pkgOut" class="hint" style="margin-top:10px">尚未选择文件</div>' +
      '</div>' +
      '<div class="card"><h3>九项自动校验</h3><ul class="check-list" style="margin-top:6px">' +
        '<li>manifest.yaml 通过 schema 校验</li>' +
        '<li>final/ 与某一代 hash 完全一致</li>' +
        '<li>gens/ 从 gen01 连续无跳号</li>' +
        '<li>每代至少 20 局 SGF，summary 局数对得上</li>' +
        '<li>解压后不超过 20 MB</li>' +
        '<li>源码总量不超过 512 KB</li>' +
        '<li>无 .pt / .onnx / .h5 / .pb / .tflite / .bin</li>' +
        '<li>build.sh 在沙箱 60 秒内成功</li>' +
        '<li>能响应 name / version / genmove</li>' +
      '</ul></div>' +
    '</div>' +
  '</div>';
}

function setChannel(c) {
  submitState.channel = c;
  $$('#segChannel button').forEach(function (b) {
    b.classList.toggle('on', b.textContent === CHANNELS[c]);
  });
  refreshYaml();
}

function hitRows() {
  return [
    { lv: 'H2', n: 0 }, { lv: 'H3', n: 1 }, { lv: 'H4', n: 0 }, { lv: 'H5', n: 0 }
  ];
}

function computeHi() {
  return hitRows().reduce(function (s, r) { return s + LEVELS[r.lv].weight * r.n; }, 0);
}

function refreshYaml() {
  var out = $('#yamlOut');
  if (!out) return;
  var hi = computeHi();
  submitState.hi = hi;
  var hb = $('#hiOut');
  if (hb) hb.textContent = hi;

  var y = '' +
'<span class="c"># Go9 Agent Arena 提交清单 v1.0</span>\n' +
'schema_version: <span class="s">"1.0"</span>\n\n' +
'engine:\n' +
'  name: <span class="s">"' + ($('#fName') ? $('#fName').value : 'StoneFox') + '"</span>\n' +
'  version: <span class="s">"' + ($('#fVer') ? $('#fVer').value : '1.0.0') + '"</span>\n' +
'  declared_generation: <span class="n">' + submitState.gens + '</span>\n\n' +
'lineage:\n' +
'  primary_model:\n' +
'    model_id: <span class="s">"' + submitState.model + '"</span>\n' +
'    version_tag: <span class="s">"' + submitState.version + '"</span>\n' +
'    channel: <span class="s">' + submitState.channel + '</span>\n' +
'  agent_framework:\n' +
'    name: <span class="s">"' + submitState.framework + '"</span>\n' +
'    version: <span class="s">"' + submitState.fwVersion + '"</span>\n\n' +
'human_intervention:\n' +
'  computed_hi: <span class="n">' + hi + '</span>\n' +
'  events:\n' +
'    - seq: <span class="n">2</span>\n' +
'      level: <span class="s">H3</span>\n' +
'      human_input: <span class="s">"你看看 UCT 的探索常数和模拟次数配比"</span>\n\n' +
'generations:\n' +
'  - gen: <span class="n">1</span>\n' +
'    snapshot_dir: <span class="s">gens/gen01</span>\n' +
'    self_play: { games: <span class="n">20</span>, opponents: [Baseline-0] }\n';

  out.innerHTML = y;
}

function copyYaml() {
  var el = $('#yamlOut');
  if (!el) return;
  var txt = el.textContent;
  if (navigator.clipboard) {
    navigator.clipboard.writeText(txt).then(function () { toast('已复制'); });
  } else {
    toast('当前环境不支持剪贴板');
  }
}

function toast(msg) {
  var d = document.createElement('div');
  d.textContent = msg;
  d.style.cssText = 'position:fixed;left:50%;bottom:34px;transform:translateX(-50%);background:#1b1917;color:#f8f4ec;padding:9px 18px;border-radius:8px;font-size:13px;z-index:99';
  document.body.appendChild(d);
  setTimeout(function () { d.remove(); }, 1600);
}

/* ---------------- 页面：提示词包 ---------------- */
function renderPrompt() {
  var files = [
    ['项目说明.txt', '17.7 KB', '两个任务的边界、任务二的全部功能要求与验收清单'],
    ['任务/测试.txt', '12.2 KB', '唯一规则依据：锁定参数、12 条单元测试、迭代赛制、报告要求'],
    ['任务/gnugo-3.8-围棋规则源码.zip', '84.1 KB', 'board.c / boardlib.c / aftermath.c，可参考不可当引擎用'],
    ['参考平台/GoEngineArena/', '—', '现成的 Flask 对战平台，含 server.py、静态页、引擎配置与 Elo 数据']
  ];

  return '' +
  '<div class="hero" style="padding-bottom:22px">' +
    '<div class="kicker">提示词包</div>' +
    '<h1 style="font-size:31px">原样发出去，一个字都别改</h1>' +
    '<p class="lede" style="font-size:13.5px">这个包是本地化适配过的，下载后直接丢给你的 AI，让它按里面的顺序干活。' +
    '包的边界很清楚：任务一解决棋力，任务二解决平台。两件事不能混着做，也不能拿平台开发代替引擎设计。</p>' +
    '<div class="hero-actions"><button class="btn primary" onclick="toast(\'原型演示，正式版接下载接口\')">下载完整包（.zip）</button>' +
    '<button class="btn ghost" onclick="toast(\'原型演示\')">只看规则</button></div>' +
  '</div>' +

  '<div class="grid-2 section">' +
    '<div class="card"><h3>包里有什么</h3>' +
      files.map(function (f) {
        return '<div class="file-row"><div class="fi"><b>' + esc(f[0]) + '</b><span>' + esc(f[2]) + '</span></div>' +
          '<span class="mono" style="font-size:11.5px;color:var(--ink-3)">' + esc(f[1]) + '</span></div>';
      }).join('') +
    '</div>' +
    '<div class="card"><h3>拿到之后怎么用</h3><ol class="steps">' +
      '<li><b>先确认平台状态</b>：包里的说明明确要求，动手前必须先问清楚已有平台在哪、用什么技术栈、能不能直接改。</li>' +
      '<li><b>只做任务一</b>：先把 rules/ 规则库、referee/ 裁判、12 条单元测试做完，全过才允许开始 A/B 对抗。</li>' +
      '<li><b>按 BO10 迭代</b>：A 与 B 先打 10 局定冠军，之后 C、D、E 依次挑战，挑战者不拿 9 胜不算晋级。</li>' +
      '<li><b>如实报数</b>：迭代次数只算 A、B 以外的候选数量。报告里要写清每轮比分，不能自称已击败用户程序。</li>' +
    '</ol></div>' +
  '</div>' +

  '<div class="section">' +
    '<div class="section-head"><h2>包内目录</h2><span class="sub">围棋编程大赛.zip</span></div>' +
    '<div class="card"><div class="pkg-tree">' +
      '<span class="d">围棋编程大赛/</span>\n' +
      '├── <span class="d">任务/</span>\n' +
      '│   ├── <span class="f">测试.txt</span> <span class="sz">12.2 KB</span>\n' +
      '│   └── <span class="f">gnugo-3.8-围棋规则源码.zip</span> <span class="sz">84.1 KB</span>\n' +
      '├── <span class="d">参考平台/GoEngineArena/</span>\n' +
      '│   ├── <span class="f">server.py</span> <span class="sz">40.6 KB</span>\n' +
      '│   ├── <span class="f">engines.json</span> <span class="sz">885 B</span>\n' +
      '│   ├── <span class="f">start.bat</span>\n' +
      '│   ├── <span class="d">data/</span><span class="f">ratings.json</span>\n' +
      '│   └── <span class="d">static/</span> <span class="f">index.html · style.css · app.js</span>\n' +
      '└── <span class="d">项目说明/</span>\n' +
      '    └── <span class="f">项目说明.txt</span> <span class="sz">17.7 KB</span>' +
    '</div></div>' +
  '</div>' +

  '<div class="note accent">参考平台有两个已知的参数问题必须先修：engines.json 里 komi 是 6.5、max_moves 是 400，与任务书锁定的 7.5 和 500 不一致；终局分数直接读了引擎的 final_score，没有走固定裁判计分。这两条不修，对局结果全部无效。</div>';
}


/* ---------------- 页面：竞技场（需本地服务） ---------------- */
var ARENA = { online: null, timer: null, state: null, engines: [], picked: {}, health: null, auto: null };

function renderArena() {
  return '' +
  '<div class="hero" style="padding-bottom:22px">' +
    '<div class="kicker">竞技场 · 本地服务</div>' +
    '<h1 style="font-size:31px">上传引擎，让它自己打出一个等级分</h1>' +
    '<p class="lede" style="font-size:13.5px">这里是真跑，不是演示。上传 GTP 引擎后，平台用锁定的规则让它与其他引擎对局，' +
    '死子由 GNU Go 3.8 裁决，Elo 按局结算并落盘。需要先在项目目录执行 <span class="mono">python server.py</span>。</p>' +
  '</div>' +
  '<div id="arenaBody"><div class="empty-state">正在检测本地服务…</div></div>';
}

function arenaInit() {
  if (ARENA.timer) { clearInterval(ARENA.timer); ARENA.timer = null; }
  fetch('/api/health', { cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      ARENA.online = !!d.ok;
      ARENA.health = d;
      return fetch('/api/engines', { cache: 'no-store' });
    })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      ARENA.engines = d.engines || [];
      ARENA.engines.forEach(function (e) {
        if (!(e.id in ARENA.picked)) ARENA.picked[e.id] = true;
      });
      return fetch('/api/auto', { cache: 'no-store' });
    })
    .then(function (r) { return r.json(); })
    .then(function (a) {
      ARENA.auto = a;
      arenaPaint();
      arenaPoll();
    })
    .catch(function () { ARENA.online = false; arenaPaint(); });
}

function arenaPaint() {
  var box = $('#arenaBody');
  if (!box) return;

  if (!ARENA.online) {
    box.innerHTML = '<div class="card"><div class="empty-state" style="padding:44px 20px">' +
      '<div style="font-size:14px;color:var(--ink);margin-bottom:10px">本地服务没有启动</div>' +
      '<div style="font-size:12.5px;line-height:1.9;color:var(--ink-2);max-width:420px;margin:0 auto">' +
      '在项目目录执行 <b class="mono">python server.py</b>，然后回到这个页面刷新。' +
      '静态页面本身不跑引擎，对局与等级分都要靠本地服务。</div>' +
      '<div class="hint" style="margin-top:12px">默认地址 http://127.0.0.1:8770/</div></div></div>';
    return;
  }

  var rows = ARENA.engines.map(function (e) {
    var on = ARENA.picked[e.id];
    return '<tr>' +
      '<td><input type="checkbox" ' + (on ? 'checked' : '') +
        ' onchange="arenaToggle(\'' + esc(e.id) + '\',this.checked)"></td>' +
      '<td><div class="eng-name">' + esc(e.name) + '</div><div class="eng-sub">' + esc(e.id) + '</div></td>' +
      '<td class="mono">' + (e.elo == null ? '—' : Number(e.elo).toFixed(1)) + '</td>' +
      '<td class="mono" style="font-size:12px">' + e.wins + '/' + e.games + '</td>' +
      '<td class="mono" style="font-size:11px;color:var(--ink-3)">' + esc((e.args || []).join(' ')) + '</td>' +
    '</tr>';
  }).join('');

  var st = ARENA.state;
  var prog = st && st.total ? Math.round(st.done / st.total * 100) : 0;

  box.innerHTML =
    '<div class="grid-2">' +
      '<div class="card">' +
        '<h3>引擎列表 <span style="font-size:11px;color:var(--ink-3);font-weight:400">' +
          ARENA.engines.length + ' 个</span></h3>' +
        '<div class="ladder" style="margin-top:10px;box-shadow:none">' +
          '<table><thead><tr><th style="width:30px"></th><th>引擎</th><th>Elo</th><th>战绩</th><th>启动参数</th></tr></thead>' +
          '<tbody>' + (rows || '<tr><td colspan="5" class="gempty">还没有引擎</td></tr>') + '</tbody></table></div>' +
        (ARENA.engines.length < 2 ? '<div class="hint" style="margin-top:10px">至少需要两个引擎才能开赛。</div>' : '') +
      '</div>' +
      '<div class="card">' +
        '<h3>上传引擎</h3>' +
        '<div class="form-grid" style="margin-top:12px;grid-template-columns:76px 1fr">' +
          '<label>文件</label><div><input type="file" id="upFile" accept=".py,.exe,.jar" style="font-size:12.5px"></div>' +
          '<label>名称</label><div><input class="inp" id="upName" placeholder="留空则用文件名"></div>' +
          '<label>启动参数</label><div><input class="inp" id="upArgs" value="--mode gtp">' +
            '<div class="hint">.py 会用当前 Python 解释器启动</div></div>' +
        '</div>' +
        '<button class="btn primary" style="margin-top:14px" onclick="arenaUpload()">上传并握手校验</button>' +
        '<div id="upOut" class="hint" style="margin-top:10px"></div>' +
      '</div>' +
    '</div>' +
    '<div class="card" style="margin-top:18px">' +
      '<div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">' +
        '<h3 style="margin:0">自动对战</h3>' +
        '<label style="font-size:12.5px;color:var(--ink-2);display:inline-flex;align-items:center;gap:6px">' +
          '<input type="checkbox" id="autoSw" ' + (ARENA.auto && ARENA.auto.enabled ? 'checked' : '') +
          ' onchange="setAuto(this.checked)"> 上传后自动排位</label>' +
        '<label style="font-size:12.5px;color:var(--ink-2)">目标 ' +
          '<input class="inp" id="autoTarget" type="number" min="2" max="50" value="' +
          ((ARENA.auto && ARENA.auto.target) || 6) + '" ' +
          'style="width:58px;display:inline-block;padding:5px 8px;text-align:center" ' +
          'onchange="setTarget(this.value)"> 局</label>' +
        '<span style="flex:1"></span>' +
        '<span class="mono" style="font-size:12px;color:var(--ink-3)" id="autoNote">' +
          esc((ARENA.auto && ARENA.auto.state && ARENA.auto.state.note) || '待命') + '</span>' +
      '</div>' +
      '<div class="hint" id="autoLast" style="margin-top:8px;color:var(--ink-2)">' +
        esc((ARENA.auto && ARENA.auto.state && ARENA.auto.state.last) || '新引擎上传后会自动与最缺局的对手开打，无需手动点开始。') +
      '</div>' +
    '</div>' +
    '<div class="card" style="margin-top:14px">' +
      '<div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">' +
        '<h3 style="margin:0">手动循环赛</h3>' +
        '<label style="font-size:12.5px;color:var(--ink-2)">每对 ' +
          '<input class="inp" id="gpp" type="number" min="1" max="20" value="2" ' +
          'style="width:62px;display:inline-block;padding:5px 8px;text-align:center"> 局</label>' +
        '<button class="btn accent" onclick="arenaStart()">开始循环赛</button>' +
        '<button class="btn sm" onclick="apiReset()">重置等级分</button>' +
        '<span style="flex:1"></span>' +
        '<span class="mono" style="font-size:12px;color:var(--ink-3)" id="arenaProg">' +
          (st && st.total ? st.done + ' / ' + st.total : '未开赛') + '</span>' +
      '</div>' +
      '<div class="elo-bar" style="width:100%;height:6px;margin-top:12px">' +
        '<i style="width:' + prog + '%"></i></div>' +
      '<div class="hint" id="arenaCur" style="margin-top:8px">' + (st && st.current ? esc(st.current) : '') + '</div>' +
      '<div class="move-list" id="arenaLog" style="max-height:210px;margin-top:10px">' +
        (st && st.log && st.log.length
          ? st.log.slice().reverse().map(function (g) {
              return '<div class="mv">' + esc(g.black) + ' vs ' + esc(g.white) +
                ' → <b>' + esc(g.result) + '</b> · ' + g.moves + ' 手 · ' + g.seconds + 's</div>';
            }).join('')
          : '<div class="hint">还没有对局记录</div>') +
      '</div>' +
    '</div>';
}

function arenaToggle(id, on) { ARENA.picked[id] = on; }

function setAuto(on) {
  fetch('/api/auto', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled: !!on })
  }).then(function () { toast(on ? '自动对战已开启' : '自动对战已关闭'); });
}

function setTarget(v) {
  fetch('/api/auto', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ target: parseInt(v, 10) || 6 })
  }).then(function () { toast('目标局数已设为 ' + v); });
}

function arenaUpload() {
  var el = $('#upFile');
  var out = $('#upOut');
  if (!el || !el.files || !el.files[0]) { out.textContent = '先选一个文件'; return; }
  var fd = new FormData();
  fd.append('file', el.files[0]);
  fd.append('name', ($('#upName') || {}).value || '');
  fd.append('args', ($('#upArgs') || {}).value || '--mode gtp');
  out.textContent = '正在上传并做 GTP 握手…';
  fetch('/api/engines/upload', { method: 'POST', body: fd })
    .then(function (r) { return r.json().then(function (d) { return d; }); })
    .then(function (d) {
      if (d.ok) {
        out.innerHTML = '<span style="color:var(--jade)">' + esc(d.message) + '</span>';
        setTimeout(arenaInit, 400);
      } else {
        out.innerHTML = '<span style="color:var(--accent)">' + esc(d.error || '上传失败') + '</span>';
      }
    })
    .catch(function (e) { out.textContent = '请求失败：' + e.message; });
}

function arenaStart() {
  var ids = Object.keys(ARENA.picked).filter(function (k) { return ARENA.picked[k]; });
  if (ids.length < 2) { toast('至少选两个引擎'); return; }
  var gpp = parseInt(($('#gpp') || {}).value, 10) || 2;
  fetch('/api/arena/start', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ engines: ids, games_per_pair: gpp })
  })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (!d.ok) { toast(d.error || '开赛失败'); return; }
      toast('已开赛，共 ' + d.total + ' 局');
      arenaPoll();
    })
    .catch(function (e) { toast('请求失败：' + e.message); });
}

function apiReset() {
  if (!window.confirm('重置所有引擎的等级分？对局记录保留。')) return;
  fetch('/api/ratings/reset', { method: 'POST' })
    .then(function () { toast('已重置'); arenaInit(); });
}

function arenaPoll() {
  if (ARENA.timer) clearInterval(ARENA.timer);
  ARENA.timer = setInterval(function () {
    if (location.hash.indexOf('/arena') < 0) {
      clearInterval(ARENA.timer); ARENA.timer = null; return;
    }
    fetch('/api/arena/state', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (st) {
        var was = ARENA.state;
        ARENA.state = st;
        var pr = $('#arenaProg'), cu = $('#arenaCur'), lg = $('#arenaLog');
        if (pr) pr.textContent = st.done + ' / ' + st.total;
        if (cu) cu.textContent = st.current || '';
        var bar = $('.elo-bar i');
        if (bar && st.total) bar.style.width = Math.round(st.done / st.total * 100) + '%';
        if (lg && st.log) {
          lg.innerHTML = st.log.length
            ? st.log.slice().reverse().map(function (g) {
                return '<div class="mv">' + esc(g.black) + ' vs ' + esc(g.white) +
                  ' → <b>' + esc(g.result) + '</b> · ' + g.moves + ' 手 · ' + g.seconds + 's</div>';
              }).join('')
            : '<div class="hint">还没有对局记录</div>';
        }
        if (was && was.running && !st.running) {
          toast('比赛结束，等级分已更新');
          setTimeout(arenaInit, 400);
        }
      })
      .catch(function () {});

    fetch('/api/auto', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (a) {
        var prev = ARENA.auto;
        ARENA.auto = a;
        var note = $('#autoNote'), last = $('#autoLast');
        if (note) note.textContent = (a.state && a.state.note) || '待命';
        if (last && a.state && a.state.last) last.textContent = a.state.last;
        if (prev && prev.state && a.state &&
            prev.state.last !== a.state.last && a.state.last) {
          setTimeout(arenaInit, 500);
        }
      })
      .catch(function () {});
  }, 2000);
}

/* ---------------- 路由 ---------------- */
function renderEnginesList() {
  var list = ENGINES.slice().sort(function (a, b) { return b.elo - a.elo; });
  return '' +
  '<div class="hero" style="padding-bottom:22px">' +
    '<div class="kicker">参赛作品</div>' +
    '<h1 style="font-size:31px">' + ENGINES.length + ' 个引擎，' + SUMMARY.totalGenerations + ' 代累计</h1>' +
    '<p class="lede" style="font-size:13.5px">每张卡片是一个完整提交单元。点进去能看到代际曲线、干预时间线和血统拓扑。</p>' +
  '</div>' +
  '<div class="grid-3">' +
    list.map(function (e) {
      return '<div class="card" style="cursor:pointer" onclick="location.hash=\'#/engine/' + e.id + '\'">' +
        '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">' +
          '<div><div class="eng-name" style="font-size:15px">' + esc(e.name) + ' ' + sampleBadge(e) + '</div>' +
          '<div class="eng-sub">' + (e.lineage ? esc(e.lineage.primary.model) : '血统未申报') + '</div></div>' +
          '<div style="text-align:right"><div class="elo-num">' + e.elo + '</div>' +
          '<div style="font-size:10px;color:var(--ink-3)">ELO</div></div>' +
        '</div>' +
        '<div class="tag-line" style="margin:11px 0 10px">' +
          '<span class="badge g">G' + e.g + '</span>' +
          '<span class="badge g">HI ' + e.hi + '</span>' +
          trustBadge(e.trust) +
        '</div>' +
        '<div style="font-size:12px;color:var(--ink-3)">' + esc(e.tagline) + '</div>' +
      '</div>';
    }).join('') +
  '</div>';
}

function route() {
  var h = location.hash.replace(/^#\/?/, '') || '';
  var parts = h.split('/');
  var app = $('#app');
  var navKey = parts[0] || 'home';
  var html = '';

  if (navKey === '' || navKey === 'home') { html = renderHome(); navKey = 'home'; }
  else if (navKey === 'ladder') { html = renderLadder(); }
  else if (navKey === 'engines') { html = renderEnginesList(); }
  else if (navKey === 'arena') { html = renderArena(); }
  else if (navKey === 'engine') { html = renderEngine(parts[1]); navKey = 'engines'; }
  else if (navKey === 'replay') { html = renderReplay(); navKey = 'ladder'; }
  else if (navKey === 'rules') { html = renderRules(); }
  else if (navKey === 'submit') { html = renderSubmit(); }
  else if (navKey === 'prompt') { html = renderPrompt(); }
  else { html = '<div class="empty-state">页面不存在</div>'; }

  app.innerHTML = html;

  $$('.nav a').forEach(function (a) {
    a.classList.toggle('on', a.getAttribute('data-k') === navKey);
  });

  if (navKey === 'submit' || parts[0] === 'submit') {
    renderHitTable();
    refreshYaml();
    var pf = $('#pkgFile');
    if (pf) pf.addEventListener('change', function () {
      var o = $('#pkgOut');
      if (this.files && this.files[0]) {
        var f = this.files[0];
        o.innerHTML = '已选择 <b>' + esc(f.name) + '</b>（' + (f.size / 1024 / 1024).toFixed(2) + ' MB）。正式版会在这里显示九项校验结果。';
      }
    });
  }

  if (parts[0] === 'replay') {
    replayInit();
  }

  if (parts[0] === 'arena') {
    arenaInit();
  } else if (ARENA.timer) {
    clearInterval(ARENA.timer);
    ARENA.timer = null;
  }

  window.scrollTo(0, 0);
}

function renderHitTable() {
  var rows = hitRows();
  var body = $('#hitBody');
  if (!body) return;
  body.innerHTML = rows.map(function (r) {
    var lv = LEVELS[r.lv];
    return '<tr><td>' + r.lv + ' ' + lv.name + '</td>' +
      '<td class="mono">' + r.n + '</td>' +
      '<td class="mono">' + lv.weight + '</td>' +
      '<td class="num mono">' + (lv.weight * r.n) + '</td></tr>';
  }).join('') +
  '<tr style="border-top:2px solid var(--line)"><td><b>H1 任务书</b></td><td class="mono">1</td><td class="mono">0</td><td class="num mono">0</td></tr>';
}

window.addEventListener('hashchange', route);
window.addEventListener('DOMContentLoaded', route);
