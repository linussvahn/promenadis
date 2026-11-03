import { PromenadisApiError } from "@promenadis/api-client";
import type { EventTeamSummary, InvitedEventTeamRole } from "@promenadis/contracts";
import { formatDateTime, type Locale, translate } from "@promenadis/i18n";
import { ChevronRightIcon } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { useExpectedAccountId } from "../lib/account-session";
import { getBrowserAuthClient, getPromenadisApiClient } from "../lib/supabase";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { NativeSelect, NativeSelectOption } from "./ui/native-select";

const rowList = "m-0 grid list-none divide-y border-y p-0";
const row = "flex flex-wrap items-start justify-between gap-3 py-3";
const subPanel = "grid gap-3 rounded-xl bg-muted/60 p-4 sm:p-5";
const subheading = "text-base font-bold";
const hint = "text-sm text-muted-foreground";
const summaryClass =
  "flex min-h-11 w-fit cursor-pointer list-none items-center gap-2 text-sm font-semibold text-link [&::-webkit-details-marker]:hidden";
const chevronClass = "size-4 transition-transform group-open:rotate-90";

export function EventTeam({
  actorRole,
  eventId,
  locale,
}: {
  readonly actorRole: "owner" | "co_host" | "moderator";
  readonly eventId: string;
  readonly locale: Locale;
}) {
  const expectedAccountId = useExpectedAccountId();
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmingRemoval, setConfirmingRemoval] = useState<string | null>(null);
  const [confirmingEmergencyClaim, setConfirmingEmergencyClaim] = useState(false);
  const [confirmingTransfer, setConfirmingTransfer] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [team, setTeam] = useState<EventTeamSummary | null>(null);

  const authenticatedClient = useCallback(async () => {
    const supabase = getBrowserAuthClient(expectedAccountId);
    const api = getPromenadisApiClient();
    if (!supabase || !api) return null;
    const { data } = await supabase.auth.getSession();
    return data.session ? { api, token: data.session.user.id } : null;
  }, [expectedAccountId]);

  const loadTeam = useCallback(async () => {
    try {
      const authenticated = await authenticatedClient();
      if (!authenticated) {
        setStatus(translate(locale, "dashboard.sessionExpired"));
        return;
      }
      setTeam(await authenticated.api.getEventTeam(authenticated.token, eventId));
    } catch {
      setStatus(translate(locale, "team.error"));
    }
  }, [authenticatedClient, eventId, locale]);

  useEffect(() => {
    void loadTeam();
  }, [loadTeam]);

  const errorMessage = (error: unknown) => {
    if (!(error instanceof PromenadisApiError)) return translate(locale, "team.error");
    if (error.code === "recent_auth_required") return translate(locale, "team.recentAuth");
    if (error.code === "version_conflict") {
      void loadTeam();
      return translate(locale, "team.versionConflict");
    }
    if (error.code === "already_member") return translate(locale, "team.alreadyMember");
    if (error.code === "invalid_email") return translate(locale, "team.invalidEmail");
    if (error.code === "organizer_manager_required") {
      return translate(locale, "team.transferOrganizerRequired");
    }
    if (error.code === "transfer_unavailable") {
      void loadTeam();
      return translate(locale, "team.transferUnavailable");
    }
    if (error.code === "claim_not_ready") return translate(locale, "team.claimNotReady");
    if (error.code === "claim_pending") return translate(locale, "team.claimPendingError");
    if (error.code === "claim_unavailable") {
      void loadTeam();
      return translate(locale, "team.claimUnavailable");
    }
    return translate(locale, "team.error");
  };

  const applyTeam = (nextTeam: EventTeamSummary) => {
    setTeam((currentTeam) => ({
      ...nextTeam,
      currentMembershipId: nextTeam.currentMembershipId ?? currentTeam?.currentMembershipId,
      pendingEmergencyClaim:
        nextTeam.pendingEmergencyClaim !== undefined
          ? nextTeam.pendingEmergencyClaim
          : nextTeam.emergencySuccessor
            ? currentTeam?.pendingEmergencyClaim
            : null,
    }));
  };

  const invite = async (formEvent: FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault();
    if (!team) return;
    const form = formEvent.currentTarget;
    const formData = new FormData(form);
    setBusy("invite");
    setStatus("");
    try {
      const authenticated = await authenticatedClient();
      if (!authenticated) throw new Error("missing_session");
      const nextTeam = await authenticated.api.inviteEventTeamMember(authenticated.token, eventId, {
        email: String(formData.get("email") ?? ""),
        expectedTeamVersion: team.teamVersion,
        role: String(formData.get("role") ?? "co_host") as InvitedEventTeamRole,
      });
      applyTeam(nextTeam);
      form.reset();
      setStatus(translate(locale, "team.invited"));
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  const cancelInvite = async (inviteId: string) => {
    if (!team) return;
    setBusy(inviteId);
    setStatus("");
    try {
      const authenticated = await authenticatedClient();
      if (!authenticated) throw new Error("missing_session");
      applyTeam(
        await authenticated.api.cancelEventTeamInvite(authenticated.token, eventId, inviteId, {
          expectedTeamVersion: team.teamVersion,
        }),
      );
      setStatus(translate(locale, "team.inviteCancelled"));
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  const updateMember = async (
    membershipId: string,
    nextRole: InvitedEventTeamRole,
    remove: boolean,
  ) => {
    if (!team) return;
    setBusy(membershipId);
    setStatus("");
    try {
      const authenticated = await authenticatedClient();
      if (!authenticated) throw new Error("missing_session");
      applyTeam(
        remove
          ? await authenticated.api.removeEventTeamMember(
              authenticated.token,
              eventId,
              membershipId,
              { expectedTeamVersion: team.teamVersion },
            )
          : await authenticated.api.updateEventTeamMemberRole(
              authenticated.token,
              eventId,
              membershipId,
              { expectedTeamVersion: team.teamVersion, role: nextRole },
            ),
      );
      if (remove) setConfirmingRemoval(null);
      setStatus(translate(locale, remove ? "team.memberRemoved" : "team.roleSaved"));
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  const initiateTransfer = async (optionValue: string) => {
    if (!team) return;
    const [membershipId, targetOrganizerProfileId] = optionValue.split(":");
    if (!membershipId || !targetOrganizerProfileId) return;
    setBusy("transfer");
    setStatus("");
    try {
      const authenticated = await authenticatedClient();
      if (!authenticated) throw new Error("missing_session");
      applyTeam(
        await authenticated.api.initiateEventOwnershipTransfer(authenticated.token, eventId, {
          expectedTeamVersion: team.teamVersion,
          targetOrganizerProfileId,
          toMembershipId: membershipId,
        }),
      );
      setConfirmingTransfer(null);
      setStatus(translate(locale, "team.transferInitiated"));
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  const resolveTransfer = async (accept: boolean) => {
    if (!team?.pendingTransfer) return;
    setBusy("transfer");
    setStatus("");
    try {
      const authenticated = await authenticatedClient();
      if (!authenticated) throw new Error("missing_session");
      const nextTeam = accept
        ? await authenticated.api.acceptEventOwnershipTransfer(
            authenticated.token,
            eventId,
            team.pendingTransfer.id,
            { expectedTeamVersion: team.teamVersion },
          )
        : await authenticated.api.cancelEventOwnershipTransfer(
            authenticated.token,
            eventId,
            team.pendingTransfer.id,
            { expectedTeamVersion: team.teamVersion },
          );
      applyTeam(nextTeam);
      setStatus(translate(locale, accept ? "team.transferAccepted" : "team.transferCancelled"));
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  const setSuccessor = async (optionValue: string) => {
    if (!team) return;
    const [successorMembershipId, targetOrganizerProfileId] = optionValue.split(":");
    if (!successorMembershipId || !targetOrganizerProfileId) return;
    setBusy("successor");
    setStatus("");
    try {
      const authenticated = await authenticatedClient();
      if (!authenticated) throw new Error("missing_session");
      applyTeam(
        await authenticated.api.setEventEmergencySuccessor(authenticated.token, eventId, {
          expectedTeamVersion: team.teamVersion,
          successorMembershipId,
          targetOrganizerProfileId,
        }),
      );
      setStatus(translate(locale, "team.successorSaved"));
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  const clearSuccessor = async () => {
    if (!team) return;
    setBusy("successor");
    setStatus("");
    try {
      const authenticated = await authenticatedClient();
      if (!authenticated) throw new Error("missing_session");
      applyTeam(
        await authenticated.api.clearEventEmergencySuccessor(authenticated.token, eventId, {
          expectedTeamVersion: team.teamVersion,
        }),
      );
      setStatus(translate(locale, "team.successorCleared"));
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  const initiateEmergencyClaim = async () => {
    if (!team) return;
    setBusy("emergency-claim");
    setStatus("");
    try {
      const authenticated = await authenticatedClient();
      if (!authenticated) throw new Error("missing_session");
      applyTeam(
        await authenticated.api.initiateEmergencySuccessorClaim(authenticated.token, eventId, {
          expectedTeamVersion: team.teamVersion,
        }),
      );
      setConfirmingEmergencyClaim(false);
      setStatus(translate(locale, "team.claimStarted"));
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  const resolveEmergencyClaim = async (complete: boolean) => {
    if (!team?.pendingEmergencyClaim) return;
    setBusy("emergency-claim");
    setStatus("");
    try {
      const authenticated = await authenticatedClient();
      if (!authenticated) throw new Error("missing_session");
      applyTeam(
        complete
          ? await authenticated.api.completeEmergencySuccessorClaim(
              authenticated.token,
              eventId,
              team.pendingEmergencyClaim.id,
              { expectedTeamVersion: team.teamVersion },
            )
          : await authenticated.api.cancelEmergencySuccessorClaim(
              authenticated.token,
              eventId,
              team.pendingEmergencyClaim.id,
              { expectedTeamVersion: team.teamVersion },
            ),
      );
      setStatus(translate(locale, complete ? "team.claimCompleted" : "team.claimCancelled"));
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  const effectiveActorRole =
    team?.members.find((member) => member.id === team.currentMembershipId)?.role ?? actorRole;
  const transferOptions = team?.ownershipTransferOptions ?? [];
  const successorOptions = team?.successorOptions ?? [];
  const pendingEmergencyClaim = team?.pendingEmergencyClaim ?? null;
  const isDesignatedSuccessor =
    team?.emergencySuccessor?.successorMembershipId === team?.currentMembershipId;
  const isClaimant = pendingEmergencyClaim?.successorMembershipId === team?.currentMembershipId;
  const claimIsReady = pendingEmergencyClaim
    ? Date.parse(pendingEmergencyClaim.readyAt) <= Date.now()
    : false;

  return (
    <Card asChild>
      <section aria-labelledby="event-team-heading">
        <CardHeader>
          <CardTitle id="event-team-heading">{translate(locale, "team.title")}</CardTitle>
          <CardDescription>{translate(locale, "team.intro")}</CardDescription>
        </CardHeader>
        <CardContent className="gap-6">
          {!team ? (
            <p aria-live="polite">{status || translate(locale, "common.loading")}</p>
          ) : (
            <>
              <ul aria-label={translate(locale, "team.members")} className={rowList}>
                {team.members.map((member) => (
                  <li className={row} key={member.id}>
                    <div className="grid min-w-0 gap-0.5">
                      <strong>{member.displayName}</strong>
                      <span>{translate(locale, `team.role.${member.role}`)}</span>
                    </div>
                    {effectiveActorRole === "owner" &&
                    member.role !== "owner" &&
                    pendingEmergencyClaim?.successorMembershipId !== member.id ? (
                      <details className="group w-full sm:w-auto sm:min-w-64">
                        <summary className={summaryClass}>
                          <ChevronRightIcon aria-hidden="true" className={chevronClass} />
                          {translate(locale, "team.manageMember")}
                        </summary>
                        <form
                          className="mt-2 grid gap-3 rounded-xl bg-muted/60 p-4"
                          onSubmit={(formEvent) => {
                            formEvent.preventDefault();
                            const nextRole = new FormData(formEvent.currentTarget).get("role");
                            void updateMember(
                              member.id,
                              String(nextRole) as InvitedEventTeamRole,
                              false,
                            );
                          }}
                        >
                          <Label htmlFor={`member-role-${member.id}`}>
                            {translate(locale, "team.roleLabel")}
                          </Label>
                          <NativeSelect
                            defaultValue={member.role}
                            disabled={busy !== null}
                            id={`member-role-${member.id}`}
                            name="role"
                          >
                            <NativeSelectOption value="co_host">
                              {translate(locale, "team.role.co_host")}
                            </NativeSelectOption>
                            <NativeSelectOption value="moderator">
                              {translate(locale, "team.role.moderator")}
                            </NativeSelectOption>
                          </NativeSelect>
                          <Button variant="outline" disabled={busy !== null} type="submit">
                            {translate(locale, "team.saveRole")}
                          </Button>
                          {confirmingRemoval === member.id ? (
                            <div className="grid gap-2 rounded-lg bg-destructive-soft p-3 text-destructive-foreground">
                              <strong>{translate(locale, "team.confirmRemoval")}</strong>
                              <div className="flex flex-wrap items-center gap-2">
                                <Button
                                  variant="destructive"
                                  disabled={busy !== null}
                                  onClick={() => void updateMember(member.id, "moderator", true)}
                                  type="button"
                                >
                                  {translate(locale, "team.confirmRemoveMember")}
                                </Button>
                                <Button
                                  variant="ghost"
                                  disabled={busy !== null}
                                  onClick={() => setConfirmingRemoval(null)}
                                  type="button"
                                >
                                  {translate(locale, "common.cancel")}
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <Button
                              className="text-destructive-foreground hover:bg-destructive-soft"
                              variant="ghost"
                              disabled={busy !== null}
                              onClick={() => setConfirmingRemoval(member.id)}
                              type="button"
                            >
                              {translate(locale, "team.removeMember")}
                            </Button>
                          )}
                        </form>
                      </details>
                    ) : null}
                  </li>
                ))}
              </ul>

              {team.emergencySuccessor ? (
                <section aria-labelledby="emergency-successor-heading" className={subPanel}>
                  <h3 className={subheading} id="emergency-successor-heading">
                    {translate(locale, "team.successorTitle")}
                  </h3>
                  <p>
                    {translate(locale, "team.successorCurrent")
                      .replace("{name}", team.emergencySuccessor.recipientDisplayName)
                      .replace("{organizer}", team.emergencySuccessor.organizerDisplayName)}
                  </p>
                  <p className={hint}>{translate(locale, "team.successorDelay")}</p>
                  {effectiveActorRole === "owner" && !pendingEmergencyClaim ? (
                    <Button
                      variant="outline"
                      disabled={busy !== null}
                      onClick={() => void clearSuccessor()}
                      type="button"
                    >
                      {translate(locale, "team.successorClear")}
                    </Button>
                  ) : null}
                </section>
              ) : null}

              {pendingEmergencyClaim ? (
                <section aria-labelledby="emergency-claim-heading" className={subPanel}>
                  <h3 className={subheading} id="emergency-claim-heading">
                    {translate(locale, "team.claimPendingTitle")}
                  </h3>
                  <p>
                    {translate(locale, "team.claimPending")
                      .replace("{name}", pendingEmergencyClaim.successorDisplayName)
                      .replace("{organizer}", pendingEmergencyClaim.targetOrganizerDisplayName)}
                  </p>
                  <p className={hint}>
                    {translate(locale, "team.claimReadyAt")}{" "}
                    {formatDateTime(locale, pendingEmergencyClaim.readyAt, "Europe/Stockholm")}
                  </p>
                  <p className={hint}>
                    {translate(locale, "team.expires")}{" "}
                    {formatDateTime(locale, pendingEmergencyClaim.expiresAt, "Europe/Stockholm")}
                  </p>
                  <p className={hint}>{translate(locale, "team.claimNotificationLocal")}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    {isClaimant ? (
                      <Button
                        disabled={busy !== null || !claimIsReady}
                        onClick={() => void resolveEmergencyClaim(true)}
                        type="button"
                      >
                        {claimIsReady
                          ? translate(locale, "team.claimComplete")
                          : translate(locale, "team.claimWaiting")}
                      </Button>
                    ) : null}
                    {effectiveActorRole === "owner" || isClaimant ? (
                      <Button
                        variant="outline"
                        disabled={busy !== null}
                        onClick={() => void resolveEmergencyClaim(false)}
                        type="button"
                      >
                        {translate(locale, "team.claimCancel")}
                      </Button>
                    ) : null}
                  </div>
                </section>
              ) : isDesignatedSuccessor ? (
                <section aria-labelledby="emergency-claim-start-heading" className={subPanel}>
                  <h3 className={subheading} id="emergency-claim-start-heading">
                    {translate(locale, "team.claimTitle")}
                  </h3>
                  <p>{translate(locale, "team.claimHelp")}</p>
                  {confirmingEmergencyClaim ? (
                    <p className="rounded-lg bg-destructive-soft p-3 text-destructive-foreground">
                      <strong>{translate(locale, "team.claimConfirm")}</strong>
                    </p>
                  ) : null}
                  <Button
                    variant="outline"
                    disabled={busy !== null}
                    onClick={() =>
                      confirmingEmergencyClaim
                        ? void initiateEmergencyClaim()
                        : setConfirmingEmergencyClaim(true)
                    }
                    type="button"
                  >
                    {confirmingEmergencyClaim
                      ? translate(locale, "team.claimStart")
                      : translate(locale, "team.claimReview")}
                  </Button>
                </section>
              ) : null}

              {effectiveActorRole === "owner" ? (
                <div className="grid gap-6 border-t pt-6">
                  {!team.emergencySuccessor ? (
                    <section aria-labelledby="successor-settings-heading" className={subPanel}>
                      <h3 className={subheading} id="successor-settings-heading">
                        {translate(locale, "team.successorTitle")}
                      </h3>
                      <p className={hint}>{translate(locale, "team.successorHelp")}</p>
                      {successorOptions.length > 0 ? (
                        <form
                          onSubmit={(formEvent) => {
                            formEvent.preventDefault();
                            void setSuccessor(
                              String(
                                new FormData(formEvent.currentTarget).get("successorOption") ?? "",
                              ),
                            );
                          }}
                        >
                          <Label htmlFor="emergency-successor-option">
                            {translate(locale, "team.successorPerson")}
                          </Label>
                          <NativeSelect
                            disabled={busy !== null}
                            id="emergency-successor-option"
                            name="successorOption"
                          >
                            {successorOptions.map((option) => (
                              <NativeSelectOption
                                key={`${option.successorMembershipId}:${option.organizerProfileId}`}
                                value={`${option.successorMembershipId}:${option.organizerProfileId}`}
                              >
                                {option.recipientDisplayName} · {option.organizerDisplayName}
                              </NativeSelectOption>
                            ))}
                          </NativeSelect>
                          <Button variant="outline" disabled={busy !== null} type="submit">
                            {translate(locale, "team.successorSet")}
                          </Button>
                        </form>
                      ) : (
                        <p>{translate(locale, "team.successorNoEligible")}</p>
                      )}
                    </section>
                  ) : null}
                  <section aria-labelledby="ownership-transfer-heading" className={subPanel}>
                    <h3 className={subheading} id="ownership-transfer-heading">
                      {translate(locale, "team.transferTitle")}
                    </h3>
                    {pendingEmergencyClaim ? (
                      <p className={hint}>{translate(locale, "team.claimBlocksTransfer")}</p>
                    ) : team.pendingTransfer ? (
                      <div className="grid gap-2">
                        <p>
                          {translate(locale, "team.transferPending").replace(
                            "{name}",
                            team.pendingTransfer.toDisplayName,
                          )}
                        </p>
                        {team.pendingTransfer.targetOrganizerDisplayName ? (
                          <p className={hint}>
                            {translate(locale, "team.transferOrganizer").replace(
                              "{organizer}",
                              team.pendingTransfer.targetOrganizerDisplayName,
                            )}
                          </p>
                        ) : null}
                        <p className={hint}>
                          {translate(locale, "team.expires")}{" "}
                          {formatDateTime(
                            locale,
                            team.pendingTransfer.expiresAt,
                            "Europe/Stockholm",
                          )}
                        </p>
                        <Button
                          variant="outline"
                          disabled={busy !== null}
                          onClick={() => void resolveTransfer(false)}
                          type="button"
                        >
                          {translate(locale, "team.transferCancel")}
                        </Button>
                      </div>
                    ) : transferOptions.length === 0 ? (
                      <p className={hint}>{translate(locale, "team.transferNoEligible")}</p>
                    ) : (
                      <form
                        onSubmit={(formEvent) => {
                          formEvent.preventDefault();
                          const optionValue = String(
                            new FormData(formEvent.currentTarget).get("transferOption") ?? "",
                          );
                          if (confirmingTransfer === optionValue)
                            void initiateTransfer(optionValue);
                          else setConfirmingTransfer(optionValue);
                        }}
                      >
                        <p className={hint}>{translate(locale, "team.transferHelp")}</p>
                        <Label htmlFor="ownership-transfer-recipient">
                          {translate(locale, "team.transferRecipient")}
                        </Label>
                        <NativeSelect
                          disabled={busy !== null}
                          id="ownership-transfer-recipient"
                          name="transferOption"
                          onChange={() => setConfirmingTransfer(null)}
                        >
                          {transferOptions.map((option) => (
                            <NativeSelectOption
                              key={`${option.toMembershipId}:${option.organizerProfileId}`}
                              value={`${option.toMembershipId}:${option.organizerProfileId}`}
                            >
                              {option.recipientDisplayName} · {option.organizerDisplayName}
                            </NativeSelectOption>
                          ))}
                        </NativeSelect>
                        {confirmingTransfer ? (
                          <p className="rounded-lg bg-destructive-soft p-3 text-destructive-foreground">
                            <strong>{translate(locale, "team.transferConfirm")}</strong>
                          </p>
                        ) : null}
                        <Button variant="outline" disabled={busy !== null} type="submit">
                          {confirmingTransfer
                            ? translate(locale, "team.transferConfirmButton")
                            : translate(locale, "team.transferStart")}
                        </Button>
                      </form>
                    )}
                  </section>

                  <form className="grid max-w-md gap-3" onSubmit={invite}>
                    <h3 className={subheading}>{translate(locale, "team.inviteTitle")}</h3>
                    <p className={hint}>{translate(locale, "team.inviteHelp")}</p>
                    <Label htmlFor="team-invite-email">{translate(locale, "auth.email")}</Label>
                    <Input
                      autoComplete="email"
                      disabled={busy !== null}
                      id="team-invite-email"
                      name="email"
                      required
                      type="email"
                    />
                    <Label htmlFor="team-invite-role">{translate(locale, "team.roleLabel")}</Label>
                    <NativeSelect
                      defaultValue="co_host"
                      disabled={busy !== null}
                      id="team-invite-role"
                      name="role"
                    >
                      <NativeSelectOption value="co_host">
                        {translate(locale, "team.role.co_host")}
                      </NativeSelectOption>
                      <NativeSelectOption value="moderator">
                        {translate(locale, "team.role.moderator")}
                      </NativeSelectOption>
                    </NativeSelect>
                    <Button variant="outline" disabled={busy !== null} type="submit">
                      {busy === "invite"
                        ? translate(locale, "team.inviting")
                        : translate(locale, "team.sendInvite")}
                    </Button>
                  </form>

                  {team.pendingInvites.length > 0 ? (
                    <div>
                      <h3 className={subheading}>{translate(locale, "team.pending")}</h3>
                      <ul className={rowList}>
                        {team.pendingInvites.map((inviteItem) => (
                          <li className={row} key={inviteItem.id}>
                            <div className="grid min-w-0 gap-0.5">
                              <strong>{inviteItem.email}</strong>
                              <span>
                                {translate(locale, `team.role.${inviteItem.role}`)} ·{" "}
                                {translate(locale, "team.expires")}{" "}
                                {formatDateTime(locale, inviteItem.expiresAt, "Europe/Stockholm")}
                              </span>
                            </div>
                            <Button
                              variant="outline"
                              disabled={busy !== null}
                              onClick={() => void cancelInvite(inviteItem.id)}
                              type="button"
                            >
                              {translate(locale, "team.cancelInvite")}
                            </Button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {team.pendingTransfer &&
              team.currentMembershipId === team.pendingTransfer.toMembershipId ? (
                <section aria-labelledby="ownership-accept-heading" className={subPanel}>
                  <h3 className={subheading} id="ownership-accept-heading">
                    {translate(locale, "team.transferAcceptTitle")}
                  </h3>
                  <p>{translate(locale, "team.transferAcceptHelp")}</p>
                  {team.pendingTransfer.targetOrganizerDisplayName ? (
                    <p className={hint}>
                      {translate(locale, "team.transferOrganizer").replace(
                        "{organizer}",
                        team.pendingTransfer.targetOrganizerDisplayName,
                      )}
                    </p>
                  ) : null}
                  <Button
                    disabled={busy !== null}
                    onClick={() => void resolveTransfer(true)}
                    type="button"
                  >
                    {busy === "transfer"
                      ? translate(locale, "common.saving")
                      : translate(locale, "team.transferAccept")}
                  </Button>
                </section>
              ) : null}
            </>
          )}

          {team ? (
            <p aria-live="polite" className="min-h-6 text-sm font-semibold">
              {status}
            </p>
          ) : null}
        </CardContent>
      </section>
    </Card>
  );
}
