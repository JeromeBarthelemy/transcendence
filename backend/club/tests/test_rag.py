import pytest

from club.generation import GenerationError
from club.models import Document, Season, User
from club.rag import NO_ANSWER, ask, chunk_manual, chunk_qa, embed, ingest_document

RULE = (
    "Le robot ne doit jamais dépasser dix-huit pouces de hauteur pendant "
    "la phase autonome du match, sous peine de pénalité majeure."
)
UNRELATED = "Les inscriptions au tournoi régional ferment le premier mars."
# `chunk_manual` reads HTML tags, not plain text — every fixture below that
# stands in for the manual is wrapped, even a single sentence like RULE.
RULE_HTML = f"<p>{RULE}</p>"

# A trimmed excerpt of FIRST's own HTML export of the real BioBuzz manual
# (ftc-resources.firstinspires.org/ftc/game/cm-html/..., fetched while
# building chunk_manual) — real tag names and nesting, shortened prose.
# Covers what the PDF version got wrong: a table attached to the rule
# before it (G102's wire table), a mid-sentence cross-reference with no
# anchor of its own, and a rule ID exported with a stray space after its
# asterisk (A204, the exact shape that made the PDF miss it).
REAL_HTML_EXCERPT = """
<html><body>
<p class=MsoToc1><a href="#_Toc1"><span>11 Game Rules (G) .......... 99</span></a></p>
<h1><a name="_Toc1"></a>11<span>&nbsp;&nbsp;&nbsp;</span>Game Rules (G)</h1>
<h2><a name="_Toc2"></a>11.1<span>&nbsp;&nbsp;&nbsp;</span>Personal Safety</h2>
<p class=RuleNumber-Game><a name="_Ref1"></a><a name=G101></a><b>G101<span>&nbsp;&nbsp;&nbsp;</span></b>
<span class=Headline-Evergreen>*Humans, stay off the FIELD during the MATCH.</span> A team member may
not enter the FIELD during a MATCH.</p>
<p class=Violation>Violation: VERBAL WARNING.</p>
<p>The intent of this rule is covered further in <span class=CrossRefChar>G101</span> above and does
not repeat here.</p>
<p class=RuleNumber-Game><a name=G102></a><b>G102<span>&nbsp;&nbsp;&nbsp;</span></b>
<span class=Headline-Evergreen>*Be careful when interacting with ARENA elements.</span> Climbing on,
hanging from, or damaging ARENA elements is prohibited.</p>
<table><tr><td>Application</td><td>Minimum Wire Size</td></tr>
<tr><td>12V Main Battery Power</td><td>18 AWG</td></tr></table>
<h2><a name="_Toc3"></a>11.2<span>&nbsp;&nbsp;&nbsp;</span>Conduct</h2>
<p class=RuleNumber-Game><a name=G201></a><b>G201<span>&nbsp;&nbsp;&nbsp;</span></b>
<span class=Headline-Evergreen>*Be a good person.</span> All teams must be civil toward everyone.</p>
<p class=RulesNumbering-awards><a name=A204></a><span class=normaltextrun><b>A204<span>&nbsp;&nbsp;&nbsp;
</span></b></span><span class=Headline-Evergreen>*</span> Have the right resources available for your
Initial Interview.</p>
</body></html>
"""


# Modeled on FIRST's own Q&A numbering convention, not a scraped verbatim
# entry — this season's Q&A isn't published yet, and the archived page for
# a past one didn't render outside a browser while this was written.
REAL_QA_EXCERPT = """
Q44 Blue robot over their gate to score in the opponent's zone?
During the endgame, is a robot allowed to reach over its own alliance's
gate to place a game piece in the opponent's scoring zone?
Ruling: No. This would be a violation of G410, which prohibits a robot
from extending over a neutral or opponent zone's boundary at any point
during the MATCH.
Q45 Two robots touching during autonomous?
May two alliance partners' robots make contact with each other during
the autonomous period?
Ruling: Yes, incidental contact between alliance partners is not by
itself a violation.
"""


def season(start_year=2026, game_name="BioBuzz"):
    return Season.objects.create(start_year=start_year, game_name=game_name)


def asker(email="lina@club.fr", display_name="Lina"):
    return User.objects.create_user(email, display_name)


def document(
    the_season, source=Document.Source.GAME_MANUAL, text=RULE_HTML, title="Manuel"
):
    return ingest_document(season=the_season, source=source, title=title, text=text)


# --- embedding ---


def test_embedding_is_deterministic():
    assert embed("bonjour le monde") == embed("bonjour le monde")


