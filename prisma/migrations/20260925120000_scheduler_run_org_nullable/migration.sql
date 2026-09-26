-- SPEC-030: SchedulerRun.orgId volta a ser opcional -- rodadas "meta" do tick (status "locked", sem
-- organizacao especifica) nao tem org; rodadas normais passam a ter 1 linha por Organization ativa
-- processada (cron agora itera por org, ver src/lib/scheduler/run-tick.ts).
ALTER TABLE "SchedulerRun" ALTER COLUMN "orgId" DROP NOT NULL;
