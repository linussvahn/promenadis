export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  app_private: {
    Tables: {
      account_deletion_requests: {
        Row: {
          account_id: string
          erase_after: string
          requested_at: string
        }
        Insert: {
          account_id: string
          erase_after: string
          requested_at?: string
        }
        Update: {
          account_id?: string
          erase_after?: string
          requested_at?: string
        }
        Relationships: []
      }
      account_recovery_claims: {
        Row: {
          account_id: string
          code_version: number | null
          email_verified_at: string | null
          expires_at: string
          id: string
          initiated_at: string
          method: string
          new_email: string
          original_email: string | null
          ready_at: string
          required_notice_count: number
          verification_token_hash: string
        }
        Insert: {
          account_id: string
          code_version?: number | null
          email_verified_at?: string | null
          expires_at: string
          id?: string
          initiated_at?: string
          method?: string
          new_email: string
          original_email?: string | null
          ready_at: string
          required_notice_count?: number
          verification_token_hash: string
        }
        Update: {
          account_id?: string
          code_version?: number | null
          email_verified_at?: string | null
          expires_at?: string
          id?: string
          initiated_at?: string
          method?: string
          new_email?: string
          original_email?: string | null
          ready_at?: string
          required_notice_count?: number
          verification_token_hash?: string
        }
        Relationships: []
      }
      account_recovery_codes: {
        Row: {
          account_id: string
          code_hash: string
          invalidated_at: string | null
          issued_at: string
          rotated_at: string | null
          used_at: string | null
          version: number
        }
        Insert: {
          account_id: string
          code_hash: string
          invalidated_at?: string | null
          issued_at?: string
          rotated_at?: string | null
          used_at?: string | null
          version?: number
        }
        Update: {
          account_id?: string
          code_hash?: string
          invalidated_at?: string | null
          issued_at?: string
          rotated_at?: string | null
          used_at?: string | null
          version?: number
        }
        Relationships: []
      }
      account_recovery_dispatches: {
        Row: {
          account_id: string
          claim_id: string
          id: string
          lease_until: string
          operation_id: string
          resolved_at: string | null
          started_at: string
          state: string
        }
        Insert: {
          account_id: string
          claim_id: string
          id?: string
          lease_until: string
          operation_id: string
          resolved_at?: string | null
          started_at?: string
          state?: string
        }
        Update: {
          account_id?: string
          claim_id?: string
          id?: string
          lease_until?: string
          operation_id?: string
          resolved_at?: string | null
          started_at?: string
          state?: string
        }
        Relationships: []
      }
      account_recovery_preparations: {
        Row: {
          claim_id: string
          operation_id: string
          prepared_at: string
        }
        Insert: {
          claim_id: string
          operation_id?: string
          prepared_at?: string
        }
        Update: {
          claim_id?: string
          operation_id?: string
          prepared_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_recovery_preparations_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: true
            referencedRelation: "account_recovery_claims"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_elevation_sessions: {
        Row: {
          account_id: string
          auth_session_id: string
          ended_at: string | null
          expires_at: string
          id: string
          started_at: string
        }
        Insert: {
          account_id: string
          auth_session_id: string
          ended_at?: string | null
          expires_at: string
          id?: string
          started_at?: string
        }
        Update: {
          account_id?: string
          auth_session_id?: string
          ended_at?: string | null
          expires_at?: string
          id?: string
          started_at?: string
        }
        Relationships: []
      }
      audit_events: {
        Row: {
          action: string
          actor_account_id: string | null
          correlation_id: string
          created_at: string
          event_id: string | null
          id: number
          safe_summary: Json
          target_id: string | null
          target_type: string
        }
        Insert: {
          action: string
          actor_account_id?: string | null
          correlation_id: string
          created_at?: string
          event_id?: string | null
          id?: never
          safe_summary?: Json
          target_id?: string | null
          target_type: string
        }
        Update: {
          action?: string
          actor_account_id?: string | null
          correlation_id?: string
          created_at?: string
          event_id?: string | null
          id?: never
          safe_summary?: Json
          target_id?: string | null
          target_type?: string
        }
        Relationships: []
      }
      browser_sessions: {
        Row: {
          account_id: string | null
          attempts: number
          auth_session_id: string | null
          created_at: string
          encrypted_payload: string
          expires_at: string
          kind: string
          lease_id: string | null
          lease_until: string | null
          session_hash: string
        }
        Insert: {
          account_id?: string | null
          attempts?: number
          auth_session_id?: string | null
          created_at?: string
          encrypted_payload: string
          expires_at: string
          kind: string
          lease_id?: string | null
          lease_until?: string | null
          session_hash: string
        }
        Update: {
          account_id?: string | null
          attempts?: number
          auth_session_id?: string | null
          created_at?: string
          encrypted_payload?: string
          expires_at?: string
          kind?: string
          lease_id?: string | null
          lease_until?: string | null
          session_hash?: string
        }
        Relationships: []
      }
      erasure_tombstones: {
        Row: {
          erased_at: string
          subject_id: string
          subject_type: string
        }
        Insert: {
          erased_at?: string
          subject_id: string
          subject_type: string
        }
        Update: {
          erased_at?: string
          subject_id?: string
          subject_type?: string
        }
        Relationships: []
      }
      event_first_reviews: {
        Row: {
          boundary_version: number
          decided_at: string | null
          decided_by_account_id: string | null
          event_id: string
          event_version: number
          reason: string | null
          registration_version: number
          requested_at: string
          status: string
          visibility: string
        }
        Insert: {
          boundary_version: number
          decided_at?: string | null
          decided_by_account_id?: string | null
          event_id: string
          event_version: number
          reason?: string | null
          registration_version: number
          requested_at?: string
          status?: string
          visibility: string
        }
        Update: {
          boundary_version?: number
          decided_at?: string | null
          decided_by_account_id?: string | null
          event_id?: string
          event_version?: number
          reason?: string | null
          registration_version?: number
          requested_at?: string
          status?: string
          visibility?: string
        }
        Relationships: []
      }
      feature_flags: {
        Row: {
          created_at: string
          enabled: boolean
          environment: string
          expires_at: string
          key: string
          owner: string
          rationale: string
          scope_id: string | null
          scope_type: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          environment: string
          expires_at: string
          key: string
          owner: string
          rationale: string
          scope_id?: string | null
          scope_type?: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          environment?: string
          expires_at?: string
          key?: string
          owner?: string
          rationale?: string
          scope_id?: string | null
          scope_type?: string
        }
        Relationships: []
      }
      local_recovery_budget: {
        Row: {
          attempts: number
          singleton: boolean
          window_started_at: string
        }
        Insert: {
          attempts: number
          singleton?: boolean
          window_started_at: string
        }
        Update: {
          attempts?: number
          singleton?: boolean
          window_started_at?: string
        }
        Relationships: []
      }
      notification_jobs: {
        Row: {
          attempt_count: number
          available_at: string
          cancelled_at: string | null
          completed_at: string | null
          correlation_id: string
          created_at: string
          delivery_lease_id: string | null
          delivery_lease_until: string | null
          event_id: string | null
          expires_at: string
          id: string
          recipient_account_id: string | null
          recipient_recovery_claim_id: string | null
          source_id: string
          template_key: string
        }
        Insert: {
          attempt_count?: number
          available_at?: string
          cancelled_at?: string | null
          completed_at?: string | null
          correlation_id: string
          created_at?: string
          delivery_lease_id?: string | null
          delivery_lease_until?: string | null
          event_id?: string | null
          expires_at?: string
          id?: string
          recipient_account_id?: string | null
          recipient_recovery_claim_id?: string | null
          source_id: string
          template_key: string
        }
        Update: {
          attempt_count?: number
          available_at?: string
          cancelled_at?: string | null
          completed_at?: string | null
          correlation_id?: string
          created_at?: string
          delivery_lease_id?: string | null
          delivery_lease_until?: string | null
          event_id?: string | null
          expires_at?: string
          id?: string
          recipient_account_id?: string | null
          recipient_recovery_claim_id?: string | null
          source_id?: string
          template_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_jobs_recipient_recovery_claim_id_fkey"
            columns: ["recipient_recovery_claim_id"]
            isOneToOne: false
            referencedRelation: "account_recovery_claims"
            referencedColumns: ["id"]
          },
        ]
      }
      organizer_verifications: {
        Row: {
          control_method: string
          control_reference: string
          decided_at: string | null
          organization_number: string
          organizer_profile_id: string
          reason: string | null
          recheck_due_at: string | null
          registered_name: string | null
          registry_source: string | null
          requested_at: string
          requested_by_account_id: string | null
          reviewer_account_id: string | null
          status: string
        }
        Insert: {
          control_method: string
          control_reference: string
          decided_at?: string | null
          organization_number: string
          organizer_profile_id: string
          reason?: string | null
          recheck_due_at?: string | null
          registered_name?: string | null
          registry_source?: string | null
          requested_at?: string
          requested_by_account_id?: string | null
          reviewer_account_id?: string | null
          status?: string
        }
        Update: {
          control_method?: string
          control_reference?: string
          decided_at?: string | null
          organization_number?: string
          organizer_profile_id?: string
          reason?: string | null
          recheck_due_at?: string | null
          registered_name?: string | null
          registry_source?: string | null
          requested_at?: string
          requested_by_account_id?: string | null
          reviewer_account_id?: string | null
          status?: string
        }
        Relationships: []
      }
      platform_admins: {
        Row: {
          account_id: string
          granted_at: string
        }
        Insert: {
          account_id: string
          granted_at?: string
        }
        Update: {
          account_id?: string
          granted_at?: string
        }
        Relationships: []
      }
      recovery_previous_email_notices: {
        Row: {
          created_at: string
          email: string
          expires_at: string
          job_id: string
        }
        Insert: {
          created_at?: string
          email: string
          expires_at: string
          job_id: string
        }
        Update: {
          created_at?: string
          email?: string
          expires_at?: string
          job_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recovery_previous_email_notices_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "notification_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      recovery_totp_attempts: {
        Row: {
          account_id: string
          failures: number
          last_step: number
          window_started_at: string
        }
        Insert: {
          account_id: string
          failures?: number
          last_step?: number
          window_started_at: string
        }
        Update: {
          account_id?: string
          failures?: number
          last_step?: number
          window_started_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      account_deletion_blockers: {
        Args: { p_account_id: string }
        Returns: Json
      }
      account_deletion_status: { Args: { p_account_id: string }; Returns: Json }
      account_recovery_claim_summary: {
        Args: {
          p_claim: Database["app_private"]["Tables"]["account_recovery_claims"]["Row"]
        }
        Returns: Json
      }
      account_recovery_status: { Args: { p_account_id: string }; Returns: Json }
      advance_event_lifecycle_command: { Args: never; Returns: number }
      base32_decode: { Args: { p_value: string }; Returns: string }
      consume_recovery_totp: {
        Args: { p_account_id: string; p_code: string }
        Returns: boolean
      }
      erase_due_accounts_command: { Args: never; Returns: number }
      event_boundary_summary: {
        Args: {
          p_boundary: Database["public"]["Tables"]["event_boundaries"]["Row"]
        }
        Returns: Json
      }
      event_control_summary: {
        Args: { p_event: Database["public"]["Tables"]["events"]["Row"] }
        Returns: Json
      }
      event_registration_summary: {
        Args: {
          p_registration: Database["public"]["Tables"]["event_registration_settings"]["Row"]
        }
        Returns: Json
      }
      event_team_summary: {
        Args: { p_event_id: string; p_include_invite_emails: boolean }
        Returns: Json
      }
      event_team_summary_with_emergency_claim: {
        Args: { p_event_id: string; p_include_invite_emails: boolean }
        Returns: Json
      }
      first_event_review_blocker: {
        Args: { p_event_id: string; p_owner_account_id: string }
        Returns: string
      }
      has_verified_totp: { Args: { p_account_id: string }; Returns: boolean }
      lock_eligible_recovery_claim: {
        Args: { p_claim_id: string; p_verification_token: string }
        Returns: {
          account_id: string
          code_version: number | null
          email_verified_at: string | null
          expires_at: string
          id: string
          initiated_at: string
          method: string
          new_email: string
          original_email: string | null
          ready_at: string
          required_notice_count: number
          verification_token_hash: string
        }
        SetofOptions: {
          from: "*"
          to: "account_recovery_claims"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      mask_email: { Args: { p_email: string }; Returns: string }
      organizer_team_summary: {
        Args: {
          p_include_invite_emails: boolean
          p_organizer_profile_id: string
        }
        Returns: Json
      }
      organizer_verification_status: {
        Args: { p_organizer_profile_id: string }
        Returns: Json
      }
      publication_system_blockers: {
        Args: { p_event_id: string }
        Returns: Json
      }
      purge_closed_organizer_verifications_command: {
        Args: never
        Returns: undefined
      }
      purge_expired_account_recovery_claims_command: {
        Args: never
        Returns: undefined
      }
      purge_expired_browser_sessions: { Args: never; Returns: undefined }
      purge_expired_recovery_previous_emails_command: {
        Args: never
        Returns: undefined
      }
      require_admin_elevation: {
        Args: { p_actor_id: string; p_auth_session_id: string }
        Returns: undefined
      }
      require_recent_authentication: {
        Args: { p_authenticated_at: string }
        Returns: undefined
      }
      resolve_recovery_dispatch: {
        Args: { p_correlation_id: string; p_dispatch_id: string }
        Returns: string
      }
      totp_code: { Args: { p_key: string; p_step: number }; Returns: string }
      valid_organization_number: { Args: { p_value: string }; Returns: boolean }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      event_boundaries: {
        Row: {
          area_square_meters: number
          boundary: unknown
          created_at: string
          display_label: string | null
          event_id: string
          span_meters: number
          updated_at: string
          version: number
        }
        Insert: {
          area_square_meters: number
          boundary: unknown
          created_at?: string
          display_label?: string | null
          event_id: string
          span_meters: number
          updated_at?: string
          version?: number
        }
        Update: {
          area_square_meters?: number
          boundary?: unknown
          created_at?: string
          display_label?: string | null
          event_id?: string
          span_meters?: number
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "event_boundaries_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: true
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_emergency_successor_claims: {
        Row: {
          event_id: string
          expires_at: string
          from_owner_membership_id: string
          id: string
          initiated_at: string
          ready_at: string
          successor_membership_id: string
          target_organizer_profile_id: string
        }
        Insert: {
          event_id: string
          expires_at?: string
          from_owner_membership_id: string
          id?: string
          initiated_at?: string
          ready_at?: string
          successor_membership_id: string
          target_organizer_profile_id: string
        }
        Update: {
          event_id?: string
          expires_at?: string
          from_owner_membership_id?: string
          id?: string
          initiated_at?: string
          ready_at?: string
          successor_membership_id?: string
          target_organizer_profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_emergency_successor_clai_target_organizer_profile_id_fkey"
            columns: ["target_organizer_profile_id"]
            isOneToOne: false
            referencedRelation: "organizer_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_emergency_successor_claims_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: true
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_emergency_successor_claims_from_owner_membership_id_fkey"
            columns: ["from_owner_membership_id"]
            isOneToOne: false
            referencedRelation: "event_memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_emergency_successor_claims_successor_membership_id_fkey"
            columns: ["successor_membership_id"]
            isOneToOne: false
            referencedRelation: "event_memberships"
            referencedColumns: ["id"]
          },
        ]
      }
      event_emergency_successors: {
        Row: {
          designated_at: string
          event_id: string
          successor_membership_id: string
          target_organizer_profile_id: string
          updated_at: string
        }
        Insert: {
          designated_at?: string
          event_id: string
          successor_membership_id: string
          target_organizer_profile_id: string
          updated_at?: string
        }
        Update: {
          designated_at?: string
          event_id?: string
          successor_membership_id?: string
          target_organizer_profile_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_emergency_successors_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: true
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_emergency_successors_successor_membership_id_fkey"
            columns: ["successor_membership_id"]
            isOneToOne: false
            referencedRelation: "event_memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_emergency_successors_target_organizer_profile_id_fkey"
            columns: ["target_organizer_profile_id"]
            isOneToOne: false
            referencedRelation: "organizer_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      event_intervals: {
        Row: {
          created_at: string
          ends_at: string
          event_id: string
          id: string
          position: number
          starts_at: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          ends_at: string
          event_id: string
          id?: string
          position?: number
          starts_at: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          ends_at?: string
          event_id?: string
          id?: string
          position?: number
          starts_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_intervals_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_invites: {
        Row: {
          created_at: string
          created_by_account_id: string
          event_id: string
          expires_at: string
          id: string
          invited_email: string
          role: string
        }
        Insert: {
          created_at?: string
          created_by_account_id: string
          event_id: string
          expires_at?: string
          id?: string
          invited_email: string
          role: string
        }
        Update: {
          created_at?: string
          created_by_account_id?: string
          event_id?: string
          expires_at?: string
          id?: string
          invited_email?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_invites_created_by_account_id_fkey"
            columns: ["created_by_account_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "event_invites_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_memberships: {
        Row: {
          account_id: string
          created_at: string
          display_name: string
          event_id: string
          id: string
          role: string
        }
        Insert: {
          account_id: string
          created_at?: string
          display_name: string
          event_id: string
          id?: string
          role: string
        }
        Update: {
          account_id?: string
          created_at?: string
          display_name?: string
          event_id?: string
          id?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_memberships_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "event_memberships_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_ownership_transfers: {
        Row: {
          created_at: string
          event_id: string
          expires_at: string
          from_membership_id: string
          id: string
          target_organizer_profile_id: string | null
          to_membership_id: string
        }
        Insert: {
          created_at?: string
          event_id: string
          expires_at?: string
          from_membership_id: string
          id?: string
          target_organizer_profile_id?: string | null
          to_membership_id: string
        }
        Update: {
          created_at?: string
          event_id?: string
          expires_at?: string
          from_membership_id?: string
          id?: string
          target_organizer_profile_id?: string | null
          to_membership_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_ownership_transfers_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: true
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_ownership_transfers_from_membership_id_fkey"
            columns: ["from_membership_id"]
            isOneToOne: false
            referencedRelation: "event_memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_ownership_transfers_target_organizer_profile_id_fkey"
            columns: ["target_organizer_profile_id"]
            isOneToOne: false
            referencedRelation: "organizer_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_ownership_transfers_to_membership_id_fkey"
            columns: ["to_membership_id"]
            isOneToOne: false
            referencedRelation: "event_memberships"
            referencedColumns: ["id"]
          },
        ]
      }
      event_publication_attestations: {
        Row: {
          attested_at: string
          attested_by_account_id: string
          boundary_version: number
          event_id: string
          event_version: number
          location_authority_confirmed: boolean
          registration_version: number
          visibility: string
          visibility_understood: boolean
        }
        Insert: {
          attested_at?: string
          attested_by_account_id: string
          boundary_version: number
          event_id: string
          event_version: number
          location_authority_confirmed: boolean
          registration_version: number
          visibility: string
          visibility_understood: boolean
        }
        Update: {
          attested_at?: string
          attested_by_account_id?: string
          boundary_version?: number
          event_id?: string
          event_version?: number
          location_authority_confirmed?: boolean
          registration_version?: number
          visibility?: string
          visibility_understood?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "event_publication_attestations_attested_by_account_id_fkey"
            columns: ["attested_by_account_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "event_publication_attestations_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: true
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_registration_settings: {
        Row: {
          allow_during_event: boolean
          closes_at: string
          created_at: string
          event_id: string
          opens_at: string
          updated_at: string
          version: number
        }
        Insert: {
          allow_during_event?: boolean
          closes_at: string
          created_at?: string
          event_id: string
          opens_at: string
          updated_at?: string
          version?: number
        }
        Update: {
          allow_during_event?: boolean
          closes_at?: string
          created_at?: string
          event_id?: string
          opens_at?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "event_registration_settings_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: true
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          created_at: string
          created_by_account_id: string | null
          description: string
          id: string
          organizer_profile_id: string
          public_notice: string | null
          state: string
          state_changed_at: string
          team_version: number
          timezone: string
          title: string
          updated_at: string
          version: number
          visibility: string
        }
        Insert: {
          created_at?: string
          created_by_account_id?: string | null
          description?: string
          id?: string
          organizer_profile_id: string
          public_notice?: string | null
          state?: string
          state_changed_at?: string
          team_version?: number
          timezone?: string
          title: string
          updated_at?: string
          version?: number
          visibility?: string
        }
        Update: {
          created_at?: string
          created_by_account_id?: string | null
          description?: string
          id?: string
          organizer_profile_id?: string
          public_notice?: string | null
          state?: string
          state_changed_at?: string
          team_version?: number
          timezone?: string
          title?: string
          updated_at?: string
          version?: number
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "events_created_by_account_id_fkey"
            columns: ["created_by_account_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "events_organizer_profile_id_fkey"
            columns: ["organizer_profile_id"]
            isOneToOne: false
            referencedRelation: "organizer_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      organizer_profile_invites: {
        Row: {
          created_at: string
          created_by_account_id: string
          expires_at: string
          id: string
          invited_email: string
          organizer_profile_id: string
        }
        Insert: {
          created_at?: string
          created_by_account_id: string
          expires_at?: string
          id?: string
          invited_email: string
          organizer_profile_id: string
        }
        Update: {
          created_at?: string
          created_by_account_id?: string
          expires_at?: string
          id?: string
          invited_email?: string
          organizer_profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organizer_profile_invites_created_by_account_id_fkey"
            columns: ["created_by_account_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "organizer_profile_invites_organizer_profile_id_fkey"
            columns: ["organizer_profile_id"]
            isOneToOne: false
            referencedRelation: "organizer_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      organizer_profile_memberships: {
        Row: {
          account_id: string
          created_at: string
          display_name: string
          id: string
          organizer_profile_id: string
          role: string
        }
        Insert: {
          account_id: string
          created_at?: string
          display_name: string
          id?: string
          organizer_profile_id: string
          role: string
        }
        Update: {
          account_id?: string
          created_at?: string
          display_name?: string
          id?: string
          organizer_profile_id?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "organizer_profile_memberships_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "organizer_profile_memberships_organizer_profile_id_fkey"
            columns: ["organizer_profile_id"]
            isOneToOne: false
            referencedRelation: "organizer_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      organizer_profiles: {
        Row: {
          created_at: string
          created_by_account_id: string | null
          detached_at: string | null
          display_name: string
          id: string
          locality: string | null
          organizer_type: string
          team_version: number
          updated_at: string
          version: number
          website: string | null
        }
        Insert: {
          created_at?: string
          created_by_account_id?: string | null
          detached_at?: string | null
          display_name: string
          id?: string
          locality?: string | null
          organizer_type: string
          team_version?: number
          updated_at?: string
          version?: number
          website?: string | null
        }
        Update: {
          created_at?: string
          created_by_account_id?: string | null
          detached_at?: string | null
          display_name?: string
          id?: string
          locality?: string | null
          organizer_type?: string
          team_version?: number
          updated_at?: string
          version?: number
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organizer_profiles_created_by_account_id_fkey"
            columns: ["created_by_account_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["account_id"]
          },
        ]
      }
      profiles: {
        Row: {
          account_id: string
          created_at: string
          display_name: string | null
          preferred_locale: string
          updated_at: string
        }
        Insert: {
          account_id: string
          created_at?: string
          display_name?: string | null
          preferred_locale?: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          created_at?: string
          display_name?: string | null
          preferred_locale?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_event_ownership_transfer_command: {
        Args: {
          p_actor_id: string
          p_correlation_id: string
          p_event_id: string
          p_expected_team_version: number
          p_transfer_id: string
        }
        Returns: Json
      }
      accept_event_team_invite_command: {
        Args: {
          p_actor_id: string
          p_correlation_id: string
          p_display_name: string
          p_invite_id: string
        }
        Returns: Json
      }
      accept_organizer_manager_invite_command: {
        Args: {
          p_actor_id: string
          p_correlation_id: string
          p_display_name: string
          p_invite_id: string
        }
        Returns: Json
      }
      account_deletion_pending: {
        Args: { p_account_id: string }
        Returns: boolean
      }
      account_recovery_notices_accepted: {
        Args: { p_claim_id: string }
        Returns: boolean
      }
      admin_get_event_command: {
        Args: {
          p_actor_id: string
          p_auth_session_id: string
          p_correlation_id: string
          p_event_id: string
        }
        Returns: Json
      }
      admin_intervene_event_command: {
        Args: {
          p_action: string
          p_actor_id: string
          p_auth_session_id: string
          p_correlation_id: string
          p_event_id: string
          p_expected_event_version: number
          p_internal_reason: string
          p_public_reason: string
        }
        Returns: Json
      }
      assert_recent_authentication_command: {
        Args: { p_authenticated_at: string }
        Returns: undefined
      }
      attest_event_publication_command: {
        Args: {
          p_actor_id: string
          p_authenticated_at: string
          p_correlation_id: string
          p_event_id: string
          p_expected_boundary_version: number
          p_expected_event_version: number
          p_expected_registration_version: number
          p_location_authority_confirmed: boolean
          p_visibility_understood: boolean
        }
        Returns: string
      }
      begin_account_recovery_dispatch_command: {
        Args: {
          p_claim_id: string
          p_correlation_id: string
          p_verification_token: string
        }
        Returns: Json
      }
      cancel_account_deletion_command: {
        Args: { p_actor_id: string; p_correlation_id: string }
        Returns: Json
      }
      cancel_account_recovery_claim_command: {
        Args: {
          p_actor_id: string
          p_authenticated_at: string
          p_claim_id: string
          p_correlation_id: string
        }
        Returns: Json
      }
      cancel_event_command: {
        Args: {
          p_actor_id: string
          p_authenticated_at: string
          p_confirmation_title: string
          p_correlation_id: string
          p_event_id: string
          p_expected_event_version: number
          p_public_reason: string
        }
        Returns: Json
      }
      cancel_event_emergency_successor_claim_command: {
        Args: {
          p_actor_id: string
          p_authenticated_at: string
          p_claim_id: string
          p_correlation_id: string
          p_event_id: string
          p_expected_team_version: number
        }
        Returns: Json
      }
      cancel_event_ownership_transfer_command: {
        Args: {
          p_actor_id: string
          p_authenticated_at: string
          p_correlation_id: string
          p_event_id: string
          p_expected_team_version: number
          p_transfer_id: string
        }
        Returns: Json
      }
      cancel_event_team_invite_command: {
        Args: {
          p_actor_id: string
          p_authenticated_at: string
          p_correlation_id: string
          p_event_id: string
          p_expected_team_version: number
          p_invite_id: string
        }
        Returns: Json
      }
      cancel_organizer_manager_invite_command: {
        Args: {
          p_actor_id: string
          p_authenticated_at: string
          p_correlation_id: string
          p_expected_team_version: number
          p_invite_id: string
          p_organizer_profile_id: string
        }
        Returns: Json
      }
      claim_security_notification_jobs: {
        Args: { p_limit?: number }
        Returns: {
          job_id: string
          lease_id: string
          recipient_account_id: string
          template_key: string
        }[]
      }
      clear_event_emergency_successor_command: {
        Args: {
          p_actor_id: string
          p_authenticated_at: string
          p_correlation_id: string
          p_event_id: string
          p_expected_team_version: number
        }
        Returns: Json
      }
      complete_event_emergency_successor_claim_command: {
        Args: {
          p_actor_id: string
          p_authenticated_at: string
          p_claim_id: string
          p_correlation_id: string
          p_event_id: string
          p_expected_team_version: number
        }
        Returns: Json
      }
      complete_recovery_verification_delivery_command: {
        Args: { p_claim_id: string }
        Returns: undefined
      }
      confirm_account_recovery_email_command: {
        Args: {
          p_claim_id: string
          p_correlation_id: string
          p_verification_token: string
        }
        Returns: Json
      }
      consume_local_recovery_budget_command: { Args: never; Returns: boolean }
      create_draft_event_command: {
        Args: {
          p_actor_id: string
          p_correlation_id: string
          p_description: string
          p_organizer_profile_id: string
          p_timezone: string
          p_title: string
          p_visibility: string
        }
        Returns: string
      }
      create_organizer_profile_command: {
        Args: {
          p_actor_id: string
          p_correlation_id: string
          p_display_name: string
          p_locality: string
          p_organizer_type: string
          p_website: string
        }
        Returns: string
      }
      create_scheduled_draft_event_command: {
        Args: {
          p_actor_id: string
          p_correlation_id: string
          p_description: string
          p_ends_at: string
          p_organizer_profile_id: string
          p_public_organizer_name: string
          p_starts_at: string
          p_timezone: string
          p_title: string
          p_visibility: string
        }
        Returns: string
      }
      decide_first_event_review_command: {
        Args: {
          p_actor_id: string
          p_auth_session_id: string
          p_correlation_id: string
          p_decision: string
          p_event_id: string
          p_expected_event_version: number
          p_reason: string
        }
        Returns: undefined
      }
      decide_organizer_verification_command: {
        Args: {
          p_actor_id: string
          p_auth_session_id: string
          p_control_confirmed: boolean
          p_correlation_id: string
          p_decision: string
          p_organizer_profile_id: string
          p_reason: string
          p_registered_name: string
          p_registry_active: boolean
        }
        Returns: undefined
      }
      delete_browser_session_command: {
        Args: { p_hash: string }
        Returns: undefined
      }
      delete_draft_event_command: {
        Args: {
          p_actor_id: string
          p_authenticated_at: string
          p_confirm_title: string
          p_correlation_id: string
          p_event_id: string
          p_expected_version: number
        }
        Returns: string
      }
      duplicate_event_command: {
        Args: {
          p_actor_id: string
          p_correlation_id: string
          p_ends_at: string
          p_organizer_profile_id: string
          p_source_event_id: string
          p_starts_at: string
          p_title: string
        }
        Returns: string
      }
      end_admin_elevation_command: {
        Args: { p_actor_id: string; p_correlation_id: string }
        Returns: Json
      }
      end_event_early_command: {
        Args: {
          p_actor_id: string
          p_correlation_id: string
          p_event_id: string
          p_expected_event_version: number
        }
        Returns: Json
      }
      enroll_account_recovery_code_command: {
        Args: {
          p_actor_id: string
          p_authenticated_at: string
          p_code: string
          p_correlation_id: string
          p_expected_version: number
        }
        Returns: Json
      }
      finish_account_recovery_dispatch_command: {
        Args: { p_correlation_id: string; p_dispatch_id: string }
        Returns: string
      }
      finish_security_notification_job: {
        Args: { p_delivered: boolean; p_job_id: string; p_lease_id: string }
        Returns: boolean
      }
      get_account_deletion_command: {
        Args: { p_actor_id: string }
        Returns: Json
      }
      get_account_security_command: {
        Args: { p_actor_id: string }
        Returns: Json
      }
      get_admin_status_command: {
        Args: { p_actor_id: string; p_auth_session_id: string }
        Returns: Json
      }
      get_event_publication_readiness_command: {
        Args: { p_actor_id: string; p_event_id: string }
        Returns: Json
      }
      get_event_team_command: {
        Args: { p_actor_id: string; p_event_id: string }
        Returns: Json
      }
      get_first_event_review_command: {
        Args: { p_actor_id: string; p_event_id: string }
        Returns: Json
      }
      get_identity_dashboard_command: {
        Args: { p_actor_id: string }
        Returns: Json
      }
      get_incoming_event_invites_command: {
        Args: { p_actor_id: string }
        Returns: Json
      }
      get_incoming_organizer_invites_command: {
        Args: { p_actor_id: string }
        Returns: Json
      }
      get_organizer_team_command: {
        Args: { p_actor_id: string; p_organizer_profile_id: string }
        Returns: Json
      }
      get_organizer_verification_command: {
        Args: { p_actor_id: string; p_organizer_profile_id: string }
        Returns: Json
      }
      initiate_account_recovery_claim_command: {
        Args: {
          p_correlation_id: string
          p_current_email: string
          p_new_email: string
          p_recovery_code: string
          p_totp_code: string
          p_verification_token: string
        }
        Returns: Json
      }
      initiate_event_emergency_successor_claim_command: {
        Args: {
          p_actor_id: string
          p_authenticated_at: string
          p_correlation_id: string
          p_event_id: string
          p_expected_team_version: number
        }
        Returns: Json
      }
      initiate_event_ownership_transfer_command: {
        Args: {
          p_actor_id: string
          p_authenticated_at: string
          p_correlation_id: string
          p_event_id: string
          p_expected_team_version: number
          p_to_membership_id: string
        }
        Returns: Json
      }
      initiate_event_ownership_transfer_v2_command: {
        Args: {
          p_actor_id: string
          p_authenticated_at: string
          p_correlation_id: string
          p_event_id: string
          p_expected_team_version: number
          p_target_organizer_profile_id: string
          p_to_membership_id: string
        }
        Returns: Json
      }
      invite_event_team_member_command: {
        Args: {
          p_actor_id: string
          p_authenticated_at: string
          p_correlation_id: string
          p_email: string
          p_event_id: string
          p_expected_team_version: number
          p_role: string
        }
        Returns: Json
      }
      invite_organizer_manager_command: {
        Args: {
          p_actor_id: string
          p_authenticated_at: string
          p_correlation_id: string
          p_email: string
          p_expected_team_version: number
          p_organizer_profile_id: string
        }
        Returns: Json
      }
      is_active_auth_session: {
        Args: { p_account_id: string; p_session_id: string }
        Returns: boolean
      }
      is_platform_admin: { Args: { p_account_id: string }; Returns: boolean }
      list_first_event_reviews_command: {
        Args: {
          p_actor_id: string
          p_auth_session_id: string
          p_correlation_id: string
        }
        Returns: Json
      }
      list_organizer_verifications_command: {
        Args: {
          p_actor_id: string
          p_auth_session_id: string
          p_correlation_id: string
        }
        Returns: Json
      }
      prepare_account_recovery_command: {
        Args: {
          p_claim_id: string
          p_correlation_id: string
          p_verification_token: string
        }
        Returns: string
      }
      publish_event_command: {
        Args: {
          p_actor_id: string
          p_authenticated_at: string
          p_correlation_id: string
          p_event_id: string
          p_expected_event_version: number
        }
        Returns: Json
      }
      purge_expired_emergency_successor_claims_command: {
        Args: never
        Returns: number
      }
      purge_expired_event_invites_command: { Args: never; Returns: number }
      purge_expired_event_ownership_transfers_command: {
        Args: never
        Returns: number
      }
      purge_expired_organizer_invites_command: { Args: never; Returns: number }
      read_account_recovery_claim_command: {
        Args: { p_claim_id: string; p_verification_token: string }
        Returns: Json
      }
      reconcile_account_recovery_dispatches_command: {
        Args: never
        Returns: number
      }
      record_account_mfa_event_command: {
        Args: { p_action: string; p_actor_id: string; p_correlation_id: string }
        Returns: undefined
      }
      release_browser_session_command: {
        Args: { p_hash: string; p_lease: string; p_payload: string }
        Returns: boolean
      }
      remove_event_team_member_command: {
        Args: {
          p_actor_id: string
          p_authenticated_at: string
          p_correlation_id: string
          p_event_id: string
          p_expected_team_version: number
          p_membership_id: string
        }
        Returns: Json
      }
      remove_organizer_manager_command: {
        Args: {
          p_actor_id: string
          p_authenticated_at: string
          p_correlation_id: string
          p_expected_team_version: number
          p_membership_id: string
          p_organizer_profile_id: string
        }
        Returns: Json
      }
      request_account_deletion_command: {
        Args: {
          p_actor_id: string
          p_authenticated_at: string
          p_confirmation_email: string
          p_correlation_id: string
        }
        Returns: Json
      }
      request_first_event_review_command: {
        Args: {
          p_actor_id: string
          p_correlation_id: string
          p_event_id: string
          p_expected_event_version: number
        }
        Returns: Json
      }
      request_organizer_verification_command: {
        Args: {
          p_actor_id: string
          p_control_method: string
          p_control_reference: string
          p_correlation_id: string
          p_organization_number: string
          p_organizer_profile_id: string
        }
        Returns: Json
      }
      resolve_security_notification_recipient: {
        Args: { p_job_id: string; p_lease_id: string }
        Returns: Json
      }
      set_event_emergency_successor_command: {
        Args: {
          p_actor_id: string
          p_authenticated_at: string
          p_correlation_id: string
          p_event_id: string
          p_expected_team_version: number
          p_successor_membership_id: string
          p_target_organizer_profile_id: string
        }
        Returns: Json
      }
      start_admin_elevation_command: {
        Args: {
          p_actor_id: string
          p_auth_session_id: string
          p_correlation_id: string
        }
        Returns: Json
      }
      store_browser_session_command: {
        Args: {
          p_account_id: string
          p_auth_session_id: string
          p_hash: string
          p_kind: string
          p_payload: string
        }
        Returns: undefined
      }
      take_browser_session_command: {
        Args: { p_hash: string; p_kind: string; p_lease: string }
        Returns: Json
      }
      update_draft_event_details_command: {
        Args: {
          p_actor_id: string
          p_correlation_id: string
          p_description: string
          p_ends_at: string
          p_event_id: string
          p_expected_version: number
          p_starts_at: string
          p_timezone: string
          p_title: string
        }
        Returns: Json
      }
      update_draft_event_visibility_command: {
        Args: {
          p_actor_id: string
          p_correlation_id: string
          p_event_id: string
          p_expected_version: number
          p_visibility: string
        }
        Returns: Json
      }
      update_event_team_member_role_command: {
        Args: {
          p_actor_id: string
          p_authenticated_at: string
          p_correlation_id: string
          p_event_id: string
          p_expected_team_version: number
          p_membership_id: string
          p_role: string
        }
        Returns: Json
      }
      update_organizer_profile_command: {
        Args: {
          p_actor_id: string
          p_correlation_id: string
          p_display_name: string
          p_expected_version: number
          p_locality: string
          p_organizer_profile_id: string
          p_website: string
        }
        Returns: Json
      }
      update_profile_command: {
        Args: {
          p_actor_id: string
          p_correlation_id: string
          p_display_name: string
          p_preferred_locale: string
        }
        Returns: Json
      }
      upsert_draft_event_boundary_command: {
        Args: {
          p_actor_id: string
          p_boundary_geojson: Json
          p_correlation_id: string
          p_display_label: string
          p_event_id: string
          p_expected_version: number
        }
        Returns: Json
      }
      upsert_draft_event_registration_command: {
        Args: {
          p_actor_id: string
          p_allow_during_event: boolean
          p_closes_at: string
          p_correlation_id: string
          p_event_id: string
          p_expected_version: number
          p_opens_at: string
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  app_private: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const

