import type { ReactNode } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Page } from "../components/Page";
import { Heading } from "../components/Typography";

// Written from what the application stores and does, not from a template:
// a change to what it collects, shows or keeps changes these pages too.
const CONTACT = "robotique.civ@gmail.com";

function LegalPage({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <Page width="3xl" className="legal text-body">
      <Heading size="page">{title}</Heading>
      <p className="mt-2 text-sm text-muted">{t("legal.updated")}</p>
      {children}
    </Page>
  );
}

export function PrivacyPage() {
  const { t } = useTranslation();
  return (
    <LegalPage title={t("legal.privacy.title")}>
      <p>{t("legal.privacy.intro")}</p>

      <h2>{t("legal.privacy.controllerTitle")}</h2>
      <p>
        <Trans
          i18nKey="legal.privacy.controller"
          values={{ contact: CONTACT }}
          components={{ strong: <strong />, br: <br /> }}
        />
      </p>

      <h2>{t("legal.privacy.locationTitle")}</h2>
      <p>
        <Trans
          i18nKey="legal.privacy.location"
          components={{ strong: <strong /> }}
        />
      </p>

      <h2>{t("legal.privacy.collectedTitle")}</h2>
      <h3>{t("legal.privacy.accountTitle")}</h3>
      <ul>
        <li>
          <Trans
            i18nKey="legal.privacy.loginIdentifier"
            components={{ strong: <strong /> }}
          />
        </li>
        <li>
          <Trans
            i18nKey="legal.privacy.displayName"
            components={{ strong: <strong /> }}
          />
        </li>
        <li>
          <Trans
            i18nKey="legal.privacy.password"
            components={{ strong: <strong /> }}
          />
        </li>
        <li>{t("legal.privacy.joinedAndRole")}</li>
        <li>{t("legal.privacy.failedLogins")}</li>
      </ul>
      <p className="legal-why">{t("legal.privacy.accountWhy")}</p>

      <h3>{t("legal.privacy.membershipTitle")}</h3>
      <p>
        <Trans
          i18nKey="legal.privacy.membership"
          components={{ strong: <strong /> }}
        />
      </p>
      <p className="legal-why">{t("legal.privacy.membershipWhy")}</p>

      <h3>{t("legal.privacy.consentTitle")}</h3>
      <p>{t("legal.privacy.consent")}</p>

      <h3>{t("legal.privacy.workTitle")}</h3>
      <p>{t("legal.privacy.work")}</p>
      <p className="legal-why">{t("legal.privacy.workWhy")}</p>

      <h3>{t("legal.privacy.filesTitle")}</h3>
      <p>
        <Trans
          i18nKey="legal.privacy.files"
          components={{ strong: <strong /> }}
        />
      </p>
      <p className="legal-why">{t("legal.privacy.filesWhy")}</p>

      <h3>{t("legal.privacy.photoTitle")}</h3>
      <p>
        <Trans
          i18nKey="legal.privacy.photo"
          components={{ strong: <strong /> }}
        />
      </p>

      <h3>{t("legal.privacy.questionsTitle")}</h3>
      <p>{t("legal.privacy.questions")}</p>

      <h3>{t("legal.privacy.cookiesTitle")}</h3>
      <p>
        <Trans
          i18nKey="legal.privacy.cookies"
          components={{ strong: <strong /> }}
        />
      </p>

      <h2>{t("legal.privacy.accessTitle")}</h2>
      <ul>
        <li>
          <Trans
            i18nKey="legal.privacy.students"
            components={{ strong: <strong /> }}
          />
        </li>
        <li>
          <Trans
            i18nKey="legal.privacy.mentors"
            components={{ strong: <strong /> }}
          />
        </li>
        <li>
          <Trans
            i18nKey="legal.privacy.administrators"
            components={{ strong: <strong /> }}
          />
        </li>
        <li>
          <Trans
            i18nKey="legal.privacy.notebook"
            components={{ strong: <strong /> }}
          />
        </li>
      </ul>

      <h2>{t("legal.privacy.minorsTitle")}</h2>
      <p>
        <Trans
          i18nKey="legal.privacy.minors"
          components={{ strong: <strong /> }}
        />
      </p>

      <h2>{t("legal.privacy.assistantTitle")}</h2>
      <p>
        <Trans
          i18nKey="legal.privacy.assistant"
          components={{ strong: <strong /> }}
        />
      </p>

      <h2>{t("legal.privacy.retentionTitle")}</h2>
      <table>
        <thead>
          <tr>
            <th scope="col">{t("legal.privacy.dataColumn")}</th>
            <th scope="col">{t("legal.privacy.durationColumn")}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{t("legal.privacy.accountData")}</td>
            <td>{t("legal.privacy.accountDuration")}</td>
          </tr>
          <tr>
            <td>{t("legal.privacy.departedData")}</td>
            <td>
              <Trans
                i18nKey="legal.privacy.departedDuration"
                components={{ strong: <strong /> }}
              />
            </td>
          </tr>
          <tr>
            <td>{t("legal.privacy.archivesData")}</td>
            <td>
              <Trans
                i18nKey="legal.privacy.archivesDuration"
                components={{ strong: <strong /> }}
              />
            </td>
          </tr>
          <tr>
            <td>{t("legal.privacy.verificationData")}</td>
            <td>{t("legal.privacy.verificationDuration")}</td>
          </tr>
          <tr>
            <td>{t("legal.privacy.consentData")}</td>
            <td>{t("legal.privacy.consentDuration")}</td>
          </tr>
          <tr>
            <td>{t("legal.privacy.lockoutData")}</td>
            <td>{t("legal.privacy.lockoutDuration")}</td>
          </tr>
        </tbody>
      </table>
      <p>
        <Trans
          i18nKey="legal.privacy.suspension"
          components={{ terms: <Link to="/terms" /> }}
        />
      </p>

      <h2>{t("legal.privacy.rightsTitle")}</h2>
      <p>
        <Trans
          i18nKey="legal.privacy.rights"
          values={{ contact: CONTACT }}
          components={{ strong: <strong /> }}
        />
      </p>
      <p>{t("legal.privacy.erasure")}</p>
      <p>
        <Trans
          i18nKey="legal.privacy.complaint"
          components={{ strong: <strong /> }}
        />
      </p>

      <h2>{t("legal.privacy.securityTitle")}</h2>
      <p>{t("legal.privacy.security")}</p>
    </LegalPage>
  );
}

