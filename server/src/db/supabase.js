const { createClient } = require('@supabase/supabase-js');

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('.env に SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY を設定してください');
}

// service_role キーを使用（RLS をバイパスしてサーバーから直接操作できる）
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = supabase;
