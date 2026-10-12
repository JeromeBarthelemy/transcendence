import json

import pytest

from club.generation import GenerationError
from club.models import Document, Season, User
from club.rag import (
    GENERATION_UNAVAILABLE,
    NO_ANSWER,
    ask,
    chunk_manual,
    chunk_qa,
    embed,
    glossary_for,
    ingest_document,
    parse_glossary,
)

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
# asterisk (A204, the exact shape that made the PDF miss it). Ends with a
# trimmed copy of the real glossary table (#136), same shape as the real
# manual's own (confirmed against it while building parse_glossary): a
# heading titled "Glossary" wrapped in several anchors, then a header row
# ("Term", "Definition") and two data rows.
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
<h1><a name="_Ref9"></a><a name="_Toc9"></a><a name="_Toc10">16<span>&nbsp;&nbsp;&nbsp;</span>Glossary</a></h1>
<p>The following definitions and terms are used for the FIRST Tech Challenge game.</p>
<table class=MsoTable15Grid1LightAccent1 border=1>
<tr><td><p><b>Term</b></p></td><td><p><b>Definition</b></p></td></tr>
<tr><td><p><b>ALLIANCE</b></p></td><td><p>a cooperative of 2 FIRST Tech Challenge teams</p></td></tr>
<tr><td><p><b>DISABLED</b></p></td><td><p>The REFEREE instructs the team to stop the ROBOT</p></td></tr>
</table>
</body></html>
"""


# The board's real shape (game-qa.firstinspires.org/boards/2027/FTC/QA,
# fetched while building chunk_qa): its own script reads its data from a
# plain `Object.assign(window, {...})`, not a dedicated endpoint. Real
# field names, two of the board's own real questions (one answered, one
# not — Q22's own title and content, shortened), built through `json.dumps`
# rather than hand-escaped so the HTML inside `content` stays exactly what
# the board itself would emit.
REAL_QA_BOARD_EXCERPT = (
    "<html><body><script>\n"
    "Object.assign(window, "
    + json.dumps(
        {
            "questions": [
                {
                    "number": 21,
                    "title": "Touching Perimeter Wall at PARK",
                    "content": (
                        "<p>If a ROBOT is contacting the perimeter wall in "
                        "the LOADING ZONE after PARK, does the team not earn "
                        "LEAVE points?</p>"
                    ),
                    "status": "ANSWERED",
                    "answer": {
                        "content": (
                            "<p>No. Section 10.5 bullet F clarifies that the "
                            "LEAVE achievement is only evaluated at the end "
                            "of the AUTO period, and NOT in real-time.</p>"
                        ),
                    },
                },
                {
                    "number": 22,
                    "title": "Extracted potentiometer from legal servos",
                    "content": ("<p>Is this allowed to be used on the robot?</p>"),
                    # Submitted, not yet answered — never a passage.
                    "status": "ACCEPTED",
                },
            ],
            "board": {
                "season": {
                    "gameName": "BIOBUZZ",
                    "startYear": 2026,
                    "yearString": "2026-2027",
                }
            },
        }
    )
    + ");\n</script></body></html>"
)


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
    references = [reference for reference, _, _ in chunk_manual(REAL_HTML_EXCERPT)]

    assert "G101" in references
    assert "G102" in references
    assert "G201" in references


def test_a_rules_text_does_not_leak_into_the_next_ones_chunk():
    passages = {ref: text for ref, _, text in chunk_manual(REAL_HTML_EXCERPT)}

    assert "stay off the FIELD" in passages["G101"]
    assert "Climbing on" not in passages["G101"]
    assert "Climbing on" in passages["G102"]


def test_a_bare_cross_reference_does_not_start_a_new_chunk():
    # A mid-sentence mention of G101 is marked with a different span
    # (`CrossRefChar`) and carries no anchor of its own, unlike the real
    # opening of a rule — it must stay part of whichever chunk was already
    # open (G101's own), not start a second one.
    passages = {ref: text for ref, _, text in chunk_manual(REAL_HTML_EXCERPT)}

    assert "covered further" in passages["G101"]


def test_a_table_stays_attached_to_the_rule_before_it():
    # The exact shape that broke on the real manual: R609's wire-gauge
    # table came out as its own fake sections ("18", "22", "28") under the
    # PDF chunker. A table has no anchor or heading of its own, so it must
    # merge into whichever rule was still open when it appears.
    passages = {ref: text for ref, _, text in chunk_manual(REAL_HTML_EXCERPT)}

    assert "18 AWG" in passages["G102"]


def test_a_rule_id_with_a_space_after_its_asterisk_is_still_found():
    # The other real miss: the PDF rendered some rules with a space after
    # their own asterisk ("A204 *​ Have the right..."), which the old
    # line-start regex didn't allow, so their text was folded into the
    # rule before them instead. The anchor doesn't care about the
    # asterisk's spacing at all.
    passages = {ref: text for ref, _, text in chunk_manual(REAL_HTML_EXCERPT)}

    assert "A204" in passages
    assert "Initial Interview" in passages["A204"]


def test_a_heading_with_nothing_but_itself_before_the_next_rule_is_dropped():
    # #134: "11" (Game Rules (G)) and "11.1" (Personal Safety) are each
    # immediately followed by a rule, with no body paragraph of their own
    # in between — on the real manual this shape accounts for 31 of its
    # 364 passages, every one of them a citation that could only ever
    # point back at its own heading text.
    references = [reference for reference, _, _ in chunk_manual(REAL_HTML_EXCERPT)]

    assert "11" not in references
    assert "11.1" not in references
    assert "11.2" not in references


def test_a_heading_with_real_body_text_is_kept_as_its_own_chunk():
    html = (
        "<h2><a name=_Toc9></a>5.1<span>&nbsp;</span>Robot Sizing</h2>"
        "<p>This section covers the limits placed on a ROBOT's size.</p>"
        "<p class=RuleNumber-Game><a name=G500></a><b>G500</b> "
        "<span class=Headline-Evergreen>*A rule.</span> Some text.</p>"
    )

    passages = {ref: text for ref, _, text in chunk_manual(html)}

    assert "5.1" in passages
    assert "Robot Sizing" in passages["5.1"]
    assert "limits placed" in passages["5.1"]


def test_a_rules_anchor_is_its_own_reference():
    anchors = {ref: anchor for ref, anchor, _ in chunk_manual(REAL_HTML_EXCERPT)}

    assert anchors["G101"] == "G101"
    assert anchors["G102"] == "G102"


def test_a_sections_anchor_is_its_word_generated_toc_id_not_its_number():
    # #134: what "Voir dans le manuel" jumps to is the id Word planted on
    # the heading, never the human-readable section number shown as
    # `reference` — the page has no element named "5.1" to jump to.
    html = (
        "<h2><a name=_Toc9></a>5.1<span>&nbsp;</span>Robot Sizing</h2>"
        "<p>This section covers the limits placed on a ROBOT's size.</p>"
    )

    anchors = {ref: anchor for ref, anchor, _ in chunk_manual(html)}

    assert anchors["5.1"] == "_Toc9"


def test_only_the_first_toc_anchor_is_kept_and_ref_bookmarks_are_ignored():
    # Word plants several anchors ahead of one heading: more than one
    # _Toc id (interchangeable, all jump to the same spot) and sometimes a
    # _Ref bookmark (a cross-reference target, useless as a jump link).
    html = (
        "<h2><a name=_Toc1></a><a name=_Toc2></a><a name=_Ref3></a>5.1"
        "<span>&nbsp;</span>Robot Sizing</h2>"
        "<p>This section covers the limits placed on a ROBOT's size.</p>"
    )

    anchors = {ref: anchor for ref, anchor, _ in chunk_manual(html)}

    assert anchors["5.1"] == "_Toc1"


def test_table_of_contents_entries_are_not_mistaken_for_section_headings():
    # A ToC entry has the same "number, title" shape a real heading does;
    # what tells them apart in the HTML export is the paragraph style
    # (MsoToc1), never a real <h1>-<h3>. The ToC line here ("11 Game Rules
    # (G) .......... 99") must fold into front matter, not open its own
    # "11" chunk — only the real <h1> heading further down does that.
    passages = {ref: text for ref, _, text in chunk_manual(REAL_HTML_EXCERPT)}

    assert "Game Rules (G) .......... 99" in passages[""]


def test_text_before_the_first_rule_or_section_is_kept_unreferenced():
    passages = chunk_manual(
        "<p>Some front matter.</p><p>More of it.</p><h1>1 Intro</h1>"
    )

    reference, anchor, text = passages[0]
    assert reference == ""
    assert anchor == ""
    assert "front matter" in text


def test_a_rule_longer_than_the_word_budget_is_resplit_under_the_same_reference():
    html = (
        "<p class=RuleNumber-Game><a name=G999></a><b>G999</b> *A very long rule. "
        + " ".join(f"word{n}" for n in range(400))
        + "</p>"
    )

    passages = [triple for triple in chunk_manual(html) if triple[0] == "G999"]

    assert len(passages) > 1
    assert all(reference == "G999" for reference, _, _ in passages)
    assert all(anchor == "G999" for _, anchor, _ in passages)
    # Every word still appears somewhere — nothing dropped at the split.
    joined = " ".join(text for _, _, text in passages)
    assert "word0" in joined
    assert "word399" in joined


# --- chunking (glossary) ---


def test_the_glossary_table_is_not_chunked_as_regular_passages():
    # #136: before parse_glossary, this table's rows had no reference of
    # their own and folded into one chunk under "16" (the heading), re-
    # split into a handful of passages mixing every term and definition
    # together — neither a citation nor a glossary entry worth showing.
    chunks = chunk_manual(REAL_HTML_EXCERPT)

    assert "16" not in [reference for reference, _, _ in chunks]
    assert not any("cooperative of 2" in text for _, _, text in chunks)


def test_content_before_the_glossary_heading_is_still_chunked():
    # Truncating at the glossary must not also drop everything before it.
    references = [reference for reference, _, _ in chunk_manual(REAL_HTML_EXCERPT)]

    assert "G101" in references
    assert "A204" in references


def test_the_manuals_glossary_terms_are_read_as_pairs():
    terms = dict(parse_glossary(REAL_HTML_EXCERPT))

    assert terms == {
        "ALLIANCE": "a cooperative of 2 FIRST Tech Challenge teams",
        "DISABLED": "The REFEREE instructs the team to stop the ROBOT",
    }


def test_the_glossary_tables_own_header_row_is_not_read_as_a_term():
    terms = dict(parse_glossary(REAL_HTML_EXCERPT))

    assert "Term" not in terms


def test_a_document_with_no_glossary_heading_has_no_terms():
    assert parse_glossary("<p>No glossary here.</p>") == []


# --- chunking (Q&A) ---


def test_an_answered_question_becomes_its_own_chunk_named_by_its_number():
    references = [reference for reference, _, _ in chunk_qa(REAL_QA_BOARD_EXCERPT)]

    assert references == ["Q21"]


def test_an_unanswered_question_is_not_indexed():
    # Q22 is on the board (status "ACCEPTED") but has no answer yet.
    references = [reference for reference, _, _ in chunk_qa(REAL_QA_BOARD_EXCERPT)]

    assert "Q22" not in references


def test_a_qa_chunk_has_no_anchor_of_its_own():
    # A citation does not yet link anywhere of its own on the board.
    anchors = {ref: anchor for ref, anchor, _ in chunk_qa(REAL_QA_BOARD_EXCERPT)}

    assert anchors["Q21"] == ""


def test_a_qa_chunks_text_combines_its_title_question_and_answer():
    passages = {ref: text for ref, _, text in chunk_qa(REAL_QA_BOARD_EXCERPT)}

    text = passages["Q21"]
    assert "Touching Perimeter Wall at PARK" in text
    assert "contacting the perimeter wall in the LOADING ZONE" in text
    assert "only evaluated at the end of the AUTO period" in text
    # The board writes rich text, not plain text — none of its own markup
    # belongs in a passage a question is searched against.
    assert "<p>" not in text
    assert "<" not in text


def test_a_page_with_no_board_data_yields_no_passages():
    assert chunk_qa("<html><body><p>Not a board page.</p></body></html>") == []


# --- ingestion ---


def test_ingesting_a_document_creates_its_chunks():
    doc = document(season(), text=REAL_HTML_EXCERPT)

    assert doc.chunks.count() > 1
    assert set(doc.chunks.values_list("reference", flat=True)) >= {"G101", "G102"}


def test_ingesting_a_qa_document_chunks_by_answered_question():
    doc = document(
        season(), source=Document.Source.OFFICIAL_QA, text=REAL_QA_BOARD_EXCERPT
    )

    assert set(doc.chunks.values_list("reference", flat=True)) == {"Q21"}


def test_ingesting_a_manual_creates_its_glossary_terms():
    doc = document(season(), text=REAL_HTML_EXCERPT)

    terms = {t.term: t.definition for t in doc.glossary_terms.all()}
    assert terms == {
        "ALLIANCE": "a cooperative of 2 FIRST Tech Challenge teams",
        "DISABLED": "The REFEREE instructs the team to stop the ROBOT",
    }


def test_ingesting_a_qa_document_creates_no_glossary_terms():
    # The Q&A board has no glossary of its own to read — only a
    # game_manual's own text is ever parsed for one.
    doc = document(
        season(), source=Document.Source.OFFICIAL_QA, text=REAL_QA_BOARD_EXCERPT
    )

    assert not doc.glossary_terms.exists()


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

    # #207's own review: previously silent (""), indistinguishable on
    # screen from a question simply having no sentence worth writing.
    assert query.answer == GENERATION_UNAVAILABLE
    assert query.citations.exists()


def test_a_generation_failure_logs_its_cause(monkeypatch, caplog):
    # #207's own review: GenerationError was swallowed without a trace,
    # so "the model is busy", "the timeout fired" and "a bad citation"
    # all looked identical from the outside.
    this_season = season()
    document(this_season, source=Document.Source.GAME_MANUAL, text=RULE_HTML)
    lina = asker()

    def failing(question, chunks):
        raise GenerationError("hors ligne")

    monkeypatch.setattr("club.rag.generate_answer", failing)

    with caplog.at_level("WARNING"):
        ask(
            "Quelle est la hauteur maximale du robot en pouces pendant la "
            "phase autonome ?",
            this_season,
            lina,
        )

    assert "hors ligne" in caplog.text


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


# --- glossary ---


def test_glossary_for_reads_the_latest_manuals_terms():
    this_season = season()
    document(this_season, text=RULE_HTML, title="Manuel V1 (pas de glossaire)")
    document(this_season, text=REAL_HTML_EXCERPT, title="Manuel V2 (Team Update 1)")

    terms = {t.term: t.definition for t in glossary_for(this_season)}

    assert "ALLIANCE" in terms


def test_glossary_for_an_older_manual_is_not_mixed_in():
    # Same "latest document per source" rule `ask` itself follows: an
    # amended glossary alongside its own superseded one would leave a
    # student unsure which definition to trust.
    this_season = season()
    document(this_season, text=REAL_HTML_EXCERPT, title="Manuel V1")
    document(this_season, text=RULE_HTML, title="Manuel V2 (pas de glossaire)")

    assert glossary_for(this_season) == []


def test_glossary_for_a_season_with_no_manual_is_empty():
    this_season = season(2026, "BioBuzz")

    assert glossary_for(this_season) == []
