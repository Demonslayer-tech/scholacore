"""
ScholaCore repo audit fixes.

Found by inspecting github.com/Demonslayer-tech/scholacore directly:

1. api/livekit-token.ts granted LiveKit broadcast rights to role
   'developer', which does not exist anywhere in firestore.rules'
   role model (student, parent, teacher, bursar, principal). Net
   effect: principals could NOT start/host a live class, while a
   role nobody can ever hold was checked for no reason. Fixed to
   check 'principal' instead.

2. Root .env.example (overwritten by an earlier v2-rebuild script)
   listed GROQ_API_KEY etc. but with the WRONG variable names for a
   Vite app -- client-side keys (Paystack public key, LiveKit ws
   url, Firebase web config) need a VITE_ prefix or Vite silently
   drops them from the client bundle. Restored a corrected version
   that matches what api/*.ts and a Vite build actually need.

3. Removed firebase/firestore.rules, firebase/storage.rules, and
   firebase/schema.md -- these were draft files from an earlier
   from-scratch rebuild attempt (3-role model: student/teacher/admin)
   that directly conflict with the real, deployed root firestore.rules
   (5-role model: student/parent/teacher/bursar/principal). Having
   both in the repo risked someone deploying the wrong rules file.

4. Moved fix_scholacore.py, fix_scholacore_full.py, and
   fix_telegram_crash.py out of the repo root into scripts/archive/
   so one-off patch scripts don't clutter the project root.

NOT auto-fixed (flagged for you to check, not guessed at):
- README.md documents Google Gemini as the AI provider; the actual
  code (api/ai-tutor.ts, api/vet-teacher.ts) uses Groq. Docs are stale.
- README.md documents a POST /api/initialize-payment endpoint that
  does not exist anywhere in api/ (confirmed via direct raw fetch,
  404). If any client code still calls it, that payment flow is
  broken in production. I could not find src/ evidence either way
  without you sharing that file -- worth a quick check.

Run this on your Windows machine with the repo cloned already.
"""
import base64, os, subprocess, sys

DEFAULT_REPO = r"C:\Users\Bosslady\SCHOLACORE\scholacore"

