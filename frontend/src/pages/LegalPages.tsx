import type { ReactNode } from "react";
import { Link } from "react-router-dom";

// Written from what the application stores and does, not from a template:
// a change to what it collects, shows or keeps changes these pages too.
const UPDATED_ON = "2 octobre 2026";
const CONTACT = "robotique.civ@gmail.com";

function LegalPage({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <main className="legal mx-auto w-full max-w-3xl flex-1 px-5 py-10 text-body sm:px-8 sm:py-14">
      <h1 className="brand-title text-3xl tracking-[-0.035em] text-ink sm:text-4xl">
        {title}
      </h1>
      <p className="mt-2 text-sm text-muted">
        Dernière mise à jour : {UPDATED_ON}
      </p>
      {children}
    </main>
  );
}

export function PrivacyPage() {
  return (
    <LegalPage title="Politique de confidentialité">
      <p>
        Fieldnotes est le cahier de bord des équipes de robotique de Robotique
        CIV. Cette page explique quelles données l'application enregistre,
        pourquoi, qui peut les voir, combien de temps elles sont gardées et
        comment exercer vos droits.
      </p>

      <h2>Qui est responsable de vos données</h2>
      <p>
        <strong>Robotique CIV</strong>, association loi 1901
        <br />
        190 rue Frédéric Mistral, 06560 Valbonne
        <br />
        Contact : <strong>{CONTACT}</strong>
      </p>

      <h2>Où sont vos données</h2>
      <p>
        L'application est installée{" "}
        <strong>sur une machine du club, dans ses locaux</strong>. Vos données
        ne sont ni hébergées chez un prestataire, ni vendues, ni transmises à
        des tiers. La seule sortie est l'envoi des courriels de confirmation.
      </p>

      <h2>Ce que nous enregistrons, et pourquoi</h2>
      <h3>Votre compte</h3>
      <ul>
        <li>
          votre <strong>identifiant de connexion</strong> (votre adresse e-mail
          ; si vous n'en avez pas, une adresse fictive est créée pour vous et ne
          reçoit jamais rien) ;
        </li>
        <li>
          votre <strong>nom d'affichage</strong>, visible des autres membres ;
        </li>
        <li>
          votre <strong>mot de passe</strong>, enregistré sous une forme
          chiffrée et irréversible : personne, y compris les responsables du
          club, ne peut le lire ;
        </li>
        <li>
          votre date d'inscription et votre rôle (élève, mentor, administrateur)
          ;
        </li>
        <li>
          le nombre de mots de passe erronés saisis à la suite, et, s'il en
          atteint cinq, l'heure jusqu'à laquelle la connexion est bloquée.
        </li>
      </ul>
      <p className="legal-why">
        Pourquoi : vous permettre de vous connecter et de travailler avec votre
        équipe, et empêcher qu'on devine votre mot de passe en essayant à la
        chaîne.
      </p>

      <h3>La vérification de votre adhésion</h3>
      <p>
        À l'inscription, vous indiquez votre nom, votre prénom et votre date de
        naissance. Ils servent <strong>uniquement</strong> à retrouver votre
        adhésion dans le fichier des adhérents du club (AssoConnect), puis ils
        sont <strong>supprimés</strong>. Nous recopions alors depuis AssoConnect
        votre numéro d'adhérent, votre date de naissance et une adresse de
        contact : la vôtre si vous êtes majeur, celle de votre représentant
        légal si vous êtes mineur.
      </p>
      <p className="legal-why">
        Pourquoi : réserver l'application aux adhérents et savoir si un membre
        est mineur. C'est la date d'AssoConnect qui fait foi, pas celle saisie à
        l'inscription.
      </p>

      <h3>Le droit à l'image</h3>
      <p>
        Nous gardons l'historique daté de vos décisions (accord ou refus), avec
        la qualité de la personne qui a signé (vous ou votre représentant
        légal). Le document signé reste dans AssoConnect. Ces décisions sont
        consultées par le club avant toute publication, et un refus s'applique
        dès sa date. Quand un fichier est déposé dans l'application, on indique
        si des personnes y sont reconnaissables ; le club s'en sert pour savoir
        quoi vérifier avant une publication.
      </p>

      <h3>Le travail de l'équipe</h3>
      <p>
        Les notes, avancées, décisions et passations que vous écrivez, avec leur
        date, leur auteur et leurs participants. Votre présence un jour
        d'atelier se déduit des avancées auxquelles vous avez participé.
      </p>
      <p className="legal-why">
        Pourquoi : c'est l'objet même de l'outil, garder la trace du travail de
        l'équipe d'une séance à l'autre et d'une saison à l'autre.
      </p>

      <h3>Les fichiers déposés</h3>
      <p>
        Les photos, vidéos, plans et fichiers de CAO ajoutés à une trace. Une
        photo est <strong>débarrassée de ses métadonnées</strong>, dont la
        position où elle a été prise, et une photo d'iPhone (HEIC) est convertie
        en JPEG ; une <strong>vidéo est gardée telle quelle</strong> et peut
        donc contenir cette position si le téléphone l'a enregistrée. Ils ne
        sont visibles que de l'équipe et des mentors ; celui qui a déposé un
        fichier, ou un mentor, peut le retirer.
      </p>
      <p className="legal-why">
        Pourquoi : une photo du prototype ou la vidéo d'un essai est souvent la
        trace la plus utile d'une séance, et le portfolio a besoin du fichier
        lui-même.
      </p>

      <h3>Votre photo (facultative)</h3>
      <p>
        Si vous ajoutez une photo de profil, elle est redimensionnée et{" "}
        <strong>débarrassée de ses métadonnées</strong>, dont la position où
        elle a été prise. Elle n'est visible que des membres connectés. Vous
        pouvez la supprimer à tout moment.
      </p>

      <h3>Vos questions sur le règlement</h3>
      <p>
        Chaque question posée à l'assistant sur le règlement est enregistrée
        avec son auteur, sa date et les passages du règlement qu'il a cités
        (voir plus bas).
      </p>

      <h3>Les cookies</h3>
      <p>
        L'application utilise deux cookies techniques, indispensables à son
        fonctionnement : un cookie de <strong>session</strong>, qui vous garde
        connecté, et un cookie de <strong>sécurité</strong> (CSRF), qui empêche
        un autre site d'agir en votre nom. Il n'y a{" "}
        <strong>aucun cookie publicitaire ni de mesure d'audience</strong>.
      </p>

      <h2>Qui voit quoi</h2>
      <ul>
        <li>
          <strong>Les élèves</strong> voient le travail de leur équipe et les
          membres qui y participent.
        </li>
        <li>
          <strong>Les mentors</strong> voient le travail de toutes les équipes
          du club, pour les accompagner.
        </li>
        <li>
          <strong>Les administrateurs du club</strong> gèrent les équipes, les
          membres et les rôles.
        </li>
        <li>
          <strong>L'export du cahier</strong> est, comme l'application, un
          document de travail interne au club, qui sert de matière aux dossiers
          de compétition. Rien n'est publié depuis l'application : c'est au
          moment de rédiger un dossier ou une publication que le club consulte
          les décisions de droit à l'image et écarte les images des membres qui
          l'ont refusé.
        </li>
      </ul>

      <h2>Les mineurs</h2>
      <p>
        La plupart de nos membres sont mineurs. L'utilisation de l'application
        est couverte par l'
        <strong>adhésion au club, signée par le représentant légal</strong> dans
        AssoConnect. Les droits d'un membre mineur peuvent être exercés par
        lui-même ou par son représentant légal, et les confirmations sont
        envoyées à l'adresse de ce dernier.
      </p>

      <h2>L'assistant sur le règlement</h2>
      <p>
        L'assistant qui répond aux questions sur le règlement de la compétition{" "}
        <strong>tourne entièrement sur la machine du club</strong> : il cherche
        la réponse dans le manuel officiel et ses questions officielles, chargés
        sur cette machine, et aucune question n'est envoyée à un service
        extérieur. Vos questions ne sont pas montrées aux autres membres ; elles
        font partie de vos données, et donc de votre export.
      </p>

      <h2>Combien de temps nous gardons vos données</h2>
      <table>
        <thead>
          <tr>
            <th scope="col">Donnée</th>
            <th scope="col">Durée</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Votre compte</td>
            <td>tant que vous êtes adhérent</td>
          </tr>
          <tr>
            <td>Le compte d'un membre qui quitte le club</td>
            <td>
              <strong>anonymisé à son départ</strong> : son nom devient « Ancien
              membre » ; sa photo, ses adresses, sa date de naissance et son
              numéro d'adhérent sont effacés, et il ne permet plus de se
              connecter
            </td>
          </tr>
          <tr>
            <td>Les cahiers des équipes et les questions sur le règlement</td>
            <td>
              conservés comme <strong>archives du club</strong> ; après
              l'anonymisation, ils ne sont plus rattachés à votre identité
            </td>
          </tr>
          <tr>
            <td>Les informations de vérification</td>
            <td>
              supprimées dès que votre adhésion est retrouvée, ou avec le compte
              s'il n'est jamais rapproché d'une adhésion
            </td>
          </tr>
          <tr>
            <td>Les décisions de droit à l'image</td>
            <td>tant que des contenus vous concernant existent</td>
          </tr>
          <tr>
            <td>Le blocage après cinq mots de passe erronés</td>
            <td>
              quinze minutes ; le compte d'essais repart de zéro à la connexion
              suivante
            </td>
          </tr>
        </tbody>
      </table>
      <p>
        Une suspension temporaire du compte, décidée par le club (voir les{" "}
        <Link to="/terms">conditions d'utilisation</Link>), n'entraîne pas son
        anonymisation.
      </p>

      <h2>Vos droits</h2>
      <p>
        Vous pouvez à tout moment <strong>accéder</strong> à vos données, les{" "}
        <strong>rectifier</strong>, en demander l'<strong>effacement</strong> ou
        en recevoir une <strong>copie</strong> dans un format lisible.
        L'application permet de demander l'export et la suppression de vos
        données, avec une confirmation envoyée par courriel. Pour toute autre
        demande, écrivez à <strong>{CONTACT}</strong>.
      </p>
      <p>
        Un effacement est une anonymisation, la même qu'au départ du club :
        votre identité disparaît de l'application, et les textes écrits pour
        votre équipe restent dans ses archives, sans votre nom.
      </p>
      <p>
        Si vous estimez que vos droits ne sont pas respectés, vous pouvez
        adresser une réclamation à la <strong>CNIL</strong> (www.cnil.fr).
      </p>

      <h2>Sécurité</h2>
      <p>
        Les échanges avec l'application sont chiffrés (HTTPS), les mots de passe
        ne sont jamais stockés en clair, cinq mots de passe erronés à la suite
        bloquent la connexion au compte pendant quinze minutes, et chaque accès
        aux données vérifie que vous êtes connecté et autorisé à les voir.
      </p>
    </LegalPage>
  );
}

export function TermsPage() {
  return (
    <LegalPage title="Conditions d'utilisation">
      <p>
        Fieldnotes est le cahier de bord des équipes de robotique de{" "}
        <strong>Robotique CIV</strong>, association loi 1901, 190 rue Frédéric
        Mistral, 06560 Valbonne (contact : {CONTACT}). En créant un compte, vous
        acceptez les conditions ci-dessous.
      </p>

      <h2>À quoi sert l'outil</h2>
      <p>
        Fieldnotes sert à garder la trace du travail des équipes : ce qui a
        avancé à chaque séance, ce qu'il reste à faire, ce qu'on transmet à ceux
        qui prennent le relais. Il sert aussi à générer le cahier d'ingénierie
        qui permet de rédiger le portfolio pour les compétitions.{" "}
        <strong>Il est réservé à cet usage.</strong>
      </p>

      <h2>Qui peut l'utiliser</h2>
      <p>
        L'application est réservée aux <strong>adhérents du club</strong>.
        Chaque compte est rapproché de l'adhésion correspondante dans
        AssoConnect. Pour un membre mineur, l'adhésion signée par son
        représentant légal vaut accord pour l'utilisation de l'outil.
      </p>

      <h2>Votre compte</h2>
      <ul>
        <li>
          Un compte est <strong>personnel</strong> : ne le prêtez pas et ne
          partagez pas votre mot de passe.
        </li>
        <li>
          Choisissez un nom d'affichage qui permet aux autres de vous
          reconnaître, sans être moqueur ni offensant.
        </li>
        <li>
          Si vous oubliez votre mot de passe, adressez-vous à un administrateur
          du club, qui vous en donnera un provisoire.
        </li>
      </ul>

      <h2>Bonne conduite</h2>
      <p>
        Les règles sont simples :{" "}
        <strong>
          rester courtois et utiliser l'outil pour ce à quoi il est destiné.
        </strong>{" "}
        Concrètement :
      </p>
      <ul>
        <li>
          écrivez avec respect : pas d'insulte, de moquerie ni de propos
          blessants envers un membre, dans les notes comme dans les passations ;
        </li>
        <li>
          n'ajoutez comme photo de profil qu'<strong>une photo de vous</strong>,
          jamais celle de quelqu'un d'autre ;
        </li>
        <li>
          n'écrivez rien qui n'ait sa place dans le cahier d'une équipe : pas
          d'informations personnelles sur d'autres membres, pas de contenu sans
          rapport avec le club ;
        </li>
        <li>
          ne cherchez pas à accéder à ce qui ne vous est pas destiné, comme le
          travail d'une autre équipe ou le compte d'un autre membre.
        </li>
      </ul>
      <p>
        Le <strong>règlement intérieur du club</strong> s'applique par ailleurs
        à la vie au club et aux ateliers.
      </p>

      <h2>Ce qui appartient à qui</h2>
      <p>
        Ce que vous écrivez dans le cahier de votre équipe fait partie de son{" "}
        <strong>histoire</strong> : il reste dans les archives du club après
        votre départ, mais sans votre nom, puisque votre compte est alors
        anonymisé (voir la politique de confidentialité). Le club peut en
        reprendre des extraits dans ses dossiers de compétition, en respectant
        toujours les décisions de droit à l'image.
      </p>

      <h2>Ce que le club peut faire</h2>
      <p>
        En cas de manquement à ces règles, un administrateur du club peut{" "}
        <strong>modifier ou retirer un contenu</strong>, et{" "}
        <strong>suspendre un compte</strong>. Une suspension est temporaire et
        n'efface rien. Ces décisions sont prises en lien avec les responsables
        du club, comme pour toute question de comportement.
      </p>

      <h2>Disponibilité</h2>
      <p>
        L'application tourne sur une machine du club. Elle est fournie telle
        quelle, par des bénévoles, sans garantie de disponibilité permanente :
        une panne ou une maintenance peut la rendre temporairement inaccessible.
      </p>

      <h2>Changements</h2>
      <p>
        Ces conditions peuvent évoluer. La date de mise à jour en haut de page
        indique la dernière version.
      </p>

      <h2>Vos données</h2>
      <p>
        Ce que l'application enregistre, et vos droits sur ces données, sont
        décrits dans la <Link to="/privacy">politique de confidentialité</Link>.
      </p>
    </LegalPage>
  );
}
