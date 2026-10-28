# -*- coding: utf-8 -*-
"""Go9 Agent Arena · 本地服务

提供三件事：
  1. 引擎注册与上传（GTP 握手校验）
  2. 引擎对局与循环赛（规则按《9路围棋程序迭代开发任务书》锁定）
  3. Elo 等级分持久化

规则口径：9 路 / 黑贴 7.5 目 / 每手 3 秒 / 500 手上限 / 双方连续两次弃权终局
终局计分：GNU Go 3.8 裁决死子，再按数子法算分（不采信引擎自报）

启动：python server.py
"""
import json
import os
import re
import subprocess
import sys
import threading
import time
import uuid
import zipfile

from flask import Flask, jsonify, request, send_from_directory

# ------------------------------------------------------------------ 路径
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ENGINES_DIR = os.path.join(BASE_DIR, "engines")
DATA_DIR = os.path.join(BASE_DIR, "data")
CONFIG_PATH = os.path.join(BASE_DIR, "engines.json")
RATINGS_PATH = os.path.join(DATA_DIR, "ratings.json")
GNUGO_PATH = os.path.join(BASE_DIR, "bin", "gnugo-3.8", "gnugo.exe")
PORT = int(os.environ.get("PORT", "8770"))

COLUMNS = "ABCDEFGHJKLMNOPQRSTUVWXYZ"

# 任务书锁定参数，不提供修改入口
SETTINGS = {
    "board_size": 9,
    "komi": 7.5,
    "max_moves": 500,
    "move_time": 5.0,
    "elo_k": 32,
    "initial_elo": 1000,
}

app = Flask(__name__, static_folder=None)


# ------------------------------------------------------------------ 工具
def ensure_dirs():
    for d in (ENGINES_DIR, DATA_DIR):
        if not os.path.isdir(d):
            os.makedirs(d)


def load_json(path, default):
    if not os.path.isfile(path):
        return default
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return default


def save_json(path, data):
    """临时文件 + 原子替换，避免写坏配置"""
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


# ------------------------------------------------------------------ GTP
class EngineError(Exception):
    pass


def friendly(msg):
    low = (msg or "").lower()
    if "illegal move" in low or "occupied" in low:
        return "这里不能落子（已占或违规）"
    if "unacceptable" in low:
        return "引擎不接受该参数"
    return "引擎返回错误：" + (msg or "未知")


class GtpEngine(object):
    """一个 GTP 引擎子进程"""

    def __init__(self, cfg, timeout=None):
        self.cfg = cfg
        self.timeout = timeout or SETTINGS["move_time"] + 2.0
        self.proc = None
        self.lock = threading.RLock()
        self.start()

    def start(self):
        path = self.cfg.get("path", "")
        if not path or not os.path.isfile(path):
            raise EngineError("找不到引擎文件：%s" % (path or self.cfg.get("name")))
        args = list(self.cfg.get("args") or ["--mode", "gtp"])
        # .py 引擎需要解释器
        if path.lower().endswith(".py"):
            exe = [sys.executable, path] + args
        else:
            exe = [path] + args
        cwd = self.cfg.get("cwd") or os.path.dirname(path)
        self.proc = subprocess.Popen(
            exe, cwd=cwd,
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            bufsize=0,
        )

    def alive(self):
        return self.proc is not None and self.proc.poll() is None

    def close(self):
        proc, self.proc = self.proc, None
        if proc is None:
            return
        try:
            proc.stdin.write(b"quit\n")
            proc.stdin.flush()
            proc.wait(timeout=2)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass

    def command(self, cmd):
        with self.lock:
            proc = self.proc
            if proc is None:
                raise EngineError("引擎未启动")
            if proc.poll() is not None:
                raise EngineError("引擎进程已退出：%s" % self.cfg.get("name"))
            try:
                proc.stdin.write((cmd + "\n").encode("utf-8"))
                proc.stdin.flush()
            except Exception as exc:
                raise EngineError("无法发送指令：%s" % exc)

            lines, deadline = [], time.time() + self.timeout
            while True:
                if time.time() > deadline:
                    raise EngineError("引擎响应超时（%s）" % self.cfg.get("name"))
                raw = proc.stdout.readline()
                if not raw:
                    raise EngineError("引擎意外退出：%s" % self.cfg.get("name"))
                text = raw.decode("utf-8", "replace").rstrip("\r\n")
                if text == "":
                    break
                lines.append(text)

        status, idx = None, None
        for i, line in enumerate(lines):
            s = line.strip()
            if s.startswith("=") or s.startswith("?"):
                status, idx = s, i
                break
        if status is None:
            raise EngineError("引擎没有返回有效响应：%s" % self.cfg.get("name"))
        if status.startswith("?"):
            raise EngineError(friendly(status[1:].strip()))
        rest = [l for l in lines[idx + 1:] if not l.strip().startswith("#")]
        return status[1:].strip(), rest


