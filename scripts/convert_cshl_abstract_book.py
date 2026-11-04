# /// script
# requires-python = ">=3.11"
# dependencies = ["pdfplumber"]
# ///
"""Convert a Cold Spring Harbor Laboratory meeting abstract book PDF into a
conference-planner/v1 JSON file (see schema/conference.ts).

    uv run scripts/convert_cshl_abstract_book.py BOOK.pdf --out OUT.json \
        [--id cshl-data-2026] [--url URL] [--location ...] [--timezone ...]

The CSHL books share a Word-generated layout:

* an overview table (weekday, "7:30 pm – 10:00 pm", optional session number,
  name) -- the only place session end times are printed;
* a PROGRAM section: day headers ("THURSDAY, November 5—9:00 AM"), numbered
  sessions with chairpersons, centred headers for keynotes / posters /
  socials, and talk or poster entries (bold title, author line with the
  presenter underlined, "Presenter affiliation: ...", abstract number at the
  right margin);
* an AUTHOR INDEX, then one abstract per page with the abstract number in the
  page footer (title in bold, then authors, affiliations, body, separated by
  larger vertical gaps).

Everything is parsed from character positions and fonts (pdfplumber). A
summary of anything that needed a fallback is printed to stderr.
"""

from __future__ import annotations

import argparse
import datetime as dt
import gzip
import json
import re
import sys
import unicodedata
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

import pdfplumber

WEEKDAYS = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"]
MONTHS = {m: i for i, m in enumerate(
    ["january", "february", "march", "april", "may", "june", "july", "august",
     "september", "october", "november", "december"], 1)}
LIGATURES = {"\ufb00": "ff", "\ufb01": "fi", "\ufb02": "fl", "\ufb03": "ffi", "\ufb04": "ffl",
             "\u2011": "-", "\u00ad": ""}  # non-breaking hyphen (often in a math font), soft hyphen
SMALL_WORDS = {"a", "an", "and", "as", "at", "by", "for", "from", "in", "of", "on", "or", "the", "to", "via", "with"}
ROMAN = re.compile(r"^[ivxlcdm]+$", re.I)
DASHES = "\u2013\u2014-"

log_lines: list[str] = []


def note(msg: str) -> None:
    log_lines.append(msg)


# ---------------------------------------------------------------- lines


@dataclass
class Ch:
    text: str
    x0: float
    x1: float
    top: float
    bottom: float
    size: float
    font: str
    sup: bool = False  # smaller than the line's main size (superscript/subscript)
    under: bool = False  # sits on an underline rect

    @property
    def bold(self) -> bool:
        return "Bold" in self.font

    @property
    def italic(self) -> bool:
        return "Italic" in self.font


@dataclass
class Line:
    chars: list[Ch]
    page: int

    @property
    def x0(self) -> float:
        return min(c.x0 for c in self.main)

    @property
    def top(self) -> float:
        return min(c.top for c in self.main)

    @property
    def bottom(self) -> float:
        return max(c.bottom for c in self.main)

    @property
    def main(self) -> list[Ch]:
        return [c for c in self.chars if not c.sup] or self.chars

    @property
    def text(self) -> str:
        return render(self.chars)

    @property
    def starts_bold(self) -> bool:
        first = next((c for c in self.chars if c.text.strip()), None)
        return bool(first and first.bold)

    @property
    def all_bold(self) -> bool:
        # punctuation is sometimes set in a fallback font (e.g. U+2011 in Cambria Math)
        vis = [c for c in self.chars if c.text.isalnum()] or [c for c in self.chars if c.text.strip()]
        return bool(vis) and all(c.bold for c in vis)


def render(chars: list[Ch], sup_style: str = "plain") -> str:
    """Join chars left to right, inserting spaces at visible gaps.

    sup_style: "plain" keeps superscripts inline, "label" puts a space after a
    superscript run (affiliation numbers), "drop" removes them.
    """
    out: list[str] = []
    prev: Ch | None = None
    for c in chars:
        if c.sup and sup_style == "drop":
            continue
        t = LIGATURES.get(c.text, c.text)
        if prev is not None:
            gap = c.x0 - prev.x1
            need_space = gap > 0.22 * min(c.size, prev.size)
            if sup_style == "label" and prev.sup and not c.sup:
                need_space = True
            if need_space and out and not out[-1].endswith(" ") and not t.startswith(" "):
                out.append(" ")
        out.append(t)
        prev = c
    s = "".join(out)
    return re.sub(r"[  ]+", " ", s).strip()


