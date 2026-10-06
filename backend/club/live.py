"""The work-item board, live: who listens to a team season, and how a change
reaches them.

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

from club.api.permissions import team_seasons_open_to
from club.models import User


def group_name(team_season_id: int) -> str:
    return f"team-season-{team_season_id}"


class TeamSeasonConsumer(JsonWebsocketConsumer):
    """Listens only: every write goes through the API and its checks."""

    group: str | None = None

    def connect(self) -> None:
        user = self.scope["user"]
        team_season_id = self.scope["url_route"]["kwargs"]["team_season_id"]
        # A visitor is an AnonymousUser, not a User. Then the API's own rule:
        # a member hears their team, a mentor any of them.
        if not isinstance(user, User) or not (
            team_seasons_open_to(user).filter(pk=team_season_id).exists()
        ):
            self.close()
            return
        self.group = group_name(team_season_id)
        async_to_sync(self.channel_layer.group_add)(self.group, self.channel_name)
        self.accept()

    def disconnect(self, code: int) -> None:
        if self.group is not None:
            async_to_sync(self.channel_layer.group_discard)(
                self.group, self.channel_name
            )

    def work_items_changed(self, event: dict[str, Any]) -> None:
        self.send_json({"work_item": event["work_item"]})


# Django's own path(), as Channels documents it; its type stubs expect a
# private subclass instead, hence the two ignores (here and in asgi.py).
websocket_urlpatterns = [
    path(
        "ws/team-seasons/<int:team_season_id>/",
        TeamSeasonConsumer.as_asgi(),  # type: ignore[arg-type]
    ),
]


def broadcast(team_season_id: int, work_item_id: int | None) -> None:
    """Once the write is committed: a screen told before then would reload
    the old state, and one told of a rolled-back write, a change that never
    happened. Robust, since the write stands either way: a failed notice is
    logged, not answered as an error the client would retry."""
    layer = get_channel_layer()
    assert layer is not None
    transaction.on_commit(
        lambda: async_to_sync(layer.group_send)(
            group_name(team_season_id),
            {"type": "work_items.changed", "work_item": work_item_id},
        ),
        robust=True,
    )
