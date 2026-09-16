// Generated from the Supabase project with `supabase gen types typescript`
// (or the Supabase MCP `generate_typescript_types`). Regenerate after every migration.
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      api_keys: {
        Row: {
          created_at: string;
          created_by: string | null;
          expires_at: string | null;
          id: string;
          key_hash: string;
          key_prefix: string;
          last_used_at: string | null;
          name: string;
          org_id: string;
          revoked_at: string | null;
          scopes: string[];
          user_id: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          expires_at?: string | null;
          id?: string;
          key_hash: string;
          key_prefix: string;
          last_used_at?: string | null;
          name: string;
          org_id: string;
          revoked_at?: string | null;
          scopes?: string[];
          user_id: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          expires_at?: string | null;
          id?: string;
          key_hash?: string;
          key_prefix?: string;
          last_used_at?: string | null;
          name?: string;
          org_id?: string;
          revoked_at?: string | null;
          scopes?: string[];
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "api_keys_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "api_keys_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organisations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "api_keys_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      api_rate_limits: {
        Row: { count: number; key_id: string; window_start: string };
        Insert: { count?: number; key_id: string; window_start: string };
        Update: { count?: number; key_id?: string; window_start?: string };
        Relationships: [
          {
            foreignKeyName: "api_rate_limits_key_id_fkey";
            columns: ["key_id"];
            isOneToOne: false;
            referencedRelation: "api_keys";
            referencedColumns: ["id"];
          },
        ];
      };
      attachments: {
        Row: {
          category: string | null;
          conversation_id: string;
          created_at: string;
          file_name: string;
          id: string;
          message_id: string;
          meta: Json;
          mime: string;
          org_id: string;
          size_bytes: number;
          storage_path: string;
        };
        Insert: {
          category?: string | null;
          conversation_id: string;
          created_at?: string;
          file_name: string;
          id?: string;
          message_id: string;
          meta?: Json;
          mime: string;
          org_id: string;
          size_bytes?: number;
          storage_path: string;
        };
        Update: {
          category?: string | null;
          conversation_id?: string;
          created_at?: string;
          file_name?: string;
          id?: string;
          message_id?: string;
          meta?: Json;
          mime?: string;
          org_id?: string;
          size_bytes?: number;
          storage_path?: string;
        };
        Relationships: [
          {
            foreignKeyName: "attachments_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: false;
            referencedRelation: "conversations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "attachments_message_id_fkey";
            columns: ["message_id"];
            isOneToOne: false;
            referencedRelation: "messages";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "attachments_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organisations";
            referencedColumns: ["id"];
          },
        ];
      };
      audit_log: {
        Row: {
          action: string;
          actor_id: string | null;
          actor_type: string;
          at: string;
          diff: Json | null;
          entity: string;
          entity_id: string | null;
          id: number;
          org_id: string;
        };
        Insert: {
          action: string;
          actor_id?: string | null;
          actor_type?: string;
          at?: string;
          diff?: Json | null;
          entity: string;
          entity_id?: string | null;
          id?: never;
          org_id: string;
        };
        Update: {
          action?: string;
          actor_id?: string | null;
          actor_type?: string;
          at?: string;
          diff?: Json | null;
          entity?: string;
          entity_id?: string | null;
          id?: never;
          org_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "audit_log_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organisations";
            referencedColumns: ["id"];
          },
        ];
      };
      conversation_bookmarks: {
        Row: {
          conversation_id: string;
          created_at: string;
          created_by: string | null;
          emoji: string | null;
          id: string;
          note: string | null;
          org_id: string;
          position: number;
          title: string;
          updated_at: string;
          url: string;
        };
        Insert: {
          conversation_id: string;
          created_at?: string;
          created_by?: string | null;
          emoji?: string | null;
          id?: string;
          note?: string | null;
          org_id: string;
          position?: number;
          title: string;
          updated_at?: string;
          url: string;
        };
        Update: {
          conversation_id?: string;
          created_at?: string;
          created_by?: string | null;
          emoji?: string | null;
          id?: string;
          note?: string | null;
          org_id?: string;
          position?: number;
          title?: string;
          updated_at?: string;
          url?: string;
        };
        Relationships: [
          {
            foreignKeyName: "conversation_bookmarks_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: false;
            referencedRelation: "conversations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "conversation_bookmarks_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "conversation_bookmarks_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organisations";
            referencedColumns: ["id"];
          },
        ];
      };
      conversation_members: {
        Row: {
          conversation_id: string;
          joined_at: string;
          last_read_at: string | null;
          muted: boolean;
          notify_level: string;
          org_id: string;
          starred: boolean;
          user_id: string;
        };
        Insert: {
          conversation_id: string;
          joined_at?: string;
          last_read_at?: string | null;
          muted?: boolean;
          notify_level?: string;
          org_id: string;
          starred?: boolean;
          user_id: string;
        };
        Update: {
          conversation_id?: string;
          joined_at?: string;
          last_read_at?: string | null;
          muted?: boolean;
          notify_level?: string;
          org_id?: string;
          starred?: boolean;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "conversation_members_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: false;
            referencedRelation: "conversations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "conversation_members_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organisations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "conversation_members_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      conversations: {
        Row: {
          archived_at: string | null;
          assignee_id: string | null;
          created_at: string;
          created_by: string | null;
          description: string | null;
          id: string;
          is_private: boolean;
          last_message_at: string | null;
          name: string | null;
          org_id: string;
          owner_user_id: string | null;
          property_id: string | null;
          slug: string | null;
          topic: string | null;
          type: Database["public"]["Enums"]["conversation_type"];
        };
        Insert: {
          archived_at?: string | null;
          assignee_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          id?: string;
          is_private?: boolean;
          last_message_at?: string | null;
          name?: string | null;
          org_id: string;
          owner_user_id?: string | null;
          property_id?: string | null;
          slug?: string | null;
          topic?: string | null;
          type: Database["public"]["Enums"]["conversation_type"];
        };
        Update: {
          archived_at?: string | null;
          assignee_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          id?: string;
          is_private?: boolean;
          last_message_at?: string | null;
          name?: string | null;
          org_id?: string;
          owner_user_id?: string | null;
          property_id?: string | null;
          slug?: string | null;
          topic?: string | null;
          type?: Database["public"]["Enums"]["conversation_type"];
        };
        Relationships: [
          {
            foreignKeyName: "conversations_assignee_id_fkey";
            columns: ["assignee_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "conversations_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "conversations_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organisations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "conversations_owner_user_id_fkey";
            columns: ["owner_user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      email_reply_threads: {
        Row: {
          conversation_id: string;
          created_at: string;
          last_used_at: string | null;
          org_id: string;
          token: string;
          user_id: string;
        };
        Insert: {
          conversation_id: string;
          created_at?: string;
          last_used_at?: string | null;
          org_id: string;
          token: string;
          user_id: string;
        };
        Update: {
          conversation_id?: string;
          created_at?: string;
          last_used_at?: string | null;
          org_id?: string;
          token?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "email_reply_threads_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: false;
            referencedRelation: "conversations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "email_reply_threads_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organisations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "email_reply_threads_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      messages: {
        Row: {
          body: string;
          body_json: Json | null;
          body_tsv: unknown | null;
          conversation_id: string;
          created_at: string;
          deleted_at: string | null;
          edited_at: string | null;
          external_ref: string | null;
          id: string;
          kind: Database["public"]["Enums"]["message_kind"];
          meta: Json;
          org_id: string;
          parent_id: string | null;
          reply_count: number;
          last_reply_at: string | null;
          sender_id: string | null;
          sent_via: string;
          visibility: Database["public"]["Enums"]["message_visibility"];
        };
        Insert: {
          body?: string;
          body_json?: Json | null;
          conversation_id: string;
          created_at?: string;
          deleted_at?: string | null;
          edited_at?: string | null;
          external_ref?: string | null;
          id?: string;
          kind?: Database["public"]["Enums"]["message_kind"];
          meta?: Json;
          org_id: string;
          parent_id?: string | null;
          reply_count?: number;
          last_reply_at?: string | null;
          sender_id?: string | null;
          sent_via?: string;
          visibility?: Database["public"]["Enums"]["message_visibility"];
        };
        Update: {
          body?: string;
          body_json?: Json | null;
          conversation_id?: string;
          created_at?: string;
          deleted_at?: string | null;
          edited_at?: string | null;
          external_ref?: string | null;
          id?: string;
          kind?: Database["public"]["Enums"]["message_kind"];
          meta?: Json;
          org_id?: string;
          parent_id?: string | null;
          reply_count?: number;
          last_reply_at?: string | null;
          sender_id?: string | null;
          sent_via?: string;
          visibility?: Database["public"]["Enums"]["message_visibility"];
        };
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: false;
            referencedRelation: "conversations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "messages_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organisations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "messages_parent_id_fkey";
            columns: ["parent_id"];
            isOneToOne: false;
            referencedRelation: "messages";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "messages_sender_id_fkey";
            columns: ["sender_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      notification_outbox: {
        Row: {
          attempts: number;
          created_at: string;
          id: number;
          kind: string;
          last_error: string | null;
          org_id: string;
          payload: Json;
          provider_message_id: string | null;
          recipient_email: string;
          recipient_user_id: string | null;
          sent_at: string | null;
          status: string;
        };
        Insert: {
          attempts?: number;
          created_at?: string;
          id?: never;
          kind: string;
          last_error?: string | null;
          org_id: string;
          payload?: Json;
          provider_message_id?: string | null;
          recipient_email: string;
          recipient_user_id?: string | null;
          sent_at?: string | null;
          status?: string;
        };
        Update: {
          attempts?: number;
          created_at?: string;
          id?: never;
          kind?: string;
          last_error?: string | null;
          org_id?: string;
          payload?: Json;
          provider_message_id?: string | null;
          recipient_email?: string;
          recipient_user_id?: string | null;
          sent_at?: string | null;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "notification_outbox_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organisations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notification_outbox_recipient_user_id_fkey";
            columns: ["recipient_user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      organisations: {
        Row: {
          created_at: string;
          id: string;
          name: string;
          settings: Json;
          slug: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          name: string;
          settings?: Json;
          slug: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          name?: string;
          settings?: Json;
          slug?: string;
        };
        Relationships: [];
      };
      pins: {
        Row: {
          conversation_id: string;
          message_id: string;
          org_id: string;
          pinned_at: string;
          pinned_by: string | null;
        };
        Insert: {
          conversation_id: string;
          message_id: string;
          org_id: string;
          pinned_at?: string;
          pinned_by?: string | null;
        };
        Update: {
          conversation_id?: string;
          message_id?: string;
          org_id?: string;
          pinned_at?: string;
          pinned_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "pins_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: false;
            referencedRelation: "conversations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "pins_message_id_fkey";
            columns: ["message_id"];
            isOneToOne: false;
            referencedRelation: "messages";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "pins_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organisations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "pins_pinned_by_fkey";
            columns: ["pinned_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          account_type: Database["public"]["Enums"]["account_type"];
          avatar_color: string;
          avatar_url: string | null;
          created_at: string;
          deactivated_at: string | null;
          display_name: string;
          email: string | null;
          email_notifications: string;
          full_name: string | null;
          id: string;
          last_active_at: string | null;
          monday_person_id: string | null;
          org_id: string;
          presence: Database["public"]["Enums"]["presence_status"];
          role: Database["public"]["Enums"]["user_role"];
          status_text: string | null;
          status_emoji: string | null;
          status_expires_at: string | null;
          dnd_until: string | null;
          presence_mode: string;
          away_since: string | null;
          away_until: string | null;
          activity_seen_at: string | null;
          timezone: string;
          updated_at: string;
        };
        Insert: {
          account_type?: Database["public"]["Enums"]["account_type"];
          avatar_color?: string;
          avatar_url?: string | null;
          created_at?: string;
          deactivated_at?: string | null;
          display_name: string;
          email?: string | null;
          email_notifications?: string;
          full_name?: string | null;
          id: string;
          last_active_at?: string | null;
          monday_person_id?: string | null;
          org_id: string;
          presence?: Database["public"]["Enums"]["presence_status"];
          role?: Database["public"]["Enums"]["user_role"];
          status_text?: string | null;
          status_emoji?: string | null;
          status_expires_at?: string | null;
          dnd_until?: string | null;
          presence_mode?: string;
          away_since?: string | null;
          away_until?: string | null;
          activity_seen_at?: string | null;
          timezone?: string;
          updated_at?: string;
        };
        Update: {
          account_type?: Database["public"]["Enums"]["account_type"];
          avatar_color?: string;
          avatar_url?: string | null;
          created_at?: string;
          deactivated_at?: string | null;
          display_name?: string;
          email?: string | null;
          email_notifications?: string;
          full_name?: string | null;
          id?: string;
          last_active_at?: string | null;
          monday_person_id?: string | null;
          org_id?: string;
          presence?: Database["public"]["Enums"]["presence_status"];
          role?: Database["public"]["Enums"]["user_role"];
          status_text?: string | null;
          status_emoji?: string | null;
          status_expires_at?: string | null;
          dnd_until?: string | null;
          presence_mode?: string;
          away_since?: string | null;
          away_until?: string | null;
          activity_seen_at?: string | null;
          timezone?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "profiles_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organisations";
            referencedColumns: ["id"];
          },
        ];
      };
      reactions: {
        Row: {
          created_at: string;
          emoji: string;
          message_id: string;
          org_id: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          emoji: string;
          message_id: string;
          org_id: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          emoji?: string;
          message_id?: string;
          org_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "reactions_message_id_fkey";
            columns: ["message_id"];
            isOneToOne: false;
            referencedRelation: "messages";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "reactions_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organisations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "reactions_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      thread_follows: {
        Row: { message_id: string; user_id: string; org_id: string; last_read_at: string | null; created_at: string };
        Insert: {
          message_id: string;
          user_id: string;
          org_id: string;
          last_read_at?: string | null;
          created_at?: string;
        };
        Update: {
          message_id?: string;
          user_id?: string;
          org_id?: string;
          last_read_at?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "thread_follows_message_id_fkey";
            columns: ["message_id"];
            isOneToOne: false;
            referencedRelation: "messages";
            referencedColumns: ["id"];
          },
        ];
      };
      saved_items: {
        Row: {
          id: string;
          org_id: string;
          user_id: string;
          message_id: string;
          saved_at: string;
          remind_at: string | null;
          reminded_at: string | null;
          completed_at: string | null;
          archived_at: string | null;
        };
        Insert: {
          id?: string;
          org_id: string;
          user_id: string;
          message_id: string;
          saved_at?: string;
          remind_at?: string | null;
          reminded_at?: string | null;
          completed_at?: string | null;
          archived_at?: string | null;
        };
        Update: {
          id?: string;
          org_id?: string;
          user_id?: string;
          message_id?: string;
          saved_at?: string;
          remind_at?: string | null;
          reminded_at?: string | null;
          completed_at?: string | null;
          archived_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "saved_items_message_id_fkey";
            columns: ["message_id"];
            isOneToOne: false;
            referencedRelation: "messages";
            referencedColumns: ["id"];
          },
        ];
      };
      scheduled_messages: {
        Row: {
          id: string;
          org_id: string;
          conversation_id: string;
          sender_id: string;
          parent_id: string | null;
          body: string;
          visibility: Database["public"]["Enums"]["message_visibility"];
          send_at: string;
          sent_message_id: string | null;
          cancelled_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          conversation_id: string;
          sender_id: string;
          parent_id?: string | null;
          body: string;
          visibility?: Database["public"]["Enums"]["message_visibility"];
          send_at: string;
          sent_message_id?: string | null;
          cancelled_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          conversation_id?: string;
          sender_id?: string;
          parent_id?: string | null;
          body?: string;
          visibility?: Database["public"]["Enums"]["message_visibility"];
          send_at?: string;
          sent_message_id?: string | null;
          cancelled_at?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "scheduled_messages_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: false;
            referencedRelation: "conversations";
            referencedColumns: ["id"];
          },
        ];
      };
      link_previews: {
        Row: {
          url: string;
          title: string | null;
          description: string | null;
          image_url: string | null;
          site_name: string | null;
          fetched_at: string;
          ok: boolean;
        };
        Insert: {
          url: string;
          title?: string | null;
          description?: string | null;
          image_url?: string | null;
          site_name?: string | null;
          fetched_at?: string;
          ok?: boolean;
        };
        Update: {
          url?: string;
          title?: string | null;
          description?: string | null;
          image_url?: string | null;
          site_name?: string | null;
          fetched_at?: string;
          ok?: boolean;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      auth_org_id: { Args: never; Returns: string };
      add_members: { Args: { p_conversation_id: string; p_user_ids: string[] }; Returns: undefined };
      archive_channel: { Args: { p_conversation_id: string; p_archived?: boolean }; Returns: undefined };
      add_bookmark: {
        Args: {
          p_conversation_id: string;
          p_title: string;
          p_url: string;
          p_emoji?: string | null;
          p_note?: string | null;
        };
        Returns: Database["public"]["Tables"]["conversation_bookmarks"]["Row"];
      };
      move_bookmark: { Args: { p_id: string; p_delta: number }; Returns: undefined };
      api_rate_hit: {
        Args: { p_key_id: string; p_limit: number; p_window_seconds: number };
        Returns: boolean;
      };
      remove_member: { Args: { p_conversation_id: string; p_user_id: string }; Returns: undefined };
      rename_channel: { Args: { p_conversation_id: string; p_name: string }; Returns: undefined };
      set_channel_details: {
        Args: { p_conversation_id: string; p_topic: string | null; p_description: string | null };
        Returns: undefined;
      };
      mark_thread_read: { Args: { p_message_id: string }; Returns: undefined };
      my_threads: {
        Args: { max_rows?: number };
        Returns: {
          message_id: string;
          conversation_id: string;
          sender_id: string | null;
          body: string;
          created_at: string;
          reply_count: number;
          last_reply_at: string | null;
          last_read_at: string | null;
          unread_count: number;
          participant_ids: string[] | null;
        }[];
      };
      create_team_account: {
        Args: {
          p_email: string;
          p_full_name: string;
          p_display_name: string;
          p_password: string;
          p_role?: Database["public"]["Enums"]["user_role"];
        };
        Returns: string;
      };
      create_channel: {
        Args: {
          p_name: string;
          p_type: Database["public"]["Enums"]["conversation_type"];
          p_member_ids?: string[];
          p_topic?: string | null;
        };
        Returns: string;
      };
      create_group_dm: { Args: { p_member_ids: string[] }; Returns: string };
      search_messages: {
        Args: { q: string; max_rows?: number };
        Returns: {
          message_id: string;
          conversation_id: string;
          conversation_type: Database["public"]["Enums"]["conversation_type"];
          conversation_name: string | null;
          sender_id: string | null;
          sender_name: string | null;
          body: string;
          visibility: Database["public"]["Enums"]["message_visibility"];
          created_at: string;
          rank: number;
        }[];
      };
      create_customer_account: {
        Args: {
          p_email: string;
          p_full_name: string;
          p_display_name: string;
          p_password: string;
          p_conversation_ids?: string[];
          p_role?: Database["public"]["Enums"]["user_role"];
        };
        Returns: string;
      };
      dm_between: { Args: { other: string }; Returns: string };
      mark_outbox: {
        Args: { p_id: number; p_status: string; p_provider_message_id?: string | null; p_error?: string | null };
        Returns: undefined;
      };
      queue_welcome_email: { Args: { p_user_id: string; p_payload: Json }; Returns: number };
      reset_customer_password: { Args: { p_user_id: string; p_password: string }; Returns: undefined };
      is_admin: { Args: never; Returns: boolean };
      is_member: { Args: { cid: string }; Returns: boolean };
      is_team: { Args: never; Returns: boolean };
      mark_read: { Args: { cid: string }; Returns: undefined };
      my_activity: {
        Args: { max_rows?: number; since?: string };
        Returns: {
          body: string;
          conversation_id: string;
          created_at: string;
          kind: string;
          message_id: string;
          sender_id: string | null;
          unread: boolean;
          parent_id: string | null;
          emoji: string | null;
        }[];
      };
      my_conversations: {
        Args: never;
        Returns: {
          archived_at: string | null;
          created_at: string;
          description: string | null;
          id: string;
          is_private: boolean;
          last_message_at: string | null;
          last_message_body: string | null;
          last_message_kind: Database["public"]["Enums"]["message_kind"] | null;
          last_message_sender_id: string | null;
          last_read_at: string | null;
          member_count: number;
          member_ids: string[];
          muted: boolean;
          notify_level: string;
          mention_count: number;
          name: string | null;
          owner_user_id: string | null;
          slug: string | null;
          starred: boolean;
          topic: string | null;
          type: Database["public"]["Enums"]["conversation_type"];
          unread_count: number;
        }[];
      };
      shares_conversation_with: { Args: { other: string }; Returns: boolean };
      storage_path_conversation_id: { Args: { name: string }; Returns: string };
      topic_conversation_id: { Args: { topic: string }; Returns: string };
    };
    Enums: {
      account_type: "customer" | "team";
      conversation_type: "owner" | "internal" | "dm" | "group_dm" | "job";
      message_kind: "text" | "system" | "document" | "approval" | "call_summary" | "broadcast";
      message_visibility: "public" | "internal";
      presence_status: "online" | "away" | "offline";
      user_role: "owner" | "delegate" | "contractor" | "cleaner" | "staff" | "admin";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

export type Tables<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Row"];
export type Enums<T extends keyof Database["public"]["Enums"]> = Database["public"]["Enums"][T];
export type Profile = Tables<"profiles">;
export type Conversation = Tables<"conversations">;
export type Message = Tables<"messages">;
export type Pin = Tables<"pins">;
export type Attachment = Tables<"attachments">;
export type Reaction = Tables<"reactions">;
export type SavedItem = Tables<"saved_items">;
export type ConversationBookmark = Tables<"conversation_bookmarks">;
export type ApiKey = Tables<"api_keys">;
export type ScheduledMessage = Tables<"scheduled_messages">;
export type LinkPreview = Tables<"link_previews">;
export type ThreadSummary = Database["public"]["Functions"]["my_threads"]["Returns"][number];
export type SearchHit = Database["public"]["Functions"]["search_messages"]["Returns"][number];
export type NotificationOutbox = Tables<"notification_outbox">;
export type ConversationSummary = Database["public"]["Functions"]["my_conversations"]["Returns"][number];
export type ActivityItem = Database["public"]["Functions"]["my_activity"]["Returns"][number];
