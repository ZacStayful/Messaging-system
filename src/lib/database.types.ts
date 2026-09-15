// Generated from the Supabase project with `supabase gen types typescript`
// (or the Supabase MCP `generate_typescript_types`). Regenerate after every migration.
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      attachments: {
        Row: {
          category: string | null
          conversation_id: string
          created_at: string
          file_name: string
          id: string
          message_id: string
          mime: string
          org_id: string
          size_bytes: number
          storage_path: string
        }
        Insert: {
          category?: string | null
          conversation_id: string
          created_at?: string
          file_name: string
          id?: string
          message_id: string
          mime: string
          org_id: string
          size_bytes?: number
          storage_path: string
        }
        Update: {
          category?: string | null
          conversation_id?: string
          created_at?: string
          file_name?: string
          id?: string
          message_id?: string
          mime?: string
          org_id?: string
          size_bytes?: number
          storage_path?: string
        }
        Relationships: [
          { foreignKeyName: "attachments_conversation_id_fkey"; columns: ["conversation_id"]; isOneToOne: false; referencedRelation: "conversations"; referencedColumns: ["id"] },
          { foreignKeyName: "attachments_message_id_fkey"; columns: ["message_id"]; isOneToOne: false; referencedRelation: "messages"; referencedColumns: ["id"] },
          { foreignKeyName: "attachments_org_id_fkey"; columns: ["org_id"]; isOneToOne: false; referencedRelation: "organisations"; referencedColumns: ["id"] },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          actor_type: string
          at: string
          diff: Json | null
          entity: string
          entity_id: string | null
          id: number
          org_id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_type?: string
          at?: string
          diff?: Json | null
          entity: string
          entity_id?: string | null
          id?: never
          org_id: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_type?: string
          at?: string
          diff?: Json | null
          entity?: string
          entity_id?: string | null
          id?: never
          org_id?: string
        }
        Relationships: [
          { foreignKeyName: "audit_log_org_id_fkey"; columns: ["org_id"]; isOneToOne: false; referencedRelation: "organisations"; referencedColumns: ["id"] },
        ]
      }
      conversation_members: {
        Row: {
          conversation_id: string
          joined_at: string
          last_read_at: string | null
          muted: boolean
          notify_level: string
          org_id: string
          starred: boolean
          user_id: string
        }
        Insert: {
          conversation_id: string
          joined_at?: string
          last_read_at?: string | null
          muted?: boolean
          notify_level?: string
          org_id: string
          starred?: boolean
          user_id: string
        }
        Update: {
          conversation_id?: string
          joined_at?: string
          last_read_at?: string | null
          muted?: boolean
          notify_level?: string
          org_id?: string
          starred?: boolean
          user_id?: string
        }
        Relationships: [
          { foreignKeyName: "conversation_members_conversation_id_fkey"; columns: ["conversation_id"]; isOneToOne: false; referencedRelation: "conversations"; referencedColumns: ["id"] },
          { foreignKeyName: "conversation_members_org_id_fkey"; columns: ["org_id"]; isOneToOne: false; referencedRelation: "organisations"; referencedColumns: ["id"] },
          { foreignKeyName: "conversation_members_user_id_fkey"; columns: ["user_id"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"] },
        ]
      }
      conversations: {
        Row: {
          archived_at: string | null
          assignee_id: string | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_private: boolean
          last_message_at: string | null
          name: string | null
          org_id: string
          owner_user_id: string | null
          property_id: string | null
          slug: string | null
          topic: string | null
          type: Database["public"]["Enums"]["conversation_type"]
        }
        Insert: {
          archived_at?: string | null
          assignee_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_private?: boolean
          last_message_at?: string | null
          name?: string | null
          org_id: string
          owner_user_id?: string | null
          property_id?: string | null
          slug?: string | null
          topic?: string | null
          type: Database["public"]["Enums"]["conversation_type"]
        }
        Update: {
          archived_at?: string | null
          assignee_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_private?: boolean
          last_message_at?: string | null
          name?: string | null
          org_id?: string
          owner_user_id?: string | null
          property_id?: string | null
          slug?: string | null
          topic?: string | null
          type?: Database["public"]["Enums"]["conversation_type"]
        }
        Relationships: [
          { foreignKeyName: "conversations_assignee_id_fkey"; columns: ["assignee_id"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"] },
          { foreignKeyName: "conversations_created_by_fkey"; columns: ["created_by"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"] },
          { foreignKeyName: "conversations_org_id_fkey"; columns: ["org_id"]; isOneToOne: false; referencedRelation: "organisations"; referencedColumns: ["id"] },
          { foreignKeyName: "conversations_owner_user_id_fkey"; columns: ["owner_user_id"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"] },
        ]
      }
      messages: {
        Row: {
          body: string
          body_json: Json | null
          conversation_id: string
          created_at: string
          deleted_at: string | null
          edited_at: string | null
          external_ref: string | null
          id: string
          kind: Database["public"]["Enums"]["message_kind"]
          meta: Json
          org_id: string
          parent_id: string | null
          sender_id: string | null
          sent_via: string
          visibility: Database["public"]["Enums"]["message_visibility"]
        }
        Insert: {
          body?: string
          body_json?: Json | null
          conversation_id: string
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          external_ref?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["message_kind"]
          meta?: Json
          org_id: string
          parent_id?: string | null
          sender_id?: string | null
          sent_via?: string
          visibility?: Database["public"]["Enums"]["message_visibility"]
        }
        Update: {
          body?: string
          body_json?: Json | null
          conversation_id?: string
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          external_ref?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["message_kind"]
          meta?: Json
          org_id?: string
          parent_id?: string | null
          sender_id?: string | null
          sent_via?: string
          visibility?: Database["public"]["Enums"]["message_visibility"]
        }
        Relationships: [
          { foreignKeyName: "messages_conversation_id_fkey"; columns: ["conversation_id"]; isOneToOne: false; referencedRelation: "conversations"; referencedColumns: ["id"] },
          { foreignKeyName: "messages_org_id_fkey"; columns: ["org_id"]; isOneToOne: false; referencedRelation: "organisations"; referencedColumns: ["id"] },
          { foreignKeyName: "messages_parent_id_fkey"; columns: ["parent_id"]; isOneToOne: false; referencedRelation: "messages"; referencedColumns: ["id"] },
          { foreignKeyName: "messages_sender_id_fkey"; columns: ["sender_id"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"] },
        ]
      }
      organisations: {
        Row: {
          created_at: string
          id: string
          name: string
          settings: Json
          slug: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          settings?: Json
          slug: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          settings?: Json
          slug?: string
        }
        Relationships: []
      }
      pins: {
        Row: {
          conversation_id: string
          message_id: string
          org_id: string
          pinned_at: string
          pinned_by: string | null
        }
        Insert: {
          conversation_id: string
          message_id: string
          org_id: string
          pinned_at?: string
          pinned_by?: string | null
        }
        Update: {
          conversation_id?: string
          message_id?: string
          org_id?: string
          pinned_at?: string
          pinned_by?: string | null
        }
        Relationships: [
          { foreignKeyName: "pins_conversation_id_fkey"; columns: ["conversation_id"]; isOneToOne: false; referencedRelation: "conversations"; referencedColumns: ["id"] },
          { foreignKeyName: "pins_message_id_fkey"; columns: ["message_id"]; isOneToOne: false; referencedRelation: "messages"; referencedColumns: ["id"] },
          { foreignKeyName: "pins_org_id_fkey"; columns: ["org_id"]; isOneToOne: false; referencedRelation: "organisations"; referencedColumns: ["id"] },
          { foreignKeyName: "pins_pinned_by_fkey"; columns: ["pinned_by"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"] },
        ]
      }
      profiles: {
        Row: {
          account_type: Database["public"]["Enums"]["account_type"]
          avatar_color: string
          avatar_url: string | null
          created_at: string
          deactivated_at: string | null
          display_name: string
          email: string | null
          full_name: string | null
          id: string
          last_active_at: string | null
          monday_person_id: string | null
          org_id: string
          presence: Database["public"]["Enums"]["presence_status"]
          role: Database["public"]["Enums"]["user_role"]
          status_text: string | null
          updated_at: string
        }
        Insert: {
          account_type?: Database["public"]["Enums"]["account_type"]
          avatar_color?: string
          avatar_url?: string | null
          created_at?: string
          deactivated_at?: string | null
          display_name: string
          email?: string | null
          full_name?: string | null
          id: string
          last_active_at?: string | null
          monday_person_id?: string | null
          org_id: string
          presence?: Database["public"]["Enums"]["presence_status"]
          role?: Database["public"]["Enums"]["user_role"]
          status_text?: string | null
          updated_at?: string
        }
        Update: {
          account_type?: Database["public"]["Enums"]["account_type"]
          avatar_color?: string
          avatar_url?: string | null
          created_at?: string
          deactivated_at?: string | null
          display_name?: string
          email?: string | null
          full_name?: string | null
          id?: string
          last_active_at?: string | null
          monday_person_id?: string | null
          org_id?: string
          presence?: Database["public"]["Enums"]["presence_status"]
          role?: Database["public"]["Enums"]["user_role"]
          status_text?: string | null
          updated_at?: string
        }
        Relationships: [
          { foreignKeyName: "profiles_org_id_fkey"; columns: ["org_id"]; isOneToOne: false; referencedRelation: "organisations"; referencedColumns: ["id"] },
        ]
      }
      reactions: {
        Row: {
          created_at: string
          emoji: string
          message_id: string
          org_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          emoji: string
          message_id: string
          org_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          emoji?: string
          message_id?: string
          org_id?: string
          user_id?: string
        }
        Relationships: [
          { foreignKeyName: "reactions_message_id_fkey"; columns: ["message_id"]; isOneToOne: false; referencedRelation: "messages"; referencedColumns: ["id"] },
          { foreignKeyName: "reactions_org_id_fkey"; columns: ["org_id"]; isOneToOne: false; referencedRelation: "organisations"; referencedColumns: ["id"] },
          { foreignKeyName: "reactions_user_id_fkey"; columns: ["user_id"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"] },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      auth_org_id: { Args: never; Returns: string }
      dm_between: { Args: { other: string }; Returns: string }
      is_admin: { Args: never; Returns: boolean }
      is_member: { Args: { cid: string }; Returns: boolean }
      is_team: { Args: never; Returns: boolean }
      mark_read: { Args: { cid: string }; Returns: undefined }
      my_activity: {
        Args: { max_rows?: number; since?: string }
        Returns: {
          body: string
          conversation_id: string
          created_at: string
          kind: string
          message_id: string
          sender_id: string | null
          unread: boolean
        }[]
      }
      my_conversations: {
        Args: never
        Returns: {
          archived_at: string | null
          created_at: string
          description: string | null
          id: string
          is_private: boolean
          last_message_at: string | null
          last_message_body: string | null
          last_message_kind: Database["public"]["Enums"]["message_kind"] | null
          last_message_sender_id: string | null
          last_read_at: string | null
          member_count: number
          member_ids: string[]
          muted: boolean
          name: string | null
          owner_user_id: string | null
          slug: string | null
          starred: boolean
          topic: string | null
          type: Database["public"]["Enums"]["conversation_type"]
          unread_count: number
        }[]
      }
      shares_conversation_with: { Args: { other: string }; Returns: boolean }
      storage_path_conversation_id: { Args: { name: string }; Returns: string }
      topic_conversation_id: { Args: { topic: string }; Returns: string }
    }
    Enums: {
      account_type: "customer" | "team"
      conversation_type: "owner" | "internal" | "dm" | "group_dm" | "job"
      message_kind: "text" | "system" | "document" | "approval" | "call_summary" | "broadcast"
      message_visibility: "public" | "internal"
      presence_status: "online" | "away" | "offline"
      user_role: "owner" | "delegate" | "contractor" | "cleaner" | "staff" | "admin"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

export type Tables<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Row"]
export type Enums<T extends keyof Database["public"]["Enums"]> = Database["public"]["Enums"][T]
export type Profile = Tables<"profiles">
export type Conversation = Tables<"conversations">
export type Message = Tables<"messages">
export type Pin = Tables<"pins">
export type Attachment = Tables<"attachments">
export type ConversationSummary = Database["public"]["Functions"]["my_conversations"]["Returns"][number]
export type ActivityItem = Database["public"]["Functions"]["my_activity"]["Returns"][number]
