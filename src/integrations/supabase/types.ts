export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      daily_capacity: {
        Row: {
          available_hours: number
          created_at: string
          date: string
          energy_level: string
          id: string
          recovery_notes: string | null
          recovery_rating: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          available_hours?: number
          created_at?: string
          date: string
          energy_level?: string
          id?: string
          recovery_notes?: string | null
          recovery_rating?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          available_hours?: number
          created_at?: string
          date?: string
          energy_level?: string
          id?: string
          recovery_notes?: string | null
          recovery_rating?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      focus_sessions: {
        Row: {
          created_at: string
          ended_at: string | null
          id: string
          outcome: Database["public"]["Enums"]["focus_outcome"] | null
          planned_minutes: number
          started_at: string
          task_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          ended_at?: string | null
          id?: string
          outcome?: Database["public"]["Enums"]["focus_outcome"] | null
          planned_minutes?: number
          started_at?: string
          task_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          ended_at?: string | null
          id?: string
          outcome?: Database["public"]["Enums"]["focus_outcome"] | null
          planned_minutes?: number
          started_at?: string
          task_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "focus_sessions_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      tasks: {
        Row: {
          created_at: string
          deadline: string | null
          domain: Database["public"]["Enums"]["task_domain"] | null
          duration_minutes: number | null
          effort_level: string | null
          end_time: string | null
          energy: string | null
          id: string
          involves_others: boolean
          is_rest: boolean
          last_mood: Database["public"]["Enums"]["mood"] | null
          next_action: string | null
          notes: string | null
          others_rely: boolean
          priority: Database["public"]["Enums"]["task_priority"]
          progress: number
          replanning_reason: Database["public"]["Enums"]["replan_reason"] | null
          reschedule_count: number
          scheduled_date: string | null
          start_time: string | null
          status: Database["public"]["Enums"]["task_status"]
          subtasks: Json
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          deadline?: string | null
          domain?: Database["public"]["Enums"]["task_domain"] | null
          duration_minutes?: number | null
          effort_level?: string | null
          end_time?: string | null
          energy?: string | null
          id?: string
          involves_others?: boolean
          is_rest?: boolean
          last_mood?: Database["public"]["Enums"]["mood"] | null
          next_action?: string | null
          notes?: string | null
          others_rely?: boolean
          priority?: Database["public"]["Enums"]["task_priority"]
          progress?: number
          replanning_reason?:
            | Database["public"]["Enums"]["replan_reason"]
            | null
          reschedule_count?: number
          scheduled_date?: string | null
          start_time?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          subtasks?: Json
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          deadline?: string | null
          domain?: Database["public"]["Enums"]["task_domain"] | null
          duration_minutes?: number | null
          effort_level?: string | null
          end_time?: string | null
          energy?: string | null
          id?: string
          involves_others?: boolean
          is_rest?: boolean
          last_mood?: Database["public"]["Enums"]["mood"] | null
          next_action?: string | null
          notes?: string | null
          others_rely?: boolean
          priority?: Database["public"]["Enums"]["task_priority"]
          progress?: number
          replanning_reason?:
            | Database["public"]["Enums"]["replan_reason"]
            | null
          reschedule_count?: number
          scheduled_date?: string | null
          start_time?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          subtasks?: Json
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_profiles: {
        Row: {
          created_at: string
          daily_capacity_minutes: number
          default_time_blocks: Json
          id: string
          onboarding_completed: boolean
          preferred_tasks_per_day: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          daily_capacity_minutes?: number
          default_time_blocks?: Json
          id?: string
          onboarding_completed?: boolean
          preferred_tasks_per_day?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          daily_capacity_minutes?: number
          default_time_blocks?: Json
          id?: string
          onboarding_completed?: boolean
          preferred_tasks_per_day?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "user"
      focus_outcome:
        | "completed"
        | "more_time"
        | "replan"
        | "abandoned"
        | "blocked"
      mood: "fine" | "tired" | "overwhelmed" | "frustrated" | "unsure"
      replan_reason:
        | "too_tired"
        | "underestimated"
        | "waiting_others"
        | "higher_priority"
        | "needed_more_time"
        | "circumstances_changed"
      task_domain: "academic" | "work" | "social" | "personal"
      task_priority: "must" | "should" | "could"
      task_status:
        | "not_started"
        | "in_progress"
        | "done"
        | "rescheduled"
        | "started"
        | "blocked"
        | "nearly_done"
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
  public: {
    Enums: {
      app_role: ["admin", "user"],
      focus_outcome: [
        "completed",
        "more_time",
        "replan",
        "abandoned",
        "blocked",
      ],
      mood: ["fine", "tired", "overwhelmed", "frustrated", "unsure"],
      replan_reason: [
        "too_tired",
        "underestimated",
        "waiting_others",
        "higher_priority",
        "needed_more_time",
        "circumstances_changed",
      ],
      task_domain: ["academic", "work", "social", "personal"],
      task_priority: ["must", "should", "could"],
      task_status: [
        "not_started",
        "in_progress",
        "done",
        "rescheduled",
        "started",
        "blocked",
        "nearly_done",
      ],
    },
  },
} as const