export function TermsPage() {
  const { t } = useTranslation();
  return (
    <LegalPage title={t("legal.terms.title")}>
      <p>
        <Trans
          i18nKey="legal.terms.intro"
          values={{ contact: CONTACT }}
          components={{ strong: <strong /> }}
        />
      </p>

      <h2>{t("legal.terms.purposeTitle")}</h2>
      <p>
        <Trans
          i18nKey="legal.terms.purpose"
          components={{ strong: <strong /> }}
        />
      </p>

      <h2>{t("legal.terms.eligibilityTitle")}</h2>
      <p>
        <Trans
          i18nKey="legal.terms.eligibility"
          components={{ strong: <strong /> }}
        />
      </p>

      <h2>{t("legal.terms.accountTitle")}</h2>
      <ul>
        <li>
          <Trans
            i18nKey="legal.terms.personalAccount"
            components={{ strong: <strong /> }}
          />
        </li>
        <li>{t("legal.terms.displayName")}</li>
        <li>{t("legal.terms.forgottenPassword")}</li>
      </ul>

      <h2>{t("legal.terms.conductTitle")}</h2>
      <p>
        <Trans
          i18nKey="legal.terms.conduct"
          components={{ strong: <strong /> }}
        />
      </p>
      <ul>
        <li>{t("legal.terms.respectfulWriting")}</li>
        <li>
          <Trans
            i18nKey="legal.terms.ownPhoto"
            components={{ strong: <strong /> }}
          />
        </li>
        <li>{t("legal.terms.appropriateContent")}</li>
        <li>{t("legal.terms.authorizedAccess")}</li>
      </ul>
      <p>
        <Trans
          i18nKey="legal.terms.clubRules"
          components={{ strong: <strong /> }}
        />
      </p>

      <h2>{t("legal.terms.ownershipTitle")}</h2>
      <p>
        <Trans
          i18nKey="legal.terms.ownership"
          components={{ strong: <strong /> }}
        />
      </p>

      <h2>{t("legal.terms.moderationTitle")}</h2>
      <p>
        <Trans
          i18nKey="legal.terms.moderation"
          components={{ strong: <strong /> }}
        />
      </p>

      <h2>{t("legal.terms.availabilityTitle")}</h2>
      <p>{t("legal.terms.availability")}</p>

      <h2>{t("legal.terms.changesTitle")}</h2>
      <p>{t("legal.terms.changes")}</p>

      <h2>{t("legal.terms.dataTitle")}</h2>
      <p>
        <Trans
          i18nKey="legal.terms.data"
          components={{ privacy: <Link to="/privacy" /> }}
        />
      </p>
    </LegalPage>
  );
}
