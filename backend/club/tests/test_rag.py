import pytest

from club.models import Document, Season, User
from club.rag import ask, chunk_rules, embed, ingest_document

RULE = (
    "Le robot ne doit jamais dépasser dix-huit pouces de hauteur pendant "
    "la phase autonome du match, sous peine de pénalité majeure."
)
UNRELATED = "Les inscriptions au tournoi régional ferment le premier mars."

# A real excerpt (pypdf's own extraction of BioBuzz page 99), running
# headers, wrapped lines and all — chunk_rules is tested against what the
# manual actually looks like, not an idealised version of it.
REAL_EXCERPT = """
Section 11 Game Rules (G) V1 99 of 173

11 Game Rules  (G)
11.1 Personal Safety
G101 *Humans, stay off the FIELD during the MATCH. A team member may not enter the FIELD during a
MATCH.
Violation: VERBAL WARNING.
The intent of this rule is that team members should stay outside of the FIELD
perimeter during a MATCH and not impact a MATCH except as allowed in
Section 11.4.6 Human. A team member stepping onto the FIELD or hanging a
large portion of their body over the FIELD is a violation of this rule.
G102 *Be careful when interacting with ARENA elements. A team member is prohibited from the following
actions with regards to interaction with ARENA elements:
A. climbing on,
B. hanging from,
and
D. damaging.
Violation: VERBAL WARNING.
DRIVE TEAM members may brace the FIELD perimeter at any point during the
MATCH. Moving the FIELD perimeter out of position is considered a violation of
G102.C.
11.2 Conduct
G201 *Be a good person. All teams must be civil toward everyone and respectful of team and event
equipment while at a FIRST Tech Challenge event.
"""


def season(start_year=2026, game_name="BioBuzz"):
    return Season.objects.create(start_year=start_year, game_name=game_name)


def asker(email="lina@club.fr", display_name="Lina"):
    return User.objects.create_user(email, display_name)


def document(the_season, source=Document.Source.GAME_MANUAL, text=RULE, title="Manuel"):
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
    references = [reference for reference, _ in chunk_rules(REAL_EXCERPT)]

    assert "G101" in references
    assert "G102" in references
    assert "G201" in references


def test_a_rules_text_does_not_leak_into_the_next_ones_chunk():
    passages = dict(chunk_rules(REAL_EXCERPT))

    assert "stay off the FIELD" in passages["G101"]
    assert "climbing on" not in passages["G101"]
    assert "climbing on" in passages["G102"]


def test_a_bare_cross_reference_does_not_start_a_new_chunk():
    # "G102.C." closes a sentence inside G201's predecessor — a real rule
    # header is always "ID <space> Title", never "ID.letter." with no
    # space, so this must stay part of G102's own chunk.
    passages = dict(chunk_rules(REAL_EXCERPT))

    assert "G102.C" in passages["G102"]


def test_a_numbered_section_becomes_its_own_chunk():
    passages = dict(chunk_rules(REAL_EXCERPT))

    assert "Personal Safety" in passages["11.1"]
    assert "Conduct" in passages["11.2"]


def test_running_page_headers_are_dropped():
    assert not any("V1 99 of 173" in text for _, text in chunk_rules(REAL_EXCERPT))


def test_table_of_contents_entries_are_not_mistaken_for_section_headings():
    # A ToC line ("1.1 About FIRST® .......... 5") has the same "number,
    # title" shape a real heading does; only the dot leader tells them
    # apart, and it must not create a chunk of its own.
    toc = (
        "1.1 About FIRST® "
        + "." * 80
        + " 5\n1.2 FIRST Tech Challenge "
        + ("." * 80)
        + " 6\nG101 *A real rule starts the body."
    )

    references = [reference for reference, _ in chunk_rules(toc)]

    assert "1.1" not in references
    assert "1.2" not in references
    assert "G101" in references


def test_text_before_the_first_rule_or_section_is_kept_unreferenced():
    reference, text = chunk_rules("Some front matter.\nG101 *A real rule.")[0]

    assert reference == ""
    assert "front matter" in text