def page_lines(page, page_no: int, keep=lambda c: True) -> list[Line]:
    raw = [c for c in page.chars if keep(c) and c["text"] not in ("\n", "\r")]
    if not raw:
        return []
    sizes = Counter(round(c["size"], 1) for c in raw if c["text"].strip())
    if not sizes:
        return []
    body = sizes.most_common(1)[0][0]
    chars = []
    for c in raw:
        if c["size"] < 0.4 * body:  # invisible layout debris (e.g. 1pt stray "v")
            continue
        chars.append(Ch(c["text"], c["x0"], c["x1"], c["top"], c["bottom"], c["size"], c["fontname"],
                        sup=c["size"] < 0.8 * body))
    main = sorted((c for c in chars if not c.sup), key=lambda c: (c.bottom, c.x0))
    groups: list[list[Ch]] = []
    for c in main:
        if groups and abs(groups[-1][0].bottom - c.bottom) <= 2.0:
            groups[-1].append(c)
        else:
            groups.append([c])
    for c in chars:
        if not c.sup:
            continue
        mid = (c.top + c.bottom) / 2
        best = None
        for g in groups:
            top, bot = min(x.top for x in g), max(x.bottom for x in g)
            d = 0 if top - 2 <= mid <= bot + 2 else min(abs(mid - top), abs(mid - bot))
            if best is None or d < best[0]:
                best = (d, g)
        if best and best[0] < 6:
            best[1].append(c)
    lines = []
    for g in groups:
        g.sort(key=lambda c: c.x0)
        if any(c.text.strip() for c in g):
            # drop leading/trailing space chars so x0 reflects visible text
            while g and not g[0].text.strip():
                g.pop(0)
            while g and not g[-1].text.strip():
                g.pop()
            lines.append(Line(g, page_no))
    lines.sort(key=lambda l: l.top)
    # underline rects (thin horizontal rects just below a line's glyphs)
    for r in page.rects:
        if r["height"] > 1.2 or r["width"] < 3:
            continue
        for ln in lines:
            if ln.bottom - 3.5 <= r["top"] <= ln.bottom + 1.5:
                for c in ln.chars:
                    cx = (c.x0 + c.x1) / 2
                    if r["x0"] - 0.5 <= cx <= r["x1"] + 0.5:
                        c.under = True
    return lines


def join_wrapped(parts: list[str]) -> str:
    """Join wrapped lines: hyphen/dash/slash at a line end joins without a space.

    Word does not auto-hyphenate these books, so a trailing "-" is a real
    hyphen (compound word) and is kept.
    """
    out = ""
    for p in parts:
        p = p.strip()
        if not p:
            continue
        if not out:
            out = p
        elif out[-1] in DASHES + "/" and not out.endswith(" -") and not re.match(r"(and|or|nor)\b", p):
            out += p  # (a suspended hyphen, "double- and triple-", keeps its space)
        else:
            out += " " + p
    return out