# ------------------------------------------------------------------ 裁判
def judge(path=None):
    return GtpEngine({
        "name": "GNU Go 3.8",
        "path": path or GNUGO_PATH,
        "args": ["--mode", "gtp"],
        "cwd": os.path.dirname(path or GNUGO_PATH),
    }, timeout=20)


def replay_and_score(moves, gnugo_path=None):
    """用 GNU Go 重放整局并裁决，返回 'B+3.5' / 'W+2.5' / None"""
    ref = judge(gnugo_path)
    try:
        ref.command("boardsize %d" % SETTINGS["board_size"])
        ref.command("komi %s" % SETTINGS["komi"])
        ref.command("clear_board")
        color = "b"
        for mv in moves:
            ref.command("play %s %s" % (color, mv))
            color = "w" if color == "b" else "b"
        out, _ = ref.command("final_score")
        return (out or "").strip()
    finally:
        ref.close()


# ------------------------------------------------------------------ 对局
class Game(object):
    def __init__(self, black_cfg, white_cfg, gnugo_path=None):
        self.black = black_cfg
        self.white = white_cfg
        self.gnugo = gnugo_path
        self.moves = []
        self.log = []
        self.result = None
        self.reason = ""
        self.started = time.time()

    def run(self):
        eb = ew = None
        try:
            eb = GtpEngine(self.black)
            ew = GtpEngine(self.white)
            for e in (eb, ew):
                e.command("protocol_version")
                e.command("boardsize %d" % SETTINGS["board_size"])
                e.command("komi %s" % SETTINGS["komi"])
                e.command("clear_board")

            color, passes = "b", 0
            cur, opp = eb, ew
            for n in range(SETTINGS["max_moves"]):
                started = time.time()
                mv, _ = cur.command("genmove " + color)
                used = time.time() - started
                mv = (mv or "").strip()
                self.log.append((color, mv, round(used, 2)))

                if used > SETTINGS["move_time"]:
                    self.reason = "%s 超时（%.1fs > 5s）" % (cur.cfg.get("name"), used)
                    self.result = "W+R" if color == "b" else "B+R"
                    return self

                low = mv.lower()
                if low == "resign":
                    self.reason = "%s 认输" % cur.cfg.get("name")
                    self.result = "W+R" if color == "b" else "B+R"
                    return self

                if low == "pass":
                    passes += 1
                    if passes >= 2:
                        self.reason = "双方连续弃权"
                        break
                    opp.command("play %s pass" % color)
                else:
                    if not re.match(r"^[A-HJ][1-9]$", mv.upper()):
                        self.reason = "%s 返回非法坐标 %s" % (cur.cfg.get("name"), mv)
                        self.result = "W+R" if color == "b" else "B+R"
                        return self
                    self.moves.append(mv.upper())
                    try:
                        opp.command("play %s %s" % (color, mv))
                    except EngineError as exc:
                        self.reason = "%s 无法接受落子 %s：%s" % (opp.cfg.get("name"), mv, exc)
                        self.result = "W+R" if color == "b" else "B+R"
                        return self
                    passes = 0

                color = "w" if color == "b" else "b"
                cur, opp = (ew, eb) if color == "w" else (eb, ew)

            scored = replay_and_score(self.moves, self.gnugo)
            self.result = scored or "B+R"
            if not self.reason:
                self.reason = "数子裁决"
            return self

        except EngineError as exc:
            self.reason = str(exc)
            self.result = "B+R" if self.result is None else self.result
            return self
        finally:
            for e in (eb, ew):
                if e:
                    try:
                        e.close()
                    except Exception:
                        pass

    def summary(self):
        bm = len([m for m in self.moves]) if False else None
        return {
            "black": self.black.get("name"),
            "white": self.white.get("name"),
            "result": self.result,
            "reason": self.reason,
            "moves": len(self.moves),
            "seconds": round(time.time() - self.started, 1),
            "sgf_moves": self.moves,
        }


