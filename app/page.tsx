import Link from "next/link";
import Image from "next/image";
import { Trophy, Users, BarChart3, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";

const FEATURES = [
  { icon: Trophy, title: "Any Format", desc: "Singles, Doubles, and Mixed tournaments with round robin, bracket, and finals." },
  { icon: Users,  title: "Team Up",   desc: "Pick your partner or let the system match you. Seamless for every format." },
  { icon: BarChart3, title: "Live Standings", desc: "Real-time leaderboards, tiebreakers, and bracket advancement." },
  { icon: Zap,    title: "DUPR Ready", desc: "Player ratings displayed and results pushed to DUPR automatically." },
];

export default function LandingPage() {
  return (
    <div className="flex flex-col min-h-dvh bg-white">
      {/* Hero */}
      <header className="relative overflow-hidden bg-gradient-to-br from-brand-500 to-brand-700 text-white">
        <div className="absolute inset-0 opacity-10"
          style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E\")" }}
        />
        <div className="relative max-w-4xl mx-auto px-6 py-20 text-center">
          <div className="flex justify-center mb-6">
            <div className="bg-white/20 backdrop-blur rounded-2xl p-4">
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
          <p className="text-xl md:text-2xl text-brand-100 mb-8 max-w-2xl mx-auto">
            The complete pickleball tournament platform. Create, manage, and play — all in one place.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link href="/login?redirect=/dashboard">
              <Button size="xl" variant="white" className="w-full sm:w-auto font-black">
                Get Started Free
              </Button>
            </Link>
            <Link href="/login?redirect=/tournaments">
              <Button size="xl" variant="outline" className="w-full sm:w-auto border-white text-white hover:bg-white/10">
                Browse Tournaments
              </Button>
            </Link>
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
        <Link href="/login?redirect=/dashboard">
          <Button size="lg" variant="white" className="font-bold">
            Sign in with Google
          </Button>
        </Link>
      </section>

      <footer className="text-center py-6 text-sm text-gray-400">
        © {new Date().getFullYear()} Picktennt. All rights reserved.
      </footer>
    </div>
  );
}
