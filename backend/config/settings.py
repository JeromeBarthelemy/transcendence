"""Settings for the Fieldnotes project.

Everything that differs between a laptop and the club's machine comes from the
environment, read from a `.env` file that is never committed — `.env.example`
lists the keys without their values, as the subject requires.

The deployment target shapes several choices below: one instance, in one room,
on one machine, serving one club. No inbound traffic from outside that room.
"""

import os
from pathlib import Path

from dotenv import load_dotenv

# backend/config/settings.py -> backend/
BASE_DIR = Path(__file__).resolve().parent.parent

load_dotenv(BASE_DIR / ".env")


def env_bool(name: str, default: bool = False) -> bool:
    """A .env holds text: 1, true, yes and on all mean true, anything else
    means false — a typo never silently turns a protection off."""
    return os.environ.get(name, str(default)).strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


def env_list(name: str, default: str = "") -> list[str]:
    """A comma-separated .env value, with blanks dropped: a trailing comma is
    not an empty host."""
    return [
        item.strip()
        for item in os.environ.get(name, default).split(",")
        if item.strip()
    ]


# ---------------------------------------------------------------------------
# Core
# ---------------------------------------------------------------------------

# No fallback value on purpose: a project that boots with a default secret key
# eventually ships with it.
SECRET_KEY = os.environ["DJANGO_SECRET_KEY"]

# Defaults to False so that forgetting the variable fails safe.
DEBUG = env_bool("DJANGO_DEBUG", False)

ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1")

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "club",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

ASGI_APPLICATION = "config.asgi.application"
WSGI_APPLICATION = "config.wsgi.application"


# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------

# SQLite, settled: the database travels in a bag with the pit laptop and is
# backed up by copying one file.
#
# DJANGO_DB_PATH only matters in production: the container built from
# Dockerfile has no bind mount to keep BASE_DIR/db.sqlite3 outside the image
# the way the dev Compose stack does, so compose.prod.yml points this at a
# named volume instead — still one file, just one a `down` does not erase.
DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": Path(os.environ.get("DJANGO_DB_PATH", BASE_DIR / "db.sqlite3")),
        "OPTIONS": {
            # WAL lets readers work while a writer holds the database, which is
            # what a room full of students saving at once looks like.
            # IMMEDIATE takes the write lock at the start of a transaction
            # instead of midway, which is what turns "database is locked" into
            # a short wait. `timeout` is how long that wait may be.
            "init_command": "PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;",
            "transaction_mode": "IMMEDIATE",
            "timeout": 20,
        },
    }
}

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"


# ---------------------------------------------------------------------------
# Authentication
# ---------------------------------------------------------------------------

AUTH_USER_MODEL = "club.User"

# Order matters: the address is tried first, so the subject's "email and
# password" path is the one that answers and nothing about it changes. The
# display name is only reached once that has failed, and the two can never
# both claim one string because a display name holds no @.
AUTHENTICATION_BACKENDS = [
    "django.contrib.auth.backends.ModelBackend",
    "club.auth.DisplayNameBackend",
]

# Fails closed, like DJANGO_DEBUG: a view that forgets to state who may reach
# it refuses everyone rather than serving the club's roster to the internet.
# Sign-up and login open themselves explicitly.
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework.authentication.SessionAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
    # Every refusal carries a code and a sentence, never one without the other.
    "EXCEPTION_HANDLER": "club.api.errors.exception_handler",
    # DRF would read `?format=` as a choice of its own response renderer and
    # answer 404 for any it does not know; the notebook export uses that
    # parameter for its own formats.
    "URL_FORMAT_OVERRIDE": None,
}

# Django's defaults. They are what satisfies the subject's requirement that
# passwords be hashed and salted — nothing here is hand-rolled.
AUTH_PASSWORD_VALIDATORS = [
    {
        "NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"
    },
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

# The youngest members have no address: the school's ENT has internal
# messaging that never reaches outside. RFC 2606 reserves .invalid so that it
# can never be assigned — nothing is ever delivered there by accident, and the
# identifier says on its face that it is not a mailbox.
SIGNUP_RESERVED_EMAIL_DOMAIN = os.environ.get(
    "SIGNUP_RESERVED_EMAIL_DOMAIN", "rouages.invalid"
)


# ---------------------------------------------------------------------------
# Internationalisation — French interface, club timezone
# ---------------------------------------------------------------------------

LANGUAGE_CODE = "fr-fr"
TIME_ZONE = "Europe/Paris"
USE_I18N = True
USE_TZ = True


# ---------------------------------------------------------------------------
# Files
# ---------------------------------------------------------------------------

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

MEDIA_URL = "media/"
MEDIA_ROOT = BASE_DIR / "media"


# ---------------------------------------------------------------------------
# Email — needed by the GDPR module's confirmation messages
# ---------------------------------------------------------------------------

if DEBUG:
    # Prints messages to the console so work can proceed without a relay.
    EMAIL_BACKEND = "django.core.mail.backends.console.EmailBackend"
else:
    EMAIL_BACKEND = "django.core.mail.backends.smtp.EmailBackend"

EMAIL_HOST = os.environ.get("EMAIL_HOST", "")
EMAIL_PORT = int(os.environ.get("EMAIL_PORT", "587"))
EMAIL_HOST_USER = os.environ.get("EMAIL_HOST_USER", "")
EMAIL_HOST_PASSWORD = os.environ.get("EMAIL_HOST_PASSWORD", "")
EMAIL_USE_TLS = env_bool("EMAIL_USE_TLS", True)
DEFAULT_FROM_EMAIL = os.environ.get("DEFAULT_FROM_EMAIL", "fieldnotes@localhost")


# ---------------------------------------------------------------------------
# Security
# ---------------------------------------------------------------------------

# The subject requires HTTPS on every entry point of the backend. These are the
# settings that make Django rely on it rather than merely tolerate it, and they
# are off in development because there is no certificate on a laptop.
if not DEBUG:
    SECURE_SSL_REDIRECT = True
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

# compose.prod.yml's healthcheck calls this in plain HTTP, straight to
# Daphne — it never goes through the proxy, so it carries no
# X-Forwarded-Proto and would otherwise be redirected to an HTTPS URL on a
# port that only ever speaks plain HTTP. Harmless outside `if not DEBUG:`
# above: it only ever does anything while SECURE_SSL_REDIRECT is also on.
# Left unconditional so a test can exercise the real value instead of one
# it injected itself.
SECURE_REDIRECT_EXEMPT = [r"^api/health/$"]

CSRF_TRUSTED_ORIGINS = env_list("DJANGO_CSRF_TRUSTED_ORIGINS")

# Extended rather than reassigned: a second `CSRF_TRUSTED_ORIGINS = ...` below
# would silently win over the line above and drop the production origin.
#
# In production the front end is static files behind the one proxy, so it is
# same-origin and nothing is needed. In development Vite proxies /api to
# Django, which keeps the *browser* same-origin too — no CORS anywhere. But the
# proxy rewrites Host, so Django computes get_host() as its target while the
# browser still sends `Origin: http://localhost:5173`. Those two can never
# match, and the CSRF check compares Origin against this list before the view
# is ever reached.
if DEBUG:
    CSRF_TRUSTED_ORIGINS += env_list(
        "DJANGO_DEV_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
    )
