from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from django.contrib.auth.forms import AdminUserCreationForm, UserChangeForm

from .models import Consent, Membership, Season, Team, TeamSeason, User


# Django's user forms are bound to its own User model, which has a username.
class UserCreationForm(AdminUserCreationForm):
    class Meta:
        model = User
        fields = ("email", "display_name")


class UserEditForm(UserChangeForm):
    class Meta:
        model = User
        fields = "__all__"


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    form = UserEditForm
    add_form = UserCreationForm

    fieldsets = (
        (None, {"fields": ("email", "password")}),
        ("Profil", {"fields": ("display_name", "avatar")}),
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
