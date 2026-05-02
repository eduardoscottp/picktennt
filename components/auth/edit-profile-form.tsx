"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import type { Profile } from "@/types/database";

export function EditProfileForm({ profile }: { profile: Profile }) {
  const [editing, setEditing] = useState(false);
  const [firstName, setFirstName] = useState(profile.first_name ?? "");
  const [lastName, setLastName] = useState(profile.last_name ?? "");
  const [age, setAge] = useState(String(profile.age ?? ""));
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const { toast } = useToast();

  async function save() {
    setLoading(true);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("profiles")
        .update({
          first_name: firstName.trim() || null,
          last_name: lastName.trim() || null,
          age: age ? parseInt(age) : null,
        })
        .eq("id", profile.id);
      if (error) throw error;
      toast("Profile updated!", "success");
      setEditing(false);
      router.refresh();
    } catch (err: any) {
      toast(err.message, "error");
    } finally {
      setLoading(false);
    }
  }

  if (!editing) {
    return (
      <Button variant="outline" size="sm" onClick={() => setEditing(true)} className="w-full">
        Edit Profile
      </Button>
    );
  }

  return (
    <div className="space-y-3 pt-2">
      <div className="grid grid-cols-2 gap-3">
        <Input
          label="First Name"
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
        />
        <Input
          label="Last Name"
          value={lastName}
          onChange={(e) => setLastName(e.target.value)}
        />
      </div>
      <Input
        label="Age"
        type="number"
        value={age}
        onChange={(e) => setAge(e.target.value)}
      />
      <div className="flex gap-2">
        <Button onClick={save} loading={loading} className="flex-1">Save</Button>
        <Button variant="secondary" onClick={() => setEditing(false)} className="flex-1">Cancel</Button>
      </div>
    </div>
  );
}
