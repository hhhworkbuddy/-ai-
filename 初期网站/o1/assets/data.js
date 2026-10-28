/* Go9 Agent Arena 演示数据
 * 规则口径对齐《9路围棋程序迭代开发任务书》（2026-10-26 修订版）
 * 9路 / 黑贴7.5目 / 每手3秒 / 500手上限 / PSK / 禁自杀 / GNU Go 3.8 裁决死活
 *
 * 示例引擎只保留三个，均来自本地 ZGo_Arena 项目：minmaxgo9、go9x9、ZGo_final。
 * 血统字段一律未申报，不虚构模型与渠道。
 */

const SAMPLE_NOTICE = '榜上这三个是示例引擎，只用来演示界面与流程，不代表任何可信度，也不参与正式排名，不会与真实提交的作品对战。等真实引擎上传后，它们会自动退到「示例」分区。';

const BUDGET_MODES = { sims: '模拟次数', depth: '搜索深度', time: '纯时间控制' };

const RULES = {
  board: 9,
  komi: 7.5,
  maxMoves: 500,
  moveTime: 5,
  passEnd: 2,
  superko: '位置超级劫（PSK）',
  suicide: '禁止自杀',
  scoring: '中国规则数子法，提子数不计',
  judge: 'GNU Go 3.8（--chinese-rules --komi 7.5 --positional-superko）',
  seedRule: '轮次 × 1000 + 局号',
  advance: 'BO10 至少 9 胜',
  advanceDetail: '9:1 或 10:0 才算晋级',
  eloBase: 1000,
  eloK: 32
};

const TRACKS = [
  { key: 'g1',  label: 'G1',    name: '一代成型', desc: '零迭代，一次写对' },
  { key: 'g2',  label: 'G2',    name: '二代',     desc: '一次修正' },
  { key: 'g3',  label: 'G3',    name: '三代',     desc: '两次修正' },
  { key: 'g4',  label: 'G4',    name: '四代',     desc: '三次修正' },
  { key: 'g5',  label: 'G5',    name: '五代',     desc: '四次修正' },
  { key: 'g6',  label: 'G6-8',  name: '六至八代', desc: '进入长迭代区间' },
  { key: 'g9',  label: 'G9-12', name: '九至十二代', desc: '边际收益明显衰减' },
  { key: 'g13', label: 'G13+',  name: '十三代以上', desc: '高代际，单独观察' }
];

const LEVELS = {
  H1: { name: '初始任务书', weight: 0,  hint: '组委会统一下发，所有参赛者完全相同，不计分' },
  H2: { name: '继续指令',   weight: 1,  hint: '只推动流程，不含任何技术信息' },
  H3: { name: '方向级提示', weight: 3,  hint: '指出问题域，但不给解法' },
  H4: { name: '方案级提示', weight: 8,  hint: '给出算法、结构或参数方向' },
  H5: { name: '代码级干预', weight: 20, hint: '给伪代码、代码片段，或亲手改文件' }
};

const CHANNELS = {
  official: '官方渠道',
  partner:  '云厂商代理',
  relay:    '第三方中转',
  local:    '本地部署'
};

