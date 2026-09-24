"""The club admin's back office, and the only place accounts are edited by
hand. It shows Django's own admin, so reaching it means reaching the raw
database: `is_staff` is not `is_club_admin`.
"""

from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from django.contrib.auth.forms import AdminUserCreationForm, UserChangeForm
from django.db.models import QuerySet
from django.http import HttpRequest

from .models import (
    Attachment,
    Consent,
    Membership,
    Season,
    Team,
    TeamSeason,
    User,
    VerificationRequest,
)


# Django's user forms are bound to its own User model, which has a username.
class UserCreationForm(AdminUserCreationForm):
    """Creating an account here asks for what the model requires, no more."""

    class Meta:
        model = User
        fields = ("email", "display_name")


class UserEditForm(UserChangeForm):
    """Editing shows every field, including the ones the import sets."""

    class Meta:
        model = User
        fields = "__all__"


class VerificationRequestInline(admin.StackedInline):
    """Shown on the account it belongs to: a pending request is the reason an
    otherwise complete account is still treated as a minor."""

    model = VerificationRequest
    extra = 0
    can_delete = False


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    """Grouped the way the club reads an account: who they are, what
    AssoConnect established, what they may do here."""

    form = UserEditForm
    add_form = UserCreationForm
    inlines = [VerificationRequestInline]

    fieldsets = (
        (None, {"fields": ("email", "password")}),
        ("Profil", {"fields": ("display_name", "contact_email", "avatar")}),
        ("AssoConnect", {"fields": ("assoconnect_id", "birth_date")}),
        ("Club", {"fields": ("club_role", "is_club_admin")}),
        (
            "Permissions",
            {
                "fields": (
                    "is_active",
                    "is_staff",
                    "is_superuser",
                    "groups",
                    "user_permissions",
                )
            },
        ),
        ("Dates", {"fields": ("last_login", "date_joined")}),
    )
    add_fieldsets = (
        (
            None,
            {
                "classes": ("wide",),
                "fields": (
                    "email",
                    "display_name",
                    "usable_password",
                    "password1",
                    "password2",
                ),
            },
        ),
    )
    list_display = ("email", "display_name", "club_role", "is_club_admin", "is_staff")
    # is_minor is computed from the birth date on the current day, so the admin
    # cannot filter on it.
    list_filter = ("club_role", "is_club_admin", "is_staff", "is_active")
    search_fields = ("email", "display_name")
    ordering = ("display_name",)


admin.site.register([Season, Team, TeamSeason, Membership, Consent])


class ToCheckFilter(admin.SimpleListFilter):
    """The one place the club sees what to look at before a publication;
    there is no screen for it in the application."""

    title = "droit à l'image"
    parameter_name = "a_verifier"

    def lookups(
        self, request: HttpRequest, model_admin: admin.ModelAdmin
    ) -> list[tuple[str, str]]:
        return [("oui", "À vérifier")]

    def queryset(
        self, request: HttpRequest, queryset: QuerySet[Attachment]
    ) -> QuerySet[Attachment]:
        if self.value() != "oui":
            return queryset
        return queryset.filter(pk__in=Attachment.objects.to_check().values("pk"))


@admin.register(Attachment)
class AttachmentAdmin(admin.ModelAdmin):
    list_display = ["name", "entry", "uploaded_by", "people_recognisable"]
    list_filter = [ToCheckFilter, "people_recognisable"]
