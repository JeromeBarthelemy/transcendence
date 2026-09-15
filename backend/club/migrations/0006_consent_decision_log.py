import django.utils.timezone
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("club", "0005_review_labels_and_related_names"),
    ]

    # The table holds no data yet: no conversion, a direct change of shape.
    operations = [
        migrations.RemoveConstraint(
            model_name="consent",
            name="one_active_consent",
        ),
        migrations.RemoveField(
            model_name="consent",
            name="revoked_at",
        ),
        migrations.RenameField(
            model_name="consent",
            old_name="granted_at",
            new_name="decided_at",
        ),
        migrations.AlterField(
            model_name="consent",
            name="decided_at",
            field=models.DateTimeField(
                default=django.utils.timezone.now, verbose_name="décidé le"
            ),
        ),
        migrations.AddField(
            model_name="consent",
            name="decision",
            field=models.CharField(
                choices=[("granted", "accordé"), ("refused", "refusé")],
                default="granted",
                max_length=10,
                verbose_name="décision",
            ),
            preserve_default=False,
        ),
        migrations.AlterModelOptions(
            name="consent",
            options={
                "ordering": ["-decided_at", "-id"],
                "verbose_name": "décision de droit à l'image",
                "verbose_name_plural": "décisions de droit à l'image",
            },
        ),
    ]
