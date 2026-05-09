"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter, usePathname } from "next/navigation";
import { Home, Trophy, User, Plus, LogOut, Shield } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { getInitials } from "@/lib/utils";
import type { Profile } from "@/types/database";

const NAV_ITEMS = [
  { href: "/dashboard",          label: "Home",        icon: Home },
  { href: "/tournaments",        label: "Tournaments", icon: Trophy },
  { href: "/tournaments/create", label: "Create",      icon: Plus },
  { href: "/profile",            label: "Profile",     icon: User },
];

export function Navbar({ profile }: { profile: Profile | null }) {
  const router = useRouter();
  const pathname = usePathname();

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  }

  return (
    <>
      {/* Top bar — desktop */}
      <header className="hidden md:flex items-center justify-between px-6 py-3 bg-white border-b border-gray-100 sticky top-0 z-40 shadow-sm">
        <Link href="/dashboard" className="flex items-center gap-2">
          <Image src="/images/logo.png" alt="Picktennt" width={32} height={32} className="object-contain" />
          <span className="font-black text-xl tracking-tight text-brand-500">
            PICKTENNT
          </span>
        </Link>

        <nav className="flex items-center gap-1">
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  active ? "bg-brand-50 text-brand-600" : "text-gray-500 hover:text-gray-800 hover:bg-gray-50"
                }`}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
          {profile?.is_system_admin && (
            <Link href="/admin" className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-purple-600 hover:bg-purple-50">
              <Shield className="h-4 w-4" />
              Admin
            </Link>
          )}
        </nav>

        <div className="flex items-center gap-3">
          {profile && (
            <span className="text-sm text-gray-600 font-medium">
              {profile.first_name} {profile.last_name}
            </span>
          )}
          <Avatar className="h-9 w-9 cursor-pointer">
            <AvatarImage src={profile?.avatar_url ?? ""} />
            <AvatarFallback>{getInitials(profile?.first_name, profile?.last_name)}</AvatarFallback>
          </Avatar>
          <button onClick={signOut} className="text-gray-400 hover:text-red-500 transition-colors p-1">
            <LogOut className="h-5 w-5" />
          </button>
        </div>
      </header>

      {/* Bottom nav — mobile */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-white border-t border-gray-100 flex items-center justify-around pb-safe">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          const isCreate = item.href === "/tournaments/create";
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-col items-center gap-0.5 px-3 py-2 text-xs font-medium transition-colors ${
                isCreate
                  ? "relative -top-4 bg-brand-500 text-white rounded-full p-3 shadow-lg shadow-brand-300"
                  : active
                  ? "text-brand-500"
                  : "text-gray-400"
              }`}
            >
              <item.icon className={isCreate ? "h-6 w-6" : "h-5 w-5"} />
              {!isCreate && item.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}

/* Mobile top bar shown inside pages */
export function MobileHeader({ title, back }: { title: string; back?: string }) {
  const router = useRouter();
  return (
    <div className="md:hidden flex items-center gap-3 px-4 py-3 bg-white border-b border-gray-100 sticky top-0 z-30">
      {back && (
        <button onClick={() => router.back()} className="text-gray-500 p-1">
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
      )}
      <span className="font-bold text-lg text-gray-900 flex-1">{title}</span>
    </div>
  );
}
