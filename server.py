#!/usr/bin/env python3
# Minimal static server that chdir's to an absolute path BEFORE touching os.getcwd(),
# avoiding the sandbox cwd PermissionError that `python -m http.server --directory` hits.
import http.server
import socketserver
import os

ROOT = "/Users/marissafamularo/Desktop/CoworkProjects/Kids Games/space-sim"
os.chdir(ROOT)

PORT = 8011
Handler = http.server.SimpleHTTPRequestHandler

socketserver.TCPServer.allow_reuse_address = True
# Bind 0.0.0.0 (all interfaces) so other devices on the same Wi-Fi can reach it, not just
# this Mac. To go back to local-only, change "0.0.0.0" to "127.0.0.1".
with socketserver.TCPServer(("0.0.0.0", PORT), Handler) as httpd:
    lan_ip = ""
    try:
        import subprocess
        lan_ip = subprocess.run(["ipconfig", "getifaddr", "en0"], capture_output=True, text=True).stdout.strip()
    except Exception:
        pass
    print(f"serving {ROOT} on http://localhost:{PORT}" + (f"  |  from other devices: http://{lan_ip}:{PORT}" if lan_ip else ""))
    httpd.serve_forever()
