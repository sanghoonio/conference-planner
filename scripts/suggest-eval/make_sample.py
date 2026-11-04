# /// script
# requires-python = ">=3.11"
# ///
"""Build a blind sample from a conference file whose presentations have organizer categories.

Writes <out>/items.json (id, title, abstract only: no categories, no session names, no conference name)
and <out>/truth.json ({id: [categories]}) for scoring. Item ids are re-numbered so nothing leaks.

uv run scripts/suggest-eval/make_sample.py local/ashg-2026.conference.json.gz --facet track --n 240 --out local/suggest-eval
"""
import argparse, gzip, json, random
from pathlib import Path

ap = argparse.ArgumentParser()
ap.add_argument("conference")
ap.add_argument("--facet", default="track")
ap.add_argument("--n", type=int, default=240)
ap.add_argument("--seed", type=int, default=7)
ap.add_argument("--max-abstract", type=int, default=900, help="truncate abstracts to keep the sample readable in one context")
ap.add_argument("--out", required=True)
a = ap.parse_args()

opener = gzip.open if a.conference.endswith(".gz") else open
conf = json.load(opener(a.conference, "rt", encoding="utf-8"))
pool = [p for s in conf["sessions"] for p in s.get("presentations") or [] if (p.get("facets") or {}).get(a.facet) and p.get("abstract")]
random.Random(a.seed).shuffle(pool)
sample = pool[: a.n]

items, truth = [], {}
for i, p in enumerate(sample, 1):
    iid = f"i{i:03d}"
    abstract = p["abstract"].strip()
    if len(abstract) > a.max_abstract:
        abstract = abstract[: a.max_abstract].rsplit(" ", 1)[0] + " …"
    items.append({"id": iid, "title": p["title"], "abstract": abstract})
    truth[iid] = p["facets"][a.facet]

out = Path(a.out)
out.mkdir(parents=True, exist_ok=True)
(out / "items.json").write_text(json.dumps(items, ensure_ascii=False, indent=1))
(out / "truth.json").write_text(json.dumps(truth, ensure_ascii=False, indent=1))
cats = {}
for v in truth.values():
    for c in v:
        cats[c] = cats.get(c, 0) + 1
print(f"{len(items)} items -> {out}/items.json; {len(cats)} true categories, {sum(map(len, truth.values())) / len(truth):.2f} per item")
for c, n in sorted(cats.items(), key=lambda x: -x[1]):
    print(f"  {n:4d}  {c}")
