from club.ranking import keyword_scores, windows


def test_a_plural_in_the_question_matches_the_manuals_singular():
    scores = keyword_scores(
        "How many batteries?", ["One BATTERY only.", "Motors are limited."]
    )

    assert scores[0] > 0
    assert scores[1] == 0


def test_common_words_alone_match_nothing():
    scores = keyword_scores("What can we do with it?", ["We can do it with care."])

    assert scores[0] == 0


def test_a_word_rare_in_the_manual_outweighs_a_common_one():
    texts = ["ROBOT size.", "ROBOT weight.", "ROBOT laser pointer."]

    scores = keyword_scores("Can the robot carry a laser?", texts)

    assert scores.argmax() == 2


def test_a_short_rule_is_read_in_one_window():
    assert windows("R101 A short rule.") == ["R101 A short rule."]


def test_a_long_rule_is_read_in_overlapping_windows():
    text = " ".join(f"w{n}" for n in range(200))

    parts = windows(text)

    assert [part.split()[0] for part in parts] == ["w0", "w60", "w120"]
    assert all(len(part.split()) <= 120 for part in parts)


def test_each_table_row_is_also_read_alone_under_the_rules_heading_and_caption():
    # A row of a long table is drowned in a 120-word window of its
    # neighbours; read alone, under what says what it counts, it ranks.
    text = (
        "10.5.5 Point Values\n"
        "Table 10-2: BIOBUZZ Point Values\n"
        "LEAVE; MATCH points AUTO: 3\n"
        "PARK; MATCH points AUTO: 5"
    )

    parts = windows(text)

    assert parts[0] == text
    above = "10.5.5 Point Values ... Table 10-2: BIOBUZZ Point Values ... "
    assert parts[1:] == [
        above + "LEAVE; MATCH points AUTO: 3",
        above + "PARK; MATCH points AUTO: 5",
    ]