WRITE_FILES = {
    '.env.example': 'IyAtLS0gVGVsZWdyYW0gLS0tClRFTEVHUkFNX0JPVF9UT0tFTj0KCiMgLS0tIFBheXN0YWNrIC0tLQpQQVlTVEFDS19TRUNSRVRfS0VZPQojIFB1YmxpYyBrZXkgbXVzdCBiZSBwcmVmaXhlZCBWSVRFXyB0byBiZSByZWFkYWJsZSBieSB0aGUgY2xpZW50IGJ1bmRsZS4KVklURV9QQVlTVEFDS19QVUJMSUNfS0VZPQoKIyAtLS0gR3JvcSAoQUkgU3R1ZHkgTGlicmFyeSArIHRlYWNoZXIgdmV0dGluZykgLS0tCiMgYXBpL2FpLXR1dG9yLnRzIGFuZCBhcGkvdmV0LXRlYWNoZXIudHMgYm90aCByZWFkIEdST1FfQVBJX0tFWS4KIyAoTm90ZTogUkVBRE1FIGN1cnJlbnRseSByZWZlcmVuY2VzIEdlbWluaSDigJQgdGhhdCdzIHN0YWxlOyB0aGUgY29kZSB1c2VzIEdyb3EuKQpHUk9RX0FQSV9LRVk9CgojIC0tLSBMaXZlS2l0IChsaXZlIGNsYXNzcm9vbXMpIC0tLQpMSVZFS0lUX0FQSV9LRVk9CkxJVkVLSVRfQVBJX1NFQ1JFVD0KIyBDbGllbnQgbmVlZHMgdGhlIHdzOi8vIHVybCB0byBjb25uZWN0IOKAlCBtdXN0IGJlIFZJVEVfLXByZWZpeGVkLgpWSVRFX0xJVkVLSVRfV1NfVVJMPQoKIyAtLS0gRmlyZWJhc2UgQWRtaW4gU0RLIChzZXJ2ZXItb25seSwgYXBpL19saWIvZmlyZWJhc2VBZG1pbi50cykgLS0tCiMgUGFzdGUgdGhlIGZ1bGwgc2VydmljZS1hY2NvdW50IEpTT04gYXMgYSBzaW5nbGUtbGluZSBzdHJpbmcuCkZJUkVCQVNFX1NFUlZJQ0VfQUNDT1VOVF9LRVk9CgojIC0tLSBGaXJlYmFzZSBXZWIgKGNsaWVudCBTREspIC0tLQojIFRoZXNlIGFyZSBzYWZlIHRvIGV4cG9zZSB0byB0aGUgYnJvd3NlciwgYnV0IFZpdGUgb25seSBidW5kbGVzIGVudiB2YXJzCiMgcHJlZml4ZWQgd2l0aCBWSVRFXyBpbnRvIGNsaWVudCBjb2RlIOKAlCB1bnByZWZpeGVkIHZlcnNpb25zIGhlcmUgd2lsbCBiZQojIHNpbGVudGx5IHVuZGVmaW5lZCBpbiB0aGUgYnVpbHQgYXBwLgpWSVRFX0ZJUkVCQVNFX0FQSV9LRVk9ClZJVEVfRklSRUJBU0VfQVVUSF9ET01BSU49ClZJVEVfRklSRUJBU0VfUFJPSkVDVF9JRD0KVklURV9GSVJFQkFTRV9TVE9SQUdFX0JVQ0tFVD0KVklURV9GSVJFQkFTRV9NRVNTQUdJTkdfU0VOREVSX0lEPQpWSVRFX0ZJUkVCQVNFX0FQUF9JRD0K',
    'api/livekit-token.ts': 'aW1wb3J0IHR5cGUgeyBWZXJjZWxSZXF1ZXN0LCBWZXJjZWxSZXNwb25zZSB9IGZyb20gJ0B2ZXJjZWwvbm9kZSc7CmltcG9ydCB7IEFjY2Vzc1Rva2VuIH0gZnJvbSAnbGl2ZWtpdC1zZXJ2ZXItc2RrJzsKaW1wb3J0IHsgdmVyaWZ5Q2FsbGVyIH0gZnJvbSAnLi9fbGliL3ZlcmlmeUNhbGxlcic7CmltcG9ydCB7IGdldEFkbWluRmlyZXN0b3JlIH0gZnJvbSAnLi9fbGliL2ZpcmViYXNlQWRtaW4nOwoKaW50ZXJmYWNlIFRva2VuUmVxdWVzdEJvZHkgewogIGNsYXNzSWQ6IHN0cmluZzsKfQoKZnVuY3Rpb24gaXNWYWxpZEJvZHkoYm9keTogdW5rbm93bik6IGJvZHkgaXMgVG9rZW5SZXF1ZXN0Qm9keSB7CiAgaWYgKCFib2R5IHx8IHR5cGVvZiBib2R5ICE9PSAnb2JqZWN0JykgcmV0dXJuIGZhbHNlOwogIHJldHVybiB0eXBlb2YgKGJvZHkgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4pLmNsYXNzSWQgPT09ICdzdHJpbmcnOwp9CgpleHBvcnQgZGVmYXVsdCBhc3luYyBmdW5jdGlvbiBoYW5kbGVyKHJlcTogVmVyY2VsUmVxdWVzdCwgcmVzOiBWZXJjZWxSZXNwb25zZSkgewogIGlmIChyZXEubWV0aG9kICE9PSAnUE9TVCcpIHsKICAgIHJlcy5zZXRIZWFkZXIoJ0FsbG93JywgJ1BPU1QnKTsKICAgIHJldHVybiByZXMuc3RhdHVzKDQwNSkuanNvbih7IGVycm9yOiAnTWV0aG9kIG5vdCBhbGxvd2VkJyB9KTsKICB9CgogIGNvbnN0IGFwaUtleSA9IHByb2Nlc3MuZW52LkxJVkVLSVRfQVBJX0tFWTsKICBjb25zdCBhcGlTZWNyZXQgPSBwcm9jZXNzLmVudi5MSVZFS0lUX0FQSV9TRUNSRVQ7CiAgaWYgKCFhcGlLZXkgfHwgIWFwaVNlY3JldCkgewogICAgY29uc29sZS5lcnJvcignW2xpdmVraXQtdG9rZW5dIE1pc3NpbmcgTElWRUtJVF9BUElfS0VZL0xJVkVLSVRfQVBJX1NFQ1JFVCcpOwogICAgcmV0dXJuIHJlcy5zdGF0dXMoNTAwKS5qc29uKHsgZXJyb3I6ICdMaXZlIGNsYXNzcm9vbSBzZXJ2aWNlIG1pc2NvbmZpZ3VyZWQnIH0pOwogIH0KCiAgY29uc3QgY2FsbGVyID0gYXdhaXQgdmVyaWZ5Q2FsbGVyKHJlcSk7CiAgaWYgKCFjYWxsZXIpIHsKICAgIHJldHVybiByZXMuc3RhdHVzKDQwMSkuanNvbih7IGVycm9yOiAnTm90IHNpZ25lZCBpbicgfSk7CiAgfQoKICBpZiAoIWlzVmFsaWRCb2R5KHJlcS5ib2R5KSkgewogICAgcmV0dXJuIHJlcy5zdGF0dXMoNDAwKS5qc29uKHsgZXJyb3I6ICdJbnZhbGlkIHBheWxvYWQuIFJlcXVpcmVkOiBjbGFzc0lkLicgfSk7CiAgfQoKICBjb25zdCB7IGNsYXNzSWQgfSA9IHJlcS5ib2R5OwoKICB0cnkgewogICAgY29uc3QgZGIgPSBnZXRBZG1pbkZpcmVzdG9yZSgpOwogICAgY29uc3QgdXNlclNuYXAgPSBhd2FpdCBkYi5jb2xsZWN0aW9uKCd1c2VycycpLmRvYyhjYWxsZXIudWlkKS5nZXQoKTsKCiAgICBpZiAoIXVzZXJTbmFwLmV4aXN0cykgewogICAgICByZXR1cm4gcmVzLnN0YXR1cyg0MDQpLmpzb24oeyBlcnJvcjogJ1VzZXIgbm90IGZvdW5kJyB9KTsKICAgIH0KCiAgICBjb25zdCB1c2VyRGF0YSA9IHVzZXJTbmFwLmRhdGEoKSE7CiAgICBjb25zdCBjYW5Ccm9hZGNhc3QgPSB1c2VyRGF0YS5yb2xlID09PSAndGVhY2hlcicgfHwgdXNlckRhdGEucm9sZSA9PT0gJ3ByaW5jaXBhbCc7CgogICAgaWYgKCFjYW5Ccm9hZGNhc3QgJiYgdXNlckRhdGEuY2xhc3NJZCAhPT0gY2xhc3NJZCkgewogICAgICByZXR1cm4gcmVzLnN0YXR1cyg0MDMpLmpzb24oeyBlcnJvcjogJ05vdCBlbnJvbGxlZCBpbiB0aGlzIGNsYXNzJyB9KTsKICAgIH0KCiAgICBjb25zdCByb29tTmFtZSA9IGBjbGFzcy0ke2NsYXNzSWR9YDsKCiAgICBjb25zdCB0b2tlbiA9IG5ldyBBY2Nlc3NUb2tlbihhcGlLZXksIGFwaVNlY3JldCwgewogICAgICBpZGVudGl0eTogY2FsbGVyLnVpZCwKICAgICAgbmFtZTogdXNlckRhdGEubmFtZSA/PyBjYWxsZXIudWlkLAogICAgICB0dGw6ICcxNW0nCiAgICB9KTsKCiAgICB0b2tlbi5hZGRHcmFudCh7CiAgICAgIHJvb206IHJvb21OYW1lLAogICAgICByb29tSm9pbjogdHJ1ZSwKICAgICAgY2FuUHVibGlzaDogY2FuQnJvYWRjYXN0LAogICAgICBjYW5QdWJsaXNoRGF0YTogdHJ1ZSwKICAgICAgY2FuU3Vic2NyaWJlOiB0cnVlCiAgICB9KTsKCiAgICBjb25zdCBqd3QgPSBhd2FpdCB0b2tlbi50b0p3dCgpOwoKICAgIHJldHVybiByZXMuc3RhdHVzKDIwMCkuanNvbih7IHRva2VuOiBqd3QsIHJvb206IHJvb21OYW1lLCBjYW5QdWJsaXNoOiBjYW5Ccm9hZGNhc3QgfSk7CiAgfSBjYXRjaCAoZXJyKSB7CiAgICBjb25zb2xlLmVycm9yKCdbbGl2ZWtpdC10b2tlbl0gRmFpbGVkIHRvIGlzc3VlIHRva2VuJywgZXJyKTsKICAgIHJldHVybiByZXMuc3RhdHVzKDUwMCkuanNvbih7IGVycm9yOiAnVW5hYmxlIHRvIGlzc3VlIGNsYXNzcm9vbSB0b2tlbicgfSk7CiAgfQp9Cg==',
}


