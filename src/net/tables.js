// Every table and procedure name the game uses in its Supabase project, in one place. The
// project is shared with another app, so everything of ours carries the fairway_ prefix.
// Column names are the server's: fairway_profiles (id, display_name, created_at),
// fairway_saves (user_id, version, data, updated_at), fairway_scores (id, user_id,
// display_name, board, value, meta, created_at).
export const TABLES = Object.freeze({
  profiles: 'fairway_profiles',
  saves: 'fairway_saves',
  scores: 'fairway_scores',
});
export const RPCS = Object.freeze({
  newChallenge: 'fairway_new_challenge',
  deleteMyAccount: 'fairway_delete_my_account',
});
