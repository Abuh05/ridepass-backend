"""
Word Error Rate benchmark for the N-ATLAS ASR models — produces the "real-world validation"
numbers for the NAIC submission.

Layout:
  <data>/<lang>/manifest.csv  (file,reference)  or  <data>/<lang>/pending_labels.csv (file,asr_hypothesis,reference)
  <data>/<lang>/<file>        audio from riders who opted in (the app saves these to app/data/benchmark/)
Label: a native speaker listens to each clip and types exactly what was said into the `reference` column.
Run:
  python benchmark/wer.py --url http://GPU_HOST:9000 --token $MODEL_SERVICE_TOKEN --data ../app/data/benchmark
Writes benchmark/results.csv and prints WER per language.
"""
import argparse, csv, os, re, sys, unicodedata, urllib.request, uuid, json


def normalise(s: str) -> list[str]:
    s = unicodedata.normalize("NFC", s.lower())
    s = re.sub(r"[^\w\s₦]", " ", s)
    return s.split()


def wer(ref: list[str], hyp: list[str]) -> tuple[int, int]:
    d = list(range(len(hyp) + 1))
    for i, r in enumerate(ref, 1):
        prev, d[0] = d[0], i
        for j, h in enumerate(hyp, 1):
            cur = min(d[j] + 1, d[j - 1] + 1, prev + (r != h))
            prev, d[j] = d[j], cur
    return d[len(hyp)], len(ref)


def transcribe(url, token, path, lang):
    boundary = uuid.uuid4().hex
    with open(path, "rb") as f:
        audio = f.read()
    body = (
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"language\"\r\n\r\n{lang}\r\n"
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{os.path.basename(path)}\"\r\n"
        f"Content-Type: application/octet-stream\r\n\r\n"
    ).encode() + audio + f"\r\n--{boundary}--\r\n".encode()
    req = urllib.request.Request(f"{url}/asr", data=body, method="POST", headers={
        "Content-Type": f"multipart/form-data; boundary={boundary}",
        "Authorization": f"Bearer {token}",
    })
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", required=True)
    ap.add_argument("--token", default=os.environ.get("MODEL_SERVICE_TOKEN", ""))
    ap.add_argument("--data", default=os.path.join(os.path.dirname(__file__), "data"))
    a = ap.parse_args()
    rows, totals = [], {}
    for lang in sorted(os.listdir(a.data)):
        man = os.path.join(a.data, lang, "manifest.csv")
        if not os.path.exists(man):
            man = os.path.join(a.data, lang, "pending_labels.csv")  # written by the app for opted-in riders
        if not os.path.exists(man):
            continue
        with open(man, encoding="utf-8") as f:
            for rec in csv.DictReader(f):
                if not (rec.get("reference") or "").strip():
                    continue  # not labelled yet
                res = transcribe(a.url, a.token, os.path.join(a.data, lang, rec["file"]), lang)
                e, n = wer(normalise(rec["reference"]), normalise(res["text"]))
                t = totals.setdefault(lang, [0, 0, 0, 0])
                t[0] += e; t[1] += n; t[2] += 1; t[3] += res["latency_ms"]
                rows.append({"lang": lang, "file": rec["file"], "reference": rec["reference"],
                             "hypothesis": res["text"], "errors": e, "words": n,
                             "latency_ms": res["latency_ms"], "model": res["model"]})
    if not rows:
        sys.exit("no manifests found under " + a.data)
    out = os.path.join(os.path.dirname(__file__), "results.csv")
    with open(out, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]))
        w.writeheader(); w.writerows(rows)
    print(f"{'lang':6}{'clips':>6}{'WER':>8}{'avg ms':>9}")
    for lang, (e, n, c, ms) in totals.items():
        print(f"{lang:6}{c:>6}{(e / max(n, 1)) * 100:>7.1f}%{ms // max(c, 1):>9}")
    print("details ->", out)


if __name__ == "__main__":
    main()