REMOVE_FILES = [
    "firebase/firestore.rules",
    "firebase/storage.rules",
    "firebase/schema.md",
]

ARCHIVE_MOVES = {
    "fix_scholacore.py": "scripts/archive/fix_scholacore.py",
    "fix_scholacore_full.py": "scripts/archive/fix_scholacore_full.py",
    "fix_telegram_crash.py": "scripts/archive/fix_telegram_crash.py",
}


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

    changed = []

    for rel_path, b64_content in WRITE_FILES.items():
        dest = os.path.join(repo_root, rel_path.replace("/", os.sep))
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        with open(dest, "wb") as f:
            f.write(base64.b64decode(b64_content))
        changed.append(rel_path)
        print(f"wrote: {rel_path}")

    for rel_path in REMOVE_FILES:
        full = os.path.join(repo_root, rel_path.replace("/", os.sep))
        if os.path.exists(full):
            run(["git", "rm", "-f", rel_path], repo_root)
            changed.append(rel_path)
        else:
            print(f"skip (not present): {rel_path}")

    for src_rel, dest_rel in ARCHIVE_MOVES.items():
        src_full = os.path.join(repo_root, src_rel)
        if os.path.exists(src_full):
            dest_full = os.path.join(repo_root, dest_rel.replace("/", os.sep))
            os.makedirs(os.path.dirname(dest_full), exist_ok=True)
            if run(["git", "mv", src_rel, dest_rel], repo_root):
                changed.append(src_rel)
                changed.append(dest_rel)
        else:
            print(f"skip (not present): {src_rel}")

    if not changed:
        print("Nothing to do.")
        sys.exit(0)

    run(["git", "add", "-A"], repo_root)
    commit_msg = (
        "Fix livekit-token.ts stale 'developer' role check, restore correct "
        ".env.example (VITE_ prefixes), remove conflicting v2-draft firebase "
        "rules, archive one-off fix scripts"
    )
    if not run(["git", "commit", "-m", commit_msg], repo_root):
        print("Nothing to commit or commit failed -- check output above.")
        sys.exit(1)
    run(["git", "push", "origin", "main"], repo_root)


if __name__ == "__main__":
    main()
