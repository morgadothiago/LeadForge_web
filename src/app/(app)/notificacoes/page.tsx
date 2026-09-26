import { NotificationsList } from "@/components/notifications/NotificationsList";
import { requireUser } from "@/lib/auth/require-user";

export const dynamic = "force-dynamic";

export default async function Page() {
  await requireUser();
  return <NotificationsList />;
}