def test_a_question_scores_higher_against_its_own_answer_than_off_topic():
    # No corpus-wide statistics behind this (unlike the BM25 it replaced):
    # a semantic embedding compares a question to one passage at a time, so
    # this holds regardless of how many other passages exist.
    from club.rag import _unpack

    query = _unpack(
        embed(
            "Quelle est la hauteur maximale du robot en pouces pendant l'autonome ?",
            is_query=True,
        )
    )
    relevant = _unpack(embed(RULE))
    unrelated = _unpack(embed(UNRELATED))

    assert float(query @ relevant) > float(query @ unrelated)


# --- chunking ---


def test_a_rule_becomes_its_own_chunk_named_by_its_reference():
    references = [reference for reference, _ in chunk_manual(REAL_HTML_EXCERPT)]

    assert "G101" in references
    assert "G102" in references
    assert "G201" in references


def test_a_rules_text_does_not_leak_into_the_next_ones_chunk():
    passages = dict(chunk_manual(REAL_HTML_EXCERPT))

    assert "stay off the FIELD" in passages["G101"]
    assert "Climbing on" not in passages["G101"]
    assert "Climbing on" in passages["G102"]


def test_a_bare_cross_reference_does_not_start_a_new_chunk():
    # A mid-sentence mention of G101 is marked with a different span
    # (`CrossRefChar`) and carries no anchor of its own, unlike the real
    # opening of a rule — it must stay part of whichever chunk was already
    # open (G101's own), not start a second one.
    passages = dict(chunk_manual(REAL_HTML_EXCERPT))

    assert "covered further" in passages["G101"]


def test_a_table_stays_attached_to_the_rule_before_it():
    # The exact shape that broke on the real manual: R609's wire-gauge
    # table came out as its own fake sections ("18", "22", "28") under the
    # PDF chunker. A table has no anchor or heading of its own, so it must
    # merge into whichever rule was still open when it appears.
    passages = dict(chunk_manual(REAL_HTML_EXCERPT))

    assert "18 AWG" in passages["G102"]


def test_a_rule_id_with_a_space_after_its_asterisk_is_still_found():
    # The other real miss: the PDF rendered some rules with a space after
    # their own asterisk ("A204 *​ Have the right..."), which the old
    # line-start regex didn't allow, so their text was folded into the
    # rule before them instead. The anchor doesn't care about the
    # asterisk's spacing at all.
    passages = dict(chunk_manual(REAL_HTML_EXCERPT))

    assert "A204" in passages
    assert "Initial Interview" in passages["A204"]


def test_a_numbered_section_becomes_its_own_chunk():
    passages = dict(chunk_manual(REAL_HTML_EXCERPT))

    assert "Personal Safety" in passages["11.1"]
    assert "Conduct" in passages["11.2"]


def test_table_of_contents_entries_are_not_mistaken_for_section_headings():
    # A ToC entry has the same "number, title" shape a real heading does;
    # what tells them apart in the HTML export is the paragraph style
    # (MsoToc1), never a real <h1>-<h3>. The ToC line here ("11 Game Rules
    # (G) .......... 99") must fold into front matter, not open its own
    # "11" chunk — only the real <h1> heading further down does that.
    passages = dict(chunk_manual(REAL_HTML_EXCERPT))

    assert "Game Rules (G) .......... 99" in passages[""]


def test_text_before_the_first_rule_or_section_is_kept_unreferenced():
    passages = chunk_manual(
        "<p>Some front matter.</p><p>More of it.</p><h1>1 Intro</h1>"
    )

    reference, text = passages[0]
    assert reference == ""
    assert "front matter" in text


def test_a_rule_longer_than_the_word_budget_is_resplit_under_the_same_reference():
    html = (
        "<p class=RuleNumber-Game><a name=G999></a><b>G999</b> *A very long rule. "
        + " ".join(f"word{n}" for n in range(400))
        + "</p>"
    )

    passages = [pair for pair in chunk_manual(html) if pair[0] == "G999"]

    assert len(passages) > 1
    assert all(reference == "G999" for reference, _ in passages)
    # Every word still appears somewhere — nothing dropped at the split.
    joined = " ".join(text for _, text in passages)
    assert "word0" in joined
    assert "word399" in joined


# --- chunking (Q&A) ---


def test_a_qa_entry_becomes_its_own_chunk_named_by_its_number():
    references = [reference for reference, _ in chunk_qa(REAL_QA_EXCERPT)]

    assert "Q44" in references
    assert "Q45" in references


