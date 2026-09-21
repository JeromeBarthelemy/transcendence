# Le lexique

> Le vocabulaire du modèle, **figé**. Un terme ne se renomme qu'ici, et une
> *pull request* qui nomme un objet autrement contredit ce fichier — c'est fait
> pour.

Un même objet appelé de deux façons finit par devenir deux objets. Ce projet en
a déjà fait l'expérience en une journée de conception — un axe nommé tantôt
*discipline* tantôt *type de travail*, un autre tantôt *apport*, tantôt *phase*,
tantôt *étape* — et ce qui coûte une relecture dans une note coûte une
intégration ratée dans un dépôt à cinq.

Les mots ci-dessous sont donc des décisions au même titre que le schéma : le
français est celui de l'interface et des conversations, l'anglais celui du code.

| Terme | Au schéma | Ce qu'il désigne |
|---|---|---|
| **club** | *l'instance* | l'association. Une instance n'en sert qu'une : aucune table, et tout ce qui n'a pas d'équipe lui appartient sans le dire |
| **équipe** | `Team` · `TeamSeason` | l'équipe, et l'équipe *dans une saison* — c'est la seconde qui porte tout |
| **saison** | `Season` | l'année de jeu, qui porte deux noms : ses années et son jeu — « 2026-2027 · BioBuzz ». Tout ce qui change avec le jeu y est scopé |
| **membre** | `User` | avoir un compte actif, c'est être membre du club — les parents n'en ont pas, un ancien garde le sien désactivé |
| **affectation** | `Membership` | l'appartenance d'un membre à une équipe pour une saison. Sans rôle. Rien à voir avec l'*adhésion*, qui est l'inscription au club dans AssoConnect : on peut avoir adhéré sans être encore affecté |
| **rôle** | `User.club_role` · `is_club_admin` | élève ou mentor, porté par le compte. Administrer est un droit en plus, pas un troisième rôle |
| **consentement** | `Consent` | une décision datée sur le droit à l'image — accordé ou refusé ; la plus récente vaut, et sans décision on ne sait pas. L'état, jamais la pièce signée |
| **vérification** | `User.assoconnect_id` · `VerificationRequest` | le lien entre un compte et son adhésion AssoConnect, posé par le numéro d'adhérent. Tant qu'il manque, le compte est mineur et sans décision sur son droit à l'image |
| **créneau** | `MeetingSlot` | l'horaire habituel. Il n'est pas une séance : il fait *attendre* une séance, et c'est ce qui rend un trou visible |
| **séance** | `Meeting` | une case datée, au niveau du club. Ne s'ouvre ni ne se ferme |
| **présence** | *une lecture* | qui a fait avancer quelque chose ce jour-là. Aucune table : elle se lit sur les inscriptions |
| **remarque** | `Entry` · `note` | ce qui n'appartient à aucun chantier, écrit quand ça arrive. Sa portée : l'équipe, ou un chantier qu'elle attend |
| **trace** | `Entry` | le tronc commun : tout ce que le cahier peut citer |
| **avancée** | `Entry` · `progress` | ce qu'une séance a fait sur un chantier. Le croisement des deux, et l'atome du modèle |
| **décision** | `Entry` · `decision` | ce qu'une réunion a tranché |
| **chantier** | `WorkItem` | le fil d'un sous-système sur une saison — ou d'un sujet, hors robot. L'unité que le cahier raconte |
| **passation** | `WorkItem.handover` | ce qu'il faut savoir pour reprendre — et ce qu'il ne faut pas défaire |
| **sous-système** | `WorkItem.title` · `on_robot` | la partie du robot : le titre d'un chantier de robot. Au club, refait chaque saison |
| **étape** | `Entry.step` | où en est la conception, portée par l'avancée. Fixe et ordonné, *réparation* mise à part. À l'écran : « avancement » |
| **cahier** | `NotebookSection` · `NotebookBlock` | le livrable narratif, par équipe et par saison |
| **bloc** | `NotebookBlock` | un paragraphe du cahier ; c'est lui qui cite |
| **tableau** | *une vue* | les chantiers en colonnes. Aucune donnée propre : il se regarde, il ne se tient pas |
| **citation** | `Citation` | le lien entre un bloc de narration et sa preuve. L'objet à défendre en évaluation |
| **grille** | `MetricSet` | ce qu'on mesure : partagée par l'entraînement et le scouting |
| **session** | `Session` | une série d'observations sur une grille. C'est une trace, donc elle se cite. **Rien à voir avec une séance** |
| **essai** | `Session` · chantier | une session rattachée à un chantier : on mesure une modification précise |
| **match d'entraînement** | `Session` · sans chantier | le robot entier et sa drive team. Relié à rien, un point dans la courbe |
| **observation** | `Observation` | une mesure, par un observateur, sur un sujet, à un instant |
| **campagne** | `Campaign` | l'observation mutualisée des quatre équipes sur un tournoi |
| **pick list** | `PickList` | la liste ordonnée des partenaires souhaités — une par équipe |
| **événement** | `Meeting` · *kind* | une compétition, une démonstration, une visite. Un moment, jamais un chantier |
| **export** | *une sortie* | ce qui quitte le club : cahier en PDF, lot de photos, récapitulatif remis. « Publier » ne veut dire que cela |
| **partenaire** | `Partner` | une organisation ou une autre équipe. Nom et type, pas de fiche contact |
| **média** | `MediaAsset` | photo, vidéo, plan, document |

## Deux pièges, sur lesquels la note de concept s'est elle-même fait prendre

Une **séance** n'est pas une **session** : la première est un mercredi, la
seconde une série de mesures — deux mots trop proches pour un français relâché,
et deux tables sans rapport.

De même, l'**avancement** affiché à l'écran est l'étape courante, quand une
**avancée** est ce qu'une séance a fait — un libellé et un objet, jamais
interchangeables.

Et **entrée** n'est pas un second nom pour **trace** : `Entry` se dit *trace*,
partout, sinon la moitié du document parle d'un objet que l'autre moitié ne
nomme pas.

## Tous n'ont pas à paraître à l'écran

**Avancée** et **trace** sont des mots de conception : l'élève voit une case
qu'il coche, pas un objet nommé. **Chantier**, **séance**, **passation** et
**avancement**, au contraire, seront lus et prononcés par le club — ce sont ceux
qu'il faut choisir *avec* le club plutôt que pour lui.

## Ce que ce lexique ne fige pas

Les **sous-systèmes** n'y sont pas. Ils changent avec le jeu, et chacun n'est
que le titre d'un chantier de robot : les figer contredirait le modèle, qui les
veut construits par l'usage. L'écran en propose une liste de départ, pour qu'une
équipe n'ouvre pas un formulaire vide. Seules les **étapes** sont fixées, dans
le code, parce qu'elles décrivent une démarche de conception et non un jeu.

---

La note de concept — [`fieldnotes.html`](fieldnotes.html) — porte le raisonnement
qui a conduit à ces mots, et le schéma auquel ils renvoient.
