import Link from "next/link";

export function Logo() {
  return (
    <Link
      href="/"
      className="flex h-16 items-center px-6 font-heading text-xl font-bold text-primary outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
    >
      LeadForge
    </Link>
  );
}
