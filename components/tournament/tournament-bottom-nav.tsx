"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, ClipboardList, ListChecks, Settings } from "lucide-react";

interface TournamentNavProps {
  tournamentId: string;
  isAdmin?: boolean;
  placement?: "top" | "bottom";
}

function TournamentNavItems({ tournamentId, isAdmin = false, placement = "bottom" }: TournamentNavProps) {
  const pathname = usePathname();
  const items = [
    { href: `/tournaments/${tournamentId}`, label: "Overview", icon: ClipboardList, exact: true },
    { href: `/tournaments/${tournamentId}/matches`, label: "Matches", icon: ListChecks },
    { href: `/tournaments/${tournamentId}/leaderboard`, label: "Standings", icon: BarChart3 },
    ...(isAdmin ? [{ href: `/tournaments/${tournamentId}/admin`, label: "Admin", icon: Settings }] : []),
  ];

  return (
    <div
      className={placement === "top"
        ? "rounded-2xl bg-white border border-gray-100 shadow-sm grid overflow-hidden"
        : "pointer-events-auto max-w-2xl mx-auto rounded-2xl bg-white border border-gray-100 shadow-lg grid overflow-hidden"
      }
      style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
    >
      {items.map((item) => {
        const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex ${placement === "top" ? "flex-row justify-center" : "flex-col"} items-center gap-1 px-2 py-2 text-[11px] font-semibold transition-colors ${
              active ? "text-brand-500 bg-brand-50" : "text-gray-400 hover:text-gray-700"
            }`}
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}

export function TournamentTopNav(props: Omit<TournamentNavProps, "placement">) {
  return <TournamentNavItems {...props} placement="top" />;
}

export function TournamentBottomNav(props: Omit<TournamentNavProps, "placement">) {
  return (
    <nav className="md:hidden fixed bottom-[3.75rem] inset-x-0 z-30 px-3 pointer-events-none">
      <TournamentNavItems {...props} placement="bottom" />
    </nav>
  );
}
