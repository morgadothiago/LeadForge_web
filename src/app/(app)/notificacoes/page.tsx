import { NotificationsList } from "@/components/notifications/NotificationsList";
import { redirectIfTrialExpired, requirePageUser } from "@/lib/auth/require-page";

export const dynamic = "force-dynamic";

export default async function Page() {
  await requirePageUser();
  await redirectIfTrialExpired(); // SPEC-065 (D-065-13.3)
  return <NotificationsList />;
}
