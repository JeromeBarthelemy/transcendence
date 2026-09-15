from django.db import migrations, models


def label_to_start_year(apps, schema_editor):
    # Seasons were entered as "2026-2027": the start year is the first four
    # digits. The game name was never recorded, and it must be unique, so the
    # old label stands in for it until someone types the real one.
    Season = apps.get_model("club", "Season")
    for season in Season.objects.all():
        season.start_year = int(season.label[:4])
        season.game_name = season.label
        season.save(update_fields=["start_year", "game_name"])


class Migration(migrations.Migration):
    dependencies = [
        ("club", "0003_user_field_labels"),
    ]

    operations = [
        migrations.AddField(
            model_name="season",
            name="start_year",
            field=models.PositiveSmallIntegerField(null=True),
        ),
        migrations.AddField(
            model_name="season",
            name="game_name",
            field=models.CharField(default="", max_length=60),
            preserve_default=False,
        ),
        migrations.RunPython(label_to_start_year, migrations.RunPython.noop),
        migrations.AlterModelOptions(
            name="season",
            options={"ordering": ["-start_year"], "verbose_name": "saison"},
        ),
        migrations.AlterModelOptions(
            name="teamseason",
            options={
                "ordering": ["-season__start_year", "team__number"],
                "verbose_name": "équipe-saison",
            },
        ),
        migrations.RemoveField(
            model_name="season",
            name="label",
        ),
        migrations.AlterField(
            model_name="season",
            name="start_year",
            field=models.PositiveSmallIntegerField(
                unique=True, verbose_name="année de début"
            ),
        ),
        migrations.AlterField(
            model_name="season",
            name="game_name",
            field=models.CharField(max_length=60, unique=True, verbose_name="nom du jeu"),
        ),
    ]