def test_a_qa_entrys_text_does_not_leak_into_the_next_ones_chunk():
    passages = dict(chunk_qa(REAL_QA_EXCERPT))

    assert "Blue robot over their gate" in passages["Q44"]
    assert "Two robots touching" not in passages["Q44"]
    assert "Two robots touching" in passages["Q45"]


def test_a_bare_qa_cross_reference_does_not_start_a_new_chunk():
    # "in Q44." mid-sentence must stay part of whatever entry mentions it,
    # not be read as Q44 opening again — same convention chunk_rules
    # applies to a bare rule cross-reference.
    text = "Q50 A later question referencing an earlier ruling in Q44."

    references = [reference for reference, _ in chunk_qa(text)]

    assert references == ["Q50"]


def test_a_rule_reference_inside_a_qa_answer_does_not_split_the_entry():
    # chunk_manual would read a line like "G410, which prohibits..." as
    # G410 opening a new chunk; chunk_qa has no such rule and keeps the
    # whole entry, references and all, together.
    passages = dict(chunk_qa(REAL_QA_EXCERPT))

    assert "G410" in passages["Q44"]


# --- ingestion ---


def test_ingesting_a_document_creates_its_chunks():
    doc = document(season(), text=REAL_HTML_EXCERPT)

    assert doc.chunks.count() > 1
    assert set(doc.chunks.values_list("reference", flat=True)) >= {"G101", "G102"}


def test_ingesting_a_qa_document_chunks_by_entry_not_by_rule():
    doc = document(season(), source=Document.Source.OFFICIAL_QA, text=REAL_QA_EXCERPT)

    assert set(doc.chunks.values_list("reference", flat=True)) == {"Q44", "Q45"}


def test_authority_is_read_off_source_not_asked_for():
    manual = document(season(), source=Document.Source.GAME_MANUAL)
    qa = document(season(2027, "Rebound"), source=Document.Source.OFFICIAL_QA)

    assert manual.authority == Document.Authority.BINDING
    assert qa.authority == Document.Authority.RULING


# --- asking ---


def test_a_question_matching_the_manual_is_answered_and_cited():
    this_season = season()
    document(this_season, source=Document.Source.GAME_MANUAL, text=RULE_HTML)
    lina = asker()

    query = ask(
        "Quelle est la hauteur maximale du robot en pouces pendant la phase autonome ?",
        this_season,
        lina,
    )

    assert query.answer == ""
    (citation,) = query.citations.all()
    assert citation.chunk.document.authority == Document.Authority.BINDING


def test_a_question_asked_with_none_of_the_passage_own_words_is_still_answered():
    # The gap BM25 could never close (git history): a paraphrase sharing no
    # token with its source. A semantic embedding does not need one.
    this_season = season()
    document(this_season, source=Document.Source.GAME_MANUAL, text=RULE_HTML)
    lina = asker()

    query = ask(
        "Is a robot allowed to be taller than usual during the early part of a match?",
        this_season,
        lina,
    )

    assert query.answer == ""
    assert query.citations.exists()


def test_a_matched_question_is_answered_from_the_generated_text(monkeypatch):
    this_season = season()
    document(this_season, source=Document.Source.GAME_MANUAL, text=RULE_HTML)
    lina = asker()
    monkeypatch.setattr(
        "club.rag.generate_answer", lambda question, chunks: "Dix-huit pouces [G101]."
    )

    query = ask(
        "Quelle est la hauteur maximale du robot en pouces pendant la phase autonome ?",
        this_season,
        lina,
    )

    assert query.answer == "Dix-huit pouces [G101]."
    assert query.citations.exists()


def test_a_generation_failure_leaves_the_citations_standing_alone(monkeypatch):
    this_season = season()
    document(this_season, source=Document.Source.GAME_MANUAL, text=RULE_HTML)
    lina = asker()

    def failing(question, chunks):
        raise GenerationError("hors ligne")

    monkeypatch.setattr("club.rag.generate_answer", failing)

    query = ask(
        "Quelle est la hauteur maximale du robot en pouces pendant la phase autonome ?",
        this_season,
        lina,
    )

    assert query.answer == ""
    assert query.citations.exists()


def test_an_unmatched_question_never_calls_the_model(monkeypatch):
    this_season = season()
    document(this_season, source=Document.Source.GAME_MANUAL, text=RULE_HTML)
    lina = asker()
    called = []
    monkeypatch.setattr(
        "club.rag.generate_answer", lambda question, chunks: called.append(1)
    )

    query = ask("Combien de membres dans le comité des sponsors ?", this_season, lina)

    assert called == []
    assert query.answer == NO_ANSWER


