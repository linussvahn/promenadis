import { PromenadisApiError } from "@promenadis/api-client";
import type { EventTeamSummary, InvitedEventTeamRole } from "@promenadis/contracts";
import { formatDateTime, type Locale, type MessageKey, translate } from "@promenadis/i18n";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRightIcon } from "lucide-react";
import { type FormEvent, useCallback, useState } from "react";
import { useExpectedAccountId } from "../lib/account-session";
import { getBrowserAuthClient, getPromenadisApiClient } from "../lib/supabase";
import { accountKey } from "../lib/use-account-data";
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
  const queryClient = useQueryClient();
  const [confirmingRemoval, setConfirmingRemoval] = useState<string | null>(null);
  const [confirmingEmergencyClaim, setConfirmingEmergencyClaim] = useState(false);
  const [confirmingTransfer, setConfirmingTransfer] = useState<string | null>(null);
  const [status, setStatus] = useState("");

  const authenticatedClient = useCallback(async () => {
    const supabase = getBrowserAuthClient(expectedAccountId);
    const api = getPromenadisApiClient();
    if (!supabase || !api) return null;
    const { data } = await supabase.auth.getSession();
    return data.session ? { api, token: data.session.user.id } : null;
  }, [expectedAccountId]);

  const teamKey = accountKey(expectedAccountId, "event", eventId, "team");
  const teamQuery = useQuery({
    queryKey: teamKey,
    queryFn: async () => {
      const authenticated = await authenticatedClient();
      if (!authenticated) throw new MissingSessionError();
      return authenticated.api.getEventTeam(authenticated.token, eventId);
    },
    retry: false,
  });
  const team = teamQuery.data ?? null;
  const loadError = teamQuery.isError
    ? translate(
        locale,
        teamQuery.error instanceof MissingSessionError ? "dashboard.sessionExpired" : "team.error",
      )
    : "";
  const loadTeam = () => queryClient.invalidateQueries({ queryKey: teamKey });

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
    queryClient.setQueryData<EventTeamSummary>(teamKey, (currentTeam) => ({
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

  // Every team write returns the whole new team, which replaces the cached one.
  const teamAction = useMutation({
    mutationFn: async (action: TeamAction) => {
      const authenticated = await authenticatedClient();
      if (!authenticated) throw new MissingSessionError();
      return action.run(authenticated.api, authenticated.token);
    },
    onError: (error) => setStatus(errorMessage(error)),
    onMutate: () => setStatus(""),
    onSuccess: (nextTeam, action) => {
      applyTeam(nextTeam);
      action.after?.();
      setStatus(translate(locale, action.success));
    },
  });
  const busy = teamAction.isPending ? teamAction.variables.busy : null;

  const invite = (formEvent: FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault();
    if (!team) return;
    const form = formEvent.currentTarget;
    const formData = new FormData(form);
    teamAction.mutate({
      after: () => form.reset(),
      busy: "invite",
      run: (api, token) =>
        api.inviteEventTeamMember(token, eventId, {
          email: String(formData.get("email") ?? ""),
          expectedTeamVersion: team.teamVersion,
          role: String(formData.get("role") ?? "co_host") as InvitedEventTeamRole,
        }),
      success: "team.invited",
    });
  };

  const cancelInvite = (inviteId: string) => {
    if (!team) return;
    teamAction.mutate({
      busy: inviteId,
      run: (api, token) =>
        api.cancelEventTeamInvite(token, eventId, inviteId, {
          expectedTeamVersion: team.teamVersion,
        }),
      success: "team.inviteCancelled",
    });
  };

  const updateMember = (membershipId: string, nextRole: InvitedEventTeamRole, remove: boolean) => {
    if (!team) return;
    teamAction.mutate({
      ...(remove ? { after: () => setConfirmingRemoval(null) } : {}),
      busy: membershipId,
      run: (api, token) =>
        remove
          ? api.removeEventTeamMember(token, eventId, membershipId, {
              expectedTeamVersion: team.teamVersion,
            })
          : api.updateEventTeamMemberRole(token, eventId, membershipId, {
              expectedTeamVersion: team.teamVersion,
              role: nextRole,
            }),
      success: remove ? "team.memberRemoved" : "team.roleSaved",
    });
  };

  const initiateTransfer = (optionValue: string) => {
    if (!team) return;
    const [membershipId, targetOrganizerProfileId] = optionValue.split(":");
    if (!membershipId || !targetOrganizerProfileId) return;
    teamAction.mutate({
      after: () => setConfirmingTransfer(null),
      busy: "transfer",
      run: (api, token) =>
        api.initiateEventOwnershipTransfer(token, eventId, {
          expectedTeamVersion: team.teamVersion,
          targetOrganizerProfileId,
          toMembershipId: membershipId,
        }),
      success: "team.transferInitiated",
    });
  };

  const resolveTransfer = (accept: boolean) => {
    const pendingTransfer = team?.pendingTransfer;
    if (!team || !pendingTransfer) return;
    teamAction.mutate({
      busy: "transfer",
      run: (api, token) =>
        accept
          ? api.acceptEventOwnershipTransfer(token, eventId, pendingTransfer.id, {
              expectedTeamVersion: team.teamVersion,
            })
          : api.cancelEventOwnershipTransfer(token, eventId, pendingTransfer.id, {
              expectedTeamVersion: team.teamVersion,
            }),
      success: accept ? "team.transferAccepted" : "team.transferCancelled",
    });
  };

  const setSuccessor = (optionValue: string) => {
    if (!team) return;
    const [successorMembershipId, targetOrganizerProfileId] = optionValue.split(":");
    if (!successorMembershipId || !targetOrganizerProfileId) return;
    teamAction.mutate({
      busy: "successor",
      run: (api, token) =>
        api.setEventEmergencySuccessor(token, eventId, {
          expectedTeamVersion: team.teamVersion,
          successorMembershipId,
          targetOrganizerProfileId,
        }),
      success: "team.successorSaved",
    });
  };

  const clearSuccessor = () => {
    if (!team) return;
    teamAction.mutate({
      busy: "successor",
      run: (api, token) =>
        api.clearEventEmergencySuccessor(token, eventId, {
          expectedTeamVersion: team.teamVersion,
        }),
      success: "team.successorCleared",
    });
  };

  const initiateEmergencyClaim = () => {
    if (!team) return;
    teamAction.mutate({
      after: () => setConfirmingEmergencyClaim(false),
      busy: "emergency-claim",
      run: (api, token) =>
        api.initiateEmergencySuccessorClaim(token, eventId, {
          expectedTeamVersion: team.teamVersion,
        }),
      success: "team.claimStarted",
    });
  };

  const resolveEmergencyClaim = (complete: boolean) => {
    const claim = team?.pendingEmergencyClaim;
    if (!team || !claim) return;
    teamAction.mutate({
      busy: "emergency-claim",
      run: (api, token) =>
        complete
          ? api.completeEmergencySuccessorClaim(token, eventId, claim.id, {
              expectedTeamVersion: team.teamVersion,
            })
          : api.cancelEmergencySuccessorClaim(token, eventId, claim.id, {
              expectedTeamVersion: team.teamVersion,
            }),
      success: complete ? "team.claimCompleted" : "team.claimCancelled",
    });
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
            <p aria-live="polite">{status || loadError || translate(locale, "common.loading")}</p>
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
                            updateMember(
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
                                  onClick={() => updateMember(member.id, "moderator", true)}
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
                      onClick={() => clearSuccessor()}
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
                        onClick={() => resolveEmergencyClaim(true)}
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
                        onClick={() => resolveEmergencyClaim(false)}
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
                        ? initiateEmergencyClaim()
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
                            setSuccessor(
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
                          onClick={() => resolveTransfer(false)}
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
                          if (confirmingTransfer === optionValue) initiateTransfer(optionValue);
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
                              onClick={() => cancelInvite(inviteItem.id)}
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
                    onClick={() => resolveTransfer(true)}
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

class MissingSessionError extends Error {
  constructor() {
    super("missing_session");
  }
}

interface TeamAction {
  /** Which control is busy: "invite", "transfer", … or the row's ID. */
  readonly busy: string;
  readonly run: (
    api: NonNullable<ReturnType<typeof getPromenadisApiClient>>,
    token: string,
  ) => Promise<EventTeamSummary>;
  readonly success: MessageKey;
  readonly after?: () => void;
}
