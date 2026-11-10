"""Run the frozen app's --self-test. Exit 0 ok, 1 failed, 3 binary missing."""
import argparse
import json
import subprocess
import sys
from pathlib import Path

DEFAULT = {"darwin": "dist/RD-TAM.app/Contents/MacOS/RD-TAM", "win32": "dist/RD-TAM/RD-TAM.exe"}.get(sys.platform, "dist/RD-TAM/RD-TAM")

parser = argparse.ArgumentParser()
parser.add_argument("--binary", default=DEFAULT)
parser.add_argument("--report", default="build/self-test.json")
args = parser.parse_args()

binary, report = Path(args.binary), Path(args.report)
if not binary.exists():
    print(f"Binary not found: {binary}")
    sys.exit(3)
report.parent.mkdir(parents=True, exist_ok=True)
code = subprocess.run([str(binary), "--self-test", "--self-test-report", str(report)], timeout=600).returncode
result = json.loads(report.read_text(encoding="utf-8")) if report.exists() else {}
if code == 0 and all(result.get(key) is True for key in ("ok", "frozen", "browser_bundled")):
    print("Frozen self-test passed")
    sys.exit(0)
print(f"Frozen self-test failed (exit {code}): {result.get('errors', 'no report')}")
sys.exit(1)
