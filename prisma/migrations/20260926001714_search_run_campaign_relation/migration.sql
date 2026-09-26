-- AddForeignKey
ALTER TABLE "SearchRun" ADD CONSTRAINT "SearchRun_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
