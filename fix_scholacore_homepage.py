"""
Replace the stale Phase 1 placeholder homepage with real navigation links
to student-signup, teacher-vetting, teacher-portal, admin-dashboard.

All of Phase 2 and Phase 3 have been confirmed live on GitHub already --
index.html was just never updated to link to any of it, so the site
appeared stuck on the Phase 1 placeholder text.

Run on your Windows machine with the repo already cloned.
"""
import base64, os, subprocess, sys

DEFAULT_REPO = r"C:\\Users\\Bosslady\\SCHOLACORE\\scholacore"

FILE_REL = "index.html"
FILE_B64 = 'PCFET0NUWVBFIGh0bWw+CjxodG1sIGxhbmc9ImVuIj4KPGhlYWQ+CiAgPG1ldGEgY2hhcnNldD0iVVRGLTgiIC8+CiAgPG1ldGEgbmFtZT0idmlld3BvcnQiIGNvbnRlbnQ9IndpZHRoPWRldmljZS13aWR0aCwgaW5pdGlhbC1zY2FsZT0xLjAiIC8+CiAgPHRpdGxlPlNjaG9sYUNvcmU8L3RpdGxlPgogIDxzY3JpcHQgc3JjPSJodHRwczovL3RlbGVncmFtLm9yZy9qcy90ZWxlZ3JhbS13ZWItYXBwLmpzIj48L3NjcmlwdD4KICA8bGluayByZWw9InN0eWxlc2hlZXQiIGhyZWY9Ii9zcmMvc3R5bGUuY3NzIiAvPgo8L2hlYWQ+Cjxib2R5PgogIDxoZWFkZXIgY2xhc3M9ImJnLXdoaXRlIGJvcmRlci1iLTIgYm9yZGVyLXNjLWJsdWUgcHgtNiBweS00Ij4KICAgIDxzcGFuIGNsYXNzPSJ0ZXh0LXNjLWJsdWUtZGFyayBmb250LWJvbGQgdGV4dC14bCI+U2Nob2xhQ29yZTwvc3Bhbj4KICA8L2hlYWRlcj4KCiAgPG1haW4+CiAgICA8ZGl2IGNsYXNzPSJzYy1jYXJkIHNjLWNhcmQtLXdpZGUiPgogICAgICA8aDEgY2xhc3M9InRleHQteGwgZm9udC1ib2xkIHRleHQtc2MtYmx1ZS1kYXJrIG1iLTEiPldlbGNvbWUgdG8gU2Nob2xhQ29yZTwvaDE+CiAgICAgIDxwIGNsYXNzPSJ0ZXh0LXNsYXRlLTYwMCBtYi00Ij5DaG9vc2Ugd2hlcmUgeW91J2QgbGlrZSB0byBnby48L3A+CgogICAgICA8ZGl2IGNsYXNzPSJncmlkIGdhcC0zIj4KICAgICAgICA8YSBocmVmPSIvc3R1ZGVudC1zaWdudXAuaHRtbCIgY2xhc3M9InNjLWJ0biI+SSdtIGEgU3R1ZGVudDwvYT4KICAgICAgICA8YSBocmVmPSIvdGVhY2hlci12ZXR0aW5nLmh0bWwiIGNsYXNzPSJzYy1idG4gc2MtYnRuLS1zZWNvbmRhcnkiPkFwcGx5IGFzIGEgVGVhY2hlcjwvYT4KICAgICAgICA8YSBocmVmPSIvdGVhY2hlci1wb3J0YWwuaHRtbCIgY2xhc3M9InNjLWJ0biBzYy1idG4tLXNlY29uZGFyeSI+VGVhY2hlciBQb3J0YWwgKGFscmVhZHkgYXBwcm92ZWQpPC9hPgogICAgICAgIDxhIGhyZWY9Ii9hZG1pbi1kYXNoYm9hcmQuaHRtbCIgY2xhc3M9InNjLWJ0biBzYy1idG4tLXNlY29uZGFyeSI+QWRtaW4gRGFzaGJvYXJkPC9hPgogICAgICA8L2Rpdj4KICAgIDwvZGl2PgogIDwvbWFpbj4KCiAgPGZvb3RlciBjbGFzcz0idGV4dC1jZW50ZXIgdGV4dC1zbGF0ZS01MDAgdGV4dC1zbSBwLTYiPgogICAgPGEgaHJlZj0iL3ByaXZhY3ktcG9saWN5Lmh0bWwiIGNsYXNzPSJ0ZXh0LXNjLWJsdWUtZGFyayI+UHJpdmFjeSBQb2xpY3k8L2E+IMK3CiAgICA8YSBocmVmPSIvdGVybXMtb2Ytc2VydmljZS5odG1sIiBjbGFzcz0idGV4dC1zYy1ibHVlLWRhcmsiPlRlcm1zIG9mIFNlcnZpY2U8L2E+CiAgPC9mb290ZXI+CgogIDxzY3JpcHQgdHlwZT0ibW9kdWxlIiBzcmM9Ii9zcmMvbWFpbi50cyI+PC9zY3JpcHQ+CjwvYm9keT4KPC9odG1sPgo='


def run(cmd, cwd):
    print(">", " ".join(cmd))
    result = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)
    if result.stdout.strip():
        print(result.stdout)
    if result.returncode != 0 and result.stderr.strip():
        print(result.stderr)
    return result.returncode == 0


def main():
    repo_root = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_REPO
    if not os.path.isdir(repo_root):
        print(f"Repo path not found: {repo_root}")
        sys.exit(1)
    if not os.path.isdir(os.path.join(repo_root, ".git")):
        print(f"{repo_root} is not a git repository (no .git folder). Aborting.")
        sys.exit(1)

    dest = os.path.join(repo_root, FILE_REL)
    with open(dest, "wb") as f:
        f.write(base64.b64decode(FILE_B64))
    print(f"wrote: {FILE_REL}")

    run(["git", "add", FILE_REL], repo_root)
    commit_msg = "Replace stale Phase 1 homepage placeholder with real navigation to all pages"
    if not run(["git", "commit", "-m", commit_msg], repo_root):
        print("Nothing to commit or commit failed -- check output above.")
        sys.exit(1)
    run(["git", "push", "origin", "main"], repo_root)


if __name__ == "__main__":
    main()
