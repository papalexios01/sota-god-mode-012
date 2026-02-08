# Root cause: Database Offline badge while Supabase works

Console error:
  ReferenceError: isSupabaseConfigured is not defined

This comes from SupabaseSyncProvider referencing an identifier that is not in scope.
When that throws, the provider falls back to offline mode UI even though Supabase queries may still work.

Fix:
- Remove any reference to `isSupabaseConfigured` identifier.
- Use `getSupabaseConfig().configured` directly in the provider logic.