# ------------------------------------------------------------------ 等级分
class Ratings(object):
    def __init__(self, path):
        self.path = path
        self.lock = threading.RLock()
        self.data = load_json(path, {"engines": {}, "updated_at": 0})
        if "engines" not in self.data:
            self.data["engines"] = {}

    def get(self, eid):
        with self.lock:
            return self.data["engines"].get(eid)

    def ensure(self, eid, name):
        with self.lock:
            if eid not in self.data["engines"]:
                self.data["engines"][eid] = {
                    "elo": SETTINGS["initial_elo"], "wins": 0, "losses": 0,
                    "draws": 0, "games": 0, "name": name,
                }
            return self.data["engines"][eid]

    def apply(self, black_id, white_id, result):
        """按 Elo 公式结算一局"""
        with self.lock:
            rb = self.ensure(black_id, black_id)
            rw = self.ensure(white_id, white_id)
            if not result:
                return
            head = result[0].upper()
            sb = 1.0 if head == "B" else 0.0
            eb = 1.0 / (1.0 + 10 ** ((rw["elo"] - rb["elo"]) / 400.0))
            k = SETTINGS["elo_k"]
            rb["elo"] = round(rb["elo"] + k * (sb - eb), 1)
            rw["elo"] = round(rw["elo"] + k * ((1 - sb) - (1 - eb)), 1)
            rb["games"] += 1
            rw["games"] += 1
            if sb == 1:
                rb["wins"] += 1
                rw["losses"] += 1
            else:
                rb["losses"] += 1
                rw["wins"] += 1
            self.data["updated_at"] = int(time.time())
            save_json(self.path, self.data)

    def reset(self):
        with self.lock:
            for eid in list(self.data["engines"].keys()):
                self.data["engines"][eid].update({
                    "elo": SETTINGS["initial_elo"], "wins": 0, "losses": 0,
                    "draws": 0, "games": 0,
                })
            self.data["updated_at"] = int(time.time())
            save_json(self.path, self.data)

    def table(self):
        with self.lock:
            rows = []
            for eid, r in self.data["engines"].items():
                rows.append({"id": eid, "elo": r["elo"], "wins": r["wins"],
                             "losses": r["losses"], "games": r["games"], "name": r.get("name", eid)})
            rows.sort(key=lambda x: -x["elo"])
            return rows


# ------------------------------------------------------------------ 状态
class Arena(object):
    def __init__(self):
        self.lock = threading.Lock()
        self.running = False
        self.done = 0
        self.total = 0
        self.current = ""
        self.log = []
        self.thread = None

    def snapshot(self):
        with self.lock:
            return {"running": self.running, "done": self.done, "total": self.total,
                    "current": self.current, "log": self.log[-40:]}


class AutoScheduler(object):
    """上传后自动进入天梯：把最缺局的引擎两两配对，跑到目标局数"""

    def __init__(self):
        self.thread = None
        self.wake = threading.Event()
        self.enabled = True
        self.target = 6
        self.state = {"last": "", "pair": "", "note": "待命", "busy": False}

    def start(self):
        if self.thread and self.thread.is_alive():
            return
        self.thread = threading.Thread(target=self._loop, daemon=True)
        self.thread.start()

    def kick(self):
        self.wake.set()

    def _loop(self):
        while True:
            self.wake.wait(timeout=20)
            self.wake.clear()
            if not self.enabled:
                self.state["note"] = "自动对战已关闭"
                continue
            if ARENA.snapshot()["running"]:
                self.state["note"] = "手动比赛进行中，自动队列暂停"
                continue
            try:
                self._tick()
            except Exception as exc:
                self.state["note"] = "调度异常：%s" % exc
                self.state["busy"] = False

    def _tick(self):
        engines = load_engines()
        if len(engines) < 2:
            self.state["note"] = "引擎不足两个，等待上传"
            return

        table = {r["id"]: r for r in RATINGS.table()}
        scored = sorted(
            [(table.get(e["id"], {}).get("games", 0), e) for e in engines],
            key=lambda x: x[0]
        )
        if scored[0][0] >= self.target:
            self.state["note"] = "所有引擎已打满 %d 局" % self.target
            return

        a = scored[0][1]
        b = scored[1][1]
        ga = table.get(a["id"], {}).get("games", 0)
        gb = table.get(b["id"], {}).get("games", 0)
        black, white = (a, b) if ga <= gb else (b, a)

        self.state["busy"] = True
        self.state["pair"] = "%s vs %s" % (black["name"], white["name"])
        self.state["note"] = "对局中"
        try:
            game = Game(black, white).run()
            RATINGS.apply(black["id"], white["id"], game.result)
            self.state["last"] = "%s（黑） vs %s（白） → %s · %d 手 · %.1fs" % (
                black["name"], white["name"], game.result, len(game.moves),
                time.time() - game.started)
            self.state["note"] = "已自动完成一局"
            with ARENA.lock:
                ARENA.log.append(game.summary())
        finally:
            self.state["busy"] = False


