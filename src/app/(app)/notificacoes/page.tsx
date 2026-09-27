import { NotificationsList } from "@/components/notifications/NotificationsList";
import { requirePageUser } from "@/lib/auth/require-page";

export const dynamic = "force-dynamic";

export default async function Page() {
  await requirePageUser();
  return <NotificationsList />;
}