def test_a_rule_longer_than_the_word_budget_is_resplit_under_the_same_reference():
    body = "G999 *A very long rule. " + " ".join(f"word{n}" for n in range(400))

    passages = [pair for pair in chunk_rules(body) if pair[0] == "G999"]

    assert len(passages) > 1
    assert all(reference == "G999" for reference, _ in passages)
    # Every word still appears somewhere — nothing dropped at the split.
    joined = " ".join(text for _, text in passages)
    assert "word0" in joined
    assert "word399" in joined


# --- ingestion ---


def test_ingesting_a_document_creates_its_chunks():
    doc = document(season(), text=REAL_EXCERPT)

    assert doc.chunks.count() > 1
    assert set(doc.chunks.values_list("reference", flat=True)) >= {"G101", "G102"}


def test_authority_is_read_off_source_not_asked_for():
    manual = document(season(), source=Document.Source.GAME_MANUAL)
    qa = document(season(2027, "Rebound"), source=Document.Source.OFFICIAL_QA)
    forum = document(season(2028, "Centerstage"), source=Document.Source.FORUM)

    assert manual.authority == Document.Authority.BINDING
    assert qa.authority == Document.Authority.RULING
    assert forum.authority == Document.Authority.COMMUNITY


# --- asking ---


def test_a_question_matching_the_manual_is_answered_and_cited():
    this_season = season()
    document(this_season, source=Document.Source.GAME_MANUAL, text=RULE)
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
    document(this_season, source=Document.Source.GAME_MANUAL, text=RULE)
    lina = asker()

    query = ask(
        "Is a robot allowed to be taller than usual during the early part of a match?",
        this_season,
        lina,
    )

    assert query.answer == ""
    assert query.citations.exists()


def test_a_question_matching_only_a_forum_post_is_refused():
    this_season = season()
    document(this_season, source=Document.Source.FORUM, text=RULE)
    lina = asker()

    query = ask(
        "Quelle est la hauteur maximale du robot en pouces pendant la phase autonome ?",
        this_season,
        lina,
    )

    assert query.answer != ""
    (citation,) = query.citations.all()
    assert citation.chunk.document.authority == Document.Authority.COMMUNITY


def test_a_manual_match_outweighs_a_forum_match_present_too():
    # The refusal is about whether *any* trusted source backs the answer,
    # not about which single passage ranks first.
    this_season = season()
    document(this_season, source=Document.Source.GAME_MANUAL, text=RULE, title="Manuel")
    document(this_season, source=Document.Source.FORUM, text=RULE, title="Forum copie")
    lina = asker()

    query = ask(
        "Quelle est la hauteur maximale du robot en pouces pendant la phase autonome ?",
        this_season,
        lina,
    )

    assert query.answer == ""


def test_citations_are_ranked_by_authority_before_score():
    # A forum copy of the same rule, phrased closer to the question, would
    # out-score the manual's own wording on similarity alone — authority
    # must still put the manual first (the manual itself says so, §1.7.4).
    this_season = season()
    document(this_season, source=Document.Source.GAME_MANUAL, text=RULE, title="Manuel")
    document(
        this_season,
        source=Document.Source.FORUM,
        text="Quelle est la hauteur maximale du robot en pouces pendant l'autonome ?"
        " " + RULE,
        title="Forum copie",
    )
    lina = asker()

    query = ask(
        "Quelle est la hauteur maximale du robot en pouces pendant la phase autonome ?",
        this_season,
        lina,
    )

    citations = list(query.citations.order_by("rank"))
    assert citations[0].chunk.document.authority == Document.Authority.BINDING


def test_an_unrelated_question_finds_nothing_and_is_refused():
    this_season = season()
    document(this_season, source=Document.Source.GAME_MANUAL, text=RULE)
    lina = asker()

    query = ask("Combien de membres dans le comité des sponsors ?", this_season, lina)

    assert query.answer != ""
    assert not query.citations.exists()


def test_another_seasons_documents_are_not_searched():
    this_season = season(2026, "BioBuzz")
    other_season = season(2027, "Rebound")
    document(other_season, source=Document.Source.GAME_MANUAL, text=RULE)
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
        text="Le robot ne doit jamais dépasser douze pouces de hauteur en autonome.",
        title="Manuel V1",
    )
    document(
        this_season,
        source=Document.Source.GAME_MANUAL,
        text=RULE,
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
    document(this_season, source=Document.Source.GAME_MANUAL, text=RULE)
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
