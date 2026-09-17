// Generated from the Supabase project with `supabase gen types typescript`
// (or the Supabase MCP `generate_typescript_types`). Regenerate after every migration.
//
// One hand-applied correction survives every regeneration: the generator types every column of a
// `RETURNS TABLE` function as NOT NULL, because Postgres does not record nullability for them.
// Several are nullable in reality — a conversation with no messages yet has a null
// last_message_at, a reaction row in my_activity has a null parent_id — so those are widened to
// `| null` by hand. They are listed in CORRECTIONS in the regeneration step; re-apply them after
// running `pnpm db:types` or the app will confidently dereference a null.
//
// The same applies to RPC arguments: a parameter with a DEFAULT comes back optional but never
// nullable, while passing null is exactly how a caller says "no topic". Those are widened too.
//
// And conversation_members.member_side is NOT NULL with no default because a BEFORE INSERT
// trigger fills it (0018). The generator cannot see triggers, so it marks it required; it is
// made optional again here, because every caller but add_property_contact relies on that
// trigger.
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
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
        Row: {
          count: number;
          key_id: string;
          window_start: string;
        };
        Insert: {
          count?: number;
          key_id: string;
          window_start: string;
        };
        Update: {
          count?: number;
          key_id?: string;
          window_start?: string;
        };
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
      bookmark_templates: {
        Row: {
          active: boolean;
          applies_to: Database["public"]["Enums"]["conversation_type"][];
          created_at: string;
          emoji: string | null;
          is_mandatory: boolean;
          key: string;
          note: string | null;
          org_id: string;
          position: number;
          title: string;
          url: string;
        };
        Insert: {
          active?: boolean;
          applies_to?: Database["public"]["Enums"]["conversation_type"][];
          created_at?: string;
          emoji?: string | null;
          is_mandatory?: boolean;
          key: string;
          note?: string | null;
          org_id: string;
          position?: number;
          title: string;
          url: string;
        };
        Update: {
          active?: boolean;
          applies_to?: Database["public"]["Enums"]["conversation_type"][];
          created_at?: string;
          emoji?: string | null;
          is_mandatory?: boolean;
          key?: string;
          note?: string | null;
          org_id?: string;
          position?: number;
          title?: string;
          url?: string;
        };
        Relationships: [
          {
            foreignKeyName: "bookmark_templates_org_id_fkey";
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
          is_mandatory: boolean;
          note: string | null;
          org_id: string;
          position: number;
          template_key: string | null;
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
          is_mandatory?: boolean;
          note?: string | null;
          org_id: string;
          position?: number;
          template_key?: string | null;
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
          is_mandatory?: boolean;
          note?: string | null;
          org_id?: string;
          position?: number;
          template_key?: string | null;
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
          member_side: string;
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
          member_side?: string;
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
          member_side?: string;
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
          whatsapp_account_id: string | null;
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
          whatsapp_account_id?: string | null;
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
          whatsapp_account_id?: string | null;
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
          {
            foreignKeyName: "conversations_property_id_fkey";
            columns: ["property_id"];
            isOneToOne: false;
            referencedRelation: "properties";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "conversations_whatsapp_account_id_fkey";
            columns: ["whatsapp_account_id"];
            isOneToOne: false;
            referencedRelation: "whatsapp_accounts";
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
      inbound_messages_unmatched: {
        Row: {
          body: string | null;
          channel: string;
          created_at: string;
          external_ref: string | null;
          from_identifier: string;
          id: number;
          org_id: string | null;
          payload: Json;
          reason: string;
          resolved_at: string | null;
        };
        Insert: {
          body?: string | null;
          channel: string;
          created_at?: string;
          external_ref?: string | null;
          from_identifier: string;
          id?: never;
          org_id?: string | null;
          payload?: Json;
          reason: string;
          resolved_at?: string | null;
        };
        Update: {
          body?: string | null;
          channel?: string;
          created_at?: string;
          external_ref?: string | null;
          from_identifier?: string;
          id?: never;
          org_id?: string | null;
          payload?: Json;
          reason?: string;
          resolved_at?: string | null;
        };
        Relationships: [];
      };
      integrations: {
        Row: {
          config: Json;
          created_at: string;
          enabled: boolean;
          key: string;
          org_id: string;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          config?: Json;
          created_at?: string;
          enabled?: boolean;
          key: string;
          org_id: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          config?: Json;
          created_at?: string;
          enabled?: boolean;
          key?: string;
          org_id?: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "integrations_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organisations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "integrations_updated_by_fkey";
            columns: ["updated_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      link_previews: {
        Row: {
          description: string | null;
          fetched_at: string;
          image_url: string | null;
          ok: boolean;
          org_id: string;
          site_name: string | null;
          title: string | null;
          url: string;
        };
        Insert: {
          description?: string | null;
          fetched_at?: string;
          image_url?: string | null;
          ok?: boolean;
          org_id: string;
          site_name?: string | null;
          title?: string | null;
          url: string;
        };
        Update: {
          description?: string | null;
          fetched_at?: string;
          image_url?: string | null;
          ok?: boolean;
          org_id?: string;
          site_name?: string | null;
          title?: string | null;
          url?: string;
        };
        Relationships: [];
      };
      message_templates: {
        Row: {
          active: boolean;
          applies_to: Database["public"]["Enums"]["conversation_type"][];
          body: string;
          created_at: string;
          description: string | null;
          key: string;
          org_id: string;
          title: string;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          active?: boolean;
          applies_to?: Database["public"]["Enums"]["conversation_type"][];
          body: string;
          created_at?: string;
          description?: string | null;
          key: string;
          org_id: string;
          title: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          active?: boolean;
          applies_to?: Database["public"]["Enums"]["conversation_type"][];
          body?: string;
          created_at?: string;
          description?: string | null;
          key?: string;
          org_id?: string;
          title?: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "message_templates_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organisations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "message_templates_updated_by_fkey";
            columns: ["updated_by"];
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
          body_tsv: unknown;
          conversation_id: string;
          created_at: string;
          deleted_at: string | null;
          edited_at: string | null;
          external_ref: string | null;
          id: string;
          kind: Database["public"]["Enums"]["message_kind"];
          last_reply_at: string | null;
          meta: Json;
          org_id: string;
          parent_id: string | null;
          reply_count: number;
          sender_id: string | null;
          sent_via: string;
          visibility: Database["public"]["Enums"]["message_visibility"];
        };
        Insert: {
          body?: string;
          body_json?: Json | null;
          body_tsv?: unknown;
          conversation_id: string;
          created_at?: string;
          deleted_at?: string | null;
          edited_at?: string | null;
          external_ref?: string | null;
          id?: string;
          kind?: Database["public"]["Enums"]["message_kind"];
          last_reply_at?: string | null;
          meta?: Json;
          org_id: string;
          parent_id?: string | null;
          reply_count?: number;
          sender_id?: string | null;
          sent_via?: string;
          visibility?: Database["public"]["Enums"]["message_visibility"];
        };
        Update: {
          body?: string;
          body_json?: Json | null;
          body_tsv?: unknown;
          conversation_id?: string;
          created_at?: string;
          deleted_at?: string | null;
          edited_at?: string | null;
          external_ref?: string | null;
          id?: string;
          kind?: Database["public"]["Enums"]["message_kind"];
          last_reply_at?: string | null;
          meta?: Json;
          org_id?: string;
          parent_id?: string | null;
          reply_count?: number;
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
      monday_events: {
        Row: {
          board_id: string | null;
          created_at: string;
          error: string | null;
          event_id: string | null;
          event_type: string | null;
          id: number;
          item_id: string | null;
          org_id: string | null;
          outcome: string;
          payload: Json;
        };
        Insert: {
          board_id?: string | null;
          created_at?: string;
          error?: string | null;
          event_id?: string | null;
          event_type?: string | null;
          id?: never;
          item_id?: string | null;
          org_id?: string | null;
          outcome: string;
          payload?: Json;
        };
        Update: {
          board_id?: string | null;
          created_at?: string;
          error?: string | null;
          event_id?: string | null;
          event_type?: string | null;
          id?: never;
          item_id?: string | null;
          org_id?: string | null;
          outcome?: string;
          payload?: Json;
        };
        Relationships: [];
      };
      monday_links: {
        Row: {
          board_id: string | null;
          created_at: string;
          customer_conversation_id: string | null;
          monday_item_id: string;
          org_id: string;
          property_conversation_id: string | null;
          property_id: string | null;
        };
        Insert: {
          board_id?: string | null;
          created_at?: string;
          customer_conversation_id?: string | null;
          monday_item_id: string;
          org_id: string;
          property_conversation_id?: string | null;
          property_id?: string | null;
        };
        Update: {
          board_id?: string | null;
          created_at?: string;
          customer_conversation_id?: string | null;
          monday_item_id?: string;
          org_id?: string;
          property_conversation_id?: string | null;
          property_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "monday_links_customer_conversation_id_fkey";
            columns: ["customer_conversation_id"];
            isOneToOne: false;
            referencedRelation: "conversations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "monday_links_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organisations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "monday_links_property_conversation_id_fkey";
            columns: ["property_conversation_id"];
            isOneToOne: false;
            referencedRelation: "conversations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "monday_links_property_id_fkey";
            columns: ["property_id"];
            isOneToOne: false;
            referencedRelation: "properties";
            referencedColumns: ["id"];
          },
        ];
      };
      notification_outbox: {
        Row: {
          attempts: number;
          channel: string;
          claimed_at: string | null;
          created_at: string;
          fallback_from: string | null;
          id: number;
          kind: string;
          last_error: string | null;
          org_id: string;
          payload: Json;
          provider_message_id: string | null;
          recipient_email: string | null;
          recipient_phone: string | null;
          recipient_user_id: string | null;
          sent_at: string | null;
          status: string;
        };
        Insert: {
          attempts?: number;
          channel?: string;
          claimed_at?: string | null;
          created_at?: string;
          fallback_from?: string | null;
          id?: never;
          kind: string;
          last_error?: string | null;
          org_id: string;
          payload?: Json;
          provider_message_id?: string | null;
          recipient_email?: string | null;
          recipient_phone?: string | null;
          recipient_user_id?: string | null;
          sent_at?: string | null;
          status?: string;
        };
        Update: {
          attempts?: number;
          channel?: string;
          claimed_at?: string | null;
          created_at?: string;
          fallback_from?: string | null;
          id?: never;
          kind?: string;
          last_error?: string | null;
          org_id?: string;
          payload?: Json;
          provider_message_id?: string | null;
          recipient_email?: string | null;
          recipient_phone?: string | null;
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
      phone_verifications: {
        Row: {
          attempts: number;
          code_hash: string;
          consumed_at: string | null;
          created_at: string;
          expires_at: string;
          id: string;
          phone: string;
          user_id: string;
        };
        Insert: {
          attempts?: number;
          code_hash: string;
          consumed_at?: string | null;
          created_at?: string;
          expires_at: string;
          id?: string;
          phone: string;
          user_id: string;
        };
        Update: {
          attempts?: number;
          code_hash?: string;
          consumed_at?: string | null;
          created_at?: string;
          expires_at?: string;
          id?: string;
          phone?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "phone_verifications_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
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
          activity_seen_at: string | null;
          avatar_color: string;
          avatar_url: string | null;
          away_since: string | null;
          away_until: string | null;
          created_at: string;
          deactivated_at: string | null;
          display_name: string;
          dnd_until: string | null;
          email: string | null;
          email_notifications: string;
          full_name: string | null;
          id: string;
          last_active_at: string | null;
          monday_person_id: string | null;
          org_id: string;
          phone: string | null;
          phone_prompt_skipped_at: string | null;
          phone_verified_at: string | null;
          presence: Database["public"]["Enums"]["presence_status"];
          presence_mode: string;
          role: Database["public"]["Enums"]["user_role"];
          status_emoji: string | null;
          status_expires_at: string | null;
          status_text: string | null;
          timezone: string;
          updated_at: string;
          whatsapp_notifications: string;
        };
        Insert: {
          account_type?: Database["public"]["Enums"]["account_type"];
          activity_seen_at?: string | null;
          avatar_color?: string;
          avatar_url?: string | null;
          away_since?: string | null;
          away_until?: string | null;
          created_at?: string;
          deactivated_at?: string | null;
          display_name: string;
          dnd_until?: string | null;
          email?: string | null;
          email_notifications?: string;
          full_name?: string | null;
          id: string;
          last_active_at?: string | null;
          monday_person_id?: string | null;
          org_id: string;
          phone?: string | null;
          phone_prompt_skipped_at?: string | null;
          phone_verified_at?: string | null;
          presence?: Database["public"]["Enums"]["presence_status"];
          presence_mode?: string;
          role?: Database["public"]["Enums"]["user_role"];
          status_emoji?: string | null;
          status_expires_at?: string | null;
          status_text?: string | null;
          timezone?: string;
          updated_at?: string;
          whatsapp_notifications?: string;
        };
        Update: {
          account_type?: Database["public"]["Enums"]["account_type"];
          activity_seen_at?: string | null;
          avatar_color?: string;
          avatar_url?: string | null;
          away_since?: string | null;
          away_until?: string | null;
          created_at?: string;
          deactivated_at?: string | null;
          display_name?: string;
          dnd_until?: string | null;
          email?: string | null;
          email_notifications?: string;
          full_name?: string | null;
          id?: string;
          last_active_at?: string | null;
          monday_person_id?: string | null;
          org_id?: string;
          phone?: string | null;
          phone_prompt_skipped_at?: string | null;
          phone_verified_at?: string | null;
          presence?: Database["public"]["Enums"]["presence_status"];
          presence_mode?: string;
          role?: Database["public"]["Enums"]["user_role"];
          status_emoji?: string | null;
          status_expires_at?: string | null;
          status_text?: string | null;
          timezone?: string;
          updated_at?: string;
          whatsapp_notifications?: string;
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
      properties: {
        Row: {
          address: string;
          client_monday_item_id: string | null;
          created_at: string;
          id: string;
          monday_item_id: string | null;
          org_id: string;
        };
        Insert: {
          address: string;
          client_monday_item_id?: string | null;
          created_at?: string;
          id?: string;
          monday_item_id?: string | null;
          org_id: string;
        };
        Update: {
          address?: string;
          client_monday_item_id?: string | null;
          created_at?: string;
          id?: string;
          monday_item_id?: string | null;
          org_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "properties_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organisations";
            referencedColumns: ["id"];
          },
        ];
      };
      property_contacts: {
        Row: {
          conversation_id: string;
          created_at: string;
          created_by: string | null;
          kind: string;
          org_id: string;
          user_id: string;
        };
        Insert: {
          conversation_id: string;
          created_at?: string;
          created_by?: string | null;
          kind: string;
          org_id: string;
          user_id: string;
        };
        Update: {
          conversation_id?: string;
          created_at?: string;
          created_by?: string | null;
          kind?: string;
          org_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "property_contacts_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: false;
            referencedRelation: "conversations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "property_contacts_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "property_contacts_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organisations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "property_contacts_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      property_threads: {
        Row: {
          conversation_id: string;
          created_at: string;
          kind: string;
          org_id: string;
          root_message_id: string;
        };
        Insert: {
          conversation_id: string;
          created_at?: string;
          kind: string;
          org_id: string;
          root_message_id: string;
        };
        Update: {
          conversation_id?: string;
          created_at?: string;
          kind?: string;
          org_id?: string;
          root_message_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "property_threads_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: false;
            referencedRelation: "conversations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "property_threads_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organisations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "property_threads_root_message_id_fkey";
            columns: ["root_message_id"];
            isOneToOne: false;
            referencedRelation: "messages";
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
      saved_items: {
        Row: {
          archived_at: string | null;
          completed_at: string | null;
          id: string;
          message_id: string;
          org_id: string;
          remind_at: string | null;
          reminded_at: string | null;
          saved_at: string;
          user_id: string;
        };
        Insert: {
          archived_at?: string | null;
          completed_at?: string | null;
          id?: string;
          message_id: string;
          org_id: string;
          remind_at?: string | null;
          reminded_at?: string | null;
          saved_at?: string;
          user_id: string;
        };
        Update: {
          archived_at?: string | null;
          completed_at?: string | null;
          id?: string;
          message_id?: string;
          org_id?: string;
          remind_at?: string | null;
          reminded_at?: string | null;
          saved_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "saved_items_message_id_fkey";
            columns: ["message_id"];
            isOneToOne: false;
            referencedRelation: "messages";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "saved_items_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organisations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "saved_items_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      scheduled_messages: {
        Row: {
          body: string;
          cancelled_at: string | null;
          conversation_id: string;
          created_at: string;
          id: string;
          org_id: string;
          parent_id: string | null;
          send_at: string;
          sender_id: string;
          sent_message_id: string | null;
          visibility: Database["public"]["Enums"]["message_visibility"];
        };
        Insert: {
          body: string;
          cancelled_at?: string | null;
          conversation_id: string;
          created_at?: string;
          id?: string;
          org_id: string;
          parent_id?: string | null;
          send_at: string;
          sender_id: string;
          sent_message_id?: string | null;
          visibility?: Database["public"]["Enums"]["message_visibility"];
        };
        Update: {
          body?: string;
          cancelled_at?: string | null;
          conversation_id?: string;
          created_at?: string;
          id?: string;
          org_id?: string;
          parent_id?: string | null;
          send_at?: string;
          sender_id?: string;
          sent_message_id?: string | null;
          visibility?: Database["public"]["Enums"]["message_visibility"];
        };
        Relationships: [
          {
            foreignKeyName: "scheduled_messages_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: false;
            referencedRelation: "conversations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "scheduled_messages_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organisations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "scheduled_messages_parent_id_fkey";
            columns: ["parent_id"];
            isOneToOne: false;
            referencedRelation: "messages";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "scheduled_messages_sender_id_fkey";
            columns: ["sender_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "scheduled_messages_sent_message_id_fkey";
            columns: ["sent_message_id"];
            isOneToOne: false;
            referencedRelation: "messages";
            referencedColumns: ["id"];
          },
        ];
      };
      thread_follows: {
        Row: {
          created_at: string;
          last_read_at: string | null;
          message_id: string;
          org_id: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          last_read_at?: string | null;
          message_id: string;
          org_id: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          last_read_at?: string | null;
          message_id?: string;
          org_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "thread_follows_message_id_fkey";
            columns: ["message_id"];
            isOneToOne: false;
            referencedRelation: "messages";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "thread_follows_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organisations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "thread_follows_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      whatsapp_accounts: {
        Row: {
          account_name: string | null;
          created_at: string;
          id: string;
          is_default: boolean;
          org_id: string;
          owner_email: string | null;
          owner_user_id: string | null;
          phone: string;
          provider_account_id: string | null;
          status: string;
          updated_at: string;
        };
        Insert: {
          account_name?: string | null;
          created_at?: string;
          id?: string;
          is_default?: boolean;
          org_id: string;
          owner_email?: string | null;
          owner_user_id?: string | null;
          phone: string;
          provider_account_id?: string | null;
          status?: string;
          updated_at?: string;
        };
        Update: {
          account_name?: string | null;
          created_at?: string;
          id?: string;
          is_default?: boolean;
          org_id?: string;
          owner_email?: string | null;
          owner_user_id?: string | null;
          phone?: string;
          provider_account_id?: string | null;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "whatsapp_accounts_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organisations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "whatsapp_accounts_owner_user_id_fkey";
            columns: ["owner_user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      whatsapp_threads: {
        Row: {
          conversation_id: string;
          created_at: string;
          last_inbound_at: string | null;
          last_outbound_at: string | null;
          org_id: string;
          parent_message_id: string | null;
          phone: string;
          user_id: string;
          whatsapp_account_id: string | null;
        };
        Insert: {
          conversation_id: string;
          created_at?: string;
          last_inbound_at?: string | null;
          last_outbound_at?: string | null;
          org_id: string;
          parent_message_id?: string | null;
          phone: string;
          user_id: string;
          whatsapp_account_id?: string | null;
        };
        Update: {
          conversation_id?: string;
          created_at?: string;
          last_inbound_at?: string | null;
          last_outbound_at?: string | null;
          org_id?: string;
          parent_message_id?: string | null;
          phone?: string;
          user_id?: string;
          whatsapp_account_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "whatsapp_threads_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: false;
            referencedRelation: "conversations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "whatsapp_threads_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organisations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "whatsapp_threads_parent_message_id_fkey";
            columns: ["parent_message_id"];
            isOneToOne: false;
            referencedRelation: "messages";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "whatsapp_threads_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "whatsapp_threads_whatsapp_account_id_fkey";
            columns: ["whatsapp_account_id"];
            isOneToOne: false;
            referencedRelation: "whatsapp_accounts";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      add_bookmark: {
        Args: {
          p_conversation_id: string;
          p_emoji?: string | null;
          p_note?: string | null;
          p_title: string;
          p_url: string;
        };
        Returns: {
          conversation_id: string;
          created_at: string;
          created_by: string | null;
          emoji: string | null;
          id: string;
          is_mandatory: boolean;
          note: string | null;
          org_id: string;
          position: number;
          template_key: string | null;
          title: string;
          updated_at: string;
          url: string;
        };
        SetofOptions: {
          from: "*";
          to: "conversation_bookmarks";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      add_members: {
        Args: { p_conversation_id: string; p_user_ids: string[] };
        Returns: undefined;
      };
      add_property_contact: {
        Args: { p_conversation_id: string; p_kind: string; p_user_id: string };
        Returns: undefined;
      };
      api_rate_hit: {
        Args: { p_key_id: string; p_limit: number; p_window_seconds: number };
        Returns: boolean;
      };
      apply_bookmark_templates: {
        Args: { p_conversation_id: string };
        Returns: number;
      };
      archive_channel: {
        Args: { p_archived?: boolean; p_conversation_id: string };
        Returns: undefined;
      };
      auth_org_id: { Args: never; Returns: string };
      channel_system_message: {
        Args: { body: string; cid: string; event: string; extra?: Json };
        Returns: undefined;
      };
      confirm_phone_verification: {
        Args: { p_code: string; p_phone: string };
        Returns: undefined;
      };
      create_channel: {
        Args: {
          p_member_ids?: string[];
          p_name: string;
          p_topic?: string | null;
          p_type: Database["public"]["Enums"]["conversation_type"];
        };
        Returns: string;
      };
      create_customer_account: {
        Args: {
          p_conversation_ids?: string[];
          p_display_name: string;
          p_email: string;
          p_full_name: string;
          p_password: string;
          p_role?: Database["public"]["Enums"]["user_role"];
        };
        Returns: string;
      };
      create_group_dm: { Args: { p_member_ids: string[] }; Returns: string };
      create_property_group: {
        Args: {
          p_member_ids?: string[];
          p_name: string;
          p_property_id?: string | null;
          p_topic?: string | null;
        };
        Returns: string;
      };
      create_team_account: {
        Args: {
          p_display_name: string;
          p_email: string;
          p_full_name: string;
          p_password: string;
          p_role?: Database["public"]["Enums"]["user_role"];
        };
        Returns: string;
      };
      default_bookmark_templates: {
        Args: never;
        Returns: {
          applies_to: Database["public"]["Enums"]["conversation_type"][];
          emoji: string;
          key: string;
          pos: number;
          title: string;
          url: string;
        }[];
      };
      default_message_templates: {
        Args: never;
        Returns: {
          applies_to: Database["public"]["Enums"]["conversation_type"][];
          body: string;
          description: string | null;
          key: string;
          title: string;
        }[];
      };
      dm_between: { Args: { other: string }; Returns: string };
      ensure_maintenance_channel: { Args: { p_org: string }; Returns: string };
      file_message_to_property: {
        Args: {
          p_conversation_id: string;
          p_kind: string;
          p_message_id: string;
        };
        Returns: string;
      };
      is_admin: { Args: never; Returns: boolean };
      is_member: { Args: { cid: string }; Returns: boolean };
      is_team: { Args: never; Returns: boolean };
      mark_outbox: {
        Args: {
          p_error?: string | null;
          p_id: number;
          p_provider_message_id?: string | null;
          p_status: string;
        };
        Returns: undefined;
      };
      mark_read: { Args: { cid: string }; Returns: undefined };
      mark_thread_read: { Args: { p_message_id: string }; Returns: undefined };
      move_bookmark: {
        Args: { p_delta: number; p_id: string };
        Returns: undefined;
      };
      move_message: {
        Args: { p_message_id: string; p_parent_id?: string };
        Returns: undefined;
      };
      my_activity: {
        Args: { max_rows?: number; since?: string };
        Returns: {
          body: string;
          conversation_id: string;
          created_at: string;
          emoji: string | null;
          kind: string;
          message_id: string;
          parent_id: string | null;
          sender_id: string | null;
          unread: boolean;
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
          mention_count: number;
          muted: boolean;
          name: string | null;
          notify_level: string;
          owner_user_id: string | null;
          slug: string | null;
          starred: boolean;
          topic: string | null;
          type: Database["public"]["Enums"]["conversation_type"];
          unread_count: number;
        }[];
      };
      my_threads: {
        Args: { max_rows?: number };
        Returns: {
          body: string;
          conversation_id: string;
          created_at: string;
          last_read_at: string | null;
          last_reply_at: string | null;
          message_id: string;
          participant_ids: string[] | null;
          reply_count: number;
          sender_id: string | null;
          unread_count: number;
        }[];
      };
      next_available_slug: {
        Args: { p_base: string; p_org: string };
        Returns: string;
      };
      queue_welcome_email: {
        Args: { p_payload: Json; p_user_id: string };
        Returns: number;
      };
      remove_member: {
        Args: { p_conversation_id: string; p_user_id: string };
        Returns: undefined;
      };
      remove_property_contact: {
        Args: { p_conversation_id: string; p_kind: string; p_user_id: string };
        Returns: undefined;
      };
      rename_channel: {
        Args: { p_conversation_id: string; p_name: string };
        Returns: undefined;
      };
      render_message_template: {
        Args: { p_key: string; p_org: string; p_vars?: Json };
        Returns: string;
      };
      reset_customer_password: {
        Args: { p_password: string; p_user_id: string };
        Returns: undefined;
      };
      search_messages: {
        Args: { max_rows?: number; q: string };
        Returns: {
          body: string;
          conversation_id: string;
          conversation_name: string | null;
          conversation_type: Database["public"]["Enums"]["conversation_type"];
          created_at: string;
          message_id: string;
          rank: number;
          sender_id: string | null;
          sender_name: string | null;
          visibility: Database["public"]["Enums"]["message_visibility"];
        }[];
      };
      set_channel_details: {
        Args: {
          p_conversation_id: string;
          p_description: string | null;
          p_topic: string | null;
        };
        Returns: undefined;
      };
      set_conversation_whatsapp_account: {
        Args: { p_account_id: string; p_conversation_id: string };
        Returns: undefined;
      };
      set_customer_phone: {
        Args: { p_phone: string; p_user_id: string };
        Returns: undefined;
      };
      set_member_side: {
        Args: { p_conversation_id: string; p_side: string; p_user_id: string };
        Returns: undefined;
      };
      shares_conversation_with: { Args: { other: string }; Returns: boolean };
      start_phone_verification: { Args: { p_phone: string }; Returns: string };
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

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    keyof (DefaultSchema["Tables"] & DefaultSchema["Views"]) | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      account_type: ["customer", "team"],
      conversation_type: ["owner", "internal", "dm", "group_dm", "job"],
      message_kind: ["text", "system", "document", "approval", "call_summary", "broadcast"],
      message_visibility: ["public", "internal"],
      presence_status: ["online", "away", "offline"],
      user_role: ["owner", "delegate", "contractor", "cleaner", "staff", "admin"],
    },
  },
} as const;

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
