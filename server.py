import json
import os
import re
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

PHRASES = ["Oh my", "Alright", "Ask me why", "Technically speaking"]
DATA_FILE = os.environ.get("DATA_FILE", "/data/counts.json")
PORT = int(os.environ.get("PORT", "3020"))
PUBLIC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "public")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

lock = threading.Lock()


def load():
    try:
        with open(DATA_FILE) as f:
            return json.load(f)
    except FileNotFoundError:
        return {}


def save(data):
    tmp = DATA_FILE + ".tmp"
    with open(tmp, "w") as f:
        json.dump(data, f, indent=1, sort_keys=True)
    os.replace(tmp, DATA_FILE)


def day_counts(data, date):
    day = data.get(date, {})
    return {p: day.get(p, 0) for p in PHRASES}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=PUBLIC, **kwargs)

    def send_json(self, status, body):
        raw = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        if self.path.startswith("/api/day/"):
            date = self.path[len("/api/day/"):]
            if not DATE_RE.match(date):
                return self.send_json(400, {"error": "bad date"})
            with lock:
                return self.send_json(200, day_counts(load(), date))
        if self.path in ("/sw.js", "/", "/index.html"):
            self.no_cache = True
        super().do_GET()

    def end_headers(self):
        if getattr(self, "no_cache", False):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def do_POST(self):
        if self.path != "/api/ops":
            return self.send_json(404, {"error": "not found"})
        try:
            length = int(self.headers.get("Content-Length", 0))
            ops = json.loads(self.rfile.read(length))["ops"]
        except (ValueError, KeyError, TypeError):
            return self.send_json(400, {"error": "bad body"})
        with lock:
            data = load()
            for op in ops:
                date, phrase, delta = op.get("date"), op.get("phrase"), op.get("delta")
                if not (isinstance(date, str) and DATE_RE.match(date)) or phrase not in PHRASES or delta not in (1, -1):
                    continue
                day = data.setdefault(date, {})
                day[phrase] = max(0, day.get(phrase, 0) + delta)
            save(data)
            dates = {op.get("date") for op in ops if isinstance(op.get("date"), str) and DATE_RE.match(op["date"])}
            return self.send_json(200, {d: day_counts(data, d) for d in dates})

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    os.makedirs(os.path.dirname(DATA_FILE), exist_ok=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
