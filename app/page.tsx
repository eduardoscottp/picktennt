"use client";

import Link from "next/link";
import Image from "next/image";
import { Trophy, Users, BarChart3, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

const FEATURES = [
  { icon: Trophy, title: "Any Format", desc: "Singles, Doubles, and Mixed tournaments with round robin, bracket, and finals." },
  { icon: Users,  title: "Team Up",   desc: "Pick your partner or let the system match you. Seamless for every format." },
  { icon: BarChart3, title: "Live Standings", desc: "Real-time leaderboards, tiebreakers, and bracket advancement." },
  { icon: Zap,    title: "DUPR Ready", desc: "Player ratings displayed and results pushed to DUPR automatically." },
];

function signInWithGoogle() {
  const supabase = createClient();
  const callbackUrl = new URL("/auth/callback", window.location.origin);
  callbackUrl.searchParams.set("next", "/dashboard");

  supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: callbackUrl.toString(),
    },
  });
}

export default function LandingPage() {
  return (
    <div className="flex flex-col min-h-dvh bg-white">
      {/* Hero */}
      <header className="relative overflow-hidden bg-gradient-to-br from-brand-500 to-brand-700 text-white">
        <div className="absolute inset-0 opacity-10"
          style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E\")" }}
        />
        <div className="relative max-w-4xl mx-auto px-6 py-20 text-center">
          {/* Logo — white background so it pops */}
          <div className="flex justify-center mb-6">
            <div className="bg-white rounded-2xl p-4 shadow-lg">
              <Image
                src="/images/logo.png"
                alt="Picktennt Logo"
                width={64}
                height={64}
                className="object-contain"
                priority
              />
            </div>
          </div>
          <h1 className="text-5xl md:text-6xl font-black tracking-tight mb-4">
            PICKTENNT
          </h1>
          {/* Subtitle — full white */}
          <p className="text-xl md:text-2xl text-white mb-8 max-w-2xl mx-auto">
            The complete pickleball tournament platform. Create, manage, and play — all in one place.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            {/* Google Sign-in button — goes straight to Google */}
            <button
              onClick={signInWithGoogle}
              className="inline-flex items-center gap-3 bg-white text-gray-800 font-semibold text-base px-6 py-3 rounded-xl shadow-md hover:shadow-lg hover:bg-gray-50 transition-all w-full sm:w-auto justify-center"
            >
              <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              Sign in with Google
            </button>
            <a href="/tournaments">
              <Button size="xl" variant="outline" className="w-full sm:w-auto border-white text-white hover:bg-white/10">
                Browse Tournaments
              </Button>
            </a>
          </div>
        </div>
      </header>

      {/* Features */}
      <section className="max-w-4xl mx-auto px-6 py-16 grid grid-cols-1 sm:grid-cols-2 gap-6">
        {FEATURES.map((f) => (
          <div key={f.title} className="flex gap-4 p-5 rounded-2xl bg-gray-50 border border-gray-100">
            <div className="flex-shrink-0 h-12 w-12 bg-brand-50 rounded-xl flex items-center justify-center">
              <f.icon className="h-6 w-6 text-brand-500" />
            </div>
            <div>
              <h3 className="font-bold text-gray-900 mb-1">{f.title}</h3>
              <p className="text-sm text-gray-500">{f.desc}</p>
            </div>
          </div>
        ))}
      </section>

      {/* CTA */}
      <section className="bg-brand-500 text-white text-center py-16 px-6">
        <h2 className="text-3xl font-black mb-3">Ready to play?</h2>
        <p className="text-brand-100 mb-6">Join thousands of players managing their tournaments on Picktennt.</p>
        <Button size="lg" variant="white" className="font-bold" onClick={signInWithGoogle}>
          Sign in with Google
        </Button>
      </section>

      <footer className="text-center py-6 text-sm text-gray-400">
        © {new Date().getFullYear()} Picktennt. All rights reserved.
      </footer>
    </div>
  );
}