ensure_dirs()
RATINGS = Ratings(RATINGS_PATH)
ARENA = Arena()
AUTO = AutoScheduler()


def detect_entry(d):
    """在目录里找可执行入口，优先 gnugo 这类具名程序"""
    exes, pys = [], []
    for root, dirs, files in os.walk(d):
        for f in files:
            rel = os.path.relpath(os.path.join(root, f), d)
            low = f.lower()
            if low.endswith(".exe"):
                if "gnugo" in low:
                    return rel
                exes.append(rel)
            elif low.endswith(".py") and not low.startswith(("test_", "setup")):
                pys.append(rel)
    if exes:
        return exes[0]
    if pys:
        return pys[0]
    return ""


def load_engines():
    cfg = load_json(CONFIG_PATH, {"engines": []})
    return cfg.get("engines", [])


def save_engines(engines):
    save_json(CONFIG_PATH, {"settings": SETTINGS, "engines": engines})


def find_engine(eid):
    for e in load_engines():
        if e["id"] == eid:
            return e
    return None


# ------------------------------------------------------------------ 路由
@app.route("/")
def index():
    return send_from_directory(BASE_DIR, "index.html")


@app.route("/assets/<path:p>")
def assets(p):
    return send_from_directory(os.path.join(BASE_DIR, "assets"), p)


@app.route("/api/settings")
def api_settings():
    return jsonify({"settings": SETTINGS, "gnugo": os.path.isfile(GNUGO_PATH)})


@app.route("/api/engines")
def api_engines():
    engines, out = load_engines(), []
    for e in engines:
        r = RATINGS.get(e["id"]) or {}
        out.append({**e, "elo": r.get("elo", SETTINGS["initial_elo"]),
                    "wins": r.get("wins", 0), "losses": r.get("losses", 0),
                    "games": r.get("games", 0)})
    return jsonify({"engines": out})


@app.route("/api/ratings")
def api_ratings():
    return jsonify({"rows": RATINGS.table(), "settings": SETTINGS})


@app.route("/api/engines/upload", methods=["POST"])
def api_upload():
    """接收引擎文件 + 元数据，握手校验后写入配置"""
    if "file" not in request.files:
        return jsonify({"ok": False, "error": "没有收到文件"}), 400
    f = request.files["file"]
    name = (request.form.get("name") or os.path.splitext(f.filename)[0]).strip()
    eid = re.sub(r"[^A-Za-z0-9_\-]", "_", name)[:32] or ("e" + uuid.uuid4().hex[:6])
    if not eid:
        return jsonify({"ok": False, "error": "引擎名不合法"}), 400
    if find_engine(eid):
        return jsonify({"ok": False, "error": "引擎名已被占用：%s" % eid}), 409

    safe = re.sub(r"[^A-Za-z0-9_.\-]", "_", f.filename)
    target_dir = os.path.join(ENGINES_DIR, eid)
    os.makedirs(target_dir, exist_ok=True)
    saved = os.path.join(target_dir, safe)
    f.save(saved)

    entry = (request.form.get("entry") or "").strip()
    path = saved
    if safe.lower().endswith(".zip"):
        try:
            with zipfile.ZipFile(saved) as z:
                z.extractall(target_dir)
            os.remove(saved)
        except Exception as exc:
            return jsonify({"ok": False, "error": "解压失败：%s" % exc}), 400
        if not entry:
            entry = detect_entry(target_dir)
        path = os.path.join(target_dir, entry) if entry else ""

    if not path or not os.path.isfile(path):
        return jsonify({"ok": False, "error": "找不到入口文件：%s" % (entry or safe)}), 400

    args = (request.form.get("args") or "").split()
    if not args:
        args = ["--mode", "gtp"]
    cfg = {"id": eid, "name": name, "path": path, "args": args, "cwd": target_dir,
           "entry": os.path.relpath(path, target_dir), "sample": False,
           "desc": request.form.get("desc", "")}

    # 握手校验
    try:
        eng = GtpEngine(cfg, timeout=12)
        try:
            ver, _ = eng.command("protocol_version")
            eng.command("boardsize 9")
            eng.command("komi 7.5")
            eng.command("clear_board")
            mv, _ = eng.command("genmove b")
        finally:
            eng.close()
        if not re.match(r"^[A-HJ][1-9]$|^pass$", (mv or "").strip(), re.I):
            return jsonify({"ok": False, "error": "握手通过但 genmove 返回异常：%s" % mv}), 400
    except Exception as exc:
        try:
            os.remove(path)
        except Exception:
            pass
        return jsonify({"ok": False, "error": "GTP 握手失败：%s" % exc}), 400

    engines = load_engines()
    engines.append(cfg)
    save_engines(engines)
    RATINGS.ensure(eid, name)
    AUTO.kick()   # 上传即入队，自动开打
    return jsonify({"ok": True, "id": eid, "protocol": ver, "first_move": mv,
                    "message": "已注册 %s，GTP 握手正常，首手 %s。已加入自动对战队列" % (name, mv)})


