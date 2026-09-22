"""Two requests racing past the same check. Real threads would not share
SQLite's in-memory test database, so the interleaving is played in order
instead: exactly the one two simultaneous requests produce."""


def overtaken_by(monkeypatch, serializer_class, rival):
    """Lets `rival`, a request made by calling it, through between the
    validation of the request under test and its write. Returns the list the
    rival's status code lands in."""
    save = serializer_class.save
    answers = []

    def rival_first(serializer, **kwargs):
        # The rival goes through the real save, or it would be overtaken too.
        monkeypatch.setattr(serializer_class, "save", save)
        answers.append(rival().status_code)
        return save(serializer, **kwargs)

    monkeypatch.setattr(serializer_class, "save", rival_first)
    return answers
