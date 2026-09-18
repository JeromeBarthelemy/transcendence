"""What sign-up accepts, and what it refuses in French.

Validation runs here and in the browser both, as the subject requires; this
side is the one that decides.
"""

from typing import Any

from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from rest_framework import serializers
from rest_framework.exceptions import ErrorDetail

from club.models import User, VerificationRequest, no_at_sign
from club.signup import reserved_email


class SignUpSerializer(serializers.Serializer[User]):
    """The six things sign-up asks, plus the address, which is optional
    because the youngest members have none."""

    # allow_blank, not required=False: the form always sends the field, and an
    # empty string is how it says "I have no address".
    email = serializers.EmailField(required=False, allow_blank=True)
    password = serializers.CharField(write_only=True, style={"input_type": "password"})
    display_name = serializers.CharField(max_length=80, validators=[no_at_sign])
    club_role = serializers.ChoiceField(
        choices=User.ClubRole.choices, default=User.ClubRole.STUDENT
    )
    # Only ever written to the verification request: the club trusts what is
    # declared here exactly as far as the AssoConnect export confirms it.
    last_name = serializers.CharField(max_length=80)
    first_name = serializers.CharField(max_length=80)
    birth_date = serializers.DateField()

    def validate_email(self, value: str) -> str:
        # Stored lowercased, so a duplicate must be caught lowercased too.
        value = value.lower()
        if value and User.objects.filter(email=value).exists():
            raise serializers.ValidationError(
                "Cette adresse est déjà utilisée.", code="email_taken"
            )
        return value

    def validate_display_name(self, value: str) -> str:
        # On the stored folded column, not on a Lower() computed in the
        # database: SQLite's lower() is ASCII-only, so Élodie would fold to
        # itself and this check would miss a duplicate the constraint then
        # catches as a 500.
        taken = User.objects.filter(display_name_folded=value.casefold()).exists()
        if taken:
            # Same code and same sentence as the database constraint, which
            # stays underneath as the backstop: two callers racing would
            # otherwise reach it and get a 500.
            raise serializers.ValidationError(
                "Ce nom d'affichage est déjà pris. Ajoutez une initiale, "
                "par exemple « Marie D. ».",
                code="display_name_taken",
            )
        return value

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        # Run after the other fields, because the similarity validator
        # compares the password against the name and address it accompanies.
        candidate = User(
            email=attrs.get("email", ""),
            display_name=attrs["display_name"],
        )
        try:
            validate_password(attrs["password"], candidate)
        except DjangoValidationError as refused:
            # Django's validators already name what is wrong —
            # password_too_short, password_too_common, password_too_similar.
            # Rebuilding them as plain strings would throw that away, which is
            # exactly what the front end needs.
            raise serializers.ValidationError(
                {
                    "password": [
                        ErrorDetail(str(message), code=error.code or "invalid")
                        for error in refused.error_list
                        for message in error.messages
                    ]
                }
            ) from refused
        return attrs

    @transaction.atomic
    def create(self, validated_data: dict[str, Any]) -> User:
        """All or nothing: an account without its verification request would
        never be matched, and would stay a minor for ever."""
        email = validated_data.get("email") or reserved_email(
            validated_data["first_name"], validated_data["last_name"]
        )
        user = User.objects.create_user(
            email=email,
            display_name=validated_data["display_name"],
            password=validated_data["password"],
            club_role=validated_data["club_role"],
        )
        VerificationRequest.objects.create(
            user=user,
            last_name=validated_data["last_name"],
            first_name=validated_data["first_name"],
            # Never written to the account: a minor could type any date, so
            # only the export may establish one.
            birth_date=validated_data["birth_date"],
        )
        return user
