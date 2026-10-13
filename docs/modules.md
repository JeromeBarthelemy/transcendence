# Les modules déclarés — exigences et démonstration

> **Ce fichier est le plan de soutenance, pas une spécification.** Ce qui est
> construit se dit au README, en anglais, et c'est lui qui est noté ; ce qui est
> fait se coche en fermant une issue, dans le jalon du module. Ici on garde la
> seule chose que ni l'un ni l'autre ne porte : comment on le montrera le jour
> venu — ce que le club a en face de chaque exigence, ce qu'il faudra dire au
> correcteur, et la démo, minutée.
>
> Donc rien n'oblige à le tenir à jour sur la pile ou les décisions techniques :
> il n'est pas leur source. Le tenir à jour quand même en ferait une seconde
> vérité, et c'est comme ça que la §4 a pu annoncer quatre rôles au club quand
> le code n'en avait que deux.

> « Only fully functional and properly implemented modules will be counted toward
> your final score. **Non-functional or incomplete modules = 0 points.** »
> — sujet, chapitre IV

22 points déclarés pour 14 requis. Les seize modules figurent tous au barème du
sujet ; aucun ne demande d'expliquer ce qu'il est avant de montrer qu'il
fonctionne. Les numéros sont ceux des jalons : il n'y a donc ni 5, ni 12, ni 16.

Les exigences sont **recopiées mot pour mot** du sujet, en anglais, pour qu'aucune
traduction ne les adoucisse. Une case cochée veut dire « démontrable devant un
correcteur », pas « commencé ».

---

## 1 · Frameworks front + back — Major, 2 pts

- Use a frontend framework (React, Vue, Angular, Svelte, etc.)
- Use a backend framework

**Choix arrêté : Django** côté back. Le sujet définit un framework comme
fournissant « a structured architecture and conventions », « built-in features for
common tasks (routing, state management, etc.) » et « a complete ecosystem » :
Django coche les trois sans qu'on ait à plaider — URLconf et middlewares pour le
routage, ORM et migrations, authentification, admin, `manage.py`. Le débat qui
pesait tant que le back était envisagé en Go — un routeur seul (chi, gorilla/mux)
tient-il devant cette définition ? — est clos, et avec lui le besoin de le
justifier longuement au README.

**Choix arrêté : React** côté front. Le choix ne se plaide pas davantage que celui
de Django, et pour une raison plus courte encore : l'exigence le nomme elle-même,
« React, Vue, Angular, Svelte, etc. ». Reste que React seul ne fournit ni routage
ni gestion d'état — les deux exemples que la définition cite. C'est la pile qui les
apporte, et c'est donc elle que le README nommera : Vite et TypeScript, React
Router, TanStack Query, react-i18next. Next.js a été écarté : il pose un serveur
Node devant Django, là où une application d'une seule page, servie en fichiers
statiques, passe derrière le même proxy que tout le reste — une instance, une
salle, une machine.

Le back vit dans `backend/`, une application par groupe du schéma (`club` en
premier). L'API passe par **Django REST framework**, le temps réel par
**Channels**. Le front vit dans `frontend/`.

**L'authentification se fait par cookie de session**, non par jeton porté par le
navigateur. Le front est servi depuis la même origine, derrière le proxy unique de
l'installation : la mécanique de session de Django s'applique telle quelle, et rien
ne traîne là où un script pourrait le lire. Le prix est le CSRF, payé
explicitement — la page appelle `GET /api/auth/me/` au démarrage, ce qui lui pose
le cookie `csrftoken` qu'elle renverra en en-tête `X-CSRFToken`.

**Une erreur d'API se dit deux fois** : un `code` stable en anglais, sur lequel le
front branche, et un `message` en français, qu'il affiche. Aucune des deux options
envisagées ne tenait seule — faire correspondre des phrases françaises aurait fait
de chaque reformulation un bug côté front, et des codes seuls auraient imposé un
catalogue de traduction à un projet qui sert un club dans une langue. Les deux
voyagent donc ensemble :

```json
{"display_name": [{"code": "display_name_taken",
                   "message": "Ce nom d'affichage est déjà pris. Ajoutez une initiale."}]}
```

Ce n'est pas une entorse à la règle du dépôt — anglais pour le code, français pour
ce qui s'affiche — mais son application : un code *est* du code, on y branche, on
ne le lit pas. Et il ne coûte presque rien, DRF portant déjà un `.code` sur chacun
de ses messages.

**Démo (2 min)** — montrer l'arborescence des applications, nommer le framework des
deux côtés, ouvrir un `urls.py` et un middleware.

---

## 2 · ORM — Minor, 1 pt

- Use an ORM for the database

**Chez nous** — l'ORM de Django au-dessus de SQLite. Les modèles de
`backend/club/models.py` décrivent les tables, les migrations les créent, et les
relations se chargent en une ligne (`select_related`, `prefetch_related`).

