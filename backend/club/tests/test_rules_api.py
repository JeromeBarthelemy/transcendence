from club.models import Document, Season, User
from club.rag import ingest_document

RULE = "Le robot ne doit jamais dépasser dix-huit pouces de hauteur en autonome."
RULE_HTML = f"<p>{RULE}</p>"


def season(start_year=2026, game_name="BioBuzz"):
    return Season.objects.create(start_year=start_year, game_name=game_name)


def student(email="lina@club.fr", display_name="Lina"):
    return User.objects.create_user(email, display_name)


def test_a_member_asks_a_question_and_is_cited(client):
    this_season = season()
    ingest_document(
        season=this_season,
        source=Document.Source.GAME_MANUAL,
        title="Manuel BioBuzz",
        text=RULE_HTML,
    )
    client.force_login(student())

    response = client.post(
        "/api/rules/ask/",
        {
            "question": (
                "Quelle est la hauteur maximale du robot en pouces "
                "pendant la phase autonome ?"
            )
        },
        content_type="application/json",
    )

    assert response.status_code == 201
    body = response.json()
    assert body["answer"] == ""
    (citation,) = body["citations"]
    assert citation["authority"] == "binding"
    assert citation["document_title"] == "Manuel BioBuzz"


def test_a_citation_carries_its_rule_reference(client):
    this_season = season()
    ingest_document(
        season=this_season,
        source=Document.Source.GAME_MANUAL,
        title="Manuel BioBuzz",
        text=(
            "<p class=RuleNumber-Game><a name=G420></a><b>G420</b> "
            "*Do not tip or entangle. " + RULE + "</p>"
        ),
    )
    client.force_login(student())

    response = client.post(
        "/api/rules/ask/",
        {
            "question": (
                "Quelle est la hauteur maximale du robot en pouces "
                "pendant la phase autonome ?"
            )
        },
        content_type="application/json",
    )

    (citation,) = response.json()["citations"]
    assert citation["reference"] == "G420"


def test_a_citation_without_a_source_url_carries_no_link(client):
    this_season = season()
    ingest_document(
        season=this_season,
        source=Document.Source.GAME_MANUAL,
        title="Manuel BioBuzz",
        text=RULE_HTML,
    )
    client.force_login(student())

    response = client.post(
        "/api/rules/ask/",
        {
            "question": (
                "Quelle est la hauteur maximale du robot en pouces "
                "pendant la phase autonome ?"
            )
        },
        content_type="application/json",
    )

    (citation,) = response.json()["citations"]
    assert citation["url"] is None


def test_a_citation_links_to_its_own_place_in_the_manual(client):
    # #134: the URL a student is shown is the document's own page plus
    # this passage's own anchor on it, not just the document's own URL.
    this_season = season()
    ingest_document(
        season=this_season,
        source=Document.Source.GAME_MANUAL,
        title="Manuel BioBuzz",
        url="https://ftc-resources.firstinspires.org/ftc/game/cm-html/manual.htm",
        text=(
            "<p class=RuleNumber-Game><a name=G420></a><b>G420</b> "
            "*Do not tip or entangle. " + RULE + "</p>"
        ),
    )
    client.force_login(student())

    response = client.post(
        "/api/rules/ask/",
        {
            "question": (
                "Quelle est la hauteur maximale du robot en pouces "
                "pendant la phase autonome ?"
            )
        },
        content_type="application/json",
    )

    (citation,) = response.json()["citations"]
    assert citation["url"] == (
        "https://ftc-resources.firstinspires.org/ftc/game/cm-html/manual.htm#G420"
    )


def test_an_unrelated_question_carries_the_refusal(client):
    this_season = season()
    ingest_document(
        season=this_season,
        source=Document.Source.GAME_MANUAL,
        title="Manuel BioBuzz",
        text=RULE_HTML,
    )
    client.force_login(student())

    response = client.post(
        "/api/rules/ask/",
        {"question": "Combien de membres dans le comité des sponsors ?"},
        content_type="application/json",
    )

    body = response.json()
    assert body["answer"] != ""
    assert body["citations"] == []


def test_a_blank_question_is_refused(client):
    client.force_login(student())

    response = client.post(
        "/api/rules/ask/", {"question": ""}, content_type="application/json"
    )

    assert response.status_code == 400


def test_an_anonymous_caller_cannot_ask(client):
    response = client.post(
        "/api/rules/ask/", {"question": "?"}, content_type="application/json"
    )

    assert response.status_code in (401, 403)


def test_without_an_open_season_the_question_is_refused(client):
    client.force_login(student())

    response = client.post(
        "/api/rules/ask/",
        {"question": "Hauteur maximale ?"},
        content_type="application/json",
    )

    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "no_season"


GLOSSARY_HTML = (
    RULE_HTML + '<h1><a name="_Toc9">16 Glossary</a></h1>'
    "<p>The following definitions and terms are used for the game.</p>"
    "<table><tr><td><p><b>Term</b></p></td><td><p><b>Definition</b></p></td></tr>"
    "<tr><td><p><b>ALLIANCE</b></p></td>"
    "<td><p>a cooperative of 2 FIRST Tech Challenge teams</p></td></tr></table>"
)


def test_a_member_reads_the_current_seasons_glossary(client):
    this_season = season()
    ingest_document(
        season=this_season,
        source=Document.Source.GAME_MANUAL,
        title="Manuel BioBuzz",
        text=GLOSSARY_HTML,
    )
    client.force_login(student())

    response = client.get("/api/rules/glossary/")

    assert response.status_code == 200
    assert response.json() == [
        {
            "term": "ALLIANCE",
            "definition": "a cooperative of 2 FIRST Tech Challenge teams",
        }
    ]


def test_an_anonymous_caller_cannot_read_the_glossary(client):
    response = client.get("/api/rules/glossary/")

    assert response.status_code in (401, 403)


def test_without_an_open_season_the_glossary_is_quietly_empty(client):
    # Unlike asking a question, nothing here is a student action waiting
    # on a season to exist — the panel just has nothing to show yet.
    client.force_login(student())

    response = client.get("/api/rules/glossary/")

    assert response.status_code == 200
    assert response.json() == []
