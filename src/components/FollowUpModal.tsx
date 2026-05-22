import React, { useState } from "react";
import { api } from "@/integrations/database/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { useMutation, useQueryClient } from "@tanstack/react-query";

interface FollowUpModalProps {
  isOpen: boolean;
  onClose: () => void;
  contatoId: string;
  contatoNome: string;
}

const MOTIVOS = [
  "Retorno de proposta",
  "Aguardando documento",
  "Reagendar visita",
  "Sem resposta",
  "Outro",
];

export const FollowUpModal = ({ isOpen, onClose, contatoId, contatoNome }: FollowUpModalProps) => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [dataRetorno, setDataRetorno] = useState("");
  const [motivo, setMotivo] = useState("");
  const [observacao, setObservacao] = useState("");

  const createMutation = useMutation({
    mutationFn: async () => {
      const { error } = await api.from("follow_ups").insert([
        {
          user_id: user?.id,
          contato_id: contatoId,
          data_retorno: new Date(dataRetorno).toISOString(),
          motivo,
          observacao,
          status: "pendente",
        },
      ]);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["follow-ups"] });
      toast.success("Follow-up agendado com sucesso!");
      onClose();
      setDataRetorno("");
      setMotivo("");
      setObservacao("");
    },
    onError: (error) => {
      console.error(error);
      toast.error("Erro ao agendar follow-up.");
    },
  });

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Novo Follow-up para {contatoNome}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="data">Data e Hora do Retorno</Label>
            <Input
              id="data"
              type="datetime-local"
              value={dataRetorno}
              onChange={(e) => setDataRetorno(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="motivo">Motivo</Label>
            <Select onValueChange={setMotivo} value={motivo}>
              <SelectTrigger id="motivo">
                <SelectValue placeholder="Selecione o motivo" />
              </SelectTrigger>
              <SelectContent>
                {MOTIVOS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="observacao">Observação Livre</Label>
            <Textarea
              id="observacao"
              placeholder="Descreva o que deve ser tratado..."
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            onClick={() => createMutation.mutate()}
            disabled={!dataRetorno || !motivo || createMutation.isPending}
            className="gradient-brand"
          >
            {createMutation.isPending ? "Criando..." : "Criar Follow-up"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
