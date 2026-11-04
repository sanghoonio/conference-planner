# /// script
# requires-python = ">=3.11"
# ///
"""Score suggested categories against the organizer's real ones (multi-label).

Prediction format (what blind agents write):
  {"facet": {"key": "topic", "label": "Topic"},
   "categories": ["…", …],
   "assignments": {"i001": ["…"], …}}

Metrics
  match-recall    for each real category (>= --min items), F1 of its item set with the best-matching
                  suggested category; macro-averaged. "Did they find each real track?"
  match-precision for each suggested category, F1 with its best-matching real category; macro-averaged.
                  "Is each suggestion a real track, not an invented slice?"
  score           harmonic mean of the two.

uv run scripts/suggest-eval/score.py local/suggest-eval/truth.json local/suggest-eval/runs/*/prediction.json
"""
import argparse, json
from pathlib import Path

ap = argparse.ArgumentParser()
ap.add_argument("truth")
ap.add_argument("predictions", nargs="+")
ap.add_argument("--min", type=int, default=5, help="ignore real categories with fewer items than this")
ap.add_argument("--detail", action="store_true")
a = ap.parse_args()

truth = json.loads(Path(a.truth).read_text())
ids = set(truth)

def sets(assign):
    out = {}
    for i, cats in assign.items():
        if i in ids:
            for c in cats:
                out.setdefault(c, set()).add(i)
    return out

def f1(x, y):
    tp = len(x & y)
    return 0.0 if tp == 0 else 2 * tp / (len(x) + len(y))

T_all = sets(truth)
T = {c: s for c, s in T_all.items() if len(s) >= a.min}
rows = []
for path in a.predictions:
    pred = json.loads(Path(path).read_text())
    if "assignments" not in pred:  # a bare {id: [categories]} map, e.g. the truth file itself
        pred = {"assignments": pred}
    P = sets(pred["assignments"])
    if not P:
        rows.append((path, 0, 0, 0, 0, 0, 0))
        continue
    rec = {t: max(((f1(ts, ps), p) for p, ps in P.items()), key=lambda x: x[0]) for t, ts in T.items()}
    prec = {p: max(f1(ps, ts) for ts in T_all.values()) for p, ps in P.items()}
    mr = sum(v for v, _ in rec.values()) / len(rec)
    mp = sum(prec.values()) / len(prec)
    score = 0 if mr + mp == 0 else 2 * mr * mp / (mr + mp)
    assigned = [i for i in ids if pred["assignments"].get(i)]
    per = sum(len(pred["assignments"][i]) for i in assigned) / max(len(assigned), 1)
    rows.append((path, score, mr, mp, len(P), len(assigned) / len(ids), per))
    if a.detail:
        print(f"\n{path}")
        for t, (v, p) in sorted(rec.items(), key=lambda x: -len(T[x[0]])):
            print(f"  {v:.2f}  {t} ({len(T[t])})  ->  {p}")
        weak = [p for p, v in prec.items() if v < 0.3]
        if weak:
            print(f"  suggested categories with no real counterpart (F1<0.3): {', '.join(weak)}")

print(f"\n{'score':>6} {'m-rec':>6} {'m-prec':>6} {'#cats':>6} {'cover':>6} {'per':>5}  run")
for path, score, mr, mp, n, cov, per in sorted(rows, key=lambda r: -r[1]):
    print(f"{score:6.3f} {mr:6.3f} {mp:6.3f} {n:6d} {cov:6.0%} {per:5.2f}  {path}")
