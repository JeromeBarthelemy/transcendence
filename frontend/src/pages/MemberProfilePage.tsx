import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";

import { getMemberProfile } from "../api/members";
import { RequestError } from "../components/ApiErrors";
import { Avatar, OnlineDot } from "../components/Avatar";
import { Page } from "../components/Page";
import { Eyebrow, Heading } from "../components/Typography";

/** Any signed-in member may open this (#176): the club works in one room.
 * Never shows an address nor a birth date — only a name, a photo and the
 * current season's team, same as the server sends. `online` (#267) stays
 * `null` unless the viewer may see it, which is why the dot only ever
 * appears when the server actually sent a value. */
export function MemberProfilePage() {
  const { t } = useTranslation();
  const userId = Number(useParams().userId);
  const profile = useQuery({
    queryKey: ["members", "profile", userId],
    queryFn: () => getMemberProfile(userId),
    enabled: Number.isInteger(userId),
  });

  return (
    <Page width="3xl">
      {!Number.isInteger(userId) ? (
        <p role="alert" className="mt-6 text-sm text-red-800">
          {t("errors.not_found")}
        </p>
      ) : profile.isPending ? (
        <p role="status" className="mt-6 text-sm text-muted">
          {t("memberProfile.loading")}
        </p>
      ) : profile.isError ? (
        <RequestError error={profile.error} />
      ) : (
        <div className="mt-6 flex flex-wrap items-center gap-4">
          <Avatar person={profile.data} size="detail" />
          <div className="min-w-0 flex-1">
            <Eyebrow size="sm">{t("memberProfile.eyebrow")}</Eyebrow>
            <Heading size="page" className="mt-1 flex items-center gap-2">
              {profile.data.display_name}
              {profile.data.online !== null && (
                <OnlineDot online={profile.data.online} />
              )}
            </Heading>
            <p className="mt-1 text-sm text-muted">
              {profile.data.club_role === "mentor"
                ? t("profile.allTeams")
                : profile.data.team
                  ? t("profile.team", {
                      team: `${profile.data.team.number} · ${profile.data.team.name}`,
                    })
                  : t("memberProfile.noTeam")}
            </p>
          </div>
        </div>
      )}
    </Page>
  );
}
