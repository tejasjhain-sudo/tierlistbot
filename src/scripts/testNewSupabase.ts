import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://xbxbbeuigpahxvinluqb.supabase.co';
const supabaseKey = 'sb_publishable_FPR8ldGG0yBKE6WUHnTxqw_fdFhQidn';

const supabase = createClient(supabaseUrl, supabaseKey);

async function testConnection() {
  console.log('Testing Supabase REST API connection...');
  try {
    const { data, error } = await supabase.from('Player').select('*').limit(1);
    if (error) {
      console.log('Supabase connected! (Tables not yet created):', error.message);
    } else {
      console.log('Supabase connected! Data:', data);
    }
  } catch (e: any) {
    console.error('Connection failed:', e.message);
  }
}

testConnection();
