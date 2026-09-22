# -*- coding: utf-8 -*-
"""Launch the game: serve this folder over http and open it in the browser.

The game is an ES-module web app, so it has to be served over http:// instead of
being opened straight from disk.

Locally:   python start_game.py
On a host: python start_game.py 0.0.0.0 8000      (no browser is opened)
"""
import functools
import http.server
import ipaddress
import os
import socketserver
import sys
import threading
import webbrowser

ROOT = os.path.dirname(os.path.abspath(__file__))
os.chdir(ROOT)


class Server(socketserver.ThreadingTCPServer):
    """Threaded: the browser keeps idle preconnect sockets open, and a
    single-threaded server would block on one of them while the page waits."""
    allow_reuse_address = True
    daemon_threads = True


def serve(host, port):
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
    handler.log_message = lambda *args, **kwargs: None
    return Server((host, port), handler)


def is_local(host):
    if host in ("localhost", ""):
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def main():
    host = sys.argv[1] if len(sys.argv) > 1 else "127.0.0.1"
    wanted = int(sys.argv[2]) if len(sys.argv) > 2 else None

    server = None
    for port in ([wanted] if wanted else range(8765, 8780)):
        try:
            server = serve(host, port)
            break
        except OSError:
            continue
    if server is None:
        raise SystemExit("找不到可用端口,请先关闭占用 %s 的程序。" % (wanted or "8765-8779"))

    shown = "127.0.0.1" if host == "0.0.0.0" else host
    url = "http://%s:%d/index.html" % (shown, server.server_address[1])
    print("熊二的世界 正在运行 ->", url)
    if not is_local(host):
        print("监听 %s,同一网络的设备可以直接访问这个地址。" % host)
    print("按 Ctrl+C 结束游戏服务。")
    if is_local(host):
        threading.Timer(1.0, lambda: webbrowser.open(url)).start()
    with server:
        server.serve_forever()


if __name__ == "__main__":
    main()
