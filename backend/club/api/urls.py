from django.urls import path

from .views import LoginView, LogoutView, MeView, SignUpView

# No password-reset route, and that is a decision, not an omission: one
# instance serves one club, in one room. Whoever forgets their password is
# standing in front of the club admin, who identifies them on sight — no token
# does it better — and sets a temporary one from the Django admin.
urlpatterns = [
    path("auth/signup/", SignUpView.as_view(), name="signup"),
    path("auth/login/", LoginView.as_view(), name="login"),
    path("auth/logout/", LogoutView.as_view(), name="logout"),
    path("auth/me/", MeView.as_view(), name="me"),
]
