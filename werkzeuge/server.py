import http.server, sys, os
OUT = sys.argv[2]
class H(http.server.SimpleHTTPRequestHandler):
    def do_POST(self):
        n = int(self.headers['Content-Length'])
        with open(os.path.join(OUT, 'planblatt.pdf'), 'wb') as f:
            f.write(self.rfile.read(n))
        self.send_response(200); self.end_headers(); self.wfile.write(b'ok')
os.chdir(sys.argv[1])
http.server.ThreadingHTTPServer(('127.0.0.1', 8765), H).serve_forever()
