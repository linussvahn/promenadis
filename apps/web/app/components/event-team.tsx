import { useExpectedAccountId } from "../lib/account-session";
import { PromenadisApiError } from "@promenadis/api-client";
import type { EventTeamSummary, InvitedEventTeamRole } from "@promenadis/contracts";
import { formatDateTime, type Locale, translate } from "@promenadis/i18n";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { getPromenadisApiClient, getBrowserAuthClient } from "../lib/supabase";

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
    <section aria-labelledby="event-team-heading" className="event-team panel">
      <header>
        <h2 id="event-team-heading">{translate(locale, "team.title")}</h2>
        <p className="field-help">{translate(locale, "team.intro")}</p>
      </header>

      {!team ? (
        <p aria-live="polite">{status || translate(locale, "common.loading")}</p>
      ) : (
        <>
          <ul aria-label={translate(locale, "team.members")} className="team-list">
            {team.members.map((member) => (
              <li key={member.id}>
                <div className="team-member-copy">
                  <strong>{member.displayName}</strong>
                  <span>{translate(locale, `team.role.${member.role}`)}</span>
                </div>
                {effectiveActorRole === "owner" &&
                member.role !== "owner" &&
                pendingEmergencyClaim?.successorMembershipId !== member.id ? (
                  <details className="team-member-controls">
                    <summary>{translate(locale, "team.manageMember")}</summary>
                    <form
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
                      <label className="team-control-label" htmlFor={`member-role-${member.id}`}>
                        {translate(locale, "team.roleLabel")}
                      </label>
                      <select
                        defaultValue={member.role}
                        disabled={busy !== null}
                        id={`member-role-${member.id}`}
                        name="role"
                      >
                        <option value="co_host">{translate(locale, "team.role.co_host")}</option>
                        <option value="moderator">
                          {translate(locale, "team.role.moderator")}
                        </option>
                      </select>
                      <button className="secondary-button" disabled={busy !== null} type="submit">
                        {translate(locale, "team.saveRole")}
                      </button>
                      {confirmingRemoval === member.id ? (
                        <div className="remove-confirmation">
                          <strong>{translate(locale, "team.confirmRemoval")}</strong>
                          <div className="inline-control">
                            <button
                              className="danger-button"
                              disabled={busy !== null}
                              onClick={() => void updateMember(member.id, "moderator", true)}
                              type="button"
                            >
                              {translate(locale, "team.confirmRemoveMember")}
                            </button>
                            <button
                              className="quiet-button"
                              disabled={busy !== null}
                              onClick={() => setConfirmingRemoval(null)}
                              type="button"
                            >
                              {translate(locale, "common.cancel")}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          className="danger-button"
                          disabled={busy !== null}
                          onClick={() => setConfirmingRemoval(member.id)}
                          type="button"
                        >
                          {translate(locale, "team.removeMember")}
                        </button>
                      )}
                    </form>
                  </details>
                ) : null}
              </li>
            ))}
          </ul>

          {team.emergencySuccessor ? (
            <section aria-labelledby="emergency-successor-heading" className="team-transfer">
              <h3 id="emergency-successor-heading">{translate(locale, "team.successorTitle")}</h3>
              <p>
                {translate(locale, "team.successorCurrent")
                  .replace("{name}", team.emergencySuccessor.recipientDisplayName)
                  .replace("{organizer}", team.emergencySuccessor.organizerDisplayName)}
              </p>
              <p className="field-help">{translate(locale, "team.successorDelay")}</p>
              {effectiveActorRole === "owner" && !pendingEmergencyClaim ? (
                <button
                  className="secondary-button"
                  disabled={busy !== null}
                  onClick={() => void clearSuccessor()}
                  type="button"
                >
                  {translate(locale, "team.successorClear")}
                </button>
              ) : null}
            </section>
          ) : null}

          {pendingEmergencyClaim ? (
            <section aria-labelledby="emergency-claim-heading" className="team-transfer">
              <h3 id="emergency-claim-heading">{translate(locale, "team.claimPendingTitle")}</h3>
              <p>
                {translate(locale, "team.claimPending")
                  .replace("{name}", pendingEmergencyClaim.successorDisplayName)
                  .replace("{organizer}", pendingEmergencyClaim.targetOrganizerDisplayName)}
              </p>
              <p className="field-help">
                {translate(locale, "team.claimReadyAt")}{" "}
                {formatDateTime(locale, pendingEmergencyClaim.readyAt, "Europe/Stockholm")}
              </p>
              <p className="field-help">
                {translate(locale, "team.expires")}{" "}
                {formatDateTime(locale, pendingEmergencyClaim.expiresAt, "Europe/Stockholm")}
              </p>
              <p className="field-help">{translate(locale, "team.claimNotificationLocal")}</p>
              <div className="inline-control">
                {isClaimant ? (
                  <button
                    className="primary-button"
                    disabled={busy !== null || !claimIsReady}
                    onClick={() => void resolveEmergencyClaim(true)}
                    type="button"
                  >
                    {claimIsReady
                      ? translate(locale, "team.claimComplete")
                      : translate(locale, "team.claimWaiting")}
                  </button>
                ) : null}
                {effectiveActorRole === "owner" || isClaimant ? (
                  <button
                    className="secondary-button"
                    disabled={busy !== null}
                    onClick={() => void resolveEmergencyClaim(false)}
                    type="button"
                  >
                    {translate(locale, "team.claimCancel")}
                  </button>
                ) : null}
              </div>
            </section>
          ) : isDesignatedSuccessor ? (
            <section aria-labelledby="emergency-claim-start-heading" className="team-transfer">
              <h3 id="emergency-claim-start-heading">{translate(locale, "team.claimTitle")}</h3>
              <p>{translate(locale, "team.claimHelp")}</p>
              {confirmingEmergencyClaim ? (
                <p className="remove-confirmation">
                  <strong>{translate(locale, "team.claimConfirm")}</strong>
                </p>
              ) : null}
              <button
                className="secondary-button"
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
              </button>
            </section>
          ) : null}

          {effectiveActorRole === "owner" ? (
            <div className="team-owner-controls">
              {!team.emergencySuccessor ? (
                <section aria-labelledby="successor-settings-heading" className="team-transfer">
                  <h3 id="successor-settings-heading">
                    {translate(locale, "team.successorTitle")}
                  </h3>
                  <p className="field-help">{translate(locale, "team.successorHelp")}</p>
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
                      <label className="team-control-label" htmlFor="emergency-successor-option">
                        {translate(locale, "team.successorPerson")}
                      </label>
                      <select
                        disabled={busy !== null}
                        id="emergency-successor-option"
                        name="successorOption"
                      >
                        {successorOptions.map((option) => (
                          <option
                            key={`${option.successorMembershipId}:${option.organizerProfileId}`}
                            value={`${option.successorMembershipId}:${option.organizerProfileId}`}
                          >
                            {option.recipientDisplayName} · {option.organizerDisplayName}
                          </option>
                        ))}
                      </select>
                      <button className="secondary-button" disabled={busy !== null} type="submit">
                        {translate(locale, "team.successorSet")}
                      </button>
                    </form>
                  ) : (
                    <p>{translate(locale, "team.successorNoEligible")}</p>
                  )}
                </section>
              ) : null}
              <section aria-labelledby="ownership-transfer-heading" className="team-transfer">
                <h3 id="ownership-transfer-heading">{translate(locale, "team.transferTitle")}</h3>
                {pendingEmergencyClaim ? (
                  <p className="field-help">{translate(locale, "team.claimBlocksTransfer")}</p>
                ) : team.pendingTransfer ? (
                  <div className="team-transfer-pending">
                    <p>
                      {translate(locale, "team.transferPending").replace(
                        "{name}",
                        team.pendingTransfer.toDisplayName,
                      )}
                    </p>
                    {team.pendingTransfer.targetOrganizerDisplayName ? (
                      <p className="field-help">
                        {translate(locale, "team.transferOrganizer").replace(
                          "{organizer}",
                          team.pendingTransfer.targetOrganizerDisplayName,
                        )}
                      </p>
                    ) : null}
                    <p className="field-help">
                      {translate(locale, "team.expires")}{" "}
                      {formatDateTime(locale, team.pendingTransfer.expiresAt, "Europe/Stockholm")}
                    </p>
                    <button
                      className="secondary-button"
                      disabled={busy !== null}
                      onClick={() => void resolveTransfer(false)}
                      type="button"
                    >
                      {translate(locale, "team.transferCancel")}
                    </button>
                  </div>
                ) : transferOptions.length === 0 ? (
                  <p className="field-help">{translate(locale, "team.transferNoEligible")}</p>
                ) : (
                  <form
                    onSubmit={(formEvent) => {
                      formEvent.preventDefault();
                      const optionValue = String(
                        new FormData(formEvent.currentTarget).get("transferOption") ?? "",
                      );
                      if (confirmingTransfer === optionValue) void initiateTransfer(optionValue);
                      else setConfirmingTransfer(optionValue);
                    }}
                  >
                    <p className="field-help">{translate(locale, "team.transferHelp")}</p>
                    <label className="team-control-label" htmlFor="ownership-transfer-recipient">
                      {translate(locale, "team.transferRecipient")}
                    </label>
                    <select
                      disabled={busy !== null}
                      id="ownership-transfer-recipient"
                      name="transferOption"
                      onChange={() => setConfirmingTransfer(null)}
                    >
                      {transferOptions.map((option) => (
                        <option
                          key={`${option.toMembershipId}:${option.organizerProfileId}`}
                          value={`${option.toMembershipId}:${option.organizerProfileId}`}
                        >
                          {option.recipientDisplayName} · {option.organizerDisplayName}
                        </option>
                      ))}
                    </select>
                    {confirmingTransfer ? (
                      <p className="remove-confirmation">
                        <strong>{translate(locale, "team.transferConfirm")}</strong>
                      </p>
                    ) : null}
                    <button className="secondary-button" disabled={busy !== null} type="submit">
                      {confirmingTransfer
                        ? translate(locale, "team.transferConfirmButton")
                        : translate(locale, "team.transferStart")}
                    </button>
                  </form>
                )}
              </section>

              <form className="team-invite-form" onSubmit={invite}>
                <h3>{translate(locale, "team.inviteTitle")}</h3>
                <p className="field-help">{translate(locale, "team.inviteHelp")}</p>
                <label className="team-control-label" htmlFor="team-invite-email">
                  {translate(locale, "auth.email")}
                </label>
                <input
                  autoComplete="email"
                  disabled={busy !== null}
                  id="team-invite-email"
                  name="email"
                  required
                  type="email"
                />
                <label className="team-control-label" htmlFor="team-invite-role">
                  {translate(locale, "team.roleLabel")}
                </label>
                <select
                  defaultValue="co_host"
                  disabled={busy !== null}
                  id="team-invite-role"
                  name="role"
                >
                  <option value="co_host">{translate(locale, "team.role.co_host")}</option>
                  <option value="moderator">{translate(locale, "team.role.moderator")}</option>
                </select>
                <button className="secondary-button" disabled={busy !== null} type="submit">
                  {busy === "invite"
                    ? translate(locale, "team.inviting")
                    : translate(locale, "team.sendInvite")}
                </button>
              </form>

              {team.pendingInvites.length > 0 ? (
                <div>
                  <h3>{translate(locale, "team.pending")}</h3>
                  <ul className="team-list pending-invite-list">
                    {team.pendingInvites.map((inviteItem) => (
                      <li key={inviteItem.id}>
                        <div className="team-member-copy">
                          <strong>{inviteItem.email}</strong>
                          <span>
                            {translate(locale, `team.role.${inviteItem.role}`)} ·{" "}
                            {translate(locale, "team.expires")}{" "}
                            {formatDateTime(locale, inviteItem.expiresAt, "Europe/Stockholm")}
                          </span>
                        </div>
                        <button
                          className="secondary-button"
                          disabled={busy !== null}
                          onClick={() => void cancelInvite(inviteItem.id)}
                          type="button"
                        >
                          {translate(locale, "team.cancelInvite")}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}

          {team.pendingTransfer &&
          team.currentMembershipId === team.pendingTransfer.toMembershipId ? (
            <section aria-labelledby="ownership-accept-heading" className="team-transfer">
              <h3 id="ownership-accept-heading">{translate(locale, "team.transferAcceptTitle")}</h3>
              <p>{translate(locale, "team.transferAcceptHelp")}</p>
              {team.pendingTransfer.targetOrganizerDisplayName ? (
                <p className="field-help">
                  {translate(locale, "team.transferOrganizer").replace(
                    "{organizer}",
                    team.pendingTransfer.targetOrganizerDisplayName,
                  )}
                </p>
              ) : null}
              <button
                className="primary-button"
                disabled={busy !== null}
                onClick={() => void resolveTransfer(true)}
                type="button"
              >
                {busy === "transfer"
                  ? translate(locale, "common.saving")
                  : translate(locale, "team.transferAccept")}
              </button>
            </section>
          ) : null}
        </>
      )}

      {team ? (
        <p aria-live="polite" className="form-status">
          {status}
        </p>
      ) : null}
    </section>
  );
}
