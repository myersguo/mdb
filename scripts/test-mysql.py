"""Run integration tests against a disposable, loopback-only MySQL instance."""
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import time

mysql = shutil.which("mysql")
mysqld = shutil.which("mysqld")
if not mysql or not mysqld:
    raise SystemExit("Install MySQL first; mysql and mysqld must be available on PATH.")

base = Path(mysqld).resolve().parent.parent
root = Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix="mdb-test-") as temporary:
    scratch = Path(temporary)
    unix_socket = Path(f"/tmp/mdb-test-{os.getpid()}.sock")
    server = None
    try:
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            port = listener.getsockname()[1]
        initialized = subprocess.run(
            [mysqld, "--no-defaults", "--initialize-insecure", f"--basedir={base}", f"--datadir={scratch / 'data'}"],
            capture_output=True, text=True,
        )
        if initialized.returncode:
            raise RuntimeError(initialized.stderr)
        server = subprocess.Popen(
            [mysqld, "--no-defaults", f"--basedir={base}", f"--datadir={scratch / 'data'}",
             "--bind-address=127.0.0.1", f"--port={port}", f"--socket={unix_socket}",
             f"--pid-file={scratch / 'mysql.pid'}", f"--log-error={scratch / 'mysql.log'}",
             "--mysqlx=OFF", "--skip-log-bin"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        for _ in range(100):
            if server.poll() is not None:
                raise RuntimeError((scratch / "mysql.log").read_text())
            ready = subprocess.run(
                [mysql, "--no-defaults", "--protocol=tcp", "-h127.0.0.1", f"-P{port}", "-uroot", "-e", "SELECT 1"],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
            if ready.returncode == 0:
                break
            time.sleep(0.2)
        else:
            raise RuntimeError("MySQL did not become ready within 20 seconds")
        print(f"Disposable MySQL ready on 127.0.0.1:{port}", flush=True)
        if "--serve" in sys.argv:
            subprocess.run([mysql, "--no-defaults", "--protocol=tcp", "-h127.0.0.1", f"-P{port}", "-uroot", "-e",
                "CREATE DATABASE mdb_demo; CREATE TABLE mdb_demo.orders (id BIGINT UNSIGNED PRIMARY KEY, customer VARCHAR(100), amount DECIMAL(20,2), status VARCHAR(20), created_at DATETIME); INSERT INTO mdb_demo.orders VALUES (1, '林晓', 1299.00, 'paid', '2026-10-12 09:30:00'), (2, '陈晨', 89.90, 'pending', '2026-10-12 10:15:00'), (18446744073709551615, '测试用户', 9999999999999999.99, NULL, '2026-10-12 11:00:00');"], check=True)
            input("UI test server: user=root, password empty, database=mdb_demo, TLS off. Press Enter to stop.\n")
            raise SystemExit(0)
        result = subprocess.run(
            ["cargo", "test", "--manifest-path", "src-tauri/Cargo.toml", "--lib", "mysql_integration", "--", "--ignored", "--nocapture"],
            cwd=root, env={**os.environ, "MDB_TEST_MYSQL_PORT": str(port)},
        )
        raise SystemExit(result.returncode)
    finally:
        if server is not None and server.poll() is None:
            server.terminate()
            try:
                server.wait(timeout=10)
            except subprocess.TimeoutExpired:
                server.kill()
                server.wait()
        for path in (unix_socket, Path(f"{unix_socket}.lock")):
            path.unlink(missing_ok=True)
