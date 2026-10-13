from django.apps import AppConfig
from pillow_heif import register_heif_opener


class ClubConfig(AppConfig):
    name = "club"
    verbose_name = "Socle club"

    def ready(self) -> None:
        # iPhones take their photos in HEIC, which Pillow cannot read on its
        # own. Registered once, at start-up, whatever imports Pillow first.
        register_heif_opener(thumbnails=False)

        from django.db.backends.signals import connection_created

        from club.search import register_fold

        connection_created.connect(register_fold)
