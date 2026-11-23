"""Recalcula la política de seguridad (CSP) de index.html.
Ejecutar después de cualquier cambio en los <script> en línea:  python3 tools/update_csp.py"""
import base64, hashlib, re, pathlib
p = pathlib.Path(__file__).resolve().parent.parent / "index.html"
s = p.read_text(encoding="utf-8")
hashes = ["'sha256-%s'" % base64.b64encode(hashlib.sha256(m.encode("utf-8")).digest()).decode()
          for m in re.findall(r"<script>(.*?)</script>", s, flags=re.S)]
SB = "https://gkdayvzuvkygttvptuit.supabase.co"
csp = "; ".join([
    "default-src 'none'",
    "script-src 'self' " + " ".join(hashes),
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    "media-src 'self' data: blob:",
    # Simli (cara realista, prueba de Docencia): señal y vídeo
    f"connect-src 'self' {SB} {SB.replace('https', 'wss')} https://api.simli.ai wss://api.simli.ai https://*.simli.ai wss://*.simli.ai https://*.livekit.cloud wss://*.livekit.cloud",
    "manifest-src 'self'", "worker-src 'self'",
    "base-uri 'none'", "form-action 'self'", "object-src 'none'",
])
tag = f'<meta http-equiv="Content-Security-Policy" content="{csp}">'
s, n = re.subn(r'<meta http-equiv="Content-Security-Policy"[^>]*>', tag, s)
if not n:
    s = s.replace("<head>", "<head>\n" + tag, 1)
p.write_text(s, encoding="utf-8")
print(len(hashes), "scripts en línea;", "actualizada" if n else "añadida")
