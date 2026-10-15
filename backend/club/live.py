"""The work-item board, live: who hears of a change on a team season, and
how it reaches them.

A message only says what changed — the team season, and the work item when
there is one. The screens then reload it through the API, which stays the one
source of what a work item holds: nothing to serialize twice, no row to
merge, and a screen that reconnects simply reloads what it missed.
"""

from typing import Any

from asgiref.sync import async_to_sync
from channels.generic.websocket import JsonWebsocketConsumer
from channels.layers import get_channel_layer
from django.db import transaction
from django.urls import path

from club.api.permissions import readers_of
from club.models import User
from club.presence import connected, current_team_season_ids, disconnected


def person_group(user_id: int) -> str:
    return f"user-{user_id}"


class PersonConsumer(JsonWebsocketConsumer):
    """One socket per signed-in person, opened on every screen. Who hears a
    change is worked out when it is written, not here: someone taken off a
    team stops hearing about it at once.

    Also where online status (#267) comes from: a member's first socket
    and last one are exactly the moments their teammates should be told."""

    group: str | None = None

    def connect(self) -> None:
        user = self.scope["user"]
        if not isinstance(user, User):
            self.close()
            return
        self.group = person_group(user.pk)
        async_to_sync(self.channel_layer.group_add)(self.group, self.channel_name)
        # Before accept(): it sends "websocket.accept" straight through a
        # thread-safe queue, which a test's `await communicator.connect()`
        # can observe before this method's own thread goes on to run the
        # next line — a caller must never be able to see "connected" before
        # is_online() agrees.
        first = connected(user.pk)
        self.accept()
        if first:
            notify_presence_changed(user)

    def disconnect(self, code: int) -> None:
        if self.group is None:
            return
        async_to_sync(self.channel_layer.group_discard)(self.group, self.channel_name)
        user = self.scope["user"]
        assert isinstance(user, User)
        if disconnected(user.pk):
            notify_presence_changed(user)

    def board_changed(self, event: dict[str, Any]) -> None:
        self.send_json(
            {
                "team_season": event["team_season"],
                "work_item": event["work_item"],
                "deleted": event["deleted"],
            }
        )

    def presence_changed(self, event: dict[str, Any]) -> None:
        self.send_json({"presence": True, "team_season": event["team_season"]})


# Django's own path(), as Channels documents it; its type stubs expect a
# private subclass instead, hence the two ignores (here and in asgi.py).
websocket_urlpatterns = [
    path("ws/me/", PersonConsumer.as_asgi()),  # type: ignore[arg-type]
]


def broadcast(
    team_season_id: int, work_item_id: int | None, *, deleted: bool = False
) -> None:
    """Once the write is committed: a screen told before then would reload
    the old state, and one told of a rolled-back write, a change that never
    happened. Robust, since the write stands either way: a failed notice is
    logged, not answered as an error the client would retry.

    `deleted` says the work item is gone: a screen that read it again, as it
    does after any other change, would get a 404."""
    layer = get_channel_layer()
    assert layer is not None

    def send() -> None:
        for user_id in readers_of(team_season_id).values_list("pk", flat=True):
            async_to_sync(layer.group_send)(
                person_group(user_id),
                {
                    "type": "board.changed",
                    "team_season": team_season_id,
                    "work_item": work_item_id,
                    "deleted": deleted,
                },
            )

    transaction.on_commit(send, robust=True)


def notify_presence_changed(user: User) -> None:
    """Told live (#267, reviewing #272): a teammate's dot changes without
    waiting on a poll. Sent at once, not on a transaction's commit — a
    socket opening or closing is not a database write to wait on. Reaches
    the same readers `broadcast` would for each of the member's current
    team seasons, since mentors and teammates are exactly who may see it
    (`shares_current_team`) — `user` themselves excluded, who already
    knows their own status without being told. A mentor has none, so
    nobody is told of theirs — nobody but another mentor could see it
    anyway, and they already poll nothing: they would simply see it next
    time they open that profile."""
    layer = get_channel_layer()
    assert layer is not None
    for team_season_id in current_team_season_ids(user):
        readers = readers_of(team_season_id).exclude(pk=user.pk)
        for reader_id in readers.values_list("pk", flat=True):
            async_to_sync(layer.group_send)(
                person_group(reader_id),
                {"type": "presence.changed", "team_season": team_season_id},
            )
