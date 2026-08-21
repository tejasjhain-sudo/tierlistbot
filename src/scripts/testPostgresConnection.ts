import { PrismaClient } from '@prisma/client';

const passwordsToTest = [
  'Rearmc3321%40',
  'Rearmc3321@',
  'Rearmc%40321%23',
  'Rearmc321%40',
  'Rearmc@321#',
  'Rearmc321#',
];

async function testPostgres() {
  for (const pw of passwordsToTest) {
    const directUrl = `postgresql://postgres.xbxbbeuigpahxvinluqb:${encodeURIComponent(pw.replace(/%40/g, '@').replace(/%23/g, '#'))}@aws-0-ap-south-1.pooler.supabase.com:5432/postgres`;
    console.log(`Testing password: ${pw}...`);
    const prisma = new PrismaClient({
      datasources: {
        db: {
          url: directUrl,
        },
      },
    });

    try {
      await prisma.$connect();
      console.log(`🎉 SUCCESS! Connected to Supabase Postgres with password: ${pw}`);
      await prisma.$disconnect();
      return directUrl;
    } catch (e: any) {
      console.log(`❌ Failed with ${pw}:`, e.message?.slice(0, 100));
      await prisma.$disconnect();
    }
  }
}

testPostgres();
