# serve.py - 石堆本地服务器
# 防僵尸：启动前先清理占用 9876 端口的旧进程
import os
import sys
import subprocess
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

PORT = 9876
ROOT = os.path.dirname(os.path.abspath(__file__))


def kill_port_occupants():
    """杀掉所有监听 PORT 的进程（Windows）"""
    try:
        out = subprocess.check_output(
            ["netstat", "-ano"], text=True, errors="ignore"
        )
        pids = set()
        for line in out.splitlines():
            if f":{PORT}" in line and "LISTENING" in line:
                parts = line.split()
                if parts:
                    pids.add(parts[-1])
        me = str(os.getpid())
        for pid in pids:
            if pid != me and pid != "0":
                subprocess.run(
                    ["taskkill", "/PID", pid, "/F"],
                    capture_output=True,
                )
                print(f"killed zombie PID {pid}")
    except Exception as e:
        print(f"cleanup skipped: {e}")


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        # 禁缓存，改完即刷新生效
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass  # 安静


def lan_ip():
    """Best-effort LAN IPv4 for phone testing."""
    import socket
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


if __name__ == "__main__":
    kill_port_occupants()
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"stonepile serving at http://127.0.0.1:{PORT}")
    print(f"phone on same wifi:  http://{lan_ip()}:{PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
