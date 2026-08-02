#!/usr/bin/env python3
"""
ScholaCore: stop Telegram from caching a stale index.html.

Writes vercel.json (new file), then runs git add / commit / push
automatically.

Run with:
    python fix_vercel_cache.py

If your project folder isn't at the path below, edit PROJECT_DIR first.
"""
import subprocess
import sys
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8")
except AttributeError:
    pass

PROJECT_DIR = Path(r"C:\Users\Bosslady\SCHOLACORE\scholacore")

VERCEL_JSON = r'''{
  "headers": [
    {
      "source": "/",
      "headers": [
        {
          "key": "Cache-Control",
          "value": "no-cache, no-store, must-revalidate"
        }
      ]
    },
    {
      "source": "/index.html",
      "headers": [
        {
          "key": "Cache-Control",
          "value": "no-cache, no-store, must-revalidate"
        }
      ]
    },
    {
      "source": "/assets/(.*)",
      "headers": [
        {
          "key": "Cache-Control",
          "value": "public, max-age=31536000, immutable"
        }
      ]
    }
  ]
}
'''

FILES = {
    PROJECT_DIR / "vercel.json": VERCEL_JSON,
}


def write_files():
    print("== Writing files ==")
    for path, content in FILES.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        print("  wrote " + str(path.relative_to(PROJECT_DIR)))


def run_git(args, allow_fail_msg=None):
    result = subprocess.run(
        ["git"] + args, cwd=str(PROJECT_DIR), capture_output=True, text=True
    )
    output = (result.stdout + result.stderr).strip()
    if output:
        print(output)
    if result.returncode != 0 and allow_fail_msg:
        print("  (ok - " + allow_fail_msg + ")")
    return result.returncode


def main():
    if not PROJECT_DIR.exists():
        print("ERROR: " + str(PROJECT_DIR) + " does not exist.")
        print("Edit PROJECT_DIR at the top of this script to match your actual folder, then re-run.")
        sys.exit(1)

    if not (PROJECT_DIR / ".git").exists():
        print("ERROR: " + str(PROJECT_DIR) + " is not a git repo (no .git folder found).")
        sys.exit(1)

    write_files()

    print("\n== git add ==")
    run_git(["add", "-A"])

    print("\n== git commit ==")
    run_git(
        ["commit", "-m", "Add vercel.json to stop index.html from being cached"],
        allow_fail_msg="nothing new to commit, files already matched",
    )

    print("\n== git push ==")
    code = run_git(["push"])
    if code != 0:
        print("\ngit push reported an error above (auth prompt needed? no upstream set?).")
        print("Everything else is done - just run 'git push' yourself to finish.")
        sys.exit(1)

    print("\nDone. Vercel should auto-redeploy in about 1-2 minutes.")
    print("\nAfter it redeploys, this alone won't clear what Telegram ALREADY")
    print("cached on your phone - the new no-cache header only prevents FUTURE")
    print("staleness. To clear what's already cached right now:")
    print("  iOS: Settings app -> Telegram -> uninstall and reinstall, OR")
    print("       Telegram app -> Settings -> Data and Storage -> Storage Usage")
    print("       -> Clear Cache")
    print("  Fastest way to actually SEE what's happening: open web.telegram.org")
    print("  in a desktop browser, open the same mini app from there, and check")
    print("  the Network tab (F12) for any request showing a red/404 status.")
    print("  That's real devtools access while still inside a real Telegram")
    print("  session, unlike testing the bare URL outside Telegram.")


if __name__ == "__main__":
    main()
