from django.urls import path

from .views import (
    AttachmentView,
    AvatarView,
    DayView,
    EntryAttachmentsView,
    EntryDetailView,
    ExportView,
    GapsView,
    LoginView,
    LogoutView,
    MemberAvatarView,
    MemberDataExportView,
    MembershipCreateView,
    MembershipDetailView,
    MeView,
    NoteCreateView,
    RuleQuestionView,
    SignUpView,
    TeamDetailView,
    TeamListView,
    TickView,
    UserDetailView,
    UserListView,
    WorkItemDetailView,
    WorkItemListView,
)

# No password-reset route, and that is a decision, not an omission: one
# instance serves one club, in one room. Whoever forgets their password is
# standing in front of the club admin, who identifies them on sight — no token
# does it better — and sets a temporary one from the Django admin.
urlpatterns = [
    path("auth/signup/", SignUpView.as_view(), name="signup"),
    path("auth/login/", LoginView.as_view(), name="login"),
    path("auth/logout/", LogoutView.as_view(), name="logout"),
    path("auth/me/", MeView.as_view(), name="me"),
    path("auth/me/avatar/", AvatarView.as_view(), name="avatar"),
    path("auth/me/export/", MemberDataExportView.as_view(), name="member-export"),
    path("users/<int:pk>/avatar/", MemberAvatarView.as_view(), name="member-avatar"),
    path("users/", UserListView.as_view(), name="user-list"),
    path("users/<int:pk>/", UserDetailView.as_view(), name="user-detail"),
    path("teams/", TeamListView.as_view(), name="team-list"),
    path("teams/<int:pk>/", TeamDetailView.as_view(), name="team-detail"),
    path("memberships/", MembershipCreateView.as_view(), name="membership-create"),
    path(
        "memberships/<int:pk>/",
        MembershipDetailView.as_view(),
        name="membership-detail",
    ),
    path(
        "team-seasons/<int:team_season_id>/work-items/",
        WorkItemListView.as_view(),
        name="work-item-list",
    ),
    path("work-items/<int:pk>/", WorkItemDetailView.as_view(), name="work-item-detail"),
    path("work-items/<int:pk>/tick/", TickView.as_view(), name="work-item-tick"),
    path("entries/<int:pk>/", EntryDetailView.as_view(), name="entry-detail"),
    path(
        "entries/<int:pk>/attachments/",
        EntryAttachmentsView.as_view(),
        name="entry-attachments",
    ),
    path("attachments/<int:pk>/", AttachmentView.as_view(), name="attachment"),
    path(
        "team-seasons/<int:team_season_id>/notes/",
        NoteCreateView.as_view(),
        name="note-create",
    ),
    path(
        "team-seasons/<int:team_season_id>/days/<str:day>/",
        DayView.as_view(),
        name="day",
    ),
    path(
        "team-seasons/<int:team_season_id>/gaps/",
        GapsView.as_view(),
        name="gaps",
    ),
    path(
        "team-seasons/<int:team_season_id>/export/",
        ExportView.as_view(),
        name="export",
    ),
    path("rules/ask/", RuleQuestionView.as_view(), name="rule-ask"),
]