/* 只有三个示例引擎，血统未申报 */
const ENGINES = [
  {
    id: 'go9x9',
    name: 'go9x9',
    fullName: 'ZGo_go9x9',
    version: '1.0.0',
    elo: 1088,
    games: 12, wins: 4, losses: 8,
    g: 1, hi: 0,
    trust: 'declared',
    tagline: 'Go 语言实现，一次成型未再迭代',
    sample: true,
    budget: { mode: 'sims', value: 800, avgTime: 0.4, limit: 5.0, note: '固定 800 次模拟就停，5 秒预算只用了 8%，剩下 4.6 秒白白扔掉' },
    claims: { rulesPassed: true, passLevel1: true,  bo10: '7:3', gnugo1: '6:4', gnugo5: '2:8' },
    actual: { rulesPassed: true, passLevel1: false, bo10: '5:5', gnugo1: '3:7', gnugo5: '1:9' },
    lineage: null,
    lineageNote: '示例引擎，血统未申报。正式提交须填写主模型、版本标识、渠道与 Agent 框架。',
    gens: [
      { g: 1, at: '2026-10-22 08:15', summary: '启发式落子加一步搜索，写完即提交', vsBaseline: 0.35, moves: 138, delta: '+640 / -0', key: ['启发式评估', '一步搜索', 'GTP 适配'] }
    ],
    interventions: [],
    matches: []
  },
  {
    id: 'minmaxgo9',
    name: 'minmaxgo9',
    fullName: 'ZGo_minmaxgo9',
    version: '2.1.0',
    elo: 1268,
    games: 20, wins: 11, losses: 9,
    g: 2, hi: 0,
    trust: 'declared',
    tagline: 'Alpha-Beta 搜索，两代零干预',
    sample: true,
    budget: { mode: 'depth', value: 6, avgTime: 1.8, limit: 5.0, note: '固定 6 层搜索，不随时间伸缩，只用了 36%' },
    claims: { rulesPassed: true, passLevel1: true,  bo10: '9:1', gnugo1: '7:3', gnugo5: '3:7' },
    actual: { rulesPassed: true, passLevel1: true,  bo10: '8:2', gnugo1: '6:4', gnugo5: '4:6' },
    lineage: null,
    lineageNote: '示例引擎，血统未申报。正式提交须填写主模型、版本标识、渠道与 Agent 框架。',
    gens: [
      { g: 1, at: '2026-10-21 16:40', summary: 'Alpha-Beta 加静态评估，深度 4', vsBaseline: 0.40, moves: 132, delta: '+520 / -0',  key: ['Alpha-Beta', '静态评估'] },
      { g: 2, at: '2026-10-21 23:05', summary: '加深到 6 层，加入杀手着法排序', vsBaseline: 0.65, moves: 118, delta: '+188 / -26', key: ['深度 6', '着法排序'] }
    ],
    interventions: [],
    matches: [
      { id: 'm1', black: 'minmaxgo9', white: 'go9x9', result: 'B+3.5', moves: 112, at: '2026-10-22 16:30', track: 'g1' }
    ]
  },
  {
    id: 'zfinal',
    name: 'ZGo_final',
    fullName: 'ZGo_final',
    version: '3.0.0',
    elo: 1182,
    games: 16, wins: 7, losses: 9,
    g: 3, hi: 3,
    trust: 'declared',
    tagline: '三代迭代，中途被推过一次',
    sample: true,
    budget: { mode: 'sims', value: 2000, avgTime: 2.6, limit: 5.0, note: '每手 2000 次模拟，用了约 52%，还有富余' },
    claims: { rulesPassed: true, passLevel1: true,  bo10: '9:1', gnugo1: '6:4', gnugo5: '2:8' },
    actual: { rulesPassed: true, passLevel1: false, bo10: '7:3', gnugo1: '5:5', gnugo5: '2:8' },
    lineage: null,
    lineageNote: '示例引擎，血统未申报。正式提交须填写主模型、版本标识、渠道与 Agent 框架。',
    gens: [
      { g: 1, at: '2026-10-20 13:00', summary: '基础搜索与规则库', vsBaseline: 0.32, moves: 136, delta: '+420 / -0',  key: ['规则库', '基础搜索'] },
      { g: 2, at: '2026-10-20 19:30', summary: '加评估与着法排序', vsBaseline: 0.55, moves: 124, delta: '+240 / -60', key: ['评估', '着法排序'] },
      { g: 3, at: '2026-10-21 10:10', summary: '修官子收束与超时兜底', vsBaseline: 0.68, moves: 116, delta: '+180 / -32', key: ['官子', '超时兜底'] }
    ],
    interventions: [
      { seq: 2, level: 'H3', at: '2026-10-21 09:20', trigger: 'AI 报告后半盘总被逆转，无法定位原因', input: '你自己把输的棋谱拉出来看看，问题出在哪一段', reason: '指出问题域但未给具体解法，判 H3' }
    ],
    matches: [
      { id: 'm2', black: 'ZGo_final', white: 'go9x9', result: 'B+2.5', moves: 120, at: '2026-10-22 10:12', track: 'g2' },
      { id: 'm3', black: 'minmaxgo9', white: 'ZGo_final', result: 'B+1.5', moves: 124, at: '2026-10-23 15:02', track: 'overall' }
    ]
  }
];

/* 一盘用于回放的示例对局（9 路，GTP 坐标，黑先，已逐手校验合法） */
const SAMPLE_GAME = {
  id: 'demo-1',
  black: 'ZGo_final',
  white: 'minmaxgo9',
  result: 'W+R',
  komi: 7.5,
  date: '2026-10-23 15:02',
  note: '示例局面，前 30 手',
  moves: [
    'E5', 'C3', 'G7', 'G3', 'C7', 'E3', 'E7', 'C5', 'G5', 'D7',
    'C6', 'F6', 'E6', 'D3', 'F3', 'B5', 'H6', 'D5', 'F5', 'B3',
    'H4', 'E4', 'F4', 'D4', 'E2', 'C4', 'G4', 'B4', 'H8', 'E8'
  ]
};

const SUMMARY = {
  engines: ENGINES.length,
  matchesPlayed: 3,
  totalGenerations: ENGINES.reduce(function (s, e) { return s + e.g; }, 0),
  season: '2026 赛季 S1',
  deadline: '2026-11-18 23:59'
};
