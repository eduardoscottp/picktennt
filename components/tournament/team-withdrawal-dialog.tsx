"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function TeamWithdrawalConfirmation({ teamName, busy, onConfirm, onCancel, children }: {
  teamName: string; busy: boolean; onConfirm: () => void; onCancel: () => void; children?: ReactNode;
}) {
  const [confirmed, setConfirmed] = useState(false);
  return <div className="space-y-4 text-sm">
    <p><strong>{teamName}</strong> perderá todos sus partidos del torneo, pasados y futuros, por <strong>0–11</strong>. Cada oponente recibirá una victoria <strong>11–0</strong>.</p>
    <p>Se reemplazarán los marcadores ya registrados y se actualizarán la clasificación y las posiciones. El equipo quedará retirado. El historial de cambios se conservará; este botón no permite deshacer el retiro.</p>
    <p>Estos resultados administrativos no se enviarán a DUPR. Los resultados enviados anteriormente no se modifican automáticamente y requieren revisión por separado.</p>
    {children}
    <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} /><span>Confirmo el retiro de {teamName} y el cambio de todos sus partidos a derrota 0–11.</span></label>
    <div className="flex justify-end gap-2"><Button variant="ghost" disabled={busy} onClick={onCancel}>Cancelar</Button><Button variant="danger" loading={busy} disabled={!confirmed || busy} onClick={onConfirm}>Confirmar retiro 0–11</Button></div>
  </div>;
}

export function TeamWithdrawalDialog({ open, onOpenChange, teamName, busy, onConfirm, children }: {
  open: boolean; onOpenChange: (open: boolean) => void; teamName: string; busy: boolean; onConfirm: () => void; children?: ReactNode;
}) {
  return <Dialog open={open} onOpenChange={value => { if (!busy) onOpenChange(value); }}><DialogContent><DialogHeader><DialogTitle>Confirmar retiro de equipo</DialogTitle><DialogDescription>Revisa el cambio de resultados de {teamName} antes de confirmar.</DialogDescription></DialogHeader>{open && <TeamWithdrawalConfirmation teamName={teamName} busy={busy} onConfirm={onConfirm} onCancel={() => onOpenChange(false)}>{children}</TeamWithdrawalConfirmation>}</DialogContent></Dialog>;
}
