"""
MeasureAI — Secure HTTPS Server for Desktop & Mobile
Enables camera access across laptops, tablets, and phones on local WiFi.
"""
import http.server
import ssl
import os
import sys
import socket
import datetime

# Fix Windows console encoding issues
if sys.platform == 'win32':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass

PORT = 3333
CERT_FILE = 'server.pem'
KEY_FILE  = 'server.key'

def get_local_ip():
    """Get the machine's local network IP."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return '127.0.0.1'

def generate_cert():
    """Generate a self-signed SSL certificate with SAN (Subject Alternative Name) for localhost & local IP."""
    import ipaddress
    from cryptography import x509
    from cryptography.x509.oid import NameOID
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa

    print("[*] Generating secure SSL certificate for localhost and local IP...")
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    local_ip = get_local_ip()

    subject = issuer = x509.Name([
        x509.NameAttribute(NameOID.COMMON_NAME, 'MeasureAI Local Server'),
        x509.NameAttribute(NameOID.ORGANIZATION_NAME, 'MeasureAI'),
        x509.NameAttribute(NameOID.COUNTRY_NAME, 'US'),
    ])

    # Add SANs so modern browsers on mobile and PC accept the cert
    san_list = [
        x509.DNSName('localhost'),
        x509.IPAddress(ipaddress.IPv4Address('127.0.0.1')),
    ]
    try:
        san_list.append(x509.IPAddress(ipaddress.IPv4Address(local_ip)))
    except Exception:
        pass

    now = datetime.datetime.now(datetime.timezone.utc)
    cert = (x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now)
        .not_valid_after(now + datetime.timedelta(days=365))
        .add_extension(x509.SubjectAlternativeName(san_list), critical=False)
        .sign(key, hashes.SHA256()))

    with open(KEY_FILE, 'wb') as f:
        f.write(key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.TraditionalOpenSSL,
            serialization.NoEncryption()
        ))
    with open(CERT_FILE, 'wb') as f:
        f.write(cert.public_bytes(serialization.Encoding.PEM))

    print("[OK] SSL certificate created successfully (server.pem, server.key).")
    return True

def run_server():
    os.chdir(os.path.dirname(os.path.abspath(__file__)))

    # Ensure certificate exists
    if not (os.path.exists(CERT_FILE) and os.path.exists(KEY_FILE)):
        generate_cert()

    local_ip = get_local_ip()

    class QuietHandler(http.server.SimpleHTTPRequestHandler):
        def log_message(self, format, *args):
            # Clean log line
            sys.stdout.write(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] {args[0]} - {args[1]}\n")

    httpd = http.server.HTTPServer(('0.0.0.0', PORT), QuietHandler)

    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(certfile=CERT_FILE, keyfile=KEY_FILE)
    httpd.socket = context.wrap_socket(httpd.socket, server_side=True)

    print("========================================================", flush=True)
    print("           MeasureAI - Secure HTTPS Server              ", flush=True)
    print("========================================================", flush=True)
    print(f"  Laptop/PC:  https://localhost:{PORT}", flush=True)
    print(f"  Phone:      https://{local_ip}:{PORT}", flush=True)
    print("--------------------------------------------------------", flush=True)
    print("  NOTE FOR MOBILE PHONE BROWSERS:", flush=True)
    print("  Because this uses a self-signed local certificate:", flush=True)
    print("  1. Connect your phone to the same WiFi as this PC.", flush=True)
    print(f"  2. Open https://{local_ip}:{PORT} in Chrome / Safari.", flush=True)
    print("  3. Tap 'Advanced' -> 'Proceed to ... (unsafe)'", flush=True)
    print("  4. Grant Camera permission when prompted.", flush=True)
    print("========================================================", flush=True)
    print("  Press Ctrl+C to stop the server.\n", flush=True)

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n[*] Server stopped.")
        httpd.server_close()

if __name__ == '__main__':
    run_server()
