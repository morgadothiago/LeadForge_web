import { MetricCard } from "@/components/domain/MetricCard";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getDashboardData, type DashboardParams } from "@/lib/queries/dashboard";
import { RecentActivities } from "./RecentActivities";
import { WeeklyChart } from "./WeeklyChart";

export async function DashboardContent({ params }: { params: DashboardParams }) {
  const { metrics, weekly, activities, isEmpty } = await getDashboardData(params);
  const cards = [
    { title: "Leads novos", m: metrics.newLeads },
    { title: "Em follow-up", m: metrics.followUp },
    { title: "Respostas", m: metrics.replies },
    { title: "Reuniões", m: metrics.meetings },
  ];
  // percent null => "—"; direction (up/down/flat) é repassada ao MetricCard: flat (0%) fica neutro
  const trendOf = (m: (typeof cards)[number]["m"]) => m.trend.percent;

  if (isEmpty) {
    return (
      <Card className="p-8 text-center">
        <p className="font-heading text-lg font-semibold">Ainda não há dados neste período</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Assim que houver leads e interações{params.campaignId ? " nesta campanha" : ""}, as métricas aparecem aqui.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <section aria-label="Métricas" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((c) => (
          <MetricCard key={c.title} title={c.title} value={c.m.value} trend={trendOf(c.m)} direction={c.m.trend.direction} />
        ))}
      </section>
      <Card>
        <CardHeader>
          <CardTitle>Últimos 7 dias</CardTitle>
          <CardDescription>Leads novos, mensagens enviadas e respostas por dia</CardDescription>
        </CardHeader>
        <CardContent>
          <WeeklyChart data={weekly} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Atividades recentes</CardTitle>
        </CardHeader>
        <CardContent>
          <RecentActivities items={activities} />
        </CardContent>
      </Card>
    </div>
  );
}
