"""Two helpers of the rulebook search (`rag.ask`), plain functions with no
model behind them: keyword scores next to the embedding's, and the windows
a rule is read in by the cross-encoder.

Keywords catch what the embedding misses: a rule named by one rare word
("laser", "OpenMV") ranked 17th or 64th by meaning alone (measurement 9).
"""

import math
import re
from collections import Counter

import numpy as np

_STOPWORD_TEXT = """a an the of to in on at for by with from and or not no is are was were be
    been can could may might must shall should will would do does did we our us
    you your it its they them their this that these those there what when where
    which who whom how many much any some all if as into about than then so too
    very just only also get got have has had i me my he she his her one up out"""
_STOPWORDS = frozenset(_STOPWORD_TEXT.split())
# BM25's own usual constants.
_K1 = 1.2
_B = 0.75

# The cross-encoder reads at most 512 tokens: a longer rule is read in
# overlapping windows, scored by its best one.
WINDOW_WORDS = 120
WINDOW_STRIDE = 60
# A table row as `rag._table_lines` writes it ("PARK; MATCH points AUTO: 5").
_TABLE_ROW = re.compile(r"; .*: |: .*; ")


def _tokens(text: str) -> list[str]:
    """Lower-cased words, stop words dropped, a plural cut back to its
    singular ("batteries", "robots") the way the manual names things."""
    tokens = []
    for word in re.findall(r"[a-z0-9]+", text.lower()):
        if word in _STOPWORDS:
            continue
        if len(word) > 4 and word.endswith("ies"):
            word = word[:-3] + "y"
        elif len(word) > 3 and word.endswith("s") and not word.endswith("ss"):
            word = word[:-1]
        tokens.append(word)
    return tokens


def keyword_scores(question: str, texts: list[str]) -> np.ndarray:
    """BM25: each question word found in a text counts for more the rarer
    it is across `texts`, and for less the longer that text is."""
    counts = [Counter(_tokens(text)) for text in texts]
    lengths = np.array([sum(count.values()) for count in counts], dtype=float)
    average = lengths.mean() if len(texts) else 0.0
    frequency: Counter[str] = Counter()
    for count in counts:
        frequency.update(count.keys())
    n = len(texts)

    scores = np.zeros(n)
    for index, count in enumerate(counts):
        norm = _K1 * (1 - _B + _B * lengths[index] / average) if average else _K1
        for word in _tokens(question):
            seen = count.get(word)
            if seen:
                idf = math.log(
                    1 + (n - frequency[word] + 0.5) / (frequency[word] + 0.5)
                )
                scores[index] += idf * seen * (_K1 + 1) / (seen + norm)
    return scores


def windows(text: str) -> list[str]:
    """What the cross-encoder reads of one rule: overlapping windows of its
    text, then each table row alone, under the rule's first line and the
    table's caption — inside a 120-word window, one row of a long table is
    drowned by its neighbours (measurement 9: PARK ranked 12th)."""
    words = text.split()
    if len(words) <= WINDOW_WORDS:
        parts = [text]
    else:
        parts = [
            " ".join(words[start : start + WINDOW_WORDS])
            for start in range(
                0, len(words) - WINDOW_WORDS + WINDOW_STRIDE, WINDOW_STRIDE
            )
        ]

    heading = " ".join(text.split("\n", 1)[0].split()[:25])
    caption = ""
    for line in text.split("\n")[1:]:
        if _TABLE_ROW.search(line):
            parts.append(
                " ... ".join(dict.fromkeys(p for p in (heading, caption, line) if p))
            )
        else:
            caption = " ".join(line.split()[:15])
    return parts