**À dire au correcteur** : l'ORM vient avec le framework du module 1, il n'est pas
un ajout. Ce n'est pas un problème — le sujet demande « use an ORM », pas « écrire
un ORM » — mais la démonstration doit montrer l'ORM *utilisé*, pas seulement
installé.

**Démo (1 min)** — montrer la définition d'un modèle, la migration correspondante,
puis une requête qui charge un chantier avec ses avancées et leurs participants
sans écrire une jointure.

---

## 3 · Organisations — Major, 2 pts

- Create, edit, and delete organizations
- Add users to organizations
- Remove users from organizations
- View organizations and allow users to perform specific actions within an
      organization (minimum: create, read, update)

**Chez nous** — le club, ses quatre équipes, les saisons. L'import de rentrée ne
coche aucune de ces cases : il lit l'export AssoConnect de la saison (`.xlsx`) pour
*vérifier* des comptes qui existent déjà, il n'en crée aucun et ne touche à aucune
équipe.

**Démo (3 min)** — créer une équipe, y ajouter deux membres, en retirer un,
renommer l'équipe, la supprimer.

---

## 4 · Permissions avancées — Major, 2 pts

- View, edit, and delete users (CRUD)
- Roles management (admin, user, guest, moderator, etc.)
- Different views and actions based on user role

**Chez nous** — deux rôles au club, `student` et `mentor`, et un drapeau
`is_club_admin` par-dessus : l'administrateur est un mentor qui administre, non un
troisième rôle. Ce drapeau n'est pas `is_staff`, qui ouvre l'admin Django et donc
la base brute — les deux se ressemblent et ne donnent pas du tout la même chose.

L'affectation à une équipe **ne porte aucun rôle** : `Membership` est un lien pur.
Être capitaine d'une équipe n'est pas un pouvoir sur l'application, et mélanger les
deux ferait dépendre les permissions de la saison en cours.

La portée suit le rôle. L'élève voit l'équipe à laquelle il est affecté. Le mentor
voit **toutes** les équipes : il doit pouvoir intervenir dans n'importe laquelle —
remplacer un mentor absent, assister à une réunion de décision — sans qu'un
administrateur l'y affecte d'abord. L'administrateur les voit toutes aussi, avec
les écrans d'administration en plus. Trois vues distinctes, ce que l'exigence
demande. Un mentor peut être affecté à une équipe pour figurer parmi ses membres,
mais l'affectation n'étend ni ne restreint ce qu'il ouvre.

Une colonne de rôle sur `Membership` ne deviendrait nécessaire que le jour où
quelqu'un porterait un rôle *différent* selon l'équipe — un élève mentor ici, un
mentor simple membre là. Ce cas n'existe pas au club, et `Membership` est un modèle
explicite précisément pour que la colonne puisse arriver ce jour-là sans convertir
la table de jointure.

**Démo (3 min)** — se connecter en élève : une seule équipe, pas de sélecteur.
Se connecter en mentor : le sélecteur d'équipe apparaît, avec toutes les équipes.
Se connecter en administrateur du club : l'écran d'admin en plus. Basculer un
rôle, montrer l'action qui disparaît côté élève.

---

## 6 · Temps réel — Major, 2 pts

- Real-time updates across clients
- Handle connection/disconnection gracefully
- Efficient message broadcasting

**Chez nous** — le tableau des chantiers, qui travaille sur quoi en ce moment.

**Avec Django** — Channels, donc ASGI. Les trois cases tombent sur le même
mécanisme : un consumer WebSocket qui fait `group_add` à la connexion,
`group_discard` à la déconnexion, et `group_send` pour diffuser — la déconnexion
propre et la diffusion efficace sont dans la bibliothèque, pas à écrire. Une
décision de déploiement en découle : le *channel layer* en mémoire ne vaut que pour
un seul processus ; dès qu'il y a plusieurs workers, il faut Redis, donc un service
de plus au `docker compose`.

**Démo (3 min)** — deux navigateurs côte à côte. Cocher un chantier dans l'un,
le voir apparaître dans l'autre. Couper le réseau d'un des deux, saisir, le
rétablir, montrer la reprise sans doublon.

---

## 7 · Analytics — Major, 2 pts

- Interactive charts and graphs (line, bar, pie, etc.)
- Real-time data updates
- Export functionality (PDF, CSV, etc.)
- Customizable date ranges and filters

**Chez nous** — l'activité d'une équipe, tirée des avancées déjà consignées :
l'état et l'étape des chantiers, les avancées et les membres actifs jour par
jour, la participation de chacun — jamais un classement. Les mesures d'essai et
le scouting, qui auraient donné d'autres courbes, viendront après la soutenance ;
d'ici là, un résultat d'essai s'écrit dans le texte de l'avancée.

