import { redirect } from "next/navigation";

/** `/convite` sem token: quem tem um código de entrada vai para o signup já no modo "participar". */
export default function InviteIndexPage() {
  redirect("/signup?modo=participar");
}