def slug(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def title_case(s: str) -> str:
    words = s.lower().split()
    out = []
    for i, w in enumerate(words):
        if i and w in SMALL_WORDS:
            out.append(w)
        elif re.fullmatch(r"[ivx]+", w):
            out.append(w.upper())
        else:
            out.append(w[:1].upper() + w[1:])
    return " ".join(out)


def norm_title(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).lower()
    s = re.sub(r"[‐-―:\-–—/]", " ", s)
    return " ".join(re.sub(r"[^a-z0-9 ]+", "", s).split())


def to_24h(t: str) -> str:
    m = re.fullmatch(r"(\d{1,2}):(\d{2})\s*([ap])\.?m\.?", t.strip().lower())
    if not m:
        raise ValueError(f"bad time {t!r}")
    h, mi, ap = int(m[1]), int(m[2]), m[3]
    if ap == "p" and h != 12:
        h += 12
    if ap == "a" and h == 12:
        h = 0
    return f"{h:02d}:{mi:02d}"


# ---------------------------------------------------------------- front matter


def parse_front(pdf, first_program_page: int) -> dict:
    info: dict = {"organizers": [], "overview": []}
    year = None
    for i in range(first_program_page):
        lines = page_lines(pdf.pages[i], i)
        texts = [l.text for l in lines]
        for j, t in enumerate(texts):
            if "name" not in info and re.search(r"meeting on$", t) and j + 1 < len(texts):
                info["name"] = texts[j + 1]
            if year is None and (m := re.search(r"\b(20\d\d)\b", t)) and re.search(r"[A-Z][a-z]+ \d", t):
                year = int(m[1])
            if t == "Arranged by" and not info["organizers"]:
                for u in texts[j + 1:]:
                    if not u or u.startswith("Contributions"):
                        break
                    info["organizers"].append(u)
        # overview table: rows start with a weekday name
        rows = []
        row_re = re.compile(
            r"^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+"
            r"(\d{1,2}:\d{2}\s*[ap]m)(?:\s*[–\-]\s*(\d{1,2}:\d{2}\s*[ap]m))?\s+(?:(\d+)\s+)?(.+)$")
        last = None
        for l in lines:
            m = row_re.match(l.text)
            if m:
                last = {"weekday": m[1].upper(), "start": to_24h(m[2]), "end": to_24h(m[3]) if m[3] else None,
                        "number": m[4], "name": m[5].strip(), "x_name": None}
                rows.append(last)
            elif last and l.x0 > 150 and l.top - last.get("_bottom", l.top) < 14 and not rows[-1].get("_closed"):
                last["name"] += " " + l.text
            if last:
                last["_bottom"] = l.bottom
            if m is None and last and l.x0 <= 150:
                last["_closed"] = True
        if len(rows) >= 3 and not info["overview"]:
            for r in rows:
                for k in ("_bottom", "_closed", "x_name"):
                    r.pop(k, None)
            info["overview"] = rows
            note(f"overview table on pdf page {i + 1}: {len(rows)} rows")
    info["year"] = year
    return info


# ---------------------------------------------------------------- program


@dataclass
class Entry:
    title_parts: list[str] = field(default_factory=list)
    author_lines: list[Line] = field(default_factory=list)
    affil_parts: list[str] = field(default_factory=list)
    number: str | None = None
    in_affil: bool = False
    page: int = 0


@dataclass
class Sess:
    title: str
    date: str
    start: str
    number: str | None = None
    chairs: list[dict] = field(default_factory=list)
    entries: list[Entry] = field(default_factory=list)
    keynote: dict | None = None
    weekday: str = ""


DAY_RE = re.compile(r"^(" + "|".join(WEEKDAYS) + r"),\s+([A-Za-z]+)\s+(\d{1,2})\s*[—–-]\s*(\d{1,2}:\d{2}\s*[AP]\.?M\.?)$")


def parse_program(pdf, start: int, stop: int, year: int) -> list[Sess]:
    sessions: list[Sess] = []
    cur: Sess | None = None
    entry: Entry | None = None
    state = "none"
    day = None  # (weekday, date, time)
    keynote_step = None

    def finish_entry():
        nonlocal entry
        if entry and cur is not None:
            cur.entries.append(entry)
        entry = None

    for pno in range(start, stop):
        page = pdf.pages[pno]
        for ln in page_lines(page, pno):
            t = ln.text
            if not t or ROMAN.match(t) or t in ("PROGRAM", "< Back", "<Back") or re.match(r"^See p\.", t):
                continue
            m = DAY_RE.match(t)
            if m:
                finish_entry()
                mon = MONTHS[m[2].lower()]
                day = (m[1], f"{year:04d}-{mon:02d}-{int(m[3]):02d}", to_24h(m[4]))
                state = "after_day"
                continue
            m = re.match(r"^SESSION\s+(\d+)\s+(.+)$", t)
            if m and day:
                finish_entry()
                cur = Sess(title=m[2].strip(), date=day[1], start=day[2], number=m[1])
                cur.weekday = day[0]
                sessions.append(cur)
                state = "session_title"
                continue
            if state == "session_title" and ln.x0 > 90 and not t.startswith("Chairpersons"):
                cur.title += " " + t
                continue
            if re.match(r"^Chair(person)?s?:", t):
                state = "chairs"
                colon = next(k for k, c in enumerate(ln.chars) if c.text == ":")
                rest = ln.chars[colon + 1:]
                while rest and not rest[0].text.strip():
                    rest.pop(0)
                add_chair(cur, rest)
                continue
            if state == "chairs" and ln.x0 > 90:
                add_chair(cur, ln.chars)
                continue
            if state == "keynote":
                if keynote_step == "name" and ln.all_bold:
                    cur.keynote["name"] = t
                    keynote_step = "inst"
                    continue
                if keynote_step in ("inst", "inst+") and not t.startswith(("“", '"')) and not ln.all_bold:
                    cur.keynote["affiliation"] = (cur.keynote.get("affiliation", "") + " " + t).strip()
                    keynote_step = "inst+"
                    continue
                if keynote_step in ("inst", "inst+", "title"):
                    cur.keynote.setdefault("title_parts", []).append(t)
                    keynote_step = "title"
                    if t.rstrip().endswith(("”", '"')):
                        state = "none"
                    continue
            if ln.all_bold and ln.x0 > 50:
                # centred header
                finish_entry()
                if state == "after_day" and day:
                    cur = Sess(title=t, date=day[1], start=day[2])
                    cur.weekday = day[0]
                    sessions.append(cur)
                    if re.search(r"keynote", t, re.I):
                        cur.keynote = {}
                        state, keynote_step = "keynote", "name"
                    else:
                        state = "header"
                    continue
                # a list header for a session announced earlier ("POSTER SESSION I")
                match = [s for s in sessions if s.title.upper() == t.upper()]
                if match:
                    cur = match[-1]
                    state = "entries"
                    continue
                if state == "header" and cur is not None:
                    cur.title += " " + t
                    continue
                note(f"unrecognised header on pdf page {pno + 1}: {t!r}")
                continue
            # talk / poster entries
            if ln.all_bold:
                if entry is None or entry.author_lines or entry.affil_parts:
                    finish_entry()
                    entry = Entry(page=pno)
                    state = "entries"
                entry.title_parts.append(t)
                continue
            if entry is None:
                note(f"stray line on pdf page {pno + 1}: {t!r}")
                continue
            chars = list(ln.chars)
            # abstract number at the right margin: digits after a wide gap
            num = re.search(r"(\d+)$", t)
            if num:
                digits = []
                for c in reversed(chars):
                    if c.text.isdigit():
                        digits.insert(0, c)
                    else:
                        break
                before = [c for c in chars[: len(chars) - len(digits)] if c.text.strip()]
                if digits and before and digits[0].x0 - before[-1].x1 > 6:  # tab to the right margin
                    entry.number = "".join(c.text for c in digits)
                    chars = chars[: len(chars) - len(digits)]
                    while chars and not chars[-1].text.strip():
                        chars.pop()
            txt = render(chars)
            if txt.startswith("Presenter affiliation:"):
                entry.in_affil = True
                txt = txt[len("Presenter affiliation:"):].strip()
            if entry.in_affil:
                entry.affil_parts.append(txt)
            else:
                ln2 = Line(chars, ln.page)
                entry.author_lines.append(ln2)
    finish_entry()
    return sessions


def add_chair(sess: Sess | None, chars: list[Ch]) -> None:
    if sess is None:
        return
    vis = [c for c in chars if c.text.strip()]
    if not vis:
        return
    if vis[0].bold:
        name_chars = []
        for c in chars:
            if c.bold or not c.text.strip():
                name_chars.append(c)
            else:
                break
        rest = chars[len(name_chars):]
        name = render(name_chars).rstrip(", ")
        aff = render(rest).lstrip(", ")
        sess.chairs.append({"name": name, "affiliation": aff})
    elif sess.chairs:
        prev = sess.chairs[-1]
        prev["affiliation"] = join_wrapped([prev["affiliation"], render(chars)])
    else:
        # no bold name: "Name, Affiliation"
        t = render(chars)
        name, _, aff = t.partition(",")
        sess.chairs.append({"name": name.strip(), "affiliation": aff.strip()})


def entry_authors_and_presenters(e: Entry) -> tuple[str, list[str]]:
    """Return (author line, underlined presenter names)."""
    flat: list[tuple[str, bool]] = []
    for i, ln in enumerate(e.author_lines):
        chars = ln.chars
        if i:
            prev_last = next((u for t_, u in reversed(flat) if t_.strip()), False)
            first = next((c.under for c in chars if c.text.strip()), False)
            ends_dash = flat and flat[-1][0] in DASHES
            if not ends_dash:
                flat.append((" ", prev_last and first))
        for c in chars:
            flat.append((LIGATURES.get(c.text, c.text), c.under))
    authors = join_wrapped([render(ln.chars) for ln in e.author_lines])
    runs: list[str] = []
    cur = ""
    for t, u in flat:
        if u:
            cur += t
        else:
            if cur.strip():
                runs.append(cur)
            cur = ""
    if cur.strip():
        runs.append(cur)
    names = []
    for r in runs:
        r = re.sub(r"\s+", " ", r).strip().strip(",;").strip()
        if r.endswith(".") and not re.search(r"\b[A-Z]\.$", r):
            r = r[:-1]
        if len(r) > 1:
            names.append(r)
    return authors, names


def strip_final_period(s: str) -> str:
    s = s.strip()
    if s.endswith(".") and not re.search(r"(^|[\s.])[A-Z]\.$", s):
        s = s[:-1]
    return s


def split_authors(a: str) -> list[str]:
    return [x.strip() for x in re.split(r",\s*", a) if x.strip()]


# ---------------------------------------------------------------- abstracts


def footer_number(page) -> str | None:
    h = page.height
    lines = page_lines(page, 0, keep=lambda c: c["top"] > h * 0.68 and "TimesNewRoman" not in c["fontname"])
    for l in reversed(lines):
        t = l.text.replace("< Back", "").strip()
        if re.fullmatch(r"\d+", t):
            return t
    return None


def parse_abstract_pages(pdf, start: int) -> dict[str, dict]:
    out: dict[str, dict] = {}
    current = None
    for pno in range(start, len(pdf.pages)):
        page = pdf.pages[pno]
        first = (page.extract_text() or "").strip().split("\n")[0].strip()
        num = footer_number(page)
        if num is None:
            if first.upper() in ("NOTES", "PARTICIPANT LIST") or first.startswith("Participant"):
                break
            if not first:
                continue
            if current:
                current["pages"].append(pno)
                note(f"abstract {current['number']}: continuation page {pno + 1} (no footer number)")
            continue
        if num in out:
            out[num]["pages"].append(pno)
            note(f"abstract {num}: spans pdf pages {[p + 1 for p in out[num]['pages']]}")
            continue
        current = {"number": num, "pages": [pno]}
        out[num] = current
    for num, a in out.items():
        lines: list[Line] = []
        for pno in a["pages"]:
            pg = pdf.pages[pno]
            lines += page_lines(pg, pno, keep=lambda c, h=pg.height: c["top"] < h * 0.72 or "TimesNewRoman" in c["fontname"])
        lines = [l for l in lines if not re.fullmatch(r"(< ?Back\s*)?\d*", l.text)]
        a.update(split_abstract(lines, num))
    return out


def split_abstract(lines: list[Line], num: str) -> dict:
    if not lines:
        note(f"abstract {num}: empty page")
        return {"title": "", "authors": "", "affiliations": "", "abstract": ""}
    # blocks by vertical gap
    gaps = [b.top - a.bottom for a, b in zip(lines, lines[1:]) if a.page == b.page]
    small = sorted(gaps)[len(gaps) // 4] if gaps else 1.0  # typical intra-paragraph gap
    thresh = small + 4.0
    blocks: list[list[Line]] = [[lines[0]]]
    for a, b in zip(lines, lines[1:]):
        if a.page == b.page and b.top - a.bottom > thresh:
            blocks.append([b])
        else:
            blocks[-1].append(b)
    # title = leading all-bold lines (may sit in block 0 together with nothing else)
    title_lines = []
    while blocks and blocks[0] and blocks[0][0].all_bold:
        title_lines.append(blocks[0].pop(0))
    if blocks and not blocks[0]:
        blocks.pop(0)
    if not title_lines:
        note(f"abstract {num}: no bold title found")
    title = join_wrapped([l.text for l in title_lines])
    authors_block = blocks.pop(0) if blocks else []
    affil_block = blocks.pop(0) if blocks else []
    authors = join_wrapped([render(l.chars, "drop") for l in authors_block])
    affiliations = join_wrapped([render(l.chars, "label") for l in affil_block])
    # body paragraphs: gap-separated blocks, also split before lines that open with
    # a bold run label ("Methods:") inside a block
    # a body line that stops well short of the right margin is a hard line
    # break (lists, "Web: <url>" lines) and also starts a new paragraph
    right = max((max(c.x1 for c in l.chars) for b in blocks for l in b), default=0)
    paras: list[list[Line]] = []
    for b in blocks:
        prev = None
        for l in b:
            hard = (prev is not None and max(c.x1 for c in prev.chars) < right - HARD_BREAK_PT
                    # ...unless it is a soft return in mid-sentence ("We profiled" / "paired ...")
                    and not (re.search(r"[\w,]$", prev.text) and re.match(r"[a-z]", l.text)))
            if (not paras or l is b[0] or hard
                    or (l.starts_bold and not l.all_bold and re.match(r"^[A-Z][^:]{0,40}:", l.text))):
                if hard and DEBUG_BREAKS:
                    note(f"abstract {num}: hard break after {prev.text[-40:]!r} -> {l.text[:40]!r}")
                paras.append([l])
            else:
                paras[-1].append(l)
            prev = l
    body = "\n\n".join(join_wrapped([render_body(l) for l in p]) for p in paras)
    return {"title": title, "authors": authors, "affiliations": affiliations, "abstract": body}


HARD_BREAK_PT = 70.0  # longer than any word that could have wrapped
DEBUG_BREAKS = False

SUP_MAP = str.maketrans("0123456789+-−=()n", "⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁻⁼⁽⁾ⁿ")


def render_body(l: Line) -> str:
    """Body text; raised small text becomes Unicode superscripts where possible."""
    main = l.main
    base = sorted(c.bottom for c in main)[len(main) // 2]
    chars: list[Ch] = []
    for c in l.chars:
        if c.sup and c.bottom < base - 1.0:  # raised: superscript
            t = c.text
            conv = t.translate(SUP_MAP)
            if all(ch in "⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁿ" for ch in conv):
                chars.append(Ch(conv, c.x0, c.x1, c.top, c.bottom, c.size, c.font, sup=False))
                continue
        chars.append(Ch(c.text, c.x0, c.x1, c.top, c.bottom, c.size, c.font, sup=False))
    return render(chars)


# ---------------------------------------------------------------- assemble


def find_sections(pdf) -> tuple[int, int, int]:
    program = index = None
    for i, p in enumerate(pdf.pages):
        first = (p.extract_text() or "").strip().split("\n")[0].strip()
        if program is None and first == "PROGRAM":
            program = i
        if program is not None and first == "AUTHOR INDEX":
            index = i
            break
    if program is None or index is None:
        sys.exit("could not find PROGRAM / AUTHOR INDEX pages")
    abstracts = index + 1
    while abstracts < len(pdf.pages) and footer_number(pdf.pages[abstracts]) is None:
        abstracts += 1
    return program, index, abstracts


def session_kind(title: str, numbered: bool) -> str:
    t = title.lower()
    if numbered:
        return "talks"
    if "poster" in t:
        return "posters"
    if "keynote" in t:
        return "keynote"
    if re.search(r"party|banquet|cocktail|reception|dinner|picnic|social|wine", t):
        return "social"
    if "workshop" in t:
        return "workshop"
    if re.search(r"\bbreak\b", t):
        return "break"
    if re.search(r"talks?\b", t):
        return "talks"
    return "other"


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("pdf", type=Path)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--id", help="conference id slug (default: cshl-<first word of name>-<year>)")
    ap.add_argument("--name", help="override the conference name")
    ap.add_argument("--timezone", default="America/New_York")
    ap.add_argument("--location", default="Cold Spring Harbor Laboratory, Cold Spring Harbor, NY")
    ap.add_argument("--url")
    ap.add_argument("--retrieved", default=dt.date.today().isoformat(), help="YYYY-MM-DD the PDF was obtained")
    ap.add_argument("--gzip", action="store_true", help="also write OUT.gz")
    args = ap.parse_args()

    pdf = pdfplumber.open(args.pdf)
    prog_start, index_start, abs_start = find_sections(pdf)
    front = parse_front(pdf, prog_start)
    year = front["year"]
    if not year:
        sys.exit("could not find the meeting year in the front matter")
    sessions = parse_program(pdf, prog_start, index_start, year)
    abstracts = parse_abstract_pages(pdf, abs_start)

    # overview rows -> end times and properly cased names
    used_rows = set()
    out_sessions = []
    stats = {"presenter_fallback": [], "title_mismatch": [], "no_abstract": [], "empty_abstract": [],
             "unnumbered": [], "no_end": []}
    seen_numbers: Counter = Counter()
    for s in sessions:
        row = None
        for k, r in enumerate(front["overview"]):
            if k in used_rows:
                continue
            if r["weekday"] == s.weekday and r["start"] == s.start and (
                    s.number is None or r["number"] == s.number):
                row = r
                used_rows.add(k)
                break
        numbered = s.number is not None
        title = row["name"] if row else title_case(s.title)
        kind = session_kind(title, numbered)
        if s.keynote is not None:
            kind = "keynote"
        sid = (f"s{s.number}" if numbered else
               f"keynote-{s.date}" if kind == "keynote" else
               f"posters-{roman_suffix(title)}" if kind == "posters" else
               f"social-{slug(title)}" if kind == "social" else slug(title))
        sess: dict = {"id": sid, "title": title, "kind": kind, "start": f"{s.date}T{s.start}"}
        if row and row["end"]:
            sess["end"] = f"{s.date}T{row['end']}"
        else:
            stats["no_end"].append(sid)
        if numbered:
            sess["code"] = f"Session {s.number}"
        if s.chairs:
            sess["chairs"] = [{k: v for k, v in c.items() if v} for c in s.chairs]
        pres = []
        if s.keynote:
            kt = join_wrapped(s.keynote.get("title_parts", [])).strip("“”\" ")
            name = s.keynote.get("name", "")
            sess["title"] = f"{title}: {name}" if name else title
            p = {"id": f"{sid}-{slug(name.split()[-1]) if name else 'talk'}", "title": kt,
                 "speakers": [{k: v for k, v in {"name": name, "affiliation": s.keynote.get("affiliation")}.items() if v}]}
            pres.append(p)
        for e in s.entries:
            title_p = join_wrapped(e.title_parts)
            authors, under = entry_authors_and_presenters(e)
            authors = strip_final_period(authors)
            affil = strip_final_period(join_wrapped(e.affil_parts))
            if not under:
                first = split_authors(authors)[:1]
                under = first
                stats["presenter_fallback"].append(e.number or title_p[:40])
            p: dict = {}
            if e.number:
                p["id"] = f"a{e.number}"
                seen_numbers[e.number] += 1
            else:
                surname = under[0].split()[-1] if under else "talk"
                p["id"] = f"{sid}-{slug(surname)}"
                stats["unnumbered"].append(f"{p['id']}: {title_p}")
            p["title"] = title_p
            p["speakers"] = [{"name": n, **({"affiliation": affil} if affil else {})} for n in under]
            if authors:
                p["authors"] = authors
            if e.number:
                p["code"] = e.number
                a = abstracts.get(e.number)
                if a is None:
                    stats["no_abstract"].append(e.number)
                else:
                    a["used"] = True
                    if a["affiliations"]:
                        p["affiliations"] = a["affiliations"]
                    if a["abstract"]:
                        p["abstract"] = a["abstract"]
                    else:
                        stats["empty_abstract"].append(e.number)
                    if norm_title(a["title"]) != norm_title(title_p):
                        stats["title_mismatch"].append((e.number, title_p, a["title"]))
            pres.append(p)
        if pres:
            sess["presentations"] = pres
        out_sessions.append(sess)

    unused_rows = [r for k, r in enumerate(front["overview"]) if k not in used_rows]
    for r in unused_rows:
        note(f"overview row not matched to a program session: {r}")
    orphan_abstracts = sorted((n for n, a in abstracts.items() if not a.get("used")), key=int)

    name = args.name or f"{title_case(front.get('name', 'CSHL Meeting'))} {year}"
    conf = {
        "id": args.id or f"cshl-{slug(name)}",
        "name": name,
        "timezone": args.timezone,
    }
    dates = sorted(s["start"][:10] for s in out_sessions)
    conf["start"], conf["end"] = dates[0], dates[-1]
    if args.location:
        conf["location"] = args.location
    if args.url:
        conf["url"] = args.url
    if front["organizers"]:
        conf["description"] = "Arranged by " + "; ".join(front["organizers"]) + "."
    conf["source"] = {"description": f"CSHL abstract book PDF ({args.pdf.name})", "retrieved": args.retrieved}
    doc = {"format": "conference-planner/v1", "conference": conf, "sessions": out_sessions}

    args.out.parent.mkdir(parents=True, exist_ok=True)
    data = json.dumps(doc, indent=2, ensure_ascii=False) + "\n"
    args.out.write_text(data, encoding="utf-8")
    if args.gzip:
        with gzip.open(str(args.out) + ".gz", "wb", compresslevel=9) as f:
            f.write(data.encode("utf-8"))

    # ---- report
    r = sys.stderr
    print(f"wrote {args.out} ({len(data.encode()):,} bytes)", file=r)
    print(f"program pdf pages {prog_start + 1}-{index_start}, abstracts from pdf page {abs_start + 1}: "
          f"{len(abstracts)} abstracts", file=r)
    for s in out_sessions:
        print(f"  {s['id']:<28} {s['kind']:<8} {s['start']}–{s.get('end', '?')[11:]:<5} "
              f"{len(s.get('presentations', [])):>3}  {s['title']}", file=r)
    nums = sorted((int(n) for n in seen_numbers), key=int)
    dup = [n for n, c in seen_numbers.items() if c > 1]
    if nums:
        missing = sorted(set(range(1, max(nums) + 1)) - set(nums))
        print(f"abstract numbers in program: {len(nums)} (1–{max(nums)}); missing {missing or 'none'}; "
              f"duplicated {dup or 'none'}", file=r)
    print(f"abstract pages not referenced by the program: {orphan_abstracts or 'none'}", file=r)
    print(f"program entries without an abstract page: {stats['no_abstract'] or 'none'}", file=r)
    print(f"empty abstracts: {stats['empty_abstract'] or 'none'}", file=r)
    print(f"unnumbered entries: {stats['unnumbered'] or 'none'}", file=r)
    print(f"presenter underline not found (fell back to first author): {stats['presenter_fallback'] or 'none'}", file=r)
    print(f"sessions without an end time: {stats['no_end'] or 'none'}", file=r)
    print(f"program vs abstract-page title mismatches: {len(stats['title_mismatch'])}", file=r)
    for n, a, b in stats["title_mismatch"]:
        print(f"  {n}: program {a!r}\n  {' ' * len(n)}  abstract {b!r}", file=r)
    for m in log_lines:
        print(f"note: {m}", file=r)


def roman_suffix(title: str) -> str:
    m = re.search(r"\b([IVX]+|\d+)$", title.strip())
    if not m:
        return slug(title)
    v = m[1]
    if v.isdigit():
        return v
    vals = {"I": 1, "V": 5, "X": 10}
    total = 0
    for i, ch in enumerate(v):
        n = vals[ch]
        total += -n if i + 1 < len(v) and vals[v[i + 1]] > n else n
    return str(total)


if __name__ == "__main__":
    main()
