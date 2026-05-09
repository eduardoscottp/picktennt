"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, ClipboardList, ListChecks, Settings } from "lucide-react";

interface TournamentBottomNavProps {
  tournamentId: string;
  isAdmin?: boolean;
}

export function TournamentBottomNav({ tournamentId, isAdmin = false }: TournamentBottomNavProps) {
  const pathname = usePathname();
  const items = [
    { href: `/tournaments/${tournamentId}`, label: "Overview", icon: ClipboardList, exact: true },
    { href: `/tournaments/${tournamentId}/matches`, label: "Matches", icon: ListChecks },
    { href: `/tournaments/${tournamentId}/leaderboard`, label: "Standings", icon: BarChart3 },
    ...(isAdmin ? [{ href: `/tournaments/${tournamentId}/admin`, label: "Admin", icon: Settings }] : []),
  ];

  return (
    <nav className="md:hidden fixed bottom-[3.75rem] inset-x-0 z-30 px-3 pointer-events-none">
      <div className="pointer-events-auto max-w-2xl mx-auto rounded-2xl bg-white border border-gray-100 shadow-lg grid overflow-hidden" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
        {items.map((item) => {
          const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-col items-center gap-1 px-2 py-2 text-[11px] font-semibold transition-colors ${
                active ? "text-brand-500 bg-brand-50" : "text-gray-400 hover:text-gray-700"
              }`}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