**Démo (3 min)** — changer la plage de dates, voir les courbes bouger. Enregistrer
une avancée dans un autre onglet, la voir arriver. Filtrer Robot / Hors robot :
les graphiques et les compteurs des membres suivent le même filtre. Exporter
en CSV et retrouver les valeurs de la période et du filtre affichés : résumé,
jours, semaines, Robot / Hors robot, chantiers et participations, avec une colonne
`section` pour distinguer les vues (ne pas additionner leurs totaux entre elles).
Les barres hebdomadaires comptent chaque élève une fois par semaine ; les cartes
de période le comptent une fois sur toute la période. Le tableau des chantiers
garde ceux sans activité à zéro, avec un lien vers leur détail. Les statuts et
étapes restent explicitement actuels, contrairement aux compteurs de période.

---

## 8 · RAG règlement — Major, 2 pts

- Interact with a large dataset of information
- Users can ask questions and get relevant answers
- Implement proper context retrieval and response generation

**Chez nous** — le manuel de jeu et le Q&A officiel, avec un rang d'autorité par
source. Pas de base vectorielle : les embeddings tiennent dans un
`BinaryField` et le produit scalaire se fait en force brute, en Python, sur
quelques milliers de passages. Un modèle local (Ollama, `qwen2.5:3b` par
défaut, changeable sans toucher au code) écrit ensuite une réponse en
français à partir des seuls passages retenus, en citant leurs références ;
aucun passage retenu, aucune génération, la phrase de refus du système
suffit. Un modèle injoignable laisse la réponse vide : les passages cités
restent affichés en dessous.

**Démo (3 min)** — poser une question de règlement, montrer la réponse générée
puis les passages cités et leur rang d'autorité. Poser une question que le
manuel ne couvre pas et montrer que le système le dit au lieu d'inventer.

---

## 9 · Upload de fichiers — Minor, 1 pt

- Support multiple file types (images, documents, etc.)
- Client-side and server-side validation (type, size, format)
- Secure file storage with proper access control
- File preview functionality where applicable
- Progress indicators for uploads
- Ability to delete uploaded files

