import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || 'https://gioxgsgiihqtbtbljnil.supabase.co';
const supabaseKey = process.env.SUPABASE_KEY || 'sb_publishable_nQlLJaj1mr2XdhA7YZFl2w_0_hGf_57';

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  console.log('Connecting to Supabase at:', supabaseUrl);

  const tablesToCheck = [
    'profile_claims',
    'players',
    'player_tiers',
    'tiers',
    'users',
    'profiles',
    'waitlist',
    'queues',
    'sessions',
    'GuildConfig',
    'Player',
    'PlayerTier'
  ];

  for (const table of tablesToCheck) {
    try {
      const { data, error } = await supabase
        .from(table)
        .select('*');

      if (error) {
        console.log(`Table '${table}': ${error.message} (Code: ${error.code})`);
      } else {
        console.log(`\n================== Table: ${table} (Total rows: ${data?.length || 0}) ==================`);
        console.log(JSON.stringify(data, null, 2));
      }
    } catch (e: any) {
      console.log(`Table '${table}': Exception - ${e.message}`);
    }
  }
}

main().catch(console.error);