def test_citations_are_ranked_by_authority_before_score():
    # A Q&A copy of the same rule, phrased closer to the question, would
    # out-score the manual's own wording on similarity alone — authority
    # must still put the manual first (the manual itself says so, §1.7.4).
    this_season = season()
    document(
        this_season, source=Document.Source.GAME_MANUAL, text=RULE_HTML, title="Manuel"
    )
    document(
        this_season,
        source=Document.Source.OFFICIAL_QA,
        text="Quelle est la hauteur maximale du robot en pouces pendant l'autonome ?"
        " " + RULE,
        title="Q&A",
    )
    lina = asker()

    query = ask(
        "Quelle est la hauteur maximale du robot en pouces pendant la phase autonome ?",
        this_season,
        lina,
    )

    citations = list(query.citations.order_by("rank"))
    assert citations[0].chunk.document.authority == Document.Authority.BINDING


def test_top_k_cut_happens_after_the_authority_sort_not_before():
    # Five Q&A passages that quote the question itself outscore the
    # manual's own wording of the rule on similarity alone — cutting to
    # TOP_K by score before authority gets a say would drop the manual
    # (BINDING) out of the top five entirely. It must survive the cut.
    this_season = season()
    document(
        this_season, source=Document.Source.GAME_MANUAL, text=RULE_HTML, title="Manuel"
    )
    question = (
        "Quelle est la hauteur maximale du robot en pouces pendant la phase autonome ?"
    )
    for n in range(5):
        document(
            this_season,
            source=Document.Source.OFFICIAL_QA,
            text=f"{question} (variante {n}) {RULE}",
            title=f"Q&A {n}",
        )
    lina = asker()

    query = ask(question, this_season, lina)

    authorities = {
        citation.chunk.document.authority for citation in query.citations.all()
    }
    assert Document.Authority.BINDING in authorities


def test_an_unrelated_question_finds_nothing_and_is_refused():
    this_season = season()
    document(this_season, source=Document.Source.GAME_MANUAL, text=RULE_HTML)
    lina = asker()

    query = ask("Combien de membres dans le comité des sponsors ?", this_season, lina)

    assert query.answer != ""
    assert not query.citations.exists()


def test_another_seasons_documents_are_not_searched():
    this_season = season(2026, "BioBuzz")
    other_season = season(2027, "Rebound")
    document(other_season, source=Document.Source.GAME_MANUAL, text=RULE_HTML)
    lina = asker()

    query = ask("Quelle hauteur maximale en autonome ?", this_season, lina)

    assert not query.citations.exists()


def test_a_season_with_no_documents_says_the_manual_is_not_loaded():
    # Distinct from the "nothing sure enough" refusal: nothing has been
    # searched at all, so nothing should be blamed for staying silent.
    this_season = season(2026, "BioBuzz")
    lina = asker()

    query = ask("Quelle hauteur maximale en autonome ?", this_season, lina)

    assert "2026-2027" in query.answer
    assert not query.citations.exists()


def test_reingesting_a_source_supersedes_the_previous_version_of_it():
    # FIRST republishes the manual with every Team Update — the old
    # version must stop being searched, not be cited alongside the new one.
    this_season = season()
    document(
        this_season,
        source=Document.Source.GAME_MANUAL,
        text="<p>Le robot ne doit jamais dépasser douze pouces de hauteur en autonome.</p>",
        title="Manuel V1",
    )
    document(
        this_season,
        source=Document.Source.GAME_MANUAL,
        text=RULE_HTML,
        title="Manuel V2 (Team Update 1)",
    )
    lina = asker()

    query = ask(
        "Quelle est la hauteur maximale du robot en pouces pendant la phase autonome ?",
        this_season,
        lina,
    )

    titles = {citation.chunk.document.title for citation in query.citations.all()}
    assert titles == {"Manuel V2 (Team Update 1)"}


def test_a_failed_citation_write_leaves_no_orphaned_answered_query(monkeypatch):
    import club.rag as rag_module

    this_season = season()
    document(this_season, source=Document.Source.GAME_MANUAL, text=RULE_HTML)
    lina = asker()

    def broken_bulk_create(*args, **kwargs):
        raise RuntimeError("database is unavailable")

    monkeypatch.setattr(
        rag_module.QueryCitation.objects, "bulk_create", broken_bulk_create
    )

    with pytest.raises(RuntimeError):
        ask(
            "Quelle est la hauteur maximale du robot en pouces pendant la phase"
            " autonome ?",
            this_season,
            lina,
        )

    assert not rag_module.RuleQuery.objects.filter(asker=lina).exists()
