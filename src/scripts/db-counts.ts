// Somente leitura: contagens por tabela (usado para provar que a suíte não altera o banco de DEV).
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  const out = {
    leads: await prisma.lead.count(),
    campaigns: await prisma.campaign.count(),
    touches: await prisma.touch.count(),
    suppressions: await prisma.suppression.count(),
    webhookEvents: await prisma.webhookEvent.count(),
    schedulerRuns: await prisma.schedulerRun.count(),
    integrationSecrets: await prisma.integrationSecret.count(),
    users: await prisma.user.count(),
    emailAccounts: await prisma.emailAccount.count(),
    whatsappInstances: await prisma.whatsAppInstance.count(),
  };
  console.log(JSON.stringify(out));
  await prisma.$disconnect();
}
main();
