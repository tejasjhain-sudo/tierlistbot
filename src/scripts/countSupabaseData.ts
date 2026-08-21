import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || 'https://gioxgsgiihqtbtbljnil.supabase.co';
const supabaseKey = process.env.SUPABASE_KEY || 'sb_publishable_nQlLJaj1mr2XdhA7YZFl2w_0_hGf_57';

const supabase = createClient(supabaseUrl, supabaseKey);

async function inspectSupabase() {
  const tableNames = [
    'Player',
    'PlayerTier',
    'TierHistory',
    'TestSession',
    'QueueEntry',
    'Tester',
    'GuildConfig',
    'VerificationSession',
    'StaffApplication',
    'AuditLog',
    'Blacklist',
    'profile_claims',
  ];

  console.log(`\n📊 SUPABASE DATABASE SUMMARY (${supabaseUrl})`);
  console.log('───────────────────────────────────────────────────');

  for (const table of tableNames) {
    const { count, error } = await supabase
      .from(table)
      .select('*', { count: 'exact', head: true });

    if (error) {
      console.log(`❌ ${table.padEnd(22)} : Not found or error (${error.message})`);
    } else {
      console.log(`✅ ${table.padEnd(22)} : ${count} rows`);
    }
  }
}

inspectSupabase().catch(console.error);
