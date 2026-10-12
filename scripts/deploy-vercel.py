#!/usr/bin/env python3
"""
One-shot Vercel deploy for porttwin (run AFTER `vercel` OAuth is reconnected).

Flow: upload every project file via upload_file, then create_deployment with
file references. Avoids the 128KB single-argument limit of --arguments-json.
"""
import json, base64, hashlib, os, subprocess, sys

PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEAM_ID = "team_BgXkpQg04WuMj7ppJagOdhGw"

SKIP_DIRS = {"node_modules", ".next", ".git", ".vercel"}
SKIP_FILES = {"favicon.ico", "tsconfig.tsbuildinfo"}


def vcall(tool, args):
    cmd = ["vercel", "call-tool", "--name", tool,
           "--arguments-json", json.dumps(args)]
    out = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    if out.returncode != 0:
        sys.exit(f"vercel {tool} failed: {out.stderr[:500]}")
    d = json.loads(out.stdout)
    if not d.get("ok"):
        sys.exit(f"vercel {tool} error: {out.stdout[:800]}")
    return d["result"]["content"][0]["text"]


def collect():
    files = []
    for root, dirs, names in os.walk(PROJECT_DIR):
        dirs[:] = sorted(d for d in dirs if d not in SKIP_DIRS)
        for n in sorted(names):
            if n in SKIP_FILES or n.startswith("."):
                if n != ".gitignore":
                    continue
            p = os.path.join(root, n)
            rel = os.path.relpath(p, PROJECT_DIR)
            if rel in SKIP_FILES:
                continue
            with open(p, "rb") as f:
                files.append((rel, f.read()))
    return files


def main():
    files = collect()
    print(f"Uploading {len(files)} files...")
    refs = []
    for rel, data in files:
        args = {
            "teamId": TEAM_ID,
            "contentLength": len(data),
            "xVercelDigest": hashlib.sha1(data).hexdigest(),
            "requestBody": base64.b64encode(data).decode(),
        }
        txt = vcall("upload_file", args)
        # upload_file returns the file sha; parse defensively
        try:
            sha = json.loads(txt).get("sha") or txt.strip().strip('"')
        except Exception:
            sha = txt.strip().strip('"')
        refs.append({"file": rel, "sha": sha, "size": len(data)})
        print(f"  ok {rel} ({len(data)}B)")

    print("Creating production deployment...")
    deploy_args = {
        "teamId": TEAM_ID,
        "requestBody": {
            "name": "porttwin",
            "target": "production",
            "files": refs,
            "projectSettings": {"framework": "nextjs"},
        },
    }
    print(vcall("create_deployment", deploy_args)[:600])


if __name__ == "__main__":
    main()
