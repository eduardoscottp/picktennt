"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { LogOut, Trash2, AlertTriangle } from "lucide-react";

export function AccountActions() {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [loadingLogout, setLoadingLogout] = useState(false);
  const [loadingDelete, setLoadingDelete] = useState(false);
  const router = useRouter();
  const { toast } = useToast();

  async function signOut() {
    setLoadingLogout(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  }

  async function deleteAccount() {
    setLoadingDelete(true);
    try {
      const res = await fetch("/api/account/delete", { method: "DELETE" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to delete account");
      toast("Account deleted.", "success");
      router.push("/");
    } catch (err: any) {
      toast(err.message, "error");
      setLoadingDelete(false);
      setConfirmDelete(false);
    }
  }

  return (
    <div className="space-y-3 pt-2 border-t border-gray-100">
      <Button
        variant="secondary"
        onClick={signOut}
        loading={loadingLogout}
        className="w-full"
      >
        <LogOut className="h-4 w-4" />
        Sign Out
      </Button>

      {!confirmDelete ? (
        <button
          onClick={() => setConfirmDelete(true)}
          className="w-full text-sm text-red-400 hover:text-red-600 transition-colors py-1"
        >
          Delete my account
        </button>
      ) : (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 space-y-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-700 leading-snug">
              This permanently deletes your account and all your data. You cannot undo this.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="danger"
              size="sm"
              onClick={deleteAccount}
              loading={loadingDelete}
              className="flex-1"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Yes, delete
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setConfirmDelete(false)}
              className="flex-1"
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