@app.route("/api/arena/start", methods=["POST"])
def api_arena_start():
    body = request.get_json(silent=True) or {}
    ids = body.get("engines") or [e["id"] for e in load_engines()]
    gpp = max(1, min(20, int(body.get("games_per_pair", 2))))
    if len(ids) < 2:
        return jsonify({"ok": False, "error": "至少需要两个引擎"}), 400
    with ARENA.lock:
        if ARENA.running:
            return jsonify({"ok": False, "error": "已有比赛在跑"}), 409
        pairs = [(a, b) for i, a in enumerate(ids) for b in ids[i + 1:]]
        ARENA.running = True
        ARENA.done = 0
        ARENA.total = len(pairs) * gpp
        ARENA.log = []
        ARENA.current = "准备中"

    def worker():
        try:
            for a, b in pairs:
                for g in range(gpp):
                    black_id, white_id = (a, b) if g % 2 == 0 else (b, a)
                    ca, cb = find_engine(black_id), find_engine(white_id)
                    if not ca or not cb:
                        continue
                    with ARENA.lock:
                        ARENA.current = "%s（黑） vs %s（白）" % (ca["name"], cb["name"])
                    game = Game(ca, cb).run()
                    RATINGS.apply(black_id, white_id, game.result)
                    with ARENA.lock:
                        ARENA.done += 1
                        ARENA.log.append(game.summary())
        finally:
            with ARENA.lock:
                ARENA.running = False
                ARENA.current = "已结束"

    ARENA.thread = threading.Thread(target=worker, daemon=True)
    ARENA.thread.start()
    return jsonify({"ok": True, "total": ARENA.total})


@app.route("/api/arena/state")
def api_arena_state():
    return jsonify(ARENA.snapshot())


@app.route("/api/auto", methods=["GET", "POST"])
def api_auto():
    if request.method == "POST":
        body = request.get_json(silent=True) or {}
        if "enabled" in body:
            AUTO.enabled = bool(body["enabled"])
            if AUTO.enabled:
                AUTO.kick()
        if "target" in body:
            AUTO.target = max(2, min(50, int(body["target"])))
        return jsonify({"ok": True, "enabled": AUTO.enabled, "target": AUTO.target})
    return jsonify({"enabled": AUTO.enabled, "target": AUTO.target, "state": AUTO.state})


@app.route("/api/ratings/reset", methods=["POST"])
def api_reset():
    RATINGS.reset()
    return jsonify({"ok": True})


@app.route("/api/health")
def api_health():
    return jsonify({"ok": True, "gnugo": os.path.isfile(GNUGO_PATH),
                    "engines": len(load_engines()), "settings": SETTINGS})


if __name__ == "__main__":
    print("=" * 56)
    print(" Go9 Agent Arena · 本地服务")
    print(" 规则：9 路 · 贴 7.5 目 · 每手 3 秒 · 500 手上限")
    print(" GNU Go 3.8 裁判：%s" % ("已找到" if os.path.isfile(GNUGO_PATH) else "缺失"))
    print(" http://127.0.0.1:%d/" % PORT)
    print("=" * 56)
    AUTO.start()
    AUTO.kick()
    app.run(host="127.0.0.1", port=PORT, debug=False, threaded=True)
