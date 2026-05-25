"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import type { Tournament } from "@/types/database";

interface Props {
  tournament: Tournament;
}

export function AdminTournamentInfo({ tournament }: Props) {
  const [date, setDate] = useState(tournament.tournament_date ?? "");
  const [courtName, setCourtName] = useState(tournament.court_name ?? "");
  const [courtAddress, setCourtAddress] = useState(tournament.court_address ?? "");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const { toast } = useToast();

  async function save() {
    setLoading(true);
    try {
      const res = await fetch(`/api/tournaments/${tournament.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tournament_date: date || null,
          court_name: courtName.trim() || null,
          court_address: courtAddress.trim() || null,
        }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error ?? "Failed to save");
      toast("Tournament info updated", "success");
      router.refresh();
    } catch (err: any) {
      toast(err.message ?? "Failed to save", "error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Tournament Info</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Input
          label="Date"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        <Input
          label="Venue / Court Name"
          placeholder="e.g. Bayfront Park Courts"
          value={courtName}
          onChange={(e) => setCourtName(e.target.value)}
        />
        <Input
          label="Venue Address"
          placeholder="e.g. 301 Biscayne Blvd, Miami, FL"
          value={courtAddress}
          onChange={(e) => setCourtAddress(e.target.value)}
        />
        <Button onClick={save} loading={loading} className="w-full">
          Save
        </Button>
      </CardContent>
    </Card>
  );
}
