"use client";
import { usePathname } from "next/navigation";
import { getPageTitle } from "./nav-items";

export function PageTitle() {
  return <h1 className="truncate font-heading text-lg font-semibold">{getPageTitle(usePathname())}</h1>;
}