**Six cases pour un point.** Le dépôt en masse n'en dispense d'aucune. Django
apporte la moitié du chemin — `FileField` / `ImageField` (Pillow est déjà exigé par
l'avatar), `FILE_UPLOAD_MAX_MEMORY_SIZE`, les validateurs de sérialiseur pour le
contrôle serveur — mais la barre de progression, l'aperçu et la validation client
restent du front, et le stockage sous contrôle d'accès suppose de ne **pas** servir
les médias privés en statique.

**Démo (3 min)** — déposer vingt photos d'un coup avec la barre de progression,
ouvrir un aperçu, tenter un fichier interdit et montrer les deux refus (client
puis serveur), supprimer une photo.

---

## 10 · RGPD — Minor, 1 pt

- Allow users to request their data
- Data deletion with confirmation
- Export user data in a readable format
- Confirmation emails for data operations

**Dépendance à ne pas découvrir tard** — « confirmation emails » suppose un envoi
de courriel. C'est du trafic sortant, donc compatible avec l'instance locale, mais
il faut un relais SMTP et une adresse d'expédition. Django fournit l'envoi
(`send_mail`, backend SMTP configuré par `.env`) et, pour le développement, un
backend console qui évite d'attendre le relais pour avancer — mais la démo du jour
se fait avec un vrai envoi.

**Vers quelle adresse** — pas vers l'identifiant de connexion. Celui-ci identifie
un compte sans être supposé délivrer quoi que ce soit, et le plus jeune des membres
n'a pas de boîte : son adresse est construite sur un domaine réservé en `.invalid`,
où rien ne peut arriver. La confirmation part donc vers une **adresse de contact**,
distincte, qui pour un mineur est celle du représentant légal — ses droits sont
exercés par lui, et une confirmation de suppression adressée à un enfant de douze
ans n'a de valeur ni juridique ni pratique. C'est la colonne que l'export
AssoConnect porte déjà et que l'import laissait tomber.

**Démo (2 min)** — demander son export en tant qu'élève, recevoir le courriel
*sur l'adresse du responsable*, ouvrir le fichier. Demander la suppression, montrer
la confirmation exigée.

---

## 11 · PWA — Minor, 1 pt

- Progressive Web App with offline support
- and installability

**Démo (2 min)** — installer sur un téléphone depuis le navigateur, couper le
wifi, enregistrer une avancée, rallumer, la voir partir. Recharger la page hors
ligne et montrer que la file a survécu.

---

## 13 · Notifications — Minor, 1 pt

- A complete notification system for **all** creation, update, and deletion actions

**Le mot « all » est le piège.** Bon marché si la notification est posée une fois
dans la couche de service ; ruineux si elle est recâblée fonctionnalité par
fonctionnalité.

**Démo (2 min)** — deux sessions. Adresser une remarque à un chantier suivi par
l'autre, la voir arriver. Modifier, supprimer, montrer le fil et le non-lu.

**Et l'annonce du club.** Une remarque appartient toujours à une équipe : ce qui
concerne tout le club sans concerner aucun cahier — la perceuse à remplacer avant
vendredi — n'est pas une trace. Une annonce, hors `Entry` et jamais citée, dont
la seule raison d'être est d'être notifiée à chacun. À trancher en concevant ce
module.

---

## 14 · Recherche avancée — Minor, 1 pt

- Implement advanced search functionality with filters, sorting, and pagination

**Chez nous** — chercher dans les traces : texte, chantier, sous-système, étape,
participant, période, type.

**Démo (2 min)** — « les photos de l'intake en novembre », trier par date, aller
page 2, retirer un filtre.

---

## 15 · Design system maison — Minor, 1 pt

- Custom-made design system with reusable components
- proper color palette, typography, and icons
- minimum: 10 reusable components

**Construit de toute façon** en dessinant quatre écrans. Ce qu'il faut ajouter,
c'est la page qui les montre.

**Démo (2 min)** — ouvrir la galerie de composants, compter au-delà de dix,
montrer les jetons de couleur et de typographie.

---

## 17 · Santé et sauvegardes — Minor, 1 pt

- Health check and status page system with automated backups and disaster recovery
  procedures

**Chez nous** — `GET /api/health/` répond déjà. Restent à poser : un service de
sauvegarde planifiée dans le `docker compose`, une page d'état qui dit quand a eu
lieu la dernière, et la restauration écrite pas à pas.

**À dire au correcteur** : une procédure de reprise qui n'a jamais été rejouée n'est
qu'une intention. La démo la rejoue.

**Démo (3 min)** — ouvrir la page d'état, montrer la dernière sauvegarde, détruire la
base de l'instance de démonstration et la restaurer en suivant le document, puis
retrouver les données.

---

## 18 · Navigateurs supplémentaires — Minor, 1 pt

- Full compatibility with at least 2 additional browsers (Firefox, Safari, Edge, etc.)
- Test and fix all features in each browser
- Document any browser-specific limitations
- Consistent UI/UX across all supported browsers

**Chez nous** — Firefox et Edge, qui tournent sous Linux ; Edge repose sur Chromium,
donc Safari n'est qu'un renfort si un Mac ou un iPhone est à portée. « All
features » veut dire chaque écran, pas la page d'accueil.

**Démo (2 min)** — ouvrir le même écran dans les trois navigateurs, enregistrer une
avancée dans chacun, puis montrer la liste des limites documentées.

---

## 19 · Plusieurs langues — Minor, 1 pt

- Implement i18n (internationalization) system
- At least 3 complete language translations
- Language switcher in the UI
- All user-facing text must be translatable

**Chez nous** — français, anglais, espagnol, avec react-i18next. Le dernier point
est le piège : depuis que l'interface affiche les messages d'erreur du serveur,
écrits en français, « all » oblige à les traduire aussi, ainsi que les pages
légales.

**Démo (2 min)** — changer de langue depuis le sélecteur, parcourir trois écrans,
provoquer une erreur de validation et la lire dans la langue choisie, recharger la
page et retrouver la langue.

---

## En réserve — non déclaré

### Module de choix — export du cahier — Major, 2 pts

- Implement a custom module that is not listed above
- It must add real value to the project
- It must include a proper justification in the README

Construit parce que le produit en dépend, non déclaré parce que c'est le seul
module custom et donc le plus contestable. La carte à jouer si un déclaré tombe.

---

## Ce qui n'est pas un module et se perd aussi

Le sujet impose, hors barème et de façon rédhibitoire : Docker en une commande,
HTTPS sur toute entrée du backend, Chrome sans erreur console, multi-utilisateurs
simultanés, mots de passe hachés et salés, validation front **et** back, `.env`
ignoré avec un `.env.example`, schéma de base documenté, commits de tous les
membres, rôles d'équipe documentés, politique de confidentialité et conditions
d'utilisation réelles, README en anglais avec ses sections imposées — et une
modification demandée en direct le jour de la soutenance.

**Les rôles d'équipe, puisqu'ils sont exigés.** Quatre personnes, et chacun se
dit par un surnom qui ne ressemble pas à son compte — de quoi attribuer un
commit à la mauvaise personne si on ne l'écrit pas.

| surnom | compte GitHub | rôle |
|---|---|---|
| vous | `JeromeBarthelemy` | PO |
| qbourine | `quentinbourinet-max` | PM |
| qrios | `Nitwee` | Tech Lead |
| Enelsep | `Enelsep` | Developer |

C'est au README qu'il reviendra de le dire en anglais, à la soutenance : #6.
