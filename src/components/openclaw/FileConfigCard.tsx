import React, { useState } from 'react';
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileText, Eye, Save, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

interface FileConfigCardProps {
  filename: string;
  description: string;
  contentPreview: string;
  onSave: (content: string) => Promise<void>;
}

export const FileConfigCard = ({ filename, description, contentPreview, onSave }: FileConfigCardProps) => {
  const [content, setContent] = useState(contentPreview);
  const [isSaving, setIsSaving] = useState(false);
  const [isOpen, setIsOpen] = useState(false);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSave(content);
      setIsOpen(false);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card className="p-4 bg-[#111] border-[#222] flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-blue-500/10 rounded-lg">
          <FileText className="w-5 h-5 text-blue-500" />
        </div>
        <div>
          <h3 className="font-bold text-gray-200">{filename}</h3>
          <p className="text-xs text-gray-500">{description}</p>
        </div>
      </div>
      
      <div className="bg-[#0a0a0a] p-3 rounded border border-[#222] font-mono text-[10px] text-gray-500 h-20 overflow-hidden relative">
        {content}
        <div className="absolute inset-0 bg-gradient-to-t from-[#0a0a0a] to-transparent" />
      </div>

      <div className="flex gap-2">
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" className="flex-1 gap-2 border-[#333] hover:bg-[#222]">
              <Eye className="w-4 h-4" /> Ver completo
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl bg-[#111] border-[#222] text-gray-100">
            <DialogHeader>
              <DialogTitle>Editando {filename}</DialogTitle>
            </DialogHeader>
            <Textarea 
              className="min-h-[400px] bg-[#0a0a0a] border-[#222] font-mono text-sm"
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
            <DialogFooter>
              <Button 
                variant="outline" 
                onClick={() => setIsOpen(false)}
                className="border-[#333]"
              >
                Cancelar
              </Button>
              <Button 
                onClick={handleSave} 
                className="bg-blue-600 hover:bg-blue-700 gap-2"
                disabled={isSaving}
              >
                {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Salvar Alterações
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </Card>
  );
};
