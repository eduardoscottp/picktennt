"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { CheckCircle2, AlertCircle, Trophy } from "lucide-react";

interface Props {
  profileId: string;
  currentDuprId: string | null;
}

export function DuprIdCard({ profileId, currentDuprId }: Props) {
  const [value, setValue] = useState(currentDuprId ?? "");
  const [saving, setSaving] = useState(false);
  const router = useRouter();
  const { toast } = useToast();

  async function save() {
    const trimmed = value.trim();
    setSaving(true);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("profiles")
        .update({ dupr_id: trimmed || null })
        .eq("id", profileId);
      if (error) throw error;
      toast(trimmed ? "DUPR ID saved" : "DUPR ID removed", "success");
      router.refresh();
    } catch (err: any) {
      toast(err.message ?? "Save failed", "error");
    } finally {
      setSaving(false);
    }
  }

  const dirty = (value.trim() || null) !== (currentDuprId || null);
  const hasId = !!currentDuprId && currentDuprId.trim() !== "";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Trophy className="h-4 w-4 text-brand-500" />
          DUPR Connection
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {hasId ? (
          <div className="rounded-xl bg-green-50 border border-green-200 px-3 py-2 flex items-center gap-2 text-xs text-green-800">
            <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0" />
            <span>Connected · DUPR ID <span className="font-mono font-bold">{currentDuprId}</span></span>
          </div>
        ) : (
          <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 flex items-start gap-2 text-xs text-amber-800">
            <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
            <span>Add your DUPR ID so tournament results upload to your DUPR profile.</span>
          </div>
        )}
        <Input
          label="DUPR ID"
          placeholder="e.g. 67R4ND"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <Button onClick={save} loading={saving} disabled={!dirty} className="w-full">
          {hasId ? "Update DUPR ID" : "Save DUPR ID"}
        </Button>
        <p className="text-[11px] text-gray-400">
          Find your DUPR ID in the DUPR app → Profile → next to your name (short code like 67R4ND).
        </p>
      </CardContent>
    </Card>
  );
}
