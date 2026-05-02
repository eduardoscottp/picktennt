"use client";

import { useState } from "react";
import { Share2, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";

export function ShareButton({ joinUrl, joinCode }: { joinUrl: string; joinCode: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  async function copy(text: string) {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    toast("Copied to clipboard!", "success");
    setTimeout(() => setCopied(false), 2000);
  }

  async function share() {
    if (navigator.share) {
      try {
        await navigator.share({ title: "Join my tournament on Picktennt", url: joinUrl });
        return;
      } catch {}
    }
    setOpen(true);
  }

  return (
    <>
      <Button variant="outline" size="icon" onClick={share}>
        <Share2 className="h-4 w-4" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Share Tournament</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Join Code</label>
              <div className="flex items-center gap-2 mt-1">
                <div className="flex-1 bg-gray-50 rounded-xl px-4 py-3 font-mono text-2xl font-black text-brand-600 tracking-widest text-center">
                  {joinCode}
                </div>
                <Button variant="outline" size="icon" onClick={() => copy(joinCode)}>
                  {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Join Link</label>
              <div className="flex items-center gap-2 mt-1">
                <div className="flex-1 bg-gray-50 rounded-xl px-3 py-2 text-xs text-gray-500 truncate">
                  {joinUrl}
                </div>
                <Button variant="outline" size="icon" onClick={() => copy(joinUrl)}>
                  {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            <Button className="w-full" onClick={() => copy(joinUrl)}>
              Copy Link
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
